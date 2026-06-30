/**
 * Melon Synth - browser UTAU render engine.
 *
 * Electron shelled out to OpenUTAU to synthesize. That is not available on a
 * static web host, so this is a small concatenative resampler that runs in the
 * page: it reads the selected voicebank's WAV samples and oto.ini out of the
 * Substrate VFS, maps each note's phoneme to a sample, pitch-shifts it to the
 * note, time-stretches the vowel to the note length, crossfades neighbours, and
 * mixes everything into one WAV. It is intentionally simple (not OpenUTAU
 * quality), but it sings with the actual voicebank in the browser, which is the
 * whole point for a kid-friendly tool.
 *
 * The DSP is plain Float32 math with no Web Audio dependency, so it renders
 * identically in Node (for tests) and in the browser; playback then goes
 * through the existing audio subsystem (decodeAudioData on the WAV).
 */
import type { OtoEntry } from './voicebank-store';
import { otoWindowMs } from './voicebank-store';

export interface RenderNote {
  id?: string;
  pitch: number;        // MIDI note number
  start: number;        // beats
  duration: number;     // beats
  lyric?: string;
  phoneme?: string;
}

export interface RenderOptions {
  tempo: number;             // BPM
  basePitch?: number;        // MIDI pitch the samples are assumed recorded at (default C4=60)
  sampleRate?: number;       // output sample rate (default 44100)
  tailMs?: number;           // silence appended after the last note
  onProgress?: (p: { loaded: number; total: number }) => void;
}

// ── WAV decode/encode (pure) ────────────────────────────────────────────────-

export interface DecodedWav { pcm: Float32Array; sampleRate: number; }

/** Decode a PCM WAV (8/16/24/32-bit int or 32-bit float, mono or stereo) to mono Float32. */
export function decodeWav(bytes: Uint8Array): DecodedWav {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, false) !== 0x52494646 /* RIFF */) throw new Error('not a WAV (no RIFF)');
  let p = 12, fmt: any = null, dataOff = -1, dataLen = 0;
  while (p + 8 <= bytes.length) {
    const id = dv.getUint32(p, false);
    const sz = dv.getUint32(p + 4, true);
    const body = p + 8;
    if (id === 0x666d7420 /* "fmt " */) {
      fmt = {
        format: dv.getUint16(body, true),
        channels: dv.getUint16(body + 2, true),
        sampleRate: dv.getUint32(body + 4, true),
        bits: dv.getUint16(body + 14, true),
      };
    } else if (id === 0x64617461 /* "data" */) {
      dataOff = body; dataLen = sz; break;
    }
    p = body + sz + (sz & 1);   // chunks are word-aligned
  }
  if (!fmt || dataOff < 0) throw new Error('WAV missing fmt/data chunk');

  const { channels, bits, format, sampleRate } = fmt;
  const bytesPerSample = bits >> 3;
  const frameCount = Math.floor(dataLen / (bytesPerSample * channels));
  const mono = new Float32Array(frameCount);

  const readSample = (off: number): number => {
    if (format === 3 /* IEEE float */) return bits === 32 ? dv.getFloat32(off, true) : dv.getFloat64(off, true);
    if (bits === 8) return (dv.getUint8(off) - 128) / 128;             // 8-bit is unsigned
    if (bits === 16) return dv.getInt16(off, true) / 32768;
    if (bits === 24) { const v = dv.getUint8(off) | (dv.getUint8(off + 1) << 8) | (dv.getInt8(off + 2) << 16); return v / 8388608; }
    if (bits === 32) return dv.getInt32(off, true) / 2147483648;
    throw new Error(`unsupported WAV bit depth ${bits}`);
  };

  for (let i = 0; i < frameCount; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) acc += readSample(dataOff + (i * channels + c) * bytesPerSample);
    mono[i] = acc / channels;
  }
  return { pcm: mono, sampleRate };
}

