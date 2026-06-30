/**
 * Melon Synth App Addon Types — .melon format
 * =============================================
 * Type definitions for the Melon Synth app extension system.
 * Addon developers import from @melon/addon-sdk which re-exports these.
 *
 * .melon bundle format (ZIP):
 *   manifest.json     — required
 *   index.js          — compiled React/JS entry (renderer side)
 *   main.js           — optional Node.js main process code
 *   assets/           — icons, styles, data files
 *   README.md         — encouraged
 */

// ── Manifest ────────────────────────────────────────────────────────────────

export interface MelonAddonManifest {
  // Identity
  id:          string;       // unique, lowercase-hyphenated
  name:        string;
  version:     string;       // semver
  description: string;
  author:      string;
  license:     string;
  homepage?:   string;
  repository?: string;

  // Compatibility
  type:        'app_addon';
  min_melon:   string;       // minimum Melon Synth version
  max_melon?:  string;

  // What this addon contributes
  contributes: MelonContributions;

  // Technical
  entry_point:  string;      // compiled renderer JS bundle (e.g. "index.js")
  main_process?: string;     // optional Node.js main process module

  // Permissions — user sees these on install
  permissions: MelonPermission[];

  // Dependencies on other addons
  depends_on?: Array<{ id: string; version: string }>;

  // Update
  update_url?: string;
}

export interface MelonContributions {
  panels?:       PanelContribution[];
  commands?:     CommandContribution[];
  shortcuts?:    ShortcutContribution[];
  file_formats?: FileFormatContribution[];
  menu_items?:   MenuItemContribution[];
  toolbar_items?: ToolbarItemContribution[];
  context_menu_items?: ContextMenuContribution[];
}

export type MelonPermission =
  | 'microphone'       // MediaDevices.getUserMedia
  | 'project.read'     // read notes, tracks, bpm
  | 'project.write'    // add/modify/delete notes and tracks
  | 'mlc.convert'      // call MLC engine
  | 'audio.play'       // trigger audio playback
  | 'audio.capture'    // capture audio stream
  | 'filesystem.read'  // read arbitrary local files
  | 'filesystem.write' // write to user-chosen paths
  | 'network'          // outbound HTTP requests
  | 'notifications'    // show notifications in the bell panel
  | 'clipboard'        // read/write clipboard

// ── Layout zones ────────────────────────────────────────────────────────────

export type LayoutZone =
  | 'voice_panel_bottom'   // below the voice properties section, left sidebar
  | 'voice_panel_tab'      // extra tab in the voice panel tab bar
  | 'editor_toolbar'       // extra toolbar row above the piano roll
  | 'editor_bottom'        // below the lyrics lane (above transport)
  | 'right_sidebar'        // collapsible panel on the right
  | 'floating_window'      // standalone draggable panel
  | 'command_bar_right'    // buttons in the right section of the command bar
  | 'status_bar'           // additions to the status bar (future)
  | 'welcome_screen'       // addition to the welcome screen

export interface PanelContribution {
  id:             string;
  display_name:   string;
  icon?:          string;          // Lucide icon name
  requested_zone: LayoutZone;
  fallback_zone?: LayoutZone;      // if requested zone is unavailable
  default_width?:  number;
  default_height?: number;
  min_width?:      number;
  min_height?:     number;
  resizable?:      boolean;
  collapsible?:    boolean;
  default_visible?: boolean;
  // The React component export name in entry_point
  component:      string;
}

export interface CommandContribution {
  id:       string;           // e.g. "hum.start"
  label:    string;
  icon?:    string;
  category?: string;          // for command palette grouping
  // handler defined in entry_point
}

export interface ShortcutContribution {
  command:  string;
  key:      string;           // e.g. "ctrl+h"
  when?:    string;           // context condition (future)
}

export interface MenuItemContribution {
  menu:    'File' | 'Edit' | 'View' | 'Tools' | 'Help';
  label:   string;
  command: string;
  icon?:   string;
  separator_before?: boolean;
}

export interface ToolbarItemContribution {
  id:      string;
  icon:    string;
  tooltip: string;
  command: string;
}

export interface ContextMenuContribution {
  zone:    string;             // which context zone to appear in
  label:   string;
  icon?:   string;
  command: string;
}

export interface FileFormatContribution {
  id:          string;
  name:        string;
  extensions:  string[];
  direction:   'import' | 'export' | 'both';
}

// ── The Melon Addon API (window.melonAddon) ─────────────────────────────────

