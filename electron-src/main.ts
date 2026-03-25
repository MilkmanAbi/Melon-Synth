/**
 * Melon Synth — Electron Main Process
 * =====================================
 * The supervisor. Has full OS access.
 * Manages: window lifetime, MLC bridge, addon installs,
 *          file dialogs, settings persistence, IPC routing.
 *
 * Architecture:
 *   Renderer (React)  ←→  preload.ts (whitelist)  ←→  main.ts  ←→  Python MLC
 *
 * The MLC Python process is spawned ONCE when the window opens.
 * It lives until the app quits. All conversion/install requests go through it.
 */

import {
  app, BrowserWindow, ipcMain, dialog,
  shell, nativeTheme, protocol, net
} from 'electron';
import { join, resolve }           from 'path';
import * as cp                      from 'child_process';
import { existsSync, mkdirSync,
         readFileSync, writeFileSync,
         copyFileSync }             from 'fs';
import { MLCBridge, registerMLCHandlers } from '../src/engine/mlc-bridge';
import { registerVoicebankHandlers }          from './voicebank-manager';

// ── Paths ─────────────────────────────────────────────────────────────────
// __dirname after compilation = <project>/electron/electron-src/
// PROJECT_ROOT goes up two levels to the repo root.

const isDev    = process.env.NODE_ENV === 'development' || !app.isPackaged;
const PROJECT_ROOT = join(__dirname, '..', '..');   // electron/electron-src → project root
const DIST_DIR = join(PROJECT_ROOT, 'dist');
const PRELOAD  = join(__dirname, 'preload.js');     // same dir as main.js ✓

// User data paths — persisted across sessions, never wiped by browser clears
const USER_DATA   = app.getPath('userData');
const SETTINGS_F  = join(USER_DATA, 'settings.json');
const ADDONS_DIR  = join(USER_DATA, 'addons');
const PROJECTS_DIR  = join(USER_DATA, 'projects');
const VOICEBANKS_DIR = join(USER_DATA, 'voicebanks');

// MLC engine location
// In dev: relative to repo. In production: in extraResources.
const MLC_DIR = app.isPackaged
  ? join(process.resourcesPath, 'mlc')
  : join(PROJECT_ROOT, 'mlc');

// ── Ensure dirs exist ─────────────────────────────────────────────────────

[USER_DATA, ADDONS_DIR, PROJECTS_DIR, VOICEBANKS_DIR].forEach(d => {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
});

// ── Settings ──────────────────────────────────────────────────────────────

interface UIState {
  windowBounds?:    { x:number; y:number; width:number; height:number };
  voicePanelWidth?: number;
  pitchPanelHeight?: number;
  isDark?:          boolean;
  lastProjectPath?: string;
}

