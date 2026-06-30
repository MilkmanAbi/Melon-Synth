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

  // Register new addon manager IPC handlers
  ipcMain.handle('mlc:list-addons-full',   ()                          => mlcBridge!.listAddonsFull());
  ipcMain.handle('mlc:install-addon-path', (_, src: string)            => mlcBridge!.installAddonFromPath(src));
  ipcMain.handle('mlc:remove-addon',       (_, id: string)             => mlcBridge!.removeAddon(id));
  ipcMain.handle('mlc:check-updates',      (_, ids?: string[])         => mlcBridge!.checkAddonUpdates(ids));
  ipcMain.handle('mlc:apply-update',       (_, id: string, url: string) => mlcBridge!.applyAddonUpdate(id, url));
  ipcMain.handle('mlc:get-addon-info',     (_, id: string)             => mlcBridge!.getAddonInfo(id));
  ipcMain.handle('mlc:get-pipeline-trace',  (_, p: any)                 => mlcBridge!.getPipelineTrace(p));
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
  // Use null parent so the dialog works on all platforms including Wayland
  const win = mainWindow ?? undefined;
  if (win && !win.isFocused()) win.focus();
  const result = await dialog.showOpenDialog(win!, {
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

// ── IPC: File dialogs ─────────────────────────────────────────────────────

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