export interface MelonAddonAPI {
  // ── Project ──────────────────────────────────────────────────────────────
  project: ProjectAPI;

  // ── MLC ───────────────────────────────────────────────────────────────────
  mlc: MLCAddonAPI;

  // ── Audio ─────────────────────────────────────────────────────────────────
  audio: AudioAddonAPI;

  // ── UI ────────────────────────────────────────────────────────────────────
  ui: UIAddonAPI;

  // ── Commands ──────────────────────────────────────────────────────────────
  commands: CommandsAPI;

  // ── Storage ───────────────────────────────────────────────────────────────
  storage: StorageAPI;

  // ── Files (requires filesystem.read permission) ───────────────────────────
  files?: FilesAPI;

  // ── Network (requires network permission) ─────────────────────────────────
  network?: NetworkAPI;

  // ── Addon metadata ────────────────────────────────────────────────────────
  addon: {
    id:       string;
    version:  string;
    name:     string;
    dataDir:  string;        // path where addon can store data
    manifest: MelonAddonManifest;
  };
}

export interface ProjectAPI {
  getNotes():               Note[];
  getTracks():              VoiceTrack[];
  getBpm():                 number;
  getTimeSignature():       string;
  getProjectName():         string;
  getPlayheadPosition():    number;
  getSelectedNotes():       Note[];

  addNote(note: Partial<Note>):            Promise<string>;
  addNotes(notes: Partial<Note>[]):        Promise<string[]>;
  updateNote(id: string, patch: Partial<Note>): Promise<void>;
  deleteNote(id: string):                  Promise<void>;
  deleteNotes(ids: string[]):              Promise<void>;
  selectNotes(ids: string[]):              Promise<void>;
  deselectAll():                           Promise<void>;
  setLyric(noteId: string, lyric: string): Promise<void>;
  setBpm(bpm: number):                     Promise<void>;

  // Event subscriptions — returns unsubscribe function
  on(event: ProjectEvent, cb: () => void): () => void;
}

export type ProjectEvent =
  | 'notes-changed'
  | 'selection-changed'
  | 'bpm-changed'
  | 'playhead-moved'
  | 'track-changed'
  | 'project-loaded'
  | 'project-saved'

export interface MLCAddonAPI {
  convert(params: {
    text:         string;
    moduleId?:    string;
    singability?: number;
    lang?:        string;
  }): Promise<any>;
  listModules():                  Promise<any[]>;
  detectLanguage(text: string):   Promise<string>;
  suggestSingability(params: any): Promise<any>;
}

export interface AudioAddonAPI {
  startMicCapture(): Promise<MediaStream>;
  stopMicCapture():  Promise<void>;
  getAnalyserNode(): AnalyserNode | null;
  playNote(pitch: number, durationMs: number, velocity?: number): void;
  stopAllNotes(): void;
  isPlaying(): boolean;
}

export interface UIAddonAPI {
  notify(n: {
    type:     'success' | 'warning' | 'error' | 'info';
    title:    string;
    body?:    string;
    action?:  { label: string; onClick: () => void };
  }): void;
  showProgress(label: string, percent: number): void;
  hideProgress(): void;
  openPanel(panelId: string): void;
  closePanel(panelId: string): void;
  getTheme(): 'light' | 'dark';
  onThemeChange(cb: (theme: 'light' | 'dark') => void): () => void;
  // CSS variable values from tokens.css
  getToken(name: string): string;
  // All design tokens as an object
  tokens: Record<string, string>;
}

export interface CommandsAPI {
  register(id: string, handler: (api: MelonAddonAPI) => void | Promise<void>): void;
  unregister(id: string): void;
  execute(id: string): Promise<void>;
  isRegistered(id: string): boolean;
}

export interface StorageAPI {
  // Persisted in userData/addon-data/{addon-id}/storage.json
  get<T = any>(key: string): Promise<T | null>;
  set<T = any>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  // Saved in the .loid project file (per-project)
  getProjectData<T = any>(key: string): Promise<T | null>;
  setProjectData<T = any>(key: string, value: T): Promise<void>;
}

export interface FilesAPI {
  openDialog(opts: {
    title?:      string;
    filters?:    Array<{ name: string; extensions: string[] }>;
    multiple?:   boolean;
  }): Promise<string | string[] | null>;
  readText(path: string):   Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
}

export interface NetworkAPI {
  fetch(url: string, opts?: RequestInit): Promise<Response>;
}

// Re-export project types
export type { Note, VoiceTrack } from '../store/project';
