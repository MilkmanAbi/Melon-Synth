/**
 * Audio Subsystem — v2
 * ====================
 * Preview: Web Audio API oscillator synth (harmonic series, vocal-ish).
 * Playback: Loaded WAV buffer (after OpenUTAU render).
 * Sequencer: Web Audio clock-based scheduling (no setTimeout drift).
 * Metronome: Optional click track.
 */

const HARMONICS     = [1, 2, 3, 4, 6, 8];
const HARMONIC_GAIN = [1.0, 0.5, 0.25, 0.15, 0.08, 0.04];

class AudioSubsystem {
  private ctx:        AudioContext | null = null;
  private masterGain: GainNode    | null = null;

  // WAV playback
  private wavBuffer:    AudioBuffer | null = null;
  private wavSource:    AudioBufferSourceNode | null = null;
  private wavStartAt:   number = 0;   // ctx.currentTime when playback started
  private wavOffsetSec: number = 0;   // offset into buffer when started
  private _isWavPlaying = false;

  // Sequencer
  private seqNodes:  AudioNode[]              = [];
  private seqTimers: ReturnType<typeof setTimeout>[] = [];
  private _isSeqPlaying = false;

  // Callbacks
  onNoteStart?: (noteId: string) => void;
  onNoteStop?:  (noteId: string) => void;
  onPlayEnd?:   () => void;

  // ── Context management ────────────────────────────────────────────────────
  private ctx_(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.65;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  private midiToHz(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // ── Single note preview (draw feedback, piano keys) ──────────────────────
  previewNote(midi: number, durMs = 300): void {
    const ctx  = this.ctx_();
    const freq = this.midiToHz(midi);
    const now  = ctx.currentTime;
    const dur  = durMs / 1000;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.35, now + 0.010);
    env.gain.setValueAtTime(0.35, now + dur - 0.04);
    env.gain.linearRampToValueAtTime(0, now + dur);
    env.connect(this.masterGain!);

    HARMONICS.forEach((h, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * h;
      const hg = ctx.createGain();
      hg.gain.value = HARMONIC_GAIN[i] / HARMONICS.length;
      osc.connect(hg); hg.connect(env);
      osc.start(now); osc.stop(now + dur + 0.05);
    });

    // Vibrato on long notes
    if (durMs > 400) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.5;
      const lfog = ctx.createGain();
      lfog.gain.value = freq * 0.007;
      lfo.connect(lfog);
      const vosc = ctx.createOscillator();
      vosc.type = 'sine'; vosc.frequency.value = freq;
      lfog.connect(vosc.frequency);
      const venv = ctx.createGain();
      venv.gain.setValueAtTime(0, now);
      venv.gain.linearRampToValueAtTime(0.15, now + 0.18);
      vosc.connect(venv); venv.connect(env);
      vosc.start(now + 0.15); vosc.stop(now + dur + 0.05);
      lfo.start(now + 0.15);  lfo.stop(now + dur + 0.05);
    }
  }

  // ── WAV playback ──────────────────────────────────────────────────────────
  async loadWAV(url: string): Promise<void> {
    const ctx  = this.ctx_();
    const buf  = await (await fetch(url)).arrayBuffer();
    this.wavBuffer = await ctx.decodeAudioData(buf);
  }

  async loadWAVFromPath(p: string): Promise<void> {
    // Web build returns blob:/http(s):/data: URLs from the in-browser renderer;
    // only bare OS paths (desktop) need the file:// prefix.
    const isUrl = /^(blob:|https?:|data:|file:)/.test(p);
    await this.loadWAV(isUrl ? p : `file://${p}`);
  }

  playWAV(offsetBeats = 0, bpm = 120): void {
    if (!this.wavBuffer) return;
    const ctx    = this.ctx_();
    const offset = Math.min((offsetBeats / bpm) * 60, this.wavBuffer.duration);
    this.stopWAV();
    this.wavSource = ctx.createBufferSource();
    this.wavSource.buffer = this.wavBuffer;
    this.wavSource.connect(this.masterGain!);
    this.wavSource.onended = () => {
      this._isWavPlaying = false;
      this.onPlayEnd?.();
    };
    this.wavSource.start(0, offset);
    this.wavStartAt   = ctx.currentTime;
    this.wavOffsetSec = offset;
    this._isWavPlaying = true;
  }

  stopWAV(): void {
    if (this.wavSource) { try { this.wavSource.stop(); } catch {} this.wavSource = null; }
    this._isWavPlaying = false;
  }

