/**
 * Project I/O — v2
 * ================
 * .loid files are ZIP archives containing structured JSON files.
 * Addon data is stored per-addon in addon-data/{id}/data.json inside the ZIP.
 *
 * Structure:
 *   manifest.json          — version, name, timestamps
 *   project.json           — bpm, time signature
 *   tracks.json            — voice tracks
 *   notes.json             — all notes
 *   pitch.json             — pitch curve points
 *   addon-data/{id}/data.json  — per-addon project storage
 *
 * v1 compat: plain JSON .loid files are auto-migrated on load.
 *
 * In Electron: ZIP via app.saveProjectZip / app.readProjectZip IPC.
 * In browser: plain JSON download / file picker (no ZIP).
 */

import type { Note, PitchPoint, VoiceTrack } from '../store/project';

export const LOID_VERSION   = '2.0' as const;
export const MELON_VERSION  = '1.1.0-alpha';

export interface LoidManifest {
  version:       string;
  name:          string;
  created_at:    string;
  modified_at:   string;
  melon_version: string;
}

export interface LoidProject {
  version:     string;
  name:        string;
  bpm:         number;
  timeSig:     [number, number];
  tracks:      VoiceTrack[];
  notes:       Note[];
  pitchPoints: PitchPoint[];
  createdAt:   string;
  modifiedAt:  string;
  // Per-addon project data (saved inside the ZIP under addon-data/{id}/data.json)
  addonData:   Record<string, any>;
}

// ── Serialise ─────────────────────────────────────────────────────────────────

export function serializeProject(
  name:        string,
  bpm:         number,
  tracks:      VoiceTrack[],
  notes:       Note[],
  pitchPoints: PitchPoint[],
  addonData:   Record<string, any> = {},
): LoidProject {
  const now = new Date().toISOString();
  return {
    version:     LOID_VERSION,
    name,
    bpm,
    timeSig:     [4, 4],
    tracks:      tracks.map(t => ({ ...t })),
    notes:       notes.map(n => ({ ...n, playing: false, selected: false })),
    pitchPoints: pitchPoints.map(p => ({ ...p })),
    createdAt:   now,
    modifiedAt:  now,
    addonData,
  };
}

// ── Save ──────────────────────────────────────────────────────────────────────

const isElectron = typeof window !== 'undefined' && !!(window as any).app;

export async function saveProject(
  project:  LoidProject,
  filePath: string | null,
): Promise<string | null> {

  if (isElectron) {
    const path = filePath ?? await (window as any).app.saveProject(project.name + '.loid');
    if (!path) return null;

    // Build the ZIP file map
    const now = new Date().toISOString();
    const manifest: LoidManifest = {
      version:       LOID_VERSION,
      name:          project.name,
      created_at:    project.createdAt || now,
      modified_at:   now,
      melon_version: MELON_VERSION,
    };

    const files: Record<string, string> = {
      'manifest.json': JSON.stringify(manifest, null, 2),
      'project.json':  JSON.stringify({ bpm: project.bpm, timeSig: project.timeSig }, null, 2),
      'tracks.json':   JSON.stringify(project.tracks, null, 2),
      'notes.json':    JSON.stringify(project.notes, null, 2),
      'pitch.json':    JSON.stringify(project.pitchPoints, null, 2),
    };

    // Addon data — one file per addon
    for (const [addonId, data] of Object.entries(project.addonData ?? {})) {
      files[`addon-data/${addonId}/data.json`] = JSON.stringify(data, null, 2);
    }

    // Try ZIP save (Electron IPC), fall back to plain JSON
    if ((window as any).app.saveProjectZip) {
      await (window as any).app.saveProjectZip(path, files);
    } else {
      await (window as any).app.writeFile(path, JSON.stringify(project, null, 2));
    }

    return path;
  }

  // Browser fallback: plain JSON download
  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), {
    href: url, download: `${project.name}.loid`,
  }).click();
  URL.revokeObjectURL(url);
  return project.name + '.loid';
}

// ── Load ──────────────────────────────────────────────────────────────────────