function loadSettings(): UIState {
  try {
    return JSON.parse(readFileSync(SETTINGS_F, 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(data: Partial<UIState>): void {
  try {
    const current = loadSettings();
    writeFileSync(SETTINGS_F, JSON.stringify({ ...current, ...data }, null, 2));
  } catch (e) {
    console.error('[main] Failed to save settings:', e);
  }
}

// ── MLC Bridge ────────────────────────────────────────────────────────────

let mlcBridge: MLCBridge | null = null;

async function startMLC(): Promise<void> {
  try {
    mlcBridge = new MLCBridge(MLC_DIR);
    registerMLCHandlers(mlcBridge);
    await mlcBridge.start();
    console.log('[main] MLC engine started');
    registerVoicebankHandlers(VOICEBANKS_DIR, mlcBridge);
  } catch (e) {
    console.error('[main] MLC failed to start:', e);
    // App still opens — MLC features just show a "not available" state
  }
}

// ── Window ────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const settings = loadSettings();
  const bounds   = settings.windowBounds ?? { width: 1280, height: 800 };

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth:  900,
    minHeight: 600,
    // macOS: native traffic lights, app content under them (hiddenInset)
    // Linux/Windows: fully native frame — OS handles window chrome
    // NEVER fake platform UI elements
    ...(process.platform === 'darwin' ? {
      titleBarStyle:        'hiddenInset' as const,
      trafficLightPosition: { x: 16, y: 11 },
      frame:                true,
    } : {
      frame:           true,
      titleBarStyle:   'default' as const,
      autoHideMenuBar: true,   // hide the native menu bar (our CommandBar replaces it)
    }),
    backgroundColor: settings.isDark ? '#1C1B19' : '#F8F7F4',
    webPreferences: {
      preload:               PRELOAD,
      contextIsolation:      true,   // REQUIRED — renderer cannot access Node
      nodeIntegration:       false,  // REQUIRED — renderer is sandboxed
      sandbox:               false,  // preload needs some Node APIs
      webSecurity:           true,
    },
    show: false, // Show after content loads to avoid white flash
    icon: join(PROJECT_ROOT, 'public', 'icon.png'),
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(join(DIST_DIR, 'index.html'));  // DIST_DIR = project/dist
  }

  // Show window after first paint — no flash
  mainWindow.once('ready-to-show', () => {
    mainWindow!.show();
    // Send saved UI state to renderer BEFORE first user interaction
    mainWindow!.webContents.send('app:ui-state', loadSettings());
  });

  // Persist window size/position on resize/move
  const persistBounds = () => {
    if (!mainWindow) return;
    saveSettings({ windowBounds: mainWindow.getBounds() });
  };
  mainWindow.on('resize', persistBounds);
  mainWindow.on('moved',  persistBounds);

  // Confirm unsaved changes on close (renderer handles the logic)
  mainWindow.on('close', (e) => {
    // TODO: ask renderer if there are unsaved changes
    // mainWindow?.webContents.send('app:confirm-close');
    // e.preventDefault(); — wire this when project state is implemented
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Open external links in the system browser, not inside Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── IPC: UI state persistence ─────────────────────────────────────────────
// Renderer sends panel sizes here. We write to settings.json.
// On relaunch, renderer receives them via 'app:ui-state' before first paint.

ipcMain.on('app:save-ui-state', (_, data: Partial<UIState>) => {
  saveSettings(data);
});

ipcMain.handle('app:get-ui-state', () => loadSettings());

// ── IPC: Addon system ─────────────────────────────────────────────────────

/** Get the path to the user's addon directory */
ipcMain.handle('app:get-addons-dir', () => ADDONS_DIR);

/** Open a file picker for .mlc files, install the picked file */
ipcMain.handle('app:install-addon-dialog', async () => {
  const win = mainWindow;
  if (!win) return { ok: false, error: 'No window available' };
  if (!win.isFocused()) win.focus();
  const result = await dialog.showOpenDialog(win, {
    title:       'Install Melon Addon or Extension',
    buttonLabel: 'Install',
    filters:     [
      { name: 'Melon Addons & Extensions', extensions: ['mlc', 'melon'] },
      { name: 'MLC Addons',                extensions: ['mlc'] },
      { name: 'App Extensions',            extensions: ['melon'] },
      { name: 'All files',                 extensions: ['*'] },
    ],
    properties:  ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) {
    return { ok: false, canceled: true };
  }
  return installAddonFromPath(result.filePaths[0]);
});

/** Install from a drag-and-dropped file path */
ipcMain.handle('app:install-addon', async (_, filePath: string) => {
  return installAddonFromPath(filePath);
});

/** Uninstall a named addon — removes from addons dir + notifies MLC */
ipcMain.handle('app:uninstall-addon', async (_, addonId: string) => {
  try {
    const files = require('fs').readdirSync(ADDONS_DIR) as string[];
    const target = files.find((f: string) => f.startsWith(addonId) && f.endsWith('.mlc'));
    if (!target) return { ok: false, error: `Addon "${addonId}" not found in addons directory` };
    require('fs').unlinkSync(join(ADDONS_DIR, target));
    return { ok: true, removed: target };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

async function installAddonFromPath(filePath: string): Promise<{ok:boolean;name?:string;version?:string;id?:string;error?:string;warnings?:string[]}> {
  try {
    const { basename, extname } = require('path');
    const ext = extname(filePath).toLowerCase();

    if (ext === '.melon') {
      const { extensionManager } = require('./melon-extension-loader');
      const result = await extensionManager.install(filePath);
      return result;
    }

    if (ext === '.mlc') {
      if (!mlcBridge) return { ok: false, error: 'MLC engine not running — restart the app and try again' };
      const result: any = await mlcBridge.installAddonFromPath(filePath);
      // Bridge resolves with msg.data directly, so result = {ok, id, name, version, ...}
      // OR result = {ok:false, error:"..."} for failures
      if (result?.ok === true) {
        return { ok: true, id: result.id, name: result.name, version: result.version, warnings: result.warnings };
      } else {
        const errMsg = result?.error ?? 'Install failed — check the file is a valid .mlc addon';
        return { ok: false, error: errMsg };
      }
    }

    return { ok: false, error: `Unsupported file type: ${ext}. Expected .mlc or .melon` };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}


// ── IPC: .melon app extensions ────────────────────────────────────────────

/** Read just the manifest.json from a .melon zip without installing it */
ipcMain.handle('app:read-melon-manifest', async (_, filePath: string) => {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(filePath);
    const entry = zip.getEntry('manifest.json');
    if (!entry) return null;
    return JSON.parse(entry.getData().toString('utf8'));
  } catch { return null; }
});



ipcMain.handle('app:install-extension', async (_, filePath: string) => {
  try {
    const { extensionManager } = require('./melon-extension-loader');
    return extensionManager.install(filePath);
  } catch (e: any) { return { ok: false, error: e.message }; }
});

ipcMain.handle('app:remove-extension', async (_, id: string) => {
  try {
    const { extensionManager } = require('./melon-extension-loader');
    return extensionManager.remove(id);
  } catch (e: any) { return { ok: false, error: e.message }; }
});

ipcMain.handle('app:list-extensions', async () => {
  try {
    const { extensionManager } = require('./melon-extension-loader');
    return extensionManager.listInstalled();
  } catch { return []; }
});

ipcMain.handle('app:open-extension-ui', async (_, id: string) => {
  try {
    const { extensionManager } = require('./melon-extension-loader');
    extensionManager.openExtensionUI(id);
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e.message }; }
});

ipcMain.handle('app:extension-call-backend', async (_, extId: string, method: string, args: any) => {
  try {
    const { extensionManager } = require('./melon-extension-loader');
    const result = await extensionManager.callBackend(extId, method, args);
    return { ok: true, data: result };
  } catch (e: any) { return { ok: false, error: e.message }; }
});

ipcMain.handle('app:check-extension-updates', async () => {
  try {
    const { extensionManager } = require('./melon-extension-loader');
    return extensionManager.checkUpdates();
  } catch { return []; }
});

// ── IPC: Addon Panel Registration (for AddonPanelHost) ───────────────────

ipcMain.handle('addons:get-panels', async () => {
  try {
    const { extensionManager } = require('./melon-extension-loader');
    const exts = extensionManager.listInstalled();
    const panels: any[] = [];
    for (const ext of exts) {
      if (ext.contributes?.panels) {
        for (const panel of ext.contributes.panels) {
          panels.push({
            addon_id:     ext.id,
            addon_name:   ext.name,
            id:           `${ext.id}:${panel.id}`,
            display_name: panel.display_name,
            icon:         panel.icon,
            requested_zone: panel.requested_zone,
            fallback_zone:  panel.fallback_zone,
            component:    panel.component,
            entry_path:   join(ADDONS_DIR, '..', 'extensions', ext.id, ext.entry_point ?? 'index.js'),
            default_visible: panel.default_visible ?? true,
            resizable:    panel.resizable ?? true,
            collapsible:  panel.collapsible ?? true,
          });
        }
      }
    }
    return panels;
  } catch { return []; }
});

ipcMain.handle('addons:get-toolbar-items', async () => {
  try {
    const { extensionManager } = require('./melon-extension-loader');
    const exts = extensionManager.listInstalled();
    const items: any[] = [];
    for (const ext of exts) {
      for (const item of (ext.contributes?.toolbar_items ?? [])) {
        items.push({ addon_id: ext.id, ...item });
      }
    }
    return items;
  } catch { return []; }
});

ipcMain.handle('addons:get-menu-items', async () => {
  try {
    const { extensionManager } = require('./melon-extension-loader');
    const exts = extensionManager.listInstalled();
    const items: any[] = [];
    for (const ext of exts) {
      for (const item of (ext.contributes?.menu_items ?? [])) {
        items.push({ addon_id: ext.id, ...item });
      }
    }
    return items;
  } catch { return []; }
});

ipcMain.handle('addons:get-commands', async () => {
  try {
    const { extensionManager } = require('./melon-extension-loader');
    const exts = extensionManager.listInstalled();
    const cmds: any[] = [];
    for (const ext of exts) {
      for (const cmd of (ext.contributes?.commands ?? [])) {
        cmds.push({ addon_id: ext.id, ...cmd });
      }
    }
    return cmds;
  } catch { return []; }
});

ipcMain.handle('addons:execute-command', async (_, cmdId: string) => {
  try {
    const { extensionManager } = require('./melon-extension-loader');
    return extensionManager.executeCommand(cmdId);
  } catch (e: any) { return { ok: false, error: e.message }; }
});

// ── IPC: File dialogs ─────────────────────────────────────────────────────

// ── IPC: Render pipeline (UST → OpenUTAU → WAV) ─────────────────────────

ipcMain.handle('render:generate-ust', async (_, params: any) => {
  if (!mlcBridge) return { ok: false, error: 'MLC engine not running' };
  try {
    return await mlcBridge.request('generate_ust', params);
  } catch (e: any) { return { ok: false, error: e.message }; }
});

ipcMain.handle('render:render', async (_, params: any) => {
  if (!mlcBridge) return { ok: false, error: 'MLC engine not running' };
  try {
    // Check for bundled OpenUTAU first
    let openutauPath = params.openutau_path;
    if (!openutauPath) {
      try {
        const { detectOpenUTAU } = require('./openutau-bundler');
        const status = detectOpenUTAU();
        if (status?.path) openutauPath = status.path;
      } catch {}
    }

    // Build render request — full pipeline: notes → UST → OpenUTAU → WAV
    const renderParams: any = {
      notes:          params.notes || [],
      tempo:          params.tempo || params.bpm || 120,
      voice_dir:      params.voice_dir || params.voicebank_path,
      voicebank_path: params.voice_dir || params.voicebank_path,
      project_name:   params.project_name || 'melon_render',
      track_params:   params.track_params || {},
      pitch_points:   params.pitch_points || [],
      mlc_tokens:     params.mlc_tokens || [],
    };
    if (openutauPath) renderParams.openutau_path = openutauPath;
    if (params.out_wav) renderParams.out_wav = params.out_wav;

    // Send render progress to renderer
    const result = await mlcBridge.request('render', renderParams);

    // Notify renderer on completion
    if (result?.ok && mainWindow) {
      mainWindow.webContents.send('render:complete', result);
    } else if (!result?.ok && mainWindow) {
      mainWindow.webContents.send('render:error', result);
    }

    return result;
  } catch (e: any) {
    const err = { ok: false, error: e.message };
    if (mainWindow) mainWindow.webContents.send('render:error', err);
    return err;
  }
});

ipcMain.handle('editor:detect', async () => {
  if (!mlcBridge) return [];
  try {
    return await mlcBridge.request('detect_editors');
  } catch { return []; }
});

ipcMain.handle('editor:open', async (_, params: any) => {
  if (!mlcBridge) return { ok: false, error: 'MLC engine not running' };
  try {
    return await mlcBridge.request('open_editor', params);
  } catch (e: any) { return { ok: false, error: e.message }; }
});

ipcMain.handle('dialog:open-project', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title:   'Open Project',
    filters: [{ name: 'Melon Synth Project', extensions: ['loid'] }],
    properties: ['openFile'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:save-project', async (_, defaultName?: string) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title:       'Save Project',
    defaultPath: defaultName ?? 'untitled.loid',
    filters:     [{ name: 'Melon Synth Project', extensions: ['loid'] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('dialog:export-wav', async (_, defaultName?: string) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title:       'Export WAV',
    defaultPath: defaultName ?? 'export.wav',
    filters:     [{ name: 'WAV Audio', extensions: ['wav'] }],
  });
  return result.canceled ? null : result.filePath;
});

// ── IPC: Shell ────────────────────────────────────────────────────────────

ipcMain.on('shell:open-path', (_, p: string) => shell.openPath(p));

// ── IPC: File read/write (for project save/load) ──────────────────────────
ipcMain.handle('fs:write-file', async (_, filePath: string, content: string) => {
  try {
    const { writeFileSync } = require('fs');
    writeFileSync(filePath, content, 'utf8');
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e.message }; }
});

/** Save a .loid project as a ZIP with structured JSON files */
ipcMain.handle('fs:save-project-zip', async (_, filePath: string, files: Record<string, string>) => {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    for (const [name, content] of Object.entries(files)) {
      zip.addFile(name, Buffer.from(content as string, 'utf8'));
    }
    zip.writeZip(filePath);
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e.message }; }
});

/** Read a .loid project ZIP and return all file contents as {filename: content} */
ipcMain.handle('fs:read-project-zip', async (_, filePath: string) => {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();
    const files: Record<string, string> = {};
    for (const entry of entries) {
      if (!entry.isDirectory) {
        files[entry.entryName] = entry.getData().toString('utf8');
      }
    }
    // Check if this is actually a ZIP (has manifest.json) or just plain JSON
    if (!files['manifest.json']) return null; // not a ZIP project, let caller try plain JSON
    return files;
  } catch {
    return null; // not a valid ZIP, let caller try plain JSON
  }
});

ipcMain.handle('fs:read-file', async (_, filePath: string) => {
  try {
    const { readFileSync } = require('fs');
    const { join, isAbsolute } = require('path');
    // Handle relative paths (like examples/demo-melody.loid)
    if (isAbsolute(filePath)) {
      return { ok: true, content: readFileSync(filePath, 'utf8') };
    }
    // Try multiple base paths for relative files (examples, public/examples, etc.)
    const bases = [
      // Try public/examples first (where Vite puts them)
      join(app.getAppPath(), 'public'),
      app.getAppPath(),
      join(app.getAppPath(), '..'),
      // Packaged builds: resources/
      process.resourcesPath ?? '',
      join(process.resourcesPath ?? '', 'app.asar'),
    ].filter(Boolean);
    for (const base of bases) {
      const candidate = join(base, filePath);
      if (existsSync(candidate)) {
        return { ok: true, content: readFileSync(candidate, 'utf8') };
      }
    }
    // Last attempt: as-is
    return { ok: true, content: readFileSync(filePath, 'utf8') };
  } catch (e: any) { return { ok: false, error: e.message }; }
});

ipcMain.handle('fs:exists', async (_, filePath: string) => {
  return require('fs').existsSync(filePath);
});
ipcMain.on('shell:open-url',  (_, url: string) => shell.openExternal(url));

// ── IPC: System theme ─────────────────────────────────────────────────────

ipcMain.handle('app:get-system-dark', () => nativeTheme.shouldUseDarkColors);

nativeTheme.on('updated', () => {
  mainWindow?.webContents.send('app:system-dark-changed', nativeTheme.shouldUseDarkColors);
});

// ── IPC: MTI (Melon Terminal Interface) ──────────────────────────────────

/** Stateful terminal sessions — one pty per session ID */
const mtiSessions = new Map<string, cp.ChildProcess>();

/** Spawn a persistent shell session for the terminal */
ipcMain.handle('mti:spawn-session', async (_, sessionId: string) => {
  if (mtiSessions.has(sessionId)) return { ok: true, reused: true };
  try {
    const shellCmd = process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL || '/bin/bash');
    const child = cp.spawn(shellCmd, [], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        MELON_SYNTH: '1',
        MLC_DIR: MLC_DIR,
        TERM: 'xterm-256color',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    mtiSessions.set(sessionId, child);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    child.stdout?.on('data', (data: string) => {
      mainWindow?.webContents.send('mti:stdout', sessionId, data);
    });
    child.stderr?.on('data', (data: string) => {
      mainWindow?.webContents.send('mti:stderr', sessionId, data);
    });
    child.on('exit', (code) => {
      mainWindow?.webContents.send('mti:exit', sessionId, code);
      mtiSessions.delete(sessionId);
    });

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

/** Write to a session's stdin */
ipcMain.handle('mti:write', async (_, sessionId: string, data: string) => {
  const proc = mtiSessions.get(sessionId);
  if (!proc?.stdin) return { ok: false, error: 'Session not found' };
  proc.stdin.write(data);
  return { ok: true };
});

/** Kill a session */
ipcMain.handle('mti:kill', async (_, sessionId: string) => {
  const proc = mtiSessions.get(sessionId);
  if (proc) { proc.kill('SIGTERM'); mtiSessions.delete(sessionId); }
  return { ok: true };
});

/** Run a one-shot command and return full output (for MLC pipeline debug, etc.) */
ipcMain.handle('mti:exec', async (_, cmd: string, cwd?: string) => {
  return new Promise((resolve) => {
    cp.exec(cmd, {
      cwd:     cwd ?? PROJECT_ROOT,
      timeout: 30_000,
      env:     { ...process.env, MELON_SYNTH: '1', MLC_DIR },
    }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout, stderr, code: error?.code ?? 0 });
    });
  });
});

/** Run a Python command through MLC's Python environment */
ipcMain.handle('mti:python', async (_, script: string) => {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  return new Promise((resolve) => {
    cp.exec(`${python} -c "${script.replace(/"/g, '\\"')}"`, {
      cwd:     MLC_DIR,
      timeout: 30_000,
      env:     { ...process.env, PYTHONPATH: MLC_DIR },
    }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout, stderr, code: error?.code ?? 0 });
    });
  });
});

/** List available MLC commands for autocomplete */
ipcMain.handle('mti:mlc-commands', async () => {
  return [
    'mlc convert <text> [--module <id>] [--singability <0-1>]',
    'mlc modules',
    'mlc addons',
    'mlc trace <text> [--module <id>]',
    'mlc cache stats',
    'mlc cache clear [g2p|phrase|all]',
    'mlc detect <text>',
    'mlc ping',
    'render ust [--output <path>]',
    'render detect-editors',
    'render open-editor',
    'vb list',
    'vb detect',
    'ext list',
    'ext install <path>',
    'ext remove <id>',
    'help',
  ];
});

// ── IPC: Window controls (Windows/Linux) ─────────────────────────────────

ipcMain.on('win:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('win:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('win:close', () => {
  mainWindow?.close();
});

ipcMain.handle('win:is-maximized', () => {
  return mainWindow?.isMaximized() ?? false;
});

// ── App lifecycle ─────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  await startMLC();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  mlcBridge?.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  mlcBridge?.stop();
});