  /** Current playback position in beats — call from rAF */
  getPlayheadBeats(bpm: number): number {
    if (!this.ctx || !this._isWavPlaying) return 0;
    const elapsedSec = this.ctx.currentTime - this.wavStartAt + this.wavOffsetSec;
    return (elapsedSec * bpm) / 60;
  }

  clearWAV(): void {
    this.stopWAV();
    this.wavBuffer = null;
  }

  // ── Sequencer (Web Audio clock — no setTimeout drift) ────────────────────
  // Explicitly resume AudioContext (call on any user gesture)
  async resume(): Promise<void> {
    const ctx = this.ctx_();
    if (ctx.state === 'suspended') await ctx.resume();
  }

  playSequence(
    notes: { id?: string; pitch: number; start: number; duration: number }[],
    bpm:   number,
    startBeat = 0,
    options: { metronome?: boolean; measures?: number } = {}
  ): void {
    this.stopSequence();
    const ctx = this.ctx_();
    // Ensure context is running (user gesture may have already fired)
    if (ctx.state === 'suspended') { ctx.resume(); }
    const now = ctx.currentTime;
    const spb = 60 / bpm;   // seconds per beat
    const sorted = [...notes].sort((a, b) => a.start - b.start);

    this.seqNodes  = [];
    this.seqTimers = [];
    this._isSeqPlaying = true;

    let latestEnd = 0;

    sorted.forEach(note => {
      if (note.start < startBeat) return;
      const startSec = (note.start - startBeat) * spb;
      const durSec   = Math.max(note.duration * spb * 0.92, 0.05); // 8% gap
      const freq     = this.midiToHz(note.pitch);
      const absStart = now + startSec;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0,    absStart);
      env.gain.linearRampToValueAtTime(0.3, absStart + 0.012);
      env.gain.setValueAtTime(0.3,  absStart + durSec - 0.04);
      env.gain.linearRampToValueAtTime(0, absStart + durSec);
      env.connect(this.masterGain!);
      this.seqNodes.push(env);

      HARMONICS.forEach((h, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * h;
        const hg = ctx.createGain();
        hg.gain.value = HARMONIC_GAIN[i] / HARMONICS.length;
        osc.connect(hg); hg.connect(env);
        osc.start(absStart); osc.stop(absStart + durSec + 0.06);
        this.seqNodes.push(osc, hg);
      });

      // Fire note-start/stop callbacks for playhead highlight
      if (note.id && this.onNoteStart) {
        const t1 = setTimeout(() => this.onNoteStart?.(note.id!), startSec * 1000);
        const t2 = setTimeout(() => this.onNoteStop?.(note.id!), (startSec + durSec) * 1000);
        this.seqTimers.push(t1, t2);
      }

      latestEnd = Math.max(latestEnd, startSec + durSec);
    });

    // Optional metronome
    if (options.metronome) {
      const measures = options.measures ?? Math.ceil(latestEnd / spb / 4) + 1;
      for (let i = 0; i < measures * 4; i++) {
        const t    = now + i * spb;
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = i % 4 === 0 ? 1200 : 800;
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        osc.connect(gain); gain.connect(this.masterGain!);
        osc.start(t); osc.stop(t + 0.06);
        this.seqNodes.push(osc, gain);
      }
    }

    // End callback
    if (latestEnd > 0) {
      const t = setTimeout(() => {
        this._isSeqPlaying = false;
        this.onPlayEnd?.();
      }, latestEnd * 1000 + 100);
      this.seqTimers.push(t);
    }
  }

  stopSequence(): void {
    this.seqTimers.forEach(clearTimeout);
    this.seqTimers = [];
    this.seqNodes.forEach(n => { try { (n as OscillatorNode).stop?.(); } catch {} });
    this.seqNodes = [];
    this._isSeqPlaying = false;
  }

  // ── Volume + mute ─────────────────────────────────────────────────────────
  setVolume(v: number): void {
    if (this.masterGain) this.masterGain.gain.value = Math.max(0, Math.min(1, v));
  }

  get hasWAV():       boolean { return this.wavBuffer !== null; }
  get isWavPlaying(): boolean { return this._isWavPlaying; }
  get isSeqPlaying(): boolean { return this._isSeqPlaying; }
  get isPlaying():    boolean { return this._isWavPlaying || this._isSeqPlaying; }

  // ── Metronome standalone ──────────────────────────────────────────────────
  playClick(accent = false): void {
    const ctx = this.ctx_();
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.frequency.value = accent ? 1200 : 800;
    g.gain.setValueAtTime(0.2, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    osc.connect(g); g.connect(this.masterGain!);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.07);
  }
}

export const audio = new AudioSubsystem();