/** Encode mono Float32 PCM to a 16-bit WAV. */
export function encodeWav(pcm: Float32Array, sampleRate: number): Uint8Array {
  const dataLen = pcm.length * 2;
  const buf = new Uint8Array(44 + dataLen);
  const dv = new DataView(buf.buffer);
  const wstr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); wstr(8, 'WAVE');
  wstr(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);                 // PCM
  dv.setUint16(22, 1, true);                 // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);    // byte rate
  dv.setUint16(32, 2, true);                 // block align
  dv.setUint16(34, 16, true);                // bits
  wstr(36, 'data'); dv.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    dv.setInt16(o, s < 0 ? s * 32768 : s * 32767, true); o += 2;
  }
  return buf;
}

// ── alias resolution (romaji <-> kana tolerant) ──────────────────────────────-

const ROMAJI_TO_KANA: Record<string, string> = {
  a:'あ',i:'い',u:'う',e:'え',o:'お',
  ka:'か',ki:'き',ku:'く',ke:'け',ko:'こ',ga:'が',gi:'ぎ',gu:'ぐ',ge:'げ',go:'ご',
  sa:'さ',shi:'し',su:'す',se:'せ',so:'そ',za:'ざ',ji:'じ',zu:'ず',ze:'ぜ',zo:'ぞ',
  ta:'た',chi:'ち',tsu:'つ',te:'て',to:'と',da:'だ',de:'で',do:'ど',
  na:'な',ni:'に',nu:'ぬ',ne:'ね',no:'の',
  ha:'は',hi:'ひ',fu:'ふ',he:'へ',ho:'ほ',ba:'ば',bi:'び',bu:'ぶ',be:'べ',bo:'ぼ',pa:'ぱ',pi:'ぴ',pu:'ぷ',pe:'ぺ',po:'ぽ',
  ma:'ま',mi:'み',mu:'む',me:'め',mo:'も',ya:'や',yu:'ゆ',yo:'よ',
  ra:'ら',ri:'り',ru:'る',re:'れ',ro:'ろ',wa:'わ',wo:'を',n:'ん',
};
const KANA_TO_ROMAJI: Record<string, string> = Object.fromEntries(Object.entries(ROMAJI_TO_KANA).map(([r, k]) => [k, r]));

/** Find the best matching oto alias for a phoneme/lyric, tolerating CV prefixes and script. */
export function resolveAlias(query: string, aliases: Set<string>): string | null {
  const q = (query || '').trim();
  if (!q) return null;
  const candidates = new Set<string>();
  const add = (s: string) => { if (s) candidates.add(s); };
  add(q); add(q.toLowerCase());
  add(ROMAJI_TO_KANA[q.toLowerCase()]);
  add(KANA_TO_ROMAJI[q]);
  // CV onset forms many banks use
  for (const base of [q, q.toLowerCase(), ROMAJI_TO_KANA[q.toLowerCase()], KANA_TO_ROMAJI[q]]) {
    if (!base) continue;
    add('- ' + base); add('-' + base); add(base + ' -'); add('・' + base);
  }
  for (const c of candidates) if (aliases.has(c)) return c;
  // last resort: strip a leading "- " on bank aliases and compare
  for (const a of aliases) if (a.replace(/^[-・]\s*/, '') === q || a.replace(/^[-・]\s*/, '').toLowerCase() === q.toLowerCase()) return a;
  return null;
}

// ── the resampler ────────────────────────────────────────────────────────────-

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * Render notes to a mono WAV using a voicebank loaded by VoicebankStore.loadBank.
 * `read` returns the decoded sample for a given VFS path (cached by the caller).
 */
