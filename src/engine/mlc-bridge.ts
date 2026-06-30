/**
 * MLC Bridge — Electron Main Process
 * ====================================
 * Spawns the MLC Python engine as a child process.
 * Communicates via newline-delimited JSON over stdin/stdout.
 *
 * Usage (from renderer via preload/ipcRenderer):
 *   const result = await window.mlc.convert({ text, moduleId, singability })
 *   const modules = await window.mlc.listModules()
 */

import { spawn, ChildProcess } from 'child_process';
import { ipcMain }             from 'electron';
import { join }                from 'path';
import { randomUUID }          from 'crypto';
import { EventEmitter }        from 'events';

interface PendingRequest {
  resolve: (data: any) => void;
  reject:  (err: Error)  => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface MLCMessage {
  id:    string;
  ok:    boolean;
  data:  any;
  error: string | null;
}

interface ConvertParams {
  text:        string;
  moduleId?:   string;
  singability?: number;  // 0.0–1.0
  lang?:       string;
}

export class MLCBridge extends EventEmitter {
  private proc:     ChildProcess | null = null;
  private pending:  Map<string, PendingRequest> = new Map();
  private buffer:   string = '';
  private ready:    boolean = false;
  private readonly enginePath: string;
  private readonly REQUEST_TIMEOUT = 15_000; // 15s max per request

  constructor(engineDir: string) {
    super();
    this.enginePath = join(engineDir, 'mlc_engine_v2.py');
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.proc) return;

    return new Promise((resolve, reject) => {
      const python = process.platform === 'win32' ? 'python' : 'python3';

      this.proc = spawn(python, [this.enginePath], {
        cwd:   require('path').dirname(this.enginePath),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (!this.proc.stdout || !this.proc.stdin || !this.proc.stderr) {
        reject(new Error('Failed to open MLC process stdio'));
        return;
      }

      // Read newline-delimited JSON from stdout
      this.proc.stdout.setEncoding('utf8');
      this.proc.stdout.on('data', (chunk: string) => {
        this.buffer += chunk;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) this.handleMessage(trimmed);
        }
      });

      // Log stderr without crashing
      this.proc.stderr.setEncoding('utf8');
      this.proc.stderr.on('data', (data: string) => {
        if (process.env.NODE_ENV === 'development') {
          console.error('[MLC stderr]', data.trim());
        }
      });

      this.proc.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      this.proc.on('exit', (code) => {
        this.ready = false;
        this.proc = null;
        // Reject all pending requests
        for (const [id, req] of this.pending) {
          clearTimeout(req.timeout);
          req.reject(new Error(`MLC process exited with code ${code}`));
        }
        this.pending.clear();
        this.emit('exit', code);
      });

      // Ping to verify it started
      setTimeout(async () => {
        try {
          await this.ping();
          this.ready = true;
          resolve();
        } catch (e) {
          reject(new Error(
            'MLC engine did not respond to ping. ' +
            'Make sure Python 3.9+ is installed and ' +
            'dependencies are installed (see mlc/requirements.txt).'
          ));
        }
      }, 500);
    });
  }

