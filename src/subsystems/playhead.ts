/**
 * Playhead clock — bypasses React for smooth 60fps canvas animation.
 *
 * App writes to this when play starts/stops.
 * PianoRoll reads from it directly in its own rAF loop.
 * Zero React renders needed for playhead movement.
 */

let _startWall = 0;   // performance.now() when playback started
let _startBeat = 0;   // beat position when playback started
let _bpm       = 120;
let _playing   = false;

export const playheadClock = {
  start(beat: number, bpm: number) {
    _startWall = performance.now();
    _startBeat = beat;
    _bpm       = bpm;
    _playing   = true;
  },
  stop() {
    _playing = false;
  },
  updateBpm(bpm: number) {
    if (_playing) {
      // Re-anchor so the position doesn't jump
      _startBeat = playheadClock.position;
      _startWall = performance.now();
    }
    _bpm = bpm;
  },
  get position(): number {
    if (!_playing) return 0; // caller should use store value when stopped
    return _startBeat + ((performance.now() - _startWall) / 1000) * (_bpm / 60);
  },
  get playing(): boolean {
    return _playing;
  },
};
