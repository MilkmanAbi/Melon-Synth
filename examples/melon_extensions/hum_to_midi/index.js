/**
 * Hum to MIDI — Melon Synth extension  v1.0.0
 * =============================================
 * Records mic input, detects pitch with YIN algorithm, inserts MIDI notes.
 * No build step needed — pure browser JS using React.createElement.
 *
 * Algorithm:
 *   1. getUserMedia → MediaRecorder → collect PCM
 *   2. AudioContext.decodeAudioData → Float32Array mono signal
 *   3. YIN pitch detection per frame (2048 samples, 512 hop)
 *   4. Median-filter pitch contour, group into note segments
 *   5. Quantize timing to beat grid
 *   6. Insert via melonAPI.project.addNotes at playhead position
 *
 * Optional backend enhancement: if Python backend is available and
 * aubio is installed, backend.py is used for higher accuracy.
 */
(function () {
'use strict';

// ── Grab React from global (set by AddonPanelHost) ─────────────────────────
const R = window.React;
const h = R.createElement;
const { useState, useEffect, useRef, useCallback } = R;

// ── YIN pitch detection ────────────────────────────────────────────────────
// Returns Hz or -1 if no confident pitch found.
// Based on: de Cheveigné & Kawahara (2002) "YIN, a fundamental frequency
// estimator for speech and music", JASA 111(4).

const YIN_THRESH  = 0.12;
const MIN_HZ      = 60;    // C2
const MAX_HZ      = 1200;  // D6

function detectPitch(buf, sr) {
  const half   = buf.length >> 1;
  const minLag = Math.max(2, Math.floor(sr / MAX_HZ));
  const maxLag = Math.min(half - 1, Math.ceil(sr / MIN_HZ));
  const d      = new Float32Array(maxLag + 1);

  // Cumulative mean normalised difference function
  d[0] = 1.0;
  let runSum = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    let s = 0;
    const lim = half;
    for (let i = 0; i < lim; i++) {
      const delta = buf[i] - buf[i + tau];
      s += delta * delta;
    }
    runSum += s;
    d[tau] = s * tau / (runSum + 1e-10);
  }

  // Find first dip below threshold
  let tau = minLag;
  while (tau < maxLag) {
    if (d[tau] < YIN_THRESH) {
      while (tau + 1 <= maxLag && d[tau + 1] < d[tau]) tau++;
      break;
    }
    tau++;
  }
  if (tau >= maxLag || d[tau] >= YIN_THRESH) return -1;

  // Parabolic interpolation for sub-sample accuracy
  if (tau > 0 && tau < maxLag) {
    const s = 2 * d[tau] - d[tau - 1] - d[tau + 1];
    if (Math.abs(s) > 1e-10) tau = tau + (d[tau + 1] - d[tau - 1]) / (2 * s);
  }
  return sr / tau;
}

// ── Signal utils ───────────────────────────────────────────────────────────

const hzToMidi  = hz => hz > 0 ? 69 + 12 * Math.log2(hz / 440) : null;
const midiRound = m  => (m !== null ? Math.max(21, Math.min(108, Math.round(m))) : null);

function noteName(midi) {
  const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

function medianFilter(arr, r) {
  return arr.map((_, i) => {
    const w = arr.slice(Math.max(0, i - r), Math.min(arr.length, i + r + 1))
               .filter(x => x !== null);
    if (!w.length) return null;
    w.sort((a, b) => a - b);
    return w.length % 2 ? w[w.length >> 1] : (w[(w.length >> 1) - 1] + w[w.length >> 1]) / 2;
  });
}

// ── Core analysis ──────────────────────────────────────────────────────────

const FRAME     = 2048;
const HOP       = 512;
const SIL_RMS   = 0.008;  // silence threshold
const MIN_FRMS  = 3;      // min frames for a real note (~35ms)
const PITCH_TOL = 0.55;   // semitone tolerance before treating as new note

function analyzeLocal(pcm, sr, bpm, snapBeats) {
  const hopSec  = HOP / sr;
  const beatSec = 60 / bpm;
  const nFrames = Math.floor((pcm.length - FRAME) / HOP) + 1;

  // Step 1: per-frame pitch
  const raw = [];
  for (let fi = 0; fi < nFrames; fi++) {
    const s     = fi * HOP;
    const frame = pcm.subarray(s, s + FRAME);
    const loud  = rms(frame);
    if (loud < SIL_RMS) { raw.push(null); continue; }
    const hz   = detectPitch(frame, sr);
    const midi = hzToMidi(hz);
    raw.push(midi !== null && midi > 30 && midi < 100 ? midi : null);
  }

  // Step 2: smooth with median filter to kill octave jumps
  const smooth = medianFilter(raw, 3);

  // Step 3: group into note segments
  const notes = [];
  let start  = null;
  let midis  = [];

  const flush = (endFi) => {
    if (start === null || midis.length < MIN_FRMS) { start = null; midis = []; return; }
    const med      = [...midis].sort((a, b) => a - b);
    const midiMed  = med[med.length >> 1];
    const midiInt  = midiRound(midiMed);
    if (midiInt === null) { start = null; midis = []; return; }

    const startSec   = start * hopSec;
    const durSec     = (endFi - start) * hopSec;
    const startBeat  = quantGrid(startSec / beatSec, snapBeats);
    const durBeats   = Math.max(snapBeats, quantGrid(durSec / beatSec, snapBeats));

    notes.push({
      midi:          midiInt,
      startBeat,
      durationBeats: durBeats,
      noteName:      noteName(midiInt),
      confidence:    Math.min(1, midis.length / 16),
    });
    start = null; midis = [];
  };

  for (let fi = 0; fi < smooth.length; fi++) {
    const m = smooth[fi];
    if (m === null) { flush(fi); continue; }
    if (start === null) { start = fi; midis = [m]; continue; }
    const prev = midis.slice(-4).reduce((a, b) => a + b, 0) / Math.min(4, midis.length);
    if (Math.abs(m - prev) > PITCH_TOL) { flush(fi); start = fi; midis = [m]; }
    else midis.push(m);
  }
  flush(smooth.length);
  return notes;
}

const quantGrid = (beats, snap) => Math.round(beats / snap) * snap;

// ── Mini piano-roll preview ────────────────────────────────────────────────

function NotePreview({ notes, snapBeats }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !notes.length) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const midis  = notes.map(n => n.midi);
    const lo     = Math.min(...midis) - 2;
    const hi     = Math.max(...midis) + 2;
    const endB   = Math.max(...notes.map(n => n.startBeat + n.durationBeats)) + snapBeats;
    const pxPerB = (W - 4) / endB;
    const pxPerS = (H - 4) / (hi - lo + 1);

    // Background
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-sunken') || '#1a1a1a';
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let b = 0; b <= endB; b += snapBeats) {
      const x = 2 + b * pxPerB;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }

    // Notes
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#4DBF90';
    notes.forEach(n => {
      const x = 2 + n.startBeat * pxPerB;
      const y = H - 2 - (n.midi - lo + 1) * pxPerS;
      const w = Math.max(2, n.durationBeats * pxPerB - 1);
      const h = Math.max(3, pxPerS - 1);
      ctx.fillStyle = accent + 'CC';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, w, h, 2) : ctx.rect(x, y, w, h);
      ctx.fill();
      // Note name label if wide enough
      if (w > 20) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.font = `${Math.min(10, h - 1)}px system-ui`;
        ctx.fillText(n.noteName, x + 2, y + Math.min(10, h - 1));
      }
    });
  }, [notes, snapBeats]);

  return h('canvas', { ref, width: 274, height: 62, style: { borderRadius: 6, display: 'block' } });
}