  stop(): void {
    if (this.proc) {
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
  }

  // ── Core IPC ─────────────────────────────────────────────────────────────

  private send(msg: object): void {
    if (!this.proc?.stdin) throw new Error('MLC not running');
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
  }

  /** Public for main-process callers (voicebank-manager etc). Never expose to renderer. */
  request<T = any>(action: string, params: object = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();

      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MLC request "${action}" timed out after ${this.REQUEST_TIMEOUT}ms`));
      }, this.REQUEST_TIMEOUT);

      this.pending.set(id, { resolve, reject, timeout });
      this.send({ id, action, ...params });
    });
  }

  private handleMessage(raw: string): void {
    let msg: MLCMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.error('[MLC] Invalid JSON from engine:', raw);
      return;
    }

    const req = this.pending.get(msg.id);
    if (!req) return;

    clearTimeout(req.timeout);
    this.pending.delete(msg.id);

    if (msg.ok) {
      req.resolve(msg.data);
    } else {
      req.reject(new Error(msg.error ?? 'Unknown MLC error'));
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  async ping(): Promise<{ status: string; version: string }> {
    return this.request('ping');
  }

  async listModules(): Promise<ModuleInfo[]> {
    return this.request('list_modules');
  }

  async detectLanguage(text: string): Promise<{ lang: string }> {
    return this.request('detect_lang', { text });
  }

  async convert(params: ConvertParams): Promise<ConversionResult> {
    return this.request('convert', {
      text:        params.text,
      module_id:   params.moduleId   ?? 'jp_cv_standard',
      singability: params.singability ?? 0.5,
      lang:        params.lang        ?? null,
    });
  }

  async preview(params: ConvertParams): Promise<ConversionResult> {
    return this.request('preview', {
      text:        params.text,
      module_id:   params.moduleId   ?? 'jp_cv_standard',
      singability: params.singability ?? 0.5,
    });
  }

  async listAllAddons(): Promise<AddonInfo[]> {
    return this.request('list_all_addons');
  }

  async suggestSingability(params: { text:string; moduleId?:string; lang?:string }): Promise<{ suggested:number; reason:string }> {
    return this.request('suggest_singability', {
      text:      params.text,
      module_id: params.moduleId ?? 'jp_cv_standard',
      lang:      params.lang ?? null,
    });
  }

  async cacheStats(): Promise<object> {
    return this.request('cache_stats');
  }

  async clearCache(target: 'g2p' | 'phrase' | 'all'): Promise<{ cleared: string }> {
    return this.request('cache_clear', { target });
  }

  /** Install a .mlc bundle file from an absolute path on disk */
  async installAddon(filePath: string): Promise<string> {
    return this.request('install_module', { path: filePath });
  }

  async reloadAddon(moduleId: string): Promise<string> {
    return this.request('reload_module', { module_id: moduleId });
  }

  // ── Addon Manager v2 ───────────────────────────────────────────────────
  async listAddonsFull():                                   Promise<any> { return this.request('list_addons_full', {}); }
  async installAddonFromPath(source: string):               Promise<any> { return this.request('install_addon', { source }); }
  async removeAddon(addonId: string):                       Promise<any> { return this.request('remove_addon', { addon_id: addonId }); }
  async checkAddonUpdates(addonIds?: string[]):             Promise<any> { return this.request('check_updates', { addon_ids: addonIds ?? null }); }
  async applyAddonUpdate(addonId: string, url: string):    Promise<any> { return this.request('apply_update', { addon_id: addonId, download_url: url }); }
  async getAddonInfo(addonId: string):                      Promise<any> { return this.request('get_addon_info', { addon_id: addonId }); }
  async getPipelineTrace(params: {text:string;module_id:string;singability?:number}): Promise<any> { return this.request('get_pipeline_trace', params); }
}

// ── Electron IPC handlers (register in main process) ─────────────────────

export function registerMLCHandlers(bridge: MLCBridge): void {
  ipcMain.handle('mlc:ping',               ()                         => bridge.ping());
  ipcMain.handle('mlc:convert',            (_, p: ConvertParams)      => bridge.convert(p));
  ipcMain.handle('mlc:preview',            (_, p: ConvertParams)      => bridge.preview(p));
  ipcMain.handle('mlc:list-modules',       ()                         => bridge.listModules());
  ipcMain.handle('mlc:list-all-addons',    ()                         => bridge.listAllAddons());
  ipcMain.handle('mlc:detect-lang',        (_, text: string)          => bridge.detectLanguage(text));
  ipcMain.handle('mlc:suggest-singability', (_, p)                    => bridge.suggestSingability(p));
  ipcMain.handle('mlc:cache-stats',        ()                         => bridge.cacheStats());
  ipcMain.handle('mlc:cache-clear',          (_, p: {target:string})    => bridge.clearCache(p.target as any));
  // Addon Manager v2
  ipcMain.handle('mlc:list-addons-full',     ()                         => bridge.listAddonsFull());
  ipcMain.handle('mlc:install-addon-path',   (_, source: string)        => bridge.installAddonFromPath(source));
  ipcMain.handle('mlc:remove-addon',         (_, id: string)            => bridge.removeAddon(id));
  ipcMain.handle('mlc:check-updates',        (_, ids?: string[])        => bridge.checkAddonUpdates(ids));
  ipcMain.handle('mlc:apply-update',         (_, id: string, url: string) => bridge.applyAddonUpdate(id, url));
  ipcMain.handle('mlc:get-addon-info',       (_, id: string)            => bridge.getAddonInfo(id));
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface ModuleInfo {
  id:          string;
  name:        string;
  description: string;
  language:    string;
  phoneme_set: string;
  version:     string;
}

export interface SynthToken {
  phoneme:         string;
  display:         string;
  duration_hint:   number;
  is_vowel:        boolean;
  stressed:        boolean;
  word_index:      number;
  syllable_index:  number;
  prev_transition: string | null;
  source_phoneme:  string;
  note:            string;
}

export interface AddonInfo {
  id:           string;
  name:         string;
  description:  string;
  author?:      string;
  version:      string;
  language:     string;
  languages?:   string[];
  phoneme_set:  string;
  target_banks?: string[];
  from_bundle:  boolean;
  source:       string;
  addon_type:   'voicebank_mapper' | 'language_pack' | 'pipeline_plugin';
}

export interface ConversionResult {
  tokens:           SynthToken[];
  words:            string[];
  word_boundaries:  [number, number][];
  language:         string;
  module_id:        string;
  singability:      number;
  warnings:         string[];
  token_count:      number;
}
