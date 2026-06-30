/**
 * Melon Extension Loader
 * ======================
 * Loads, manages, and runs .melon app extensions in Electron.
 *
 * A .melon file is a ZIP archive:
 *   manifest.json       — required: metadata, placements, permissions
 *   ui/index.html       — UI loaded in sandboxed BrowserView
 *   backend/main.py     — optional Python backend (spawned as child process)
 *   icon.svg            — icon for toolbar/menu
 *
 * The loader:
 *   1. Reads the manifest
 *   2. Checks melon_api compatibility
 *   3. Spawns a Python backend process (if declared)
 *   4. Exposes the melon.* JS API to the UI webview
 *   5. Registers UI placements (toolbar buttons, menu items, etc.)
 *   6. Manages install/remove/update lifecycle
 */

import { app, BrowserWindow, BrowserView, ipcMain, shell } from 'electron';
import * as fs   from 'fs';
import * as path from 'path';
import * as cp   from 'child_process';
import * as crypto from 'crypto';

const MELON_API_VERSION = '1.0.0';
const USER_DATA_DIR     = app.getPath('userData');
const EXTENSIONS_DIR    = path.join(USER_DATA_DIR, 'extensions');
const EXT_META_FILE     = path.join(EXTENSIONS_DIR, '.ext_meta.json');

interface ExtManifest {
  id:              string;
  name:            string;
  version:         string;
  melon_api:       string;
  extension_type:  string;
  description?:    string;
  author?:         string;
  license?:        string;
  homepage?:       string;
  icon?:           string;
  update_url?:     string;
  ui?: {
    entry:       string;
    width?:      number;
    height?:     number;
    resizable?:  boolean;
    title?:      string;
  };
  placements?: Array<{
    type:      string;
    label:     string;
    icon?:     string;
    tooltip?:  string;
    shortcut?: string;
    menu?:     string;
    tool_key?: string;
    default_collapsed?: boolean;
  }>;
  permissions?:  string[];
  backend?: {
    entry:      string;
    pip_deps?:  string[];
  };
}

interface ExtMetadata extends ExtManifest {
  file:         string;  // .melon filename
  extract_dir:  string;  // extracted path
  installed_at: number;
  hash:         string;
  source_url?:  string;
}

interface LoadedExtension {
  meta:    ExtMetadata;
  backend: cp.ChildProcess | null;
  view:    BrowserView | null;
  pendingCalls: Map<string, { resolve: Function; reject: Function }>;
}

// ── Manifest reading ──────────────────────────────────────────────────────────

function readMelonManifest(melonPath: string): ExtManifest | null {
  try {
    const { execSync } = require('child_process');
    // Use Python to read the ZIP (Node has no built-in ZIP)
    const py = `
import sys, json, zipfile
with zipfile.ZipFile(sys.argv[1]) as zf:
    names = zf.namelist()
    m = next((n for n in names if n.endswith('manifest.json')), None)
    if m:
        print(json.dumps(json.loads(zf.read(m))))
    else:
        print('null')
`;
    const out = execSync(`python3 -c "${py.replace(/\n/g, '; ').replace(/"/g, '\\"')}" "${melonPath}"`, {
      encoding: 'utf8', timeout: 5000,
    });
    return JSON.parse(out.trim());
  } catch {
    // Fallback: try reading as a directory
    const manifestPath = path.join(melonPath, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }
    return null;
  }
}

// ── Extract .melon bundle ─────────────────────────────────────────────────────

function extractMelon(melonPath: string, destDir: string): boolean {
  try {
    const { execSync } = require('child_process');
    fs.mkdirSync(destDir, { recursive: true });
    execSync(`python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "${melonPath}" "${destDir}"`, {
      timeout: 15000,
    });
    return true;
  } catch {
    return false;
  }
}

// ── Extension Manager ─────────────────────────────────────────────────────────

export class MelonExtensionManager {
  private extensions: Map<string, LoadedExtension> = new Map();
  private meta:       Map<string, ExtMetadata>      = new Map();
  private mainWindow: BrowserWindow | null          = null;