// ── Waveform display (live during recording) ───────────────────────────────

function Waveform({ analyser, recording }) {
  const ref = useRef(null);
  const raf = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx    = canvas.getContext('2d');
    const W      = canvas.width, H = canvas.height;
    const buf    = new Float32Array(256);

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-sunken') || '#1a1a1a';
      ctx.fillRect(0, 0, W, H);

      if (analyser) {
        analyser.getFloatTimeDomainData(buf);
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#4DBF90';
        ctx.strokeStyle = recording ? (accent || '#4DBF90') : 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < buf.length; i++) {
          const x = (i / buf.length) * W;
          const y = (0.5 + buf[i] * 0.45) * H;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        // Flat line
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
      }
      raf.current = requestAnimationFrame(draw);
    };

    raf.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf.current);
  }, [analyser, recording]);

  return h('canvas', { ref, width: 274, height: 44, style: { borderRadius: 6, display: 'block' } });
}

// ── Main panel component ───────────────────────────────────────────────────

const SNAP_OPTIONS = [
  { label: '1/4',  value: 1 },
  { label: '1/8',  value: 0.5 },
  { label: '1/16', value: 0.25 },
  { label: '1/32', value: 0.125 },
];

function HumToMidiPanel({ melonAPI }) {
  const [recording,  setRecording]  = useState(false);
  const [processing, setProcessing] = useState(false);
  const [notes,      setNotes]      = useState([]);
  const [snapBeats,  setSnapBeats]  = useState(0.5);
  const [shift,      setShift]      = useState(0);
  const [elapsed,    setElapsed]    = useState(0);
  const [status,     setStatus]     = useState('');
  const [micError,   setMicError]   = useState('');
  const [analyser,   setAnalyser]   = useState(null);

  const mediaRec   = useRef(null);
  const audioCtx   = useRef(null);
  const sourceNode = useRef(null);
  const stream     = useRef(null);
  const chunks     = useRef([]);
  const timerRef   = useRef(null);
  const startTime  = useRef(0);

  // Transpose notes when shift changes
  const shiftedNotes = notes.map(n => ({ ...n, midi: Math.max(21, Math.min(108, n.midi + shift)) }));

  const bpm = melonAPI?.project?.getBpm?.() ?? 120;

  // ── Recording ────────────────────────────────────────────────────────────

  const startRec = useCallback(async () => {
    setMicError(''); setNotes([]); setStatus('');
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      stream.current = s;
      chunks.current = [];

      // AudioContext for real-time waveform
      const ac    = new AudioContext();
      audioCtx.current = ac;
      const src   = ac.createMediaStreamSource(s);
      const anal  = ac.createAnalyser();
      anal.fftSize = 512;
      src.connect(anal);
      sourceNode.current = src;
      setAnalyser(anal);

      // MediaRecorder for actual PCM capture
      const mr = new MediaRecorder(s, { mimeType: 'audio/webm;codecs=opus' });
      mr.ondataavailable = e => { if (e.data.size > 0) chunks.current.push(e.data); };
      mr.onstop = () => processRecording(ac);
      mr.start(100);
      mediaRec.current = mr;

      setRecording(true);
      startTime.current = Date.now();
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startTime.current) / 1000)), 200);
    } catch (e) {
      setMicError(e.name === 'NotAllowedError' ? 'Microphone permission denied.' : `Mic error: ${e.message}`);
    }
  }, [bpm, snapBeats]);

  const stopRec = useCallback(() => {
    clearInterval(timerRef.current);
    mediaRec.current?.stop();
    stream.current?.getTracks().forEach(t => t.stop());
    setRecording(false);
    setAnalyser(null);
    setProcessing(true);
    setStatus('Analysing pitch…');
  }, []);

  const processRecording = useCallback(async (ac) => {
    try {
      if (!chunks.current.length) { setProcessing(false); setStatus('No audio captured.'); return; }

      const blob   = new Blob(chunks.current, { type: 'audio/webm' });
      const arrBuf = await blob.arrayBuffer();
      const audio  = await ac.decodeAudioData(arrBuf);

      // Mixdown to mono Float32
      let pcm;
      if (audio.numberOfChannels === 1) {
        pcm = audio.getChannelData(0);
      } else {
        const left  = audio.getChannelData(0);
        const right = audio.getChannelData(1);
        pcm = new Float32Array(left.length);
        for (let i = 0; i < left.length; i++) pcm[i] = (left[i] + right[i]) * 0.5;
      }

      await ac.close();

      // Try Python backend first (better quality with aubio)
      let detectedNotes = null;
      try {
        const pcmB64 = arrayToBase64(pcm);
        const result = await melonAPI.ui?.callExtensionBackend?.('hum_to_midi', 'analyze_hum', {
          pcm_b64:    pcmB64,
          sample_rate: audio.sampleRate,
          bpm,
          snap_beats:  snapBeats,
        });
        if (result?.notes?.length) {
          detectedNotes = result.notes;
          setStatus(`${detectedNotes.length} notes (via aubio)`);
        }
      } catch (_) {
        // Backend unavailable — use JS engine
      }

      if (!detectedNotes) {
        detectedNotes = analyzeLocal(pcm, audio.sampleRate, bpm, snapBeats);
        setStatus(detectedNotes.length ? `${detectedNotes.length} note${detectedNotes.length !== 1 ? 's' : ''} detected` : 'No notes found — try humming louder');
      }

      setNotes(detectedNotes);
    } catch (e) {
      setStatus(`Analysis failed: ${e.message}`);
    } finally {
      setProcessing(false);
    }
  }, [bpm, snapBeats, melonAPI]);

  // ── Insert into project ───────────────────────────────────────────────────

  const insertNotes = useCallback(async () => {
    if (!shiftedNotes.length) return;
    const playhead = melonAPI?.project?.getPlayheadPosition?.() ?? 0;
    const toInsert = shiftedNotes.map(n => ({
      pitch:    n.midi,
      start:    playhead + n.startBeat,
      duration: n.durationBeats,
      lyric:    n.noteName,
    }));
    try {
      await melonAPI.project.addNotes(toInsert);
      melonAPI.ui.notify({ type: 'success', title: `Inserted ${toInsert.length} note${toInsert.length !== 1 ? 's' : ''}` });
      setNotes([]);
      setStatus('');
      setShift(0);
    } catch (e) {
      melonAPI.ui.notify({ type: 'error', title: 'Insert failed', body: e.message });
    }
  }, [shiftedNotes, melonAPI]);

  // ── Styles ────────────────────────────────────────────────────────────────

  const css = {
    panel:    { padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'system-ui, sans-serif', fontSize: 12 },
    row:      { display: 'flex', alignItems: 'center', gap: 6 },
    label:    { fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 },
    recBtn:   (rec) => ({
      flex: '1', height: 34, borderRadius: 8, border: 'none', cursor: 'pointer',
      fontSize: 13, fontWeight: 600,
      background: rec ? '#E8607A' : 'var(--accent)',
      color: 'white',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      transition: 'background 150ms',
      boxShadow: rec ? '0 0 0 3px rgba(232,96,122,0.25)' : 'none',
    }),
    chip:     (active) => ({
      padding: '2px 8px', borderRadius: 20, fontSize: 11, cursor: 'pointer', border: 'none',
      background: active ? 'var(--accent)' : 'var(--bg-sunken)',
      color: active ? 'white' : 'var(--text-secondary)',
    }),
    insertBtn: {
      flex: 1, height: 30, borderRadius: 6, border: 'none', cursor: 'pointer',
      background: 'var(--accent)', color: 'white', fontSize: 12, fontWeight: 600,
    },
    clearBtn:  {
      height: 30, padding: '0 10px', borderRadius: 6, border: '0.5px solid var(--border-subtle)',
      cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary)', fontSize: 11,
    },
    shiftBtn:  {
      width: 22, height: 22, borderRadius: 4, border: '0.5px solid var(--border-subtle)',
      cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
    status:   { fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', minHeight: 14 },
    err:      { fontSize: 11, color: 'var(--danger)', padding: '4px 8px', background: 'var(--danger-subtle)', borderRadius: 4 },
  };

  const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return h('div', { style: css.panel },

    // Waveform + timer
    h('div', { style: { position: 'relative' } },
      h(Waveform, { analyser, recording }),
      recording && h('span', {
        style: { position: 'absolute', right: 6, bottom: 5, fontSize: 10,
                 color: '#E8607A', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }
      }, '● ' + fmt(elapsed)),
    ),

    // Record button
    h('button', {
      style: css.recBtn(recording),
      onClick: recording ? stopRec : startRec,
      disabled: processing,
    },
      processing
        ? h('span', null, '⏳ Analysing…')
        : recording
          ? h('span', null, '⬛ Stop  ', h('span', { style: { fontSize: 10, opacity: 0.8 } }, fmt(elapsed)))
          : h('span', null, '⏺ Record')
    ),

    // Error
    micError && h('div', { style: css.err }, micError),

    // Snap grid
    h('div', { style: { ...css.row, gap: 5 } },
      h('span', { style: css.label }, 'Snap'),
      ...SNAP_OPTIONS.map(o =>
        h('button', {
          key: o.label, style: css.chip(snapBeats === o.value),
          onClick: () => setSnapBeats(o.value),
        }, o.label)
      ),
    ),

    // Note preview + controls
    shiftedNotes.length > 0 && h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      h(NotePreview, { notes: shiftedNotes, snapBeats }),

      // Octave/semitone shift
      h('div', { style: { ...css.row, justifyContent: 'center', gap: 4 } },
        h('span', { style: css.label }, 'Shift'),
        h('button', { style: css.shiftBtn, onClick: () => setShift(s => s - 12) }, '−8ᵛ'),
        h('button', { style: css.shiftBtn, onClick: () => setShift(s => s - 1)  }, '−'),
        h('span', {
          style: { fontSize: 11, fontFamily: 'var(--font-mono)', minWidth: 28, textAlign: 'center',
                   color: shift !== 0 ? 'var(--accent)' : 'var(--text-tertiary)' }
        }, shift === 0 ? '±0' : (shift > 0 ? '+' + shift : '' + shift)),
        h('button', { style: css.shiftBtn, onClick: () => setShift(s => s + 1)  }, '+'),
        h('button', { style: css.shiftBtn, onClick: () => setShift(s => s + 12) }, '+8ᵛ'),
      ),

      // Insert / Clear
      h('div', { style: { ...css.row } },
        h('button', { style: css.insertBtn, onClick: insertNotes },
          `Insert ${shiftedNotes.length} note${shiftedNotes.length !== 1 ? 's' : ''}`
        ),
        h('button', { style: css.clearBtn, onClick: () => { setNotes([]); setStatus(''); setShift(0); } }, 'Clear'),
      ),
    ),

    // Status
    h('div', { style: css.status }, status),
  );
}

// ── Base64 helpers ──────────────────────────────────────────────────────────

function arrayToBase64(floatArr) {
  const bytes = new Uint8Array(floatArr.buffer);
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

// ── Export via well-known global ────────────────────────────────────────────
window.__MELON_ADDON_EXPORTS__ = { HumToMidiPanel };

})();
