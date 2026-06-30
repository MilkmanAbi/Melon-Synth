/**
 * Voicebank Manager — Electron Main Process
 * ==========================================
 * Handles everything voicebank-related that needs OS access:
 *   - Downloading voicebank ZIPs with progress reporting
 *   - Extracting to userData/voicebanks/
 *   - Scanning for already-installed voicebanks
 *   - Reading character.txt metadata
 *   - Installing from drag-and-dropped ZIPs
 *
 * The Python render_bridge handles detection of OpenUTAU's own singers dir.
 * This manager handles voicebanks the user installs *through Melon Synth*.
 */

import { ipcMain, BrowserWindow } from 'electron';
import {
  existsSync, mkdirSync, createWriteStream,
  readdirSync, statSync, readFileSync, unlinkSync
} from 'fs';
import { join, basename, extname } from 'path';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { EventEmitter } from 'events';

// node built-ins only — no npm deps for the main process download logic
const https = require('https');
const http  = require('http');
const path  = require('path');

export interface VoicebankEntry {
  id:          string;
  name:        string;
  author?:     string;
  path:        string;
  type:        'cv' | 'cvvc' | 'vcv' | 'diffsinger' | 'unknown';
  language:    string;
  image?:      string;
  installed:   boolean;
  size_mb?:    number;
  web?:        string;
}

// ── IPC registration ─────────────────────────────────────────────────────────