  constructor() {
    fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });
    this.loadMeta();
  }

  setMainWindow(win: BrowserWindow) {
    this.mainWindow = win;
  }

  // ── Metadata ──────────────────────────────────────────────────────────────

  private loadMeta() {
    if (fs.existsSync(EXT_META_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(EXT_META_FILE, 'utf8'));
        Object.values(data).forEach((m: any) => this.meta.set(m.id, m));
      } catch {}
    }
  }

  private saveMeta() {
    const obj: Record<string, ExtMetadata> = {};
    this.meta.forEach((m, id) => { obj[id] = m; });
    fs.writeFileSync(EXT_META_FILE, JSON.stringify(obj, null, 2));
  }

  // ── Install ────────────────────────────────────────────────────────────────

  async install(melonPath: string, sourceUrl = ''): Promise<{
    ok: boolean; id?: string; name?: string; version?: string; error?: string; warnings?: string[];
  }> {
    const manifest = readMelonManifest(melonPath);
    if (!manifest) return { ok: false, error: 'Invalid .melon file — missing manifest.json' };

    const { id, name, version } = manifest;
    const melon_api = manifest.melon_api ?? '1.0';
    if (!id) return { ok: false, error: 'manifest.json missing "id" field' };

    // API compat check
    const [reqMaj] = melon_api.split('.').map(Number);
    const [curMaj] = MELON_API_VERSION.split('.').map(Number);
    if (reqMaj > curMaj) {
      return {
        ok: false,
        error: `${name} requires Melon App API ${melon_api} but this is ${MELON_API_VERSION}. Update Melon Synth.`,
      };
    }

    const warnings: string[] = [];

    // Extract to extensions dir
    const extractDir = path.join(EXTENSIONS_DIR, id);
    const destFile   = path.join(EXTENSIONS_DIR, `${id}.melon`);
    fs.copyFileSync(melonPath, destFile);

    if (!extractMelon(melonPath, extractDir)) {
      return { ok: false, error: 'Failed to extract .melon bundle' };
    }

    // Install Python deps if needed
    if (manifest.backend?.pip_deps?.length) {
      this.installPipDeps(manifest.backend.pip_deps, name, warnings);
    }

    // Hash for update detection
    const hash = crypto.createHash('sha256').update(fs.readFileSync(melonPath)).digest('hex').slice(0, 16);

    const extMeta: ExtMetadata = {
      ...manifest,
      file:         `${id}.melon`,
      extract_dir:  extractDir,
      installed_at: Date.now(),
      hash,
      source_url:   sourceUrl,
    };

    this.meta.set(id, extMeta);
    this.saveMeta();

    // Load immediately
    await this.loadExtension(extMeta);

    // Notify main window of new placement
    this.mainWindow?.webContents.send('extension-installed', {
      id, name, version, placements: manifest.placements ?? [],
    });

    return { ok: true, id, name: name ?? id, version: version ?? '?', warnings };
  }

  // ── Remove ─────────────────────────────────────────────────────────────────

  async remove(id: string): Promise<{ ok: boolean; error?: string }> {
    const m = this.meta.get(id);
    if (!m) return { ok: false, error: `Extension "${id}" is not installed` };

    // Unload running extension
    await this.unloadExtension(id);

    // Delete files
    const melonFile  = path.join(EXTENSIONS_DIR, m.file);
    const extractDir = path.join(EXTENSIONS_DIR, id);
    if (fs.existsSync(melonFile))  fs.unlinkSync(melonFile);
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });

    this.meta.delete(id);
    this.saveMeta();

    this.mainWindow?.webContents.send('extension-removed', { id });
    return { ok: true };
  }

  // ── Load / Unload ──────────────────────────────────────────────────────────

  async loadExtension(meta: ExtMetadata): Promise<void> {
    const ext: LoadedExtension = {
      meta,
      backend:      null,
      view:         null,
      pendingCalls: new Map(),
    };

    // Spawn Python backend if declared
    if (meta.backend?.entry) {
      const backendPath = path.join(meta.extract_dir, meta.backend.entry);
      if (fs.existsSync(backendPath)) {
        ext.backend = this.spawnBackend(meta.id, backendPath, ext.pendingCalls);
      }
    }

    this.extensions.set(meta.id, ext);
  }

  async unloadExtension(id: string): Promise<void> {
    const ext = this.extensions.get(id);
    if (!ext) return;

    // Send shutdown to backend
    if (ext.backend && !ext.backend.killed) {
      try {
        ext.backend.stdin?.write(JSON.stringify({ id: 'shutdown', action: 'shutdown' }) + '\n');
        await new Promise(r => setTimeout(r, 500));
        ext.backend.kill();
      } catch {}
    }

    // Close UI view
    if (ext.view) {
      try { (ext.view as any).destroy?.(); } catch {}
    }

    this.extensions.delete(id);
  }

  // ── Backend process ────────────────────────────────────────────────────────

  private spawnBackend(
    extId:        string,
    backendPath:  string,
    pendingCalls: Map<string, { resolve: Function; reject: Function }>,
  ): cp.ChildProcess {
    const proc = cp.spawn('python3', [backendPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buf = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg  = JSON.parse(line);
          const call = pendingCalls.get(msg.id);
          if (call) {
            pendingCalls.delete(msg.id);
            if (msg.ok) call.resolve(msg.data);
            else        call.reject(new Error(msg.error ?? 'Backend error'));
          }
        } catch {}
      }
    });

    proc.stderr?.on('data', (d: Buffer) =>
      console.error(`[extension:${extId}]`, d.toString()),
    );

    return proc;
  }

  // ── Open UI window ─────────────────────────────────────────────────────────

  openExtensionUI(id: string): void {
    const ext = this.extensions.get(id);
    if (!ext || !ext.meta.ui) return;

    const { width = 480, height = 360, resizable = true, title } = ext.meta.ui;
    const uiPath = path.join(ext.meta.extract_dir, ext.meta.ui.entry);

    if (!fs.existsSync(uiPath)) return;

    const win = new BrowserWindow({
      width, height,
      resizable,
      title:  title ?? ext.meta.name,
      parent: this.mainWindow ?? undefined,
      webPreferences: {
        nodeIntegration:      false,
        contextIsolation:     true,
        preload:              path.join(__dirname, 'ext-preload.js'),
        additionalArguments:  [`--ext-id=${id}`],
      },
    });

    win.loadFile(uiPath);
    ext.view = win as any;
  }

  // ── Backend call (from UI webview) ────────────────────────────────────────

  async callBackend(extId: string, method: string, args: Record<string, any>): Promise<any> {
    const ext = this.extensions.get(extId);
    if (!ext?.backend) throw new Error(`No backend for extension ${extId}`);

    return new Promise((resolve, reject) => {
      const callId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      ext.pendingCalls.set(callId, { resolve, reject });
      setTimeout(() => {
        if (ext.pendingCalls.has(callId)) {
          ext.pendingCalls.delete(callId);
          reject(new Error('Backend call timed out'));
        }
      }, 30000);

      const msg = JSON.stringify({ id: callId, action: 'call', data: { method, args } });
      ext.backend!.stdin?.write(msg + '\n');
    });
  }

  // ── Update checking ────────────────────────────────────────────────────────

  async checkUpdates(): Promise<Array<{
    id: string; name: string; current: string; latest: string; download_url: string; changelog: string;
  }>> {
    const updates: any[] = [];
    await Promise.allSettled(
      Array.from(this.meta.values())
        .filter(m => m.update_url)
        .map(async (m) => {
          try {
            const res  = await fetch(m.update_url!);
            const data = await res.json() as Record<string,any>;
            const [la, lb, lc] = (data.latest_version ?? '0.0.0').split('.').map(Number);
            const [ca, cb, cc] = (m.version ?? '0.0.0').split('.').map(Number);
            if (la > ca || (la === ca && lb > cb) || (la === ca && lb === cb && lc > cc)) {
              updates.push({
                id:           m.id,
                name:         m.name,
                current:      m.version,
                latest:       data.latest_version,
                download_url: data.download_url ?? '',
                changelog:    data.changelog ?? '',
              });
            }
          } catch {}
        })
    );
    return updates;
  }

  // ── List ───────────────────────────────────────────────────────────────────

  listInstalled(): ExtMetadata[] {
    return Array.from(this.meta.values());
  }

  getExtensionPlacements(): Array<{ extId: string; placement: any }> {
    const result: any[] = [];
    this.meta.forEach((m) => {
      (m.placements ?? []).forEach(p => result.push({ extId: m.id, placement: p }));
    });
    return result;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private installPipDeps(deps: string[], addonName: string, warnings: string[]) {
    try {
      const { execSync } = require('child_process');
      execSync(`python3 -m pip install ${deps.join(' ')} --break-system-packages -q`, {
        timeout: 60000,
      });
    } catch (e) {
      warnings.push(`Could not auto-install Python deps for ${addonName}. Install manually: pip install ${deps.join(' ')}`);
    }
  }

  // ── Load all on startup ────────────────────────────────────────────────────

  async loadAll(): Promise<void> {
    for (const m of this.meta.values()) {
      const extractDir = path.join(EXTENSIONS_DIR, m.id);
      if (fs.existsSync(extractDir)) {
        await this.loadExtension(m);
      }
    }
  }
}

// Singleton
export const extensionManager = new MelonExtensionManager();