export async function openProject(): Promise<{ project: LoidProject; path: string } | null> {
  if (isElectron) {
    const path = await (window as any).app.openProject();
    if (!path) return null;
    const project = await loadFromPath(path);
    return project ? { project, path } : null;
  }

  // Browser fallback: file input
  return new Promise(resolve => {
    const input  = document.createElement('input');
    input.type   = 'file';
    input.accept = '.loid,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const text = await file.text();
      const project = parseRaw(text);
      resolve(project ? { project, path: file.name } : null);
    };
    input.click();
  });
}

export async function loadFromPath(path: string): Promise<LoidProject | null> {
  if (!isElectron) return null;
  try {
    // Try ZIP load first (v2)
    if ((window as any).app.readProjectZip) {
      const files: Record<string, string> | null = await (window as any).app.readProjectZip(path);
      if (files && files['manifest.json']) {
        return parseZipProject(files);
      }
    }
    // Fallback: plain JSON (v1)
    const content = await (window as any).app.readFile(path);
    return parseRaw(content);
  } catch (e) {
    console.error('[project-io] Load failed:', e);
    return null;
  }
}

// ── Parse helpers ─────────────────────────────────────────────────────────────

function parseZipProject(files: Record<string, string>): LoidProject {
  const manifest  = safeJson(files['manifest.json'], {}) as LoidManifest;
  const proj      = safeJson(files['project.json'], {})  as { bpm: number; timeSig: [number,number] };
  const tracks    = safeJson(files['tracks.json'], [])    as VoiceTrack[];
  const notes     = safeJson(files['notes.json'], [])     as Note[];
  const pitch     = safeJson(files['pitch.json'], [])     as PitchPoint[];
  const addonData: Record<string, any> = {};

  for (const [filePath, content] of Object.entries(files)) {
    const m = filePath.match(/^addon-data\/([^/]+)\/data\.json$/);
    if (m) addonData[m[1]] = safeJson(content, {});
  }

  return {
    version:     manifest.version || LOID_VERSION,
    name:        manifest.name    || 'untitled',
    bpm:         proj.bpm         || 132,
    timeSig:     proj.timeSig     || [4, 4],
    tracks:      normalizeNotes(notes).map ? tracks : tracks,
    notes:       normalizeNotes(notes),
    pitchPoints: pitch,
    createdAt:   manifest.created_at  || new Date().toISOString(),
    modifiedAt:  manifest.modified_at || new Date().toISOString(),
    addonData,
  };
}

function parseRaw(text: string): LoidProject | null {
  try {
    const data = JSON.parse(text);
    return migrate(data);
  } catch {
    return null;
  }
}

/** Migrate v1 plain-JSON projects to v2 shape */
function migrate(old: any): LoidProject {
  if (old.version === LOID_VERSION && old.addonData !== undefined) return old as LoidProject;
  const now = new Date().toISOString();
  return {
    version:     LOID_VERSION,
    name:        old.name || old.projectName || 'untitled',  // v1 used projectName
    bpm:         old.bpm         || 132,
    timeSig:     old.timeSig     || [4, 4],
    tracks:      old.tracks      || [],
    notes:       normalizeNotes(old.notes || []),
    pitchPoints: old.pitchPoints || [],
    createdAt:   old.createdAt   || now,
    modifiedAt:  old.modifiedAt  || now,
    addonData:   old.addonData   || {},
  };
}

function normalizeNotes(notes: any[]): Note[] {
  return (notes || []).map((n: any) => ({ ...n, playing: false, selected: false }));
}

function safeJson(text: string | undefined, fallback: any) {
  if (!text) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

// ── New project ───────────────────────────────────────────────────────────────

export function newProject(name = 'untitled'): LoidProject {
  const now = new Date().toISOString();
  return {
    version:     LOID_VERSION,
    name,
    bpm:         132,
    timeSig:     [4, 4],
    tracks: [
      {
        id:'t1', name:'Track 1', voiceBank: '', voicePath: '', engine:'OpenUTAU',
        color:'#4DBF90', muted:false, selected:true,
        breathiness:40, tension:65, gender:30, pitchRange:50,
        velocity:100, volume:100, attack:100, decay:0,
        modulation:0, toneShift:0, lowpass:0, normalize:86,
      } as VoiceTrack,
    ],
    notes:       [],
    pitchPoints: [],
    createdAt:   now,
    modifiedAt:  now,
    addonData:   {},
  };
}