export function registerVoicebankHandlers(
  voicebanksDir: string,
  mlcBridge:     any,  // MLCBridge instance
): void {

  mkdirSync(voicebanksDir, { recursive: true });

  // ── Scan installed voicebanks ───────────────────────────────────────────
  ipcMain.handle('vb:list', async () => {
    // First scan Melon Synth's own voicebanks dir
    const local = scanVoicebankDir(voicebanksDir);

    // Then ask MLC to scan OpenUTAU's singers dir too
    let openutau: VoicebankEntry[] = [];
    try {
      const system = await mlcBridge.request('list_voicebanks', {});
      openutau = (system as any[]).map((vb: any) => ({
        ...vb,
        installed:   true,
        source:     'openutau',
      }));
    } catch {}

    // Merge — deduplicate by name
    const seen = new Set<string>();
    const merged: VoicebankEntry[] = [];
    for (const vb of [...local, ...openutau]) {
      const key = vb.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(vb);
      }
    }
    return merged;
  });

  // ── Download a voicebank from catalog URL ───────────────────────────────
  ipcMain.handle('vb:download', async (event, params: {
    id:    string;
    url:   string;
    name:  string;
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const destDir = join(voicebanksDir, params.id);
    if (existsSync(destDir)) {
      return { ok: true, path: destDir, already_installed: true };
    }

    try {
      const zipPath = join(voicebanksDir, `${params.id}.zip`);
      await downloadWithProgress(params.url, zipPath, (bytes, total) => {
        win?.webContents.send('vb:download-progress', {
          id:        params.id,
          bytes,
          total,
          percent:   total > 0 ? Math.round((bytes / total) * 100) : -1,
        });
      });

      // Extract
      win?.webContents.send('vb:download-progress', { id: params.id, phase: 'extracting' });
      await extractZip(zipPath, voicebanksDir);

      // Clean up zip
      try { unlinkSync(zipPath); } catch {}

      win?.webContents.send('vb:download-progress', { id: params.id, phase: 'done' });
      return { ok: true, path: destDir };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // ── Install from a local ZIP file ───────────────────────────────────────
  ipcMain.handle('vb:install-from-zip', async (event, zipPath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    try {
      win?.webContents.send('vb:download-progress', {
        id: basename(zipPath, extname(zipPath)), phase: 'extracting'
      });
      await extractZip(zipPath, voicebanksDir);
      const vbs = scanVoicebankDir(voicebanksDir);
      return { ok: true, installed: vbs };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // ── Open voicebank folder in file manager ───────────────────────────────
  ipcMain.on('vb:open-folder', (_, vbPath: string) => {
    require('electron').shell.openPath(vbPath);
  });

  // ── System-level detection (delegates to MLC) ──────────────────────────
  ipcMain.handle('vb:detect-system', async () => {
    try {
      return await mlcBridge.request('detect_system', {});
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // ── Detect music editors ────────────────────────────────────────────────
  ipcMain.handle('editor:detect', async () => {
    try {
      return await mlcBridge.request('detect_editors', {});
    } catch (e: any) {
      return { error: e.message, editors: [] };
    }
  });

  // ── Open in music editor ────────────────────────────────────────────────
  ipcMain.handle('editor:open', async (_, params: {
    editorId:    string;
    wavPath:     string;
    editorPath?: string;
  }) => {
    try {
      return await mlcBridge.request('open_editor', {
        editor_id:   params.editorId,
        wav_path:    params.wavPath,
        editor_path: params.editorPath ?? null,
      });
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // ── Generate UST (preview, no render) ──────────────────────────────────
  ipcMain.handle('render:generate-ust', async (_, params: object) => {
    try {
      return await mlcBridge.request('generate_ust', params);
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // ── Full render pipeline ────────────────────────────────────────────────
  ipcMain.handle('render:render', async (event, params: object) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    // Kick off render in background; progress comes via IPC events
    mlcBridge.request('render', params)
      .then((result: any) => {
        win?.webContents.send('render:complete', result);
      })
      .catch((e: any) => {
        win?.webContents.send('render:error', { error: e.message });
      });
    return { started: true };
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scanVoicebankDir(dir: string): VoicebankEntry[] {
  if (!existsSync(dir)) return [];
  const entries: VoicebankEntry[] = [];

  for (const name of readdirSync(dir)) {
    const vbPath = join(dir, name);
    if (!statSync(vbPath).isDirectory()) continue;

    // Must have wav files or oto.ini
    const hasContent = hasVoicebankContent(vbPath);
    if (!hasContent) continue;

    const entry: VoicebankEntry = {
      id:        name,
      name,
      path:      vbPath,
      type:      'cv',
      language:  'ja',
      installed: true,
    };

    // Parse character.txt
    const charTxt = join(vbPath, 'character.txt');
    if (existsSync(charTxt)) {
      try {
        const lines = readFileSync(charTxt, 'utf8').split('\n');
        for (const line of lines) {
          if (line.startsWith('name='))   entry.name   = line.slice(5).trim();
          if (line.startsWith('author=')) entry.author = line.slice(7).trim();
          if (line.startsWith('web='))    entry.web    = line.slice(4).trim();
        }
      } catch {}
    }

    // Find image
    for (const ext of ['png','jpg','bmp']) {
      const img = join(vbPath, `character.${ext}`);
      if (existsSync(img)) { entry.image = img; break; }
    }

    entries.push(entry);
  }
  return entries;
}

function hasVoicebankContent(dir: string): boolean {
  try {
    const items = readdirSync(dir);
    // Direct .wav files
    if (items.some(f => f.endsWith('.wav'))) return true;
    // oto.ini
    if (items.some(f => f === 'oto.ini')) return true;
    // Subfolder with wavs (multi-pitch)
    for (const item of items) {
      const sub = join(dir, item);
      if (statSync(sub).isDirectory()) {
        const subItems = readdirSync(sub);
        if (subItems.some(f => f.endsWith('.wav') || f === 'oto.ini')) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function downloadWithProgress(
  url: string,
  dest: string,
  onProgress: (bytes: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, (res: any) => {
      // Follow redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        downloadWithProgress(res.headers.location, dest, onProgress)
          .then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }

      const total = parseInt(res.headers['content-length'] ?? '0', 10);
      let bytes = 0;
      const file = createWriteStream(dest);

      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        onProgress(bytes, total);
      });

      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  // Use the 'adm-zip' approach with the built-in zlib for .tar.gz
  // For plain .zip we need a different approach — use PowerShell on Windows,
  // unzip on macOS/Linux, or a JS implementation.
  const platform = process.platform;

  if (!existsSync(zipPath)) throw new Error(`ZIP not found: ${zipPath}`);

  const ext = zipPath.toLowerCase().endsWith('.tar.gz') ? 'tar.gz' : 'zip';

  await new Promise<void>((resolve, reject) => {
    let cmd: string, args: string[];

    if (ext === 'tar.gz') {
      cmd  = 'tar';
      args = ['-xzf', zipPath, '-C', destDir];
    } else if (platform === 'win32') {
      cmd  = 'powershell';
      args = ['-Command', `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`];
    } else {
      cmd  = 'unzip';
      args = ['-o', zipPath, '-d', destDir];
    }

    const { spawn } = require('child_process');
    const proc = spawn(cmd, args);
    proc.on('close', (code: number) => {
      if (code === 0) resolve();
      else reject(new Error(`Extraction failed with code ${code}`));
    });
    proc.on('error', reject);
  });
}
