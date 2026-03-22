"""
Hum to MIDI — Python backend  v1.0.0
=====================================
Higher-quality pitch detection using aubio (YIN + onset detection).
Falls back gracefully if aubio/numpy are not installed.

Protocol:
  Receives via stdin: {"id":"...", "action":"call", "data":{"method":"analyze_hum","args":{...}}}
  Sends via stdout:   {"id":"...", "ok":true, "data":{"notes":[...],"engine":"aubio"}}
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', 'mlc', 'api'))

from melon_ext import MelonExtensionBackend, run_backend_server
import base64, math, logging

log = logging.getLogger('hum_to_midi')

try:
    import numpy as np
    import aubio
    HAS_AUBIO = True
except ImportError:
    HAS_AUBIO = False
    log.warning("aubio/numpy not available — backend analysis disabled")


# ── Note name helpers ──────────────────────────────────────────────────────

NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

def midi_to_name(midi: int) -> str:
    return NOTES[midi % 12] + str(midi // 12 - 1)

def hz_to_midi(hz: float) -> float | None:
    if hz <= 0: return None
    return 69 + 12 * math.log2(hz / 440)


# ── aubio analysis ─────────────────────────────────────────────────────────

def _segment_by_pitch(pitches_hz, energies, n_frames, hop_sec, beat_sec, snap_beats) -> list[dict]:
    """
    Fallback segmentation: group consecutive frames with similar pitch into notes.
    Used when onset detection gives too few events (pure tones, sustained hums).
    Same algorithm as the JS YIN engine for consistency.
    """
    import numpy as np

    PITCH_TOL  = 0.9   # semitones from segment median before declaring a new note
    MIN_FRAMES = 3
    SIL_CEIL   = max(1e-9, np.percentile(energies, 5) * 6) if len(energies) else 1e-4
    sil_thr    = min(SIL_CEIL, np.mean(energies) * 0.05) if len(energies) else 1e-4

    notes = []
    seg_start = None
    seg_hz    = []
    seg_eng   = []

    def flush(fi_end):
        nonlocal seg_start, seg_hz, seg_eng
        if seg_start is None or len(seg_hz) < MIN_FRAMES:
            seg_start = None; seg_hz = []; seg_eng = []; return
        med_hz  = float(np.median(seg_hz))
        midi_f  = hz_to_midi(med_hz)
        if midi_f is None or not (21 <= round(midi_f) <= 108):
            seg_start = None; seg_hz = []; seg_eng = []; return
        midi_i     = int(round(midi_f))
        start_sec  = seg_start * hop_sec
        dur_sec    = (fi_end - seg_start) * hop_sec
        start_beat = _quant(start_sec / beat_sec, snap_beats)
        dur_beats  = max(snap_beats, _quant(dur_sec / beat_sec, snap_beats))
        notes.append({
            "midi":          midi_i,
            "startBeat":     start_beat,
            "durationBeats": dur_beats,
            "noteName":      midi_to_name(midi_i),
            "confidence":    round(min(1.0, len(seg_hz) / 12), 2),
        })
        seg_start = None; seg_hz = []; seg_eng = []

    for fi in range(n_frames):
        hz  = pitches_hz[fi]
        eng = energies[fi] if fi < len(energies) else 0.0
        if hz <= 0 or eng < sil_thr:
            flush(fi); continue
        if seg_start is None:
            seg_start = fi; seg_hz = [hz]; seg_eng = [eng]; continue
        # Compare current pitch against the entire segment's median (more stable)
        seg_median_hz  = float(np.median(seg_hz)) if seg_hz else hz
        seg_median_midi = hz_to_midi(seg_median_hz) or 0
        curr_midi = hz_to_midi(hz) or 0
        if abs(curr_midi - seg_median_midi) > PITCH_TOL:
            flush(fi); seg_start = fi; seg_hz = [hz]; seg_eng = [eng]
        else:
            seg_hz.append(hz); seg_eng.append(eng)

    flush(n_frames)
    return notes


def analyze_with_aubio(pcm, sr: int, bpm: float, snap_beats: float) -> list[dict]:
    """
    Full pipeline using aubio:
      1. YIN pitch tracking per hop
      2. Onset detection (specflux) for note boundaries
      3. Falls back to pitch-change segmentation when onsets are sparse
      4. Quantise timing to beat grid
    """
    import numpy as np

    hop_size   = 512
    frame_size = 2048
    beat_sec   = 60.0 / bpm
    hop_sec    = hop_size / sr

    # Pitch detector — use "midi" unit (more reliable than "hz" in this version)
    pitch_o = aubio.pitch("yin", frame_size, hop_size, sr)
    pitch_o.set_unit("midi")
    pitch_o.set_silence(-50)
    pitch_o.set_tolerance(0.85)

    # Per-hop pitch extraction using aubio YIN
    n_frames   = (len(pcm) - hop_size) // hop_size + 1
    pitches_hz = []
    energies   = []

    for fi in range(n_frames):
        s     = fi * hop_size
        frame = pcm[s : s + hop_size].astype(np.float32)
        if len(frame) < hop_size:
            frame = np.pad(frame, (0, hop_size - len(frame)))

        midi_val = float(pitch_o(frame)[0])
        conf     = float(pitch_o.get_confidence())
        hz = 440.0 * (2.0 ** ((midi_val - 69.0) / 12.0)) if midi_val > 0 and conf > 0.6 else -1.0
        eng = float(np.dot(frame, frame)) / hop_size

        pitches_hz.append(hz if 60 < hz < 1200 else -1)
        energies.append(eng)

    # Segment by pitch changes — optimal for voice / humming
    return _segment_by_pitch(pitches_hz, energies, n_frames, hop_sec, beat_sec, snap_beats)


def _quant(beats: float, snap: float) -> float:
    return round(beats / snap) * snap if snap > 0 else beats


# ── Backend class ──────────────────────────────────────────────────────────

class HumToMidiBackend(MelonExtensionBackend):
    id      = "hum_to_midi"
    version = "1.0.0"

    def analyze_hum(
        self,
        pcm_b64:     str,
        sample_rate: int   = 44100,
        bpm:         float = 120.0,
        snap_beats:  float = 0.5,
    ) -> dict:
        """
        Analyse a mono PCM recording and return MIDI notes.

        Args:
            pcm_b64:     Base64-encoded float32 PCM mono audio
            sample_rate: Hz (typically 44100 or 48000)
            bpm:         Project BPM for beat quantisation
            snap_beats:  Grid snap in beats (0.5 = 1/8 note)

        Returns:
            {
              "notes":  [{"midi": int, "startBeat": float, "durationBeats": float,
                          "noteName": str, "confidence": float}],
              "engine": "aubio" | "unavailable",
              "count":  int,
            }
        """
        if not HAS_AUBIO:
            return {
                "notes":   [],
                "engine":  "unavailable",
                "message": "aubio not installed — using JS engine. Run: pip install aubio numpy",
                "count":   0,
            }

        try:
            import numpy as np
            raw = base64.b64decode(pcm_b64)
            pcm = np.frombuffer(raw, dtype=np.float32).copy()

            if len(pcm) < 2048:
                return {"notes": [], "engine": "aubio", "count": 0, "message": "Recording too short"}

            notes = analyze_with_aubio(pcm, sample_rate, bpm, snap_beats)
            return {"notes": notes, "engine": "aubio", "count": len(notes)}

        except Exception as e:
            log.error(f"analyze_hum failed: {e}")
            return {"notes": [], "engine": "aubio", "error": str(e), "count": 0}

    def ping(self) -> dict:
        return {
            "ok":        True,
            "aubio":     HAS_AUBIO,
            "version":   self.version,
        }


# ── Entry point ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(
        level   = logging.WARNING,
        format  = "[%(levelname)s %(name)s] %(message)s",
        stream  = sys.stderr,
    )
    run_backend_server(HumToMidiBackend())
