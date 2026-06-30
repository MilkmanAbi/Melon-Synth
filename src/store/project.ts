/**
 * Project Store — Zustand
 * =======================
 * Single source of truth for the entire open project.
 * Every action that modifies state goes through here.
 * Undo history is a command stack (each entry has prev/next snapshots of the notes slice).
 *
 * Kept flat and simple — no nested Immer, no selectors library.
 * If it gets complex, split into slices then.
 */

import { create } from 'zustand';
import { nanoid } from 'nanoid';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Vibrato settings for a note */
export interface VibratoParams {
  length:    number;  // 0-100, % of note covered by vibrato
  period:    number;  // ms per cycle (50-500)
  depth:     number;  // cents (0-200)
  fadeIn:    number;  // 0-100, % of vibrato length for fade in
  fadeOut:   number;  // 0-100, % of vibrato length for fade out
  shift:     number;  // -100 to 100, phase shift
  drift:     number;  // -100 to 100, pitch drift over vibrato
}

/** Pitch bend envelope point */
export interface PitchBendPoint {
  x: number;   // 0-1 position within note
  y: number;   // semitones (-12 to +12)
}

/** Expression parameters for UTAU/OpenUTAU rendering */
export interface NoteExpressions {
  velocity:     number;  // 0-200, default 100
  intensity:    number;  // 0-200, default 100  
  modulation:   number;  // 0-100, default 0
  breathiness:  number;  // 0-100, per-note override
  tension:      number;  // 0-100, per-note override
  voicing:      number;  // 0-100, voiced/unvoiced balance
}

export interface Note {
  id:           string;
  pitch:        number;     // MIDI note number
  start:        number;     // beats
  duration:     number;     // beats
  lyric:        string;     // display lyric
  phoneme?:     string;     // MLC-converted phoneme (may differ from lyric)
  selected:     boolean;
  playing:      boolean;
  
  // ─── Pro features ───────────────────────────────────────────────────────
  /** Portamento from previous note (0 = none, 100 = full glide) */
  portamento:   number;
  
  /** Note-specific vibrato settings. null = use track defaults */
  vibrato:      VibratoParams | null;
  
  /** Expression parameters */
  expressions:  NoteExpressions;
  
  /** Custom pitch bend envelope. Empty = straight pitch */
  pitchBend:    PitchBendPoint[];
  
  /** Consonant velocity (affects attack sharpness) */
  consonantVelocity: number;  // 0-200, default 100
  
  /** Pre-utterance override in ms. null = use oto.ini default */
  preUtterance: number | null;
  
  /** Voice overlap override in ms. null = use oto.ini default */
  overlap:      number | null;
  
  /** Note flags (engine-specific, e.g. "g-5" for gender, "Y0" for pitch) */
  flags:        string;
}

export interface PitchPoint {
  noteId: string;
  x:      number;    // beats
  y:      number;    // semitones deviation
  selected: boolean;
}

export interface VoiceTrack {
  id:         string;
  name:       string;
  voiceBank?: string;
  voicePath?: string;   // absolute path to bank folder
  engine?:    string;
  color:      string;
  muted:      boolean;
  selected:   boolean;
  // Voice parameters (0–100)
  breathiness: number;
  tension:     number;
  gender:      number;
  pitchRange:  number;
}

export interface AppNotification {
  id:        string;
  type:      'success' | 'warning' | 'error' | 'info' | 'tip';
  title:     string;
  body?:     string;
  progress?: number;
  timeEstimate?: string;
  action?:   { label: string; onClick: () => void };
  pinned?:   boolean;
}

export type EditorMode = 'select' | 'draw' | 'erase' | 'pitch';
export type SnapDiv    = '1/4' | '1/8' | '1/16' | '1/32';

const SNAP_BEATS: Record<SnapDiv, number> = {
  '1/4': 1, '1/8': 0.5, '1/16': 0.25, '1/32': 0.125,
};

// ── Undo history ──────────────────────────────────────────────────────────────

