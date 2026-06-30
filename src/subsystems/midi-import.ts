/**
 * MIDI Import — Melon Synth
 * ==========================
 * Parses .mid files and converts to Melon Synth note format.
 * 
 * Supports:
 *   - Standard MIDI files (SMF format 0 and 1)
 *   - Multiple tracks (user selects which to import)
 *   - Note velocity → dynamics hints
 *   - Tempo detection
 * 
 * Does not handle:
 *   - Lyrics embedded in MIDI (rare in practice)
 *   - CC data (future: map to pitch curves)
 *   - SysEx messages
 */

import { nanoid } from 'nanoid';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MidiNote {
  pitch:    number;   // MIDI note number (0-127)
  start:    number;   // in ticks
  duration: number;   // in ticks
  velocity: number;   // 0-127
  channel:  number;   // 0-15
}

export interface MidiTrack {
  name:     string;
  channel:  number;
  notes:    MidiNote[];
  hasNotes: boolean;
}

export interface MidiFile {
  format:       number;      // 0, 1, or 2
  ticksPerBeat: number;      // ppqn
  tempo:        number;      // BPM (from first tempo event, or 120 default)
  tracks:       MidiTrack[];
  totalTicks:   number;
}

export interface ImportedNote {
  id:       string;
  pitch:    number;
  start:    number;   // in beats
  duration: number;   // in beats
  lyric:    string;
  velocity: number;
}

// ── MIDI Parser ───────────────────────────────────────────────────────────────

class MidiParser {
  private data: DataView;
  private pos:  number = 0;

  constructor(arrayBuffer: ArrayBuffer) {
    this.data = new DataView(arrayBuffer);
  }

  parse(): MidiFile {
    // Read header chunk
    const headerChunk = this.readChunkHeader();
    if (headerChunk.type !== 'MThd') {
      throw new Error('Invalid MIDI file: missing MThd header');
    }
    if (headerChunk.length !== 6) {
      throw new Error('Invalid MIDI header length');
    }

    const format       = this.readUint16();
    const numTracks    = this.readUint16();
    const timeDivision = this.readUint16();

    // Check time division format (we only support ticks per beat)
    if (timeDivision & 0x8000) {
      throw new Error('SMPTE time division not supported');
    }
    const ticksPerBeat = timeDivision;

    // Read track chunks
    const tracks: MidiTrack[] = [];
    let tempo = 120; // default
    let totalTicks = 0;

    for (let i = 0; i < numTracks; i++) {
      const trackChunk = this.readChunkHeader();
      if (trackChunk.type !== 'MTrk') {
        // Skip unknown chunk
        this.pos += trackChunk.length;
        continue;
      }

      const trackEnd = this.pos + trackChunk.length;
      const trackData = this.parseTrack(trackEnd);
      
      // Extract tempo from first track (format 0) or tempo track (format 1)
      if (trackData.tempo && (i === 0 || tempo === 120)) {
        tempo = trackData.tempo;
      }

      if (trackData.notes.length > 0) {
        const maxTick = Math.max(...trackData.notes.map(n => n.start + n.duration));
        totalTicks = Math.max(totalTicks, maxTick);
      }

      tracks.push({
        name:     trackData.name || `Track ${i + 1}`,
        channel:  trackData.channel,
        notes:    trackData.notes,
        hasNotes: trackData.notes.length > 0,
      });
    }

    return {
      format,
      ticksPerBeat,
      tempo,
      tracks,
      totalTicks,
    };
  }

  private parseTrack(endPos: number): { notes: MidiNote[]; tempo: number | null; name: string; channel: number } {
    const notes: MidiNote[] = [];
    const activeNotes = new Map<number, { start: number; velocity: number; channel: number }>(); // key: pitch
    let runningStatus = 0;
    let currentTick   = 0;
    let tempo: number | null = null;
    let name = '';
    let channel = 0;

    while (this.pos < endPos) {
      const deltaTime = this.readVarLength();
      currentTick += deltaTime;

      let statusByte = this.readUint8();

      // Running status
      if (statusByte < 0x80) {
        this.pos--;
        statusByte = runningStatus;
      } else {
        runningStatus = statusByte;
      }

      const msgType = statusByte & 0xF0;
      const chan    = statusByte & 0x0F;

      if (statusByte === 0xFF) {
        // Meta event
        const metaType = this.readUint8();
        const metaLen  = this.readVarLength();
        const metaEnd  = this.pos + metaLen;

        if (metaType === 0x51 && metaLen === 3) {
          // Tempo: microseconds per beat
          const uspb = (this.readUint8() << 16) | (this.readUint8() << 8) | this.readUint8();
          tempo = Math.round(60000000 / uspb);
        } else if (metaType === 0x03) {
          // Track name
          const bytes: number[] = [];
          while (this.pos < metaEnd) bytes.push(this.readUint8());
          name = String.fromCharCode(...bytes);
        } else if (metaType === 0x2F) {
          // End of track
          this.pos = metaEnd;
          break;
        } else {
          // Skip other meta events
          this.pos = metaEnd;
        }
      } else if (statusByte === 0xF0 || statusByte === 0xF7) {
        // SysEx — skip
        const len = this.readVarLength();
        this.pos += len;
      } else if (msgType === 0x90) {
        // Note on
        const pitch    = this.readUint8();
        const velocity = this.readUint8();
        
        if (velocity > 0) {
          activeNotes.set(pitch, { start: currentTick, velocity, channel: chan });
          channel = chan;
        } else {
          // Note on with velocity 0 = note off
          const active = activeNotes.get(pitch);
          if (active) {
            notes.push({
              pitch,
              start:    active.start,
              duration: currentTick - active.start,
              velocity: active.velocity,
              channel:  active.channel,
            });
            activeNotes.delete(pitch);
          }
        }
      } else if (msgType === 0x80) {
        // Note off
        const pitch    = this.readUint8();
        this.readUint8(); // velocity (ignored)
        
        const active = activeNotes.get(pitch);
        if (active) {
          notes.push({
            pitch,
            start:    active.start,
            duration: currentTick - active.start,
            velocity: active.velocity,
            channel:  active.channel,
          });
          activeNotes.delete(pitch);
        }
      } else if (msgType === 0xA0) {
        // Polyphonic aftertouch — skip
        this.readUint8(); this.readUint8();
      } else if (msgType === 0xB0) {
        // Control change — skip
        this.readUint8(); this.readUint8();
      } else if (msgType === 0xC0) {
        // Program change — skip
        this.readUint8();
      } else if (msgType === 0xD0) {
        // Channel aftertouch — skip
        this.readUint8();
      } else if (msgType === 0xE0) {
        // Pitch bend — skip (future: could convert to pitch curve)
        this.readUint8(); this.readUint8();
      }
    }

    // Close any remaining active notes
    for (const [pitch, active] of activeNotes) {
      notes.push({
        pitch,
        start:    active.start,
        duration: currentTick - active.start,
        velocity: active.velocity,
        channel:  active.channel,
      });
    }

    return { notes, tempo, name, channel };
  }