export async function renderNotes(
  notes: RenderNote[],
  bank: { entries: Map<string, OtoEntry & { samplePath: string }> },
  read: (samplePath: string) => Promise<Uint8Array | null>,
  opts: RenderOptions,
): Promise<{ wav: Uint8Array; durationMs: number; sampleRate: number; rendered: number; skipped: string[] }> {
  const outSR = opts.sampleRate ?? 44100;
  const basePitch = opts.basePitch ?? 60;
  const beatsToSec = (b: number) => (b / opts.tempo) * 60;

  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const lastEnd = sorted.length ? Math.max(...sorted.map(n => n.start + n.duration)) : 0;
  const totalSec = beatsToSec(lastEnd) + (opts.tailMs ?? 250) / 1000;
  const out = new Float32Array(Math.max(1, Math.ceil(totalSec * outSR)));

  const aliasSet = new Set(bank.entries.keys());
  const decodeCache = new Map<string, DecodedWav>();
  const skipped: string[] = [];
  let rendered = 0;

  for (let idx = 0; idx < sorted.length; idx++) {
    const note = sorted[idx];
    opts.onProgress?.({ loaded: idx, total: sorted.length });

    const alias = resolveAlias(note.phoneme || note.lyric || '', aliasSet);
    if (!alias) { skipped.push(note.phoneme || note.lyric || '?'); continue; }
    const oto = bank.entries.get(alias)!;

    let decoded = decodeCache.get(oto.samplePath);
    if (!decoded) {
      const raw = await read(oto.samplePath);
      if (!raw) { skipped.push(alias); continue; }
      try { decoded = decodeWav(raw); } catch { skipped.push(alias); continue; }
      decodeCache.set(oto.samplePath, decoded);
    }
    const { pcm, sampleRate: srcSR } = decoded;
    const fileDurMs = (pcm.length / srcSR) * 1000;
    const win = otoWindowMs(oto, fileDurMs);

    // source sample indices for the consonant (fixed) and vowel (loopable) regions
    const msToSrc = (ms: number) => (ms / 1000) * srcSR;
    const winStart = Math.max(0, Math.floor(msToSrc(win.start)));
    const winEnd = Math.min(pcm.length, Math.ceil(msToSrc(win.end)));
    const consEnd = Math.min(winEnd, winStart + Math.floor(msToSrc(Math.max(oto.consonant, 0))));
    if (winEnd - winStart < 2) { skipped.push(alias); continue; }

    const pitchRatio = midiToHz(note.pitch) / midiToHz(basePitch);
    // source samples consumed per output sample (pitch shift + SR conversion)
    const step = pitchRatio * (srcSR / outSR);

    const noteSec = Math.max(beatsToSec(note.duration), 0.05);
    const noteSamps = Math.floor(noteSec * outSR);

    // align so the vowel onset (preutterance) lands on the beat
    const preSrc = msToSrc(oto.preutter);
    const startSec = beatsToSec(note.start);
    let outPos = Math.floor(startSec * outSR - preSrc / step);
    const fadeIn = Math.min(Math.floor(0.008 * outSR), noteSamps >> 2);
    const fadeOut = Math.min(Math.floor(0.030 * outSR), noteSamps >> 2);

    // read head through source: consonant once, then loop the vowel region
    let srcPos = winStart;
    const vowelStart = consEnd, vowelEnd = winEnd;
    const vowelLen = Math.max(vowelEnd - vowelStart, 2);

    for (let i = 0; i < noteSamps; i++) {
      const oi = outPos + i;
      if (oi < 0) continue;
      if (oi >= out.length) break;

      // linear interpolation read at fractional srcPos
      const i0 = Math.floor(srcPos);
      const frac = srcPos - i0;
      const s0 = pcm[i0] ?? 0;
      const s1 = pcm[i0 + 1] ?? s0;
      let s = s0 + (s1 - s0) * frac;

      // envelope
      if (i < fadeIn) s *= i / fadeIn;
      else if (i > noteSamps - fadeOut) s *= Math.max(0, (noteSamps - i) / fadeOut);

      out[oi] += s;

      // advance read head; loop within the vowel region once past it
      srcPos += step;
      if (srcPos >= vowelEnd) srcPos = vowelStart + ((srcPos - vowelEnd) % vowelLen);
    }
    rendered++;
  }

  // normalise to avoid clipping from overlaps
  let peak = 0;
  for (let i = 0; i < out.length; i++) { const a = Math.abs(out[i]); if (a > peak) peak = a; }
  if (peak > 0.99) { const g = 0.99 / peak; for (let i = 0; i < out.length; i++) out[i] *= g; }

  return { wav: encodeWav(out, outSR), durationMs: Math.round(totalSec * 1000), sampleRate: outSR, rendered, skipped };
}