interface HistoryEntry {
  label:  string;
  notes:  Note[];
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface ProjectState {
  // Project metadata
  projectName:   string;
  isDirty:       boolean;

  // Transport
  bpm:              number;
  isPlaying:        boolean;
  playheadPosition: number;   // beats

  // Editor state
  mode:     EditorMode;
  snap:     SnapDiv;
  isDark:   boolean;

  // Data
  notes:       Note[];
  pitchPoints: PitchPoint[];
  tracks:      VoiceTrack[];

  // UI
  notifications:  AppNotification[];
  notifOpen:      boolean;
  notifPinned:    boolean;
  paletteOpen:    boolean;
  vbManagerOpen:  boolean;

  // Undo
  _history:    HistoryEntry[];
  _historyIdx: number;

  // Clipboard
  _clipboard: Note[];
  copySelected: () => void;
  pasteNotes:   (atBeat?: number) => void;

  // Project file
  currentFilePath: string | null;
  setCurrentFilePath: (p: string | null) => void;
  setDirty: (v: boolean) => void;
  setProjectName: (name: string) => void;

  // Render callback (set by App)
  triggerRender?: () => void;
  setTriggerRender: (fn: () => void) => void;

  // Load a full project from disk
  loadProject: (p: import('../subsystems/project-io').LoidProject) => void;

  // ── Actions ────────────────────────────────────────────────────────────────

  // Transport
  setPlaying:     (v: boolean) => void;
  setPlayhead:    (beats: number) => void;
  setBpm:         (bpm: number) => void;

  // Editor
  setMode:   (m: EditorMode) => void;
  setSnap:   (s: SnapDiv)    => void;
  toggleDark: () => void;
  setDark:   (v: boolean) => void;

  // Notes — every note mutation goes through these
  addNote:       (note: Omit<Note, 'id' | 'selected' | 'playing'>) => string;
  deleteNote:    (id: string) => void;
  deleteSelected: () => void;
  updateNote:    (id: string, patch: Partial<Note>) => void;
  moveNotes:     (ids: string[], dPitch: number, dStart: number) => void;
  resizeNote:    (id: string, duration: number) => void;
  selectNote:    (id: string, additive?: boolean) => void;
  selectRange:   (minBeat: number, maxBeat: number, minPitch: number, maxPitch: number) => void;
  selectAll:     () => void;
  deselectAll:   () => void;
  setLyric:      (id: string, lyric: string) => void;

  // Pitch
  addPitchPoint:    (p: Omit<PitchPoint, 'selected'>) => void;
  deletePitchPoint: (noteId: string, x: number) => void;
  movePitchPoint:   (noteId: string, oldX: number, newX: number, newY: number) => void;
  clearPitchPoints: (noteId?: string) => void;

  // ─── Pro editing actions ────────────────────────────────────────────────────
  /** Quantize selected notes to the current snap grid */
  quantizeSelected: () => void;
  
  /** Transpose selected notes by semitones */
  transposeSelected: (semitones: number) => void;
  
  /** Humanize selected notes (subtle random timing/velocity variations) */
  humanizeSelected: (amount: number) => void;
  
  /** Legato: extend each selected note to meet the next */
  legatoSelected: () => void;
  
  /** Apply default vibrato to selected notes */
  addVibratoToSelected: () => void;
  
  /** Remove vibrato from selected notes */
  removeVibratoFromSelected: () => void;
  
  /** Set portamento for selected notes */
  setPortamentoSelected: (amount: number) => void;
  
  /** Split a note at a specific beat position */
  splitNote: (id: string, atBeat: number) => void;
  
  /** Merge consecutive selected notes into one */
  mergeSelected: () => void;
  
  /** Duplicate selected notes, offset by given beats */
  duplicateSelected: (offsetBeats: number) => void;
  
  /** Set expression values for selected notes */
  setExpressionSelected: (expr: Partial<NoteExpressions>) => void;

  // Tracks
  addTrack:     () => void;
  removeTrack:  (id: string) => void;
  selectTrack:  (id: string) => void;
  updateTrack:  (id: string, patch: Partial<VoiceTrack>) => void;

  // Notifications
  notify:        (n: Omit<AppNotification, 'id'>) => void;
  dismissNotif:  (id: string) => void;
  clearNotifs:   () => void;
  setNotifOpen:  (v: boolean) => void;
  setNotifPinned:(v: boolean) => void;

  // UI
  setPaletteOpen:  (v: boolean) => void;
  setVbManagerOpen:(v: boolean) => void;

  // Undo / Redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

// ── Snap helper ───────────────────────────────────────────────────────────────

export function snapBeat(beat: number, snap: SnapDiv): number {
  const div = SNAP_BEATS[snap];
  return Math.round(beat / div) * div;
}

export function snapDuration(dur: number, snap: SnapDiv): number {
  const div = SNAP_BEATS[snap];
  return Math.max(div, Math.round(dur / div) * div);
}

// ── Default values for pro features ──────────────────────────────────────────

export const DEFAULT_EXPRESSIONS: NoteExpressions = {
  velocity:    100,
  intensity:   100,
  modulation:  0,
  breathiness: 50,
  tension:     50,
  voicing:     100,
};

export const DEFAULT_VIBRATO: VibratoParams = {
  length:   75,    // cover 75% of note
  period:   175,   // ms per cycle
  depth:    35,    // cents
  fadeIn:   20,
  fadeOut:  20,
  shift:    0,
  drift:    0,
};

/** Create a new note with all defaults filled in */
export function createNote(partial: Partial<Note> & Pick<Note, 'pitch' | 'start' | 'duration' | 'lyric'>): Note {
  return {
    id:                partial.id ?? nanoid(8),
    pitch:             partial.pitch,
    start:             partial.start,
    duration:          partial.duration,
    lyric:             partial.lyric,
    phoneme:           partial.phoneme,
    selected:          partial.selected ?? false,
    playing:           partial.playing ?? false,
    portamento:        partial.portamento ?? 0,
    vibrato:           partial.vibrato ?? null,
    expressions:       partial.expressions ?? { ...DEFAULT_EXPRESSIONS },
    pitchBend:         partial.pitchBend ?? [],
    consonantVelocity: partial.consonantVelocity ?? 100,
    preUtterance:      partial.preUtterance ?? null,
    overlap:           partial.overlap ?? null,
    flags:             partial.flags ?? '',
  };
}

// ── Initial state (blank canvas) ─────────────────────────────────────────────

const INIT_NOTES: Note[] = [];

// ── Store implementation ──────────────────────────────────────────────────────

function pushHistory(state: ProjectState, label: string): Partial<ProjectState> {
  const entry: HistoryEntry = { label, notes: state.notes };
  const newHistory = state._history.slice(0, state._historyIdx + 1);
  newHistory.push(entry);
  // cap at 200 entries
  if (newHistory.length > 200) newHistory.shift();
  return {
    _history:    newHistory,
    _historyIdx: newHistory.length - 1,
    isDirty:     true,
  };
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projectName:      'untitled',
  isDirty:          false,
  bpm:              132,
  isPlaying:        false,
  playheadPosition: 0,
  mode:             'draw',
  snap:             '1/16',
  isDark:           false,  // will be set from OS preference in App.tsx before first paint
  notes:            INIT_NOTES,
  pitchPoints:      [],
  tracks: [
    { id:'t1', name:'Track 1', color:'#4DBF90', muted:false, selected:true, breathiness:40, tension:65, gender:30, pitchRange:50 },
    { id:'t2', name:'Track 2', color:'#9A9590', muted:false, selected:false, breathiness:40, tension:65, gender:30, pitchRange:50, velocity:100, volume:100, attack:100, decay:0, modulation:0, toneShift:0, lowpass:0, normalize:86 },
  ],
  notifications:   [],
  notifOpen:       false,
  notifPinned:     false,
  paletteOpen:     false,
  vbManagerOpen:   false,
  _history:        [{ label: 'initial', notes: INIT_NOTES }],
  _historyIdx:     0,
  _clipboard: [],
  currentFilePath: null,
  triggerRender:   undefined,

  // Transport
  setPlaying:  (v) => set({ isPlaying: v }),
  setPlayhead: (b) => set({ playheadPosition: b }),
  setBpm:      (bpm) => set({ bpm, isDirty: true }),

  // Editor
  setMode:    (m) => set({ mode: m }),
  setSnap:    (s) => set({ snap: s }),
  toggleDark: () => set(s => ({ isDark: !s.isDark })),
  setDark:    (v) => set({ isDark: v }),

  // Notes
  addNote: (note) => {
    const newNote = createNote({ ...note, selected: true, playing: false });
    set(s => ({
      notes: [...s.notes, newNote],
      ...pushHistory(s, `Draw note`),
    }));
    return newNote.id;
  },

  deleteNote: (id) => set(s => ({
    notes: s.notes.filter(n => n.id !== id),
    ...pushHistory(s, `Delete note`),
  })),

  deleteSelected: () => set(s => {
    const count = s.notes.filter(n => n.selected).length;
    if (!count) return {};
    return {
      notes: s.notes.filter(n => !n.selected),
      ...pushHistory(s, `Delete ${count} note${count > 1 ? 's' : ''}`),
    };
  }),

  updateNote: (id, patch) => set(s => ({
    notes: s.notes.map(n => n.id === id ? { ...n, ...patch } : n),
    isDirty: true,
  })),

  moveNotes: (ids, dPitch, dStart) => set(s => {
    const idSet = new Set(ids);
    return {
      notes: s.notes.map(n => idSet.has(n.id)
        ? { ...n, pitch: Math.max(0, Math.min(127, n.pitch + dPitch)), start: Math.max(0, n.start + dStart) }
        : n),
      ...pushHistory(s, `Move note${ids.length > 1 ? 's' : ''}`),
    };
  }),

  resizeNote: (id, duration) => set(s => ({
    notes: s.notes.map(n => n.id === id ? { ...n, duration: Math.max(SNAP_BEATS[s.snap], duration) } : n),
    isDirty: true,
  })),

  selectNote: (id, additive = false) => set(s => ({
    notes: s.notes.map(n => ({
      ...n,
      selected: additive ? (n.id === id ? !n.selected : n.selected) : n.id === id,
    })),
  })),

  selectRange: (minBeat, maxBeat, minPitch, maxPitch) => set(s => ({
    notes: s.notes.map(n => ({
      ...n,
      // Select if the note overlaps the range (not just fully inside)
      selected: n.start < maxBeat + 0.001
             && n.start + n.duration > minBeat - 0.001
             && n.pitch >= minPitch
             && n.pitch <= maxPitch,
    })),
  })),

  selectAll:   () => set(s => ({ notes: s.notes.map(n => ({ ...n, selected: true })) })),
  deselectAll: () => set(s => ({ notes: s.notes.map(n => ({ ...n, selected: false })) })),

  setLyric: (id, lyric) => set(s => ({
    notes:   s.notes.map(n => n.id === id ? { ...n, lyric } : n),
    isDirty: true,
  })),

  // Pitch points
  movePitchPoint: (noteId, oldX, newX, newY) => set(s => ({
    pitchPoints: s.pitchPoints.map(p =>
      p.noteId === noteId && Math.abs(p.x - oldX) < 0.001
        ? { ...p, x: newX, y: newY }
        : p
    ),
    isDirty: true,
  })),

  clearPitchPoints: (noteId) => set(s => ({
    pitchPoints: noteId
      ? s.pitchPoints.filter(p => p.noteId !== noteId)
      : [],
    isDirty: true,
  })),

  addPitchPoint: (p) => set(s => ({
    pitchPoints: [...s.pitchPoints, { ...p, selected: false }],
    isDirty: true,
  })),

  deletePitchPoint: (noteId, x) => set(s => ({
    pitchPoints: s.pitchPoints.filter(p => !(p.noteId === noteId && Math.abs(p.x - x) < 0.01)),
    isDirty: true,
  })),

  // ─── Pro editing actions ────────────────────────────────────────────────────

  quantizeSelected: () => set(s => {
    const selected = s.notes.filter(n => n.selected);
    if (!selected.length) return {};
    const snap = SNAP_BEATS[s.snap];
    return {
      notes: s.notes.map(n => {
        if (!n.selected) return n;
        return {
          ...n,
          start: Math.round(n.start / snap) * snap,
          duration: Math.max(snap, Math.round(n.duration / snap) * snap),
        };
      }),
      ...pushHistory(s, `Quantize ${selected.length} note${selected.length > 1 ? 's' : ''}`),
    };
  }),

  transposeSelected: (semitones) => set(s => {
    const selected = s.notes.filter(n => n.selected);
    if (!selected.length) return {};
    return {
      notes: s.notes.map(n => {
        if (!n.selected) return n;
        return { ...n, pitch: Math.max(0, Math.min(127, n.pitch + semitones)) };
      }),
      ...pushHistory(s, `Transpose ${semitones > 0 ? '+' : ''}${semitones}`),
    };
  }),

  humanizeSelected: (amount) => set(s => {
    const selected = s.notes.filter(n => n.selected);
    if (!selected.length) return {};
    const factor = amount / 100;
    return {
      notes: s.notes.map(n => {
        if (!n.selected) return n;
        // Subtle random timing variation (±5% of beat at full humanize)
        const timingVar = (Math.random() - 0.5) * 0.1 * factor;
        // Velocity variation (±15% at full humanize)
        const velVar = 1 + (Math.random() - 0.5) * 0.3 * factor;
        return {
          ...n,
          start: Math.max(0, n.start + timingVar),
          expressions: {
            ...n.expressions,
            velocity: Math.max(20, Math.min(180, Math.round(n.expressions.velocity * velVar))),
          },
        };
      }),
      ...pushHistory(s, `Humanize ${selected.length} note${selected.length > 1 ? 's' : ''}`),
    };
  }),

  legatoSelected: () => set(s => {
    const selected = s.notes.filter(n => n.selected).sort((a, b) => a.start - b.start);
    if (selected.length < 2) return {};
    const selectedIds = new Set(selected.map(n => n.id));
    
    return {
      notes: s.notes.map(n => {
        if (!selectedIds.has(n.id)) return n;
        const idx = selected.findIndex(sn => sn.id === n.id);
        if (idx < 0 || idx >= selected.length - 1) return n;
        const next = selected[idx + 1];
        return { ...n, duration: next.start - n.start };
      }),
      ...pushHistory(s, `Legato ${selected.length} notes`),
    };
  }),

  addVibratoToSelected: () => set(s => {
    const selected = s.notes.filter(n => n.selected);
    if (!selected.length) return {};
    return {
      notes: s.notes.map(n => {
        if (!n.selected) return n;
        return { ...n, vibrato: { ...DEFAULT_VIBRATO } };
      }),
      ...pushHistory(s, `Add vibrato to ${selected.length} note${selected.length > 1 ? 's' : ''}`),
    };
  }),

  removeVibratoFromSelected: () => set(s => {
    const selected = s.notes.filter(n => n.selected);
    if (!selected.length) return {};
    return {
      notes: s.notes.map(n => {
        if (!n.selected) return n;
        return { ...n, vibrato: null };
      }),
      ...pushHistory(s, `Remove vibrato from ${selected.length} note${selected.length > 1 ? 's' : ''}`),
    };
  }),

  setPortamentoSelected: (amount) => set(s => {
    const selected = s.notes.filter(n => n.selected);
    if (!selected.length) return {};
    return {
      notes: s.notes.map(n => {
        if (!n.selected) return n;
        return { ...n, portamento: Math.max(0, Math.min(100, amount)) };
      }),
      ...pushHistory(s, `Set portamento to ${amount}%`),
    };
  }),

  splitNote: (id, atBeat) => set(s => {
    const note = s.notes.find(n => n.id === id);
    if (!note) return {};
    if (atBeat <= note.start || atBeat >= note.start + note.duration) return {};
    
    const firstDuration = atBeat - note.start;
    const secondDuration = note.duration - firstDuration;
    
    const firstNote = { ...note, duration: firstDuration };
    const secondNote = createNote({
      pitch: note.pitch,
      start: atBeat,
      duration: secondDuration,
      lyric: note.lyric,
      selected: note.selected,
    });
    
    return {
      notes: s.notes.map(n => n.id === id ? firstNote : n).concat(secondNote),
      ...pushHistory(s, `Split note`),
    };
  }),

  mergeSelected: () => set(s => {
    const selected = s.notes.filter(n => n.selected).sort((a, b) => a.start - b.start);
    if (selected.length < 2) return {};
    
    // Check they're on the same pitch and consecutive
    const firstPitch = selected[0].pitch;
    const allSamePitch = selected.every(n => n.pitch === firstPitch);
    if (!allSamePitch) return {};
    
    const merged = createNote({
      pitch: firstPitch,
      start: selected[0].start,
      duration: (selected[selected.length - 1].start + selected[selected.length - 1].duration) - selected[0].start,
      lyric: selected.map(n => n.lyric).join(''),
      selected: true,
    });
    
    const selectedIds = new Set(selected.map(n => n.id));
    return {
      notes: s.notes.filter(n => !selectedIds.has(n.id)).concat(merged),
      ...pushHistory(s, `Merge ${selected.length} notes`),
    };
  }),

  duplicateSelected: (offsetBeats) => set(s => {
    const selected = s.notes.filter(n => n.selected);
    if (!selected.length) return {};
    
    const duplicates = selected.map(n => createNote({
      ...n,
      id: undefined, // createNote will generate new ID
      start: n.start + offsetBeats,
      selected: true,
    }));
    
    // Deselect originals, add duplicates
    return {
      notes: s.notes.map(n => n.selected ? { ...n, selected: false } : n).concat(duplicates),
      ...pushHistory(s, `Duplicate ${selected.length} note${selected.length > 1 ? 's' : ''}`),
    };
  }),

  setExpressionSelected: (expr) => set(s => {
    const selected = s.notes.filter(n => n.selected);
    if (!selected.length) return {};
    return {
      notes: s.notes.map(n => {
        if (!n.selected) return n;
        return { ...n, expressions: { ...n.expressions, ...expr } };
      }),
      ...pushHistory(s, `Set expression`),
    };
  }),

  // Tracks
  addTrack: () => set(s => {
    const colors = ['#9A9590','#E8607A','#7B8FE8','#F5A623','#4DBF90'];
    const color  = colors[s.tracks.length % colors.length];
    return {
      tracks: [...s.tracks, {
        id: nanoid(8), name: `Track ${s.tracks.length + 1}`,
        color, muted: false, selected: false,
        breathiness:40, tension:65, gender:30, pitchRange:50,
        velocity:100, volume:100, attack:100, decay:0, modulation:0, toneShift:0, lowpass:0, normalize:86,
      }],
      isDirty: true,
    };
  }),

  removeTrack: (id) => set(s => ({
    tracks: s.tracks.length > 1 ? s.tracks.filter(t => t.id !== id) : s.tracks,
    isDirty: true,
  })),

  selectTrack: (id) => set(s => ({
    tracks: s.tracks.map(t => ({ ...t, selected: t.id === id })),
  })),

  updateTrack: (id, patch) => set(s => ({
    tracks: s.tracks.map(t => t.id === id ? { ...t, ...patch } : t),
    isDirty: true,
  })),

  // Notifications
  notify: (n) => {
    const id = nanoid(6);
    set(s => ({ notifications: [...s.notifications, { ...n, id }] }));
    if (n.type === 'success' || n.type === 'tip') {
      const delay = n.type === 'success' ? 6000 : 10000;
      setTimeout(() => get().dismissNotif(id), delay);
    }
  },

  dismissNotif: (id) => set(s => ({ notifications: s.notifications.filter(n => n.id !== id) })),
  clearNotifs:  () => set({ notifications: [] }),
  setNotifOpen:   (v) => set({ notifOpen: v }),
  setNotifPinned: (v) => set({ notifPinned: v }),
  setPaletteOpen:   (v) => set({ paletteOpen: v }),
  setVbManagerOpen: (v) => set({ vbManagerOpen: v }),

  // Clipboard
  copySelected: () => set(s => {
    const sel = s.notes.filter(n => n.selected);
    if (!sel.length) return {};
    return { _clipboard: sel.map(n => ({ ...n })) };
  }),

  pasteNotes: (atBeat) => set(s => {
    if (!s._clipboard.length) return {};
    const minBeat = Math.min(...s._clipboard.map(n => n.start));
    const targetBeat = atBeat ?? (s.playheadPosition > 0 ? s.playheadPosition : minBeat + 0.5);
    const offset = targetBeat - minBeat;
    const pasted: Note[] = s._clipboard.map(n => ({
      ...n, id: nanoid(8), start: n.start + offset, selected: true, playing: false,
    }));
    return {
      notes: [...s.notes.map(n => ({...n, selected: false})), ...pasted],
      ...pushHistory(s, `Paste ${pasted.length} note${pasted.length > 1 ? 's' : ''}`),
    };
  }),

  // Project file
  setCurrentFilePath: (p) => set({ currentFilePath: p }),
  setDirty: (v) => set({ isDirty: v }),
  setProjectName: (name) => set({ projectName: name, isDirty: true }),
  setTriggerRender: (fn) => set({ triggerRender: fn }),

  loadProject: (p) => {
    // Normalize notes — older saves lack pro fields, fill defaults
    const defaultVibrato = typeof DEFAULT_VIBRATO !== 'undefined' ? DEFAULT_VIBRATO : {
      length:0,period:200,depth:30,fadeIn:20,fadeOut:20,shift:0,drift:0
    };
    const defaultExpr = typeof DEFAULT_EXPRESSIONS !== 'undefined' ? DEFAULT_EXPRESSIONS : {
      velocity:100,intensity:100,modulation:0,breathiness:-1,tension:-1,voicing:100
    };
    const normNotes = (p.notes ?? []).map(n => ({
      portamento:       0,
      vibrato:          null,
      expressions:      defaultExpr,
      pitchBend:        [],
      consonantVelocity:100,
      preUtterance:     null,
      overlap:          null,
      flags:            '',
      ...n,
      playing: false, selected: false,
    }));
    const normTracks = (p.tracks ?? []).map(t => ({
      breathiness: 40, tension: 65, gender: 30, pitchRange: 50,
      velocity: 100, volume: 100, attack: 100, decay: 0, modulation: 0, toneShift: 0, lowpass: 0, normalize: 86,
      ...t,
    }));
    set({
      projectName:   p.name ?? p.projectName ?? 'untitled',
      bpm:           p.bpm ?? 120,
      tracks:        normTracks,
      notes:         normNotes,
      pitchPoints:   p.pitchPoints ?? [],
      isDirty:       false,
      _history:      [{ label: 'load', notes: normNotes }],
      _historyIdx:   0,
    });
  },

  // Undo / Redo
  undo: () => set(s => {
    if (s._historyIdx <= 0) return {};
    const idx   = s._historyIdx - 1;
    const entry = s._history[idx];
    return { notes: entry.notes, _historyIdx: idx };
  }),

  redo: () => set(s => {
    if (s._historyIdx >= s._history.length - 1) return {};
    const idx   = s._historyIdx + 1;
    const entry = s._history[idx];
    return { notes: entry.notes, _historyIdx: idx };
  }),

  canUndo: () => get()._historyIdx > 0,
  canRedo: () => get()._historyIdx < get()._history.length - 1,
}));

// ── Shared types used by canvas components ────────────────────────────────────

export interface ScrollSyncBus {
  scrollX:   number;
  listeners: Set<(x: number) => void>;
}

export type ContextTarget =
  | { zone: 'pianoroll-note';  noteId: string }
  | { zone: 'pianoroll-notes'; count: number }
  | { zone: 'pianoroll-empty'; beat: number; pitch: number }
  | { zone: 'pitch-point';     pointIdx: number }
  | { zone: 'pitch-empty' }
  | { zone: 'lyrics-cell';     beat: number }
  | { zone: 'voice-panel' };