  private readChunkHeader(): { type: string; length: number } {
    const type = String.fromCharCode(
      this.readUint8(), this.readUint8(), this.readUint8(), this.readUint8()
    );
    const length = this.readUint32();
    return { type, length };
  }

  private readUint8(): number {
    return this.data.getUint8(this.pos++);
  }

  private readUint16(): number {
    const val = this.data.getUint16(this.pos, false); // big-endian
    this.pos += 2;
    return val;
  }

  private readUint32(): number {
    const val = this.data.getUint32(this.pos, false); // big-endian
    this.pos += 4;
    return val;
  }

  private readVarLength(): number {
    let value = 0;
    let byte: number;
    do {
      byte = this.readUint8();
      value = (value << 7) | (byte & 0x7F);
    } while (byte & 0x80);
    return value;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a MIDI file from an ArrayBuffer.
 */
export function parseMidiFile(arrayBuffer: ArrayBuffer): MidiFile {
  const parser = new MidiParser(arrayBuffer);
  return parser.parse();
}

/**
 * Convert a MidiFile track to ImportedNote[] ready for the store.
 */
export function convertMidiTrack(
  midiFile: MidiFile,
  trackIndex: number,
  options: {
    quantize?:    number;    // snap to grid (e.g., 0.25 for 1/16th)
    minDuration?: number;    // minimum note duration in beats
    lyricPrefix?: string;    // default lyric prefix (e.g., "la")
  } = {}
): ImportedNote[] {
  const track = midiFile.tracks[trackIndex];
  if (!track) throw new Error(`Track ${trackIndex} not found`);

  const { quantize = 0, minDuration = 0.125, lyricPrefix = 'la' } = options;
  const ppq = midiFile.ticksPerBeat;

  return track.notes.map((note, i) => {
    let startBeats    = note.start / ppq;
    let durationBeats = note.duration / ppq;

    // Quantize if requested
    if (quantize > 0) {
      startBeats    = Math.round(startBeats / quantize) * quantize;
      durationBeats = Math.max(minDuration, Math.round(durationBeats / quantize) * quantize);
    } else {
      durationBeats = Math.max(minDuration, durationBeats);
    }

    return {
      id:       nanoid(8),
      pitch:    note.pitch,
      start:    startBeats,
      duration: durationBeats,
      lyric:    lyricPrefix,
      velocity: note.velocity,
    };
  });
}

/**
 * Get a summary of a MIDI file for display in import dialog.
 */
export function getMidiSummary(midiFile: MidiFile): {
  format:     number;
  tempo:      number;
  duration:   number;  // in beats
  trackCount: number;
  noteCount:  number;
  tracks:     { index: number; name: string; noteCount: number; channel: number }[];
} {
  const tracksWithNotes = midiFile.tracks
    .map((t, i) => ({ index: i, name: t.name, noteCount: t.notes.length, channel: t.channel }))
    .filter(t => t.noteCount > 0);

  return {
    format:     midiFile.format,
    tempo:      midiFile.tempo,
    duration:   midiFile.totalTicks / midiFile.ticksPerBeat,
    trackCount: tracksWithNotes.length,
    noteCount:  tracksWithNotes.reduce((sum, t) => sum + t.noteCount, 0),
    tracks:     tracksWithNotes,
  };
}

/**
 * Load a MIDI file from disk (Electron) or File API (browser).
 */
export async function loadMidiFromFile(file: File): Promise<MidiFile> {
  const buffer = await file.arrayBuffer();
  return parseMidiFile(buffer);
}

/**
 * Load a MIDI file from a path (Electron only).
 */
export async function loadMidiFromPath(filePath: string): Promise<MidiFile> {
  const response = await fetch(`file://${filePath}`);
  const buffer = await response.arrayBuffer();
  return parseMidiFile(buffer);
}
