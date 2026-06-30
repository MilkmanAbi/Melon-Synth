/**
 * Melon Synth - Substrate platform host.
 *
 * This is the heart of the web port. The renderer was written to talk to an
 * Electron main process through a set of window.* bridges (window.app,
 * window.voicebanks, window.render, window.mlc, ...). Rather than rewrite the
 * UI, this module implements that exact contract in the browser on top of
 * Substrate: files and voicebanks live in an IndexedDB-backed virtual
 * filesystem, voicebanks are cloned from GitHub or unzipped from an upload, and
 * synthesis runs in-page with the concatenative engine. Because window.app
 * becomes defined, every `isElectron`-gated path in the app lights up - so the
 * web build is the full app, not the degraded fallback.
 *
 * Call bootMelonPlatform() once before React mounts.
 */
import createSubstrate from '../vendor/substrate/substrate.js';
import { VoicebankStore } from './voicebank-store';
import { renderNotes } from './utau-render';
import { readZip, writeZip } from './zip';
import { phonemize, detectLang, BUILTIN_MODULES } from './phonemizer';

type AnyFn = (...a: any[]) => any;

const DIRS = ['/projects', '/voicebanks', '/addons', '/extensions', '/settings', '/tmp'];
const UI_STATE = '/settings/ui-state.json';

let booted: Promise<MelonPlatform> | null = null;

export interface MelonPlatform {
  sb: any;
  voicebanks: VoicebankStore;
}

/** Boot once; safe to await repeatedly. */
export function bootMelonPlatform(): Promise<MelonPlatform> {
  if (booted) return booted;
  booted = (async () => {
    const sb = await createSubstrate({ persist: true, dirs: DIRS });
    const vb = new VoicebankStore(sb);
    const platform: MelonPlatform = { sb, voicebanks: vb };

    installApp(sb);
    installMlc();
    installVoicebanks(sb, vb);
    installRender(sb, vb);
    installMti(sb);
    installAddons();
    installElectron();

    (window as any).__melonPlatform = platform;
    return platform;
  })();
  return booted;
}

// ── helpers ────────────────────────────────────────────────────────────────--
const enc = new TextEncoder();
const dec = new TextDecoder();
const listeners: Record<string, AnyFn[]> = {};
const emit = (ev: string, ...a: any[]) => (listeners[ev] || []).forEach(f => { try { f(...a); } catch {} });
const on = (ev: string, cb: AnyFn) => { (listeners[ev] ||= []).push(cb); };

function pickFile(accept: string): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    let done = false;
    const finish = (f: File | null) => { if (!done) { done = true; resolve(f); } };
    input.onchange = () => finish(input.files?.[0] ?? null);
    window.addEventListener('focus', () => setTimeout(() => finish(input.files?.[0] ?? null), 400), { once: true });
    input.click();
  });
}

function download(name: string, data: Uint8Array | string, mime = 'application/octet-stream') {
  const blob = new Blob([data as any], { type: mime });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ── window.app ─────────────────────────────────────────────────────────────--
function installApp(sb: any) {
  let uiCache: any = {};
  (window as any).app = {
    async saveUIState(data: any) {
      uiCache = { ...uiCache, ...data };
      try { await sb.fs.writeText(UI_STATE, JSON.stringify(uiCache)); } catch {}
      try { localStorage.setItem('melon-ui-state', JSON.stringify(uiCache)); } catch {}
    },
    async getUIState() {
      try { if (await sb.fs.exists(UI_STATE)) { uiCache = JSON.parse(await sb.fs.readText(UI_STATE)); return uiCache; } } catch {}
      try { const ls = localStorage.getItem('melon-ui-state'); if (ls) return (uiCache = JSON.parse(ls)); } catch {}
      return {};
    },
    onUIState(_cb: AnyFn) { /* single-window web: no external pushes */ },

    getPlatform: () => 'web',
    async getSystemDark() { return !!window.matchMedia?.('(prefers-color-scheme: dark)').matches; },
    onSystemDarkChanged(cb: AnyFn) {
      window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', e => cb(e.matches));
    },

    // raw file I/O over the VFS
    async writeFile(path: string, content: string) {
      try { await sb.fs.writeText(vfsPath(path), content); return { ok: true }; }
      catch (e: any) { return { ok: false, error: e.message }; }
    },
    async readFile(path: string) { return sb.fs.readText(vfsPath(path)); },
    async fileExists(path: string) { return sb.fs.exists(vfsPath(path)); },

    // projects: open imports a file into the VFS and returns its VFS path
    async openProject() {
      const file = await pickFile('.loid,.json');
      if (!file) return null;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const dest = `/projects/${file.name}`;
      await sb.fs.writeFile(dest, bytes);
      return dest;
    },
    async saveProject(name?: string) {
      const fname = (name || 'untitled.loid').replace(/[^\w.\- ]/g, '_');
      return `/projects/${fname}`;
    },
    async exportWAV(name?: string) {
      const last = (window as any).__melonLastWav as Uint8Array | undefined;
      if (!last) return null;
      download((name || 'export.wav'), last, 'audio/wav');
      return name || 'export.wav';
    },

    // .loid v2 ZIP project files, stored in the VFS
    async saveProjectZip(path: string, files: Record<string, string>) {
      try {
        const zip = await writeZip(files);
        await sb.fs.writeFile(vfsPath(path), zip);
        // also offer a download so kids can keep a copy / share it
        download((path.split('/').pop() || 'project.loid'), zip, 'application/zip');
        return { ok: true };
      } catch (e: any) { return { ok: false, error: e.message }; }
    },
    async readProjectZip(path: string) {
      try {
        const bytes = await sb.fs.readFile(vfsPath(path));
        // a v1 plain-JSON .loid is not a zip - signal caller to fall back
        if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) return null;
        const map = await readZip(bytes);
        const out: Record<string, string> = {};
        for (const [k, v] of map) out[k] = dec.decode(v);
        return out;
      } catch { return null; }
    },

    // shell / OS - degrade to web equivalents
    openPath(_p: string) { /* no filesystem shell on web */ },
    openURL(url: string) { window.open(url, '_blank', 'noopener'); },

    // addons / extensions (stored in the VFS; advanced, minimal v1)
    async getAddonsDir() { return '/addons'; },
    async installAddonDialog() {
      const file = await pickFile('.mlc,.zip');
      if (!file) return { ok: false, canceled: true };
      return installBundle(sb, '/addons', new Uint8Array(await file.arrayBuffer()), file.name);
    },
    async installAddon(filePath: string) {
      try { const bytes = await sb.fs.readFile(vfsPath(filePath)); return installBundle(sb, '/addons', bytes, filePath); }
      catch (e: any) { return { ok: false, error: e.message }; }
    },
    async uninstallAddon(id: string) { try { await sb.fs.remove(`/addons/${id}`, { recursive: true }); return { ok: true, removed: id }; } catch (e: any) { return { ok: false, error: e.message }; } },
    async installExtension(p: any) {
      const path = p?.path ?? p;
      if (typeof path === 'string') { try { const b = await sb.fs.readFile(vfsPath(path)); return installBundle(sb, '/extensions', b, path); } catch (e: any) { return { ok: false, error: e.message }; } }
      const file = await pickFile('.melon,.zip');
      if (!file) return { ok: false, error: 'cancelled' };
      return installBundle(sb, '/extensions', new Uint8Array(await file.arrayBuffer()), file.name);
    },
    async removeExtension(id: string) { try { await sb.fs.remove(`/extensions/${id}`, { recursive: true }); return { ok: true }; } catch (e: any) { return { ok: false, error: e.message }; } },
    async listExtensions() { return listInstalled(sb, '/extensions'); },
    async openExtensionUI() { return { ok: false, error: 'Extension UIs are not available in the web build yet' }; },
    async checkExtensionUpdates() { return []; },
    async readMelonManifest(path: string) { try { return JSON.parse(await sb.fs.readText(vfsPath(path))); } catch { return null; } },
  };
}

// ── window.mlc ─────────────────────────────────────────────────────────────--
function installMlc() {
  (window as any).mlc = {
    async ping() { return { status: 'ok', version: 'web-1.0.0', modules: BUILTIN_MODULES.length }; },
    async convert(p: any) { return phonemize(p.text, p.moduleId); },
    async preview(p: any) { return phonemize(p.text, p.moduleId); },
    async listModules() { return BUILTIN_MODULES; },
    async listAllAddons() { return []; },
    async listAddonsFull() { return { addons: [] }; },
    async detectLanguage(text: string) { return { lang: detectLang(text), confidence: 0.8 }; },
    async suggestSingability() { return { suggested: 0.65, reason: 'Standard setting' }; },
    async cacheStats() { return { entries: 0 }; },
    async clearCache(target: string) { return { cleared: target }; },
    async installAddon() { return { ok: false, error: 'Addons require the desktop/Python build' }; },
    async removeAddon() { return { ok: true }; },
    async checkUpdates() { return []; },
    async applyUpdate() { return { ok: false }; },
    async getAddonInfo() { return null; },
    async getPipelineTrace() { return { stages: [] }; },
  };
}

// ── window.voicebanks ──────────────────────────────────────────────────────--
function installVoicebanks(sb: any, vb: VoicebankStore) {
  (window as any).voicebanks = {
    async list() { return vb.list(); },
    async detectSystem() { return { openutau: false, banks: [] }; },
    async download(p: any) {
      // Collect every candidate URL (primary + catalog mirrors). GitHub release
      // assets and raw GitHub are CORS-friendly and install cleanly; arbitrary
      // third-party hosts usually are not, so we prefer GitHub when offered.
      const candidates: string[] = [p?.url, ...(p?.mirrors || [])].filter(Boolean);
      const ghZip = candidates.find(u => /github\.com|githubusercontent\.com/.test(u) && /\.zip(\?|$)/i.test(u));
      const ghRepo = candidates.find(u => /github\.com\/[^/]+\/[^/]+/.test(u) && !/\.zip/i.test(u));
      const anyZip = candidates.find(u => /\.zip(\?|$)/i.test(u));
      try {
        if (p?.github || p?.repo) {
          const entry = await vb.installFromGitHub(p.github || p.repo, { id: p?.id, ref: p?.ref, onProgress: pr => emit('vb:download-progress', { ...pr, id: p?.id }) });
          return { ok: true, entry };
        }
        const fetchZip = async (url: string) => {
          emit('vb:download-progress', { phase: 'download', id: p?.id, percent: 5 });
          const resp = await fetch(url);
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const bytes = new Uint8Array(await resp.arrayBuffer());
          emit('vb:download-progress', { phase: 'extract', id: p?.id, percent: 60 });
          return vb.installFromZip(bytes, { id: p?.id, name: p?.name, onProgress: pr => emit('vb:download-progress', { ...pr, id: p?.id }) });
        };
        if (ghZip) return { ok: true, entry: await fetchZip(ghZip) };
        if (ghRepo) {
          const spec = toGithubSpec(ghRepo)!;
          const entry = await vb.installFromGitHub(spec, { id: p?.id, onProgress: pr => emit('vb:download-progress', { ...pr, id: p?.id }) });
          return { ok: true, entry };
        }
        if (anyZip) return { ok: true, entry: await fetchZip(anyZip) };
        return { ok: false, error: 'No installable GitHub mirror or .zip URL. Upload the bank .zip instead.' };
      } catch (e: any) {
        return { ok: false, error: e.message + ' (this host may block browser downloads; upload the .zip or use a GitHub mirror)' };
      }
    },
    async installFromZip(p: any) {
      try {
        let bytes: Uint8Array | null = null, name: string | undefined;
        if (p instanceof File || p instanceof Blob) { bytes = new Uint8Array(await (p as Blob).arrayBuffer()); name = (p as File).name; }
        else if (p?.bytes) bytes = p.bytes;
        else if (typeof p?.path === 'string') { bytes = await sb.fs.readFile(vfsPath(p.path)); name = p.path.split('/').pop(); }
        else { const f = await pickFile('.zip'); if (!f) return { ok: false, error: 'cancelled' }; bytes = new Uint8Array(await f.arrayBuffer()); name = f.name; }
        const entry = await vb.installFromZip(bytes!, { name: p?.name || name, onProgress: pr => emit('vb:download-progress', pr) });
        return { ok: true, entry };
      } catch (e: any) { return { ok: false, error: e.message }; }
    },
    openFolder(_p: any) { /* no OS folder on web */ },
    onDownloadProgress(cb: AnyFn) { on('vb:download-progress', cb); },
    // convenience the web UI can use directly
    async remove(id: string) { await vb.remove(id); return { ok: true }; },
  };
}

// ── window.render ──────────────────────────────────────────────────────────--
function installRender(sb: any, vb: VoicebankStore) {
  (window as any).render = {
    async render(p: any) {
      try {
        const bankPath = p.voicebank_path || p.voice_dir;
        if (!bankPath) return { ok: false, error: 'No voicebank selected' };
        const bank = await vb.loadBank(bankPath);
        if (!bank.entries.size) return { ok: false, error: 'Voicebank has no samples (no oto.ini found)' };

        const res = await renderNotes(
          (p.notes || []).map((n: any) => ({ pitch: n.pitch, start: n.start, duration: n.duration, lyric: n.lyric, phoneme: n.phoneme })),
          bank,
          (sp: string) => vb.readSample(sp),
          { tempo: p.tempo || 120, onProgress: pr => emit('render:progress', pr) },
        );

        // stash bytes for exportWAV + build a blob URL the audio subsystem can fetch
        (window as any).__melonLastWav = res.wav;
        const url = URL.createObjectURL(new Blob([res.wav], { type: 'audio/wav' }));
        // keep a copy in the VFS too
        try { await sb.fs.writeFile('/tmp/last-render.wav', res.wav); } catch {}

        const result = {
          ok: true, wav_path: url, duration_ms: res.durationMs,
          rendered: res.rendered, skipped: res.skipped,
        };
        emit('render:complete', result);
        if (res.rendered === 0) return { ok: false, error: `Could not match any phonemes to bank samples (tried: ${res.skipped.slice(0, 5).join(', ')})` };
        return result;
      } catch (e: any) { emit('render:error', e.message); return { ok: false, error: e.message }; }
    },
    async generateUST(p: any) { return { ok: true, ust: buildUST(p) }; },
    async detectEditors() { return { editors: [] }; },
    async openInEditor() { return { ok: false, error: 'External editors are desktop-only' }; },
    onComplete(cb: AnyFn) { on('render:complete', cb); },
    onError(cb: AnyFn) { on('render:error', cb); },
  };
}

// ── window.mti (in-browser mini shell over the VFS) ─────────────────────────--
function installMti(sb: any) {
  const run = async (cmd: string): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> => {
    const [c, ...args] = cmd.trim().split(/\s+/);
    const ok = (stdout: string) => ({ ok: true, stdout, stderr: '', code: 0 });
    const err = (stderr: string) => ({ ok: false, stdout: '', stderr, code: 1 });
    try {
      switch (c) {
        case '': return ok('');
        case 'help': return ok('Melon web shell: help, ls [path], cat <path>, pwd, echo, vb, mkdir <path>, rm <path>, clear');
        case 'pwd': return ok('/');
        case 'echo': return ok(args.join(' '));
        case 'vb': { const banks = await (window as any).voicebanks.list(); return ok(banks.map((b: any) => `${b.id}  ${b.name} (${b.aliasCount ?? '?'} aliases)`).join('\n') || '(no voicebanks installed)'); }
        case 'ls': { const e = await sb.fs.list(args[0] || '/'); return ok(e.map((x: any) => x.name + (x.type === 'dir' ? '/' : '')).join('  ')); }
        case 'cat': { return ok(await sb.fs.readText(args[0])); }
        case 'mkdir': { await sb.fs.mkdir(args[0]); return ok(''); }
        case 'rm': { await sb.fs.remove(args[0], { recursive: true }); return ok(''); }
        case 'python': case 'python3': return err('Python is not available in the web build (no Pyodide bundled). Use the desktop build for the Python MLC engine.');
        default: return err(`unknown command: ${c}`);
      }
    } catch (e: any) { return err(e.message); }
  };
  (window as any).mti = {
    async spawnSession(id: string) { emit('mti:stdout', id, 'Melon web shell. Type "help".\n'); return { ok: true }; },
    async write(id: string, data: string) { const r = await run(data); emit('mti:stdout', id, (r.stdout || r.stderr) + '\n'); return { ok: r.ok }; },
    async kill(id: string) { emit('mti:exit', id, 0); return { ok: true }; },
    async exec(cmd: string) { return run(cmd); },
    async python() { return { ok: false, stdout: '', stderr: 'Python not available in web build', code: 1 }; },
    async mlcCommands() { return ['convert', 'preview', 'list-modules']; },
    onStdout(cb: AnyFn) { on('mti:stdout', cb); },
    onStderr(cb: AnyFn) { on('mti:stderr', cb); },
    onExit(cb: AnyFn) { on('mti:exit', cb); },
  };
}

// ── window.melonAddons (extension panel system) ─────────────────────────────--
function installAddons() {
  (window as any).melonAddons = {
    async getPanels() { return []; },
    async getToolbarItems() { return []; },
    async getMenuItems() { return []; },
    async getCommands() { return []; },
    async executeCommand() { return { ok: false }; },
    async callBackend() { return { ok: false, error: 'Extension backends are desktop-only' }; },
    onAddonLoaded(cb: AnyFn) { on('addons:loaded', cb); },
    onAddonUnloaded(cb: AnyFn) { on('addons:unloaded', cb); },
  };
}

// ── window.electron (window controls - no-ops on web) ───────────────────────--
function installElectron() {
  (window as any).electron = {
    minimize() {}, maximize() {}, close() {},
    async isMaximized() { return false },
    platform: 'web',
  };
}

// ── shared bits ────────────────────────────────────────────────────────────--
function vfsPath(p: string): string {
  if (!p) return '/';
  if (p.startsWith('/')) return p;
  // map bare names / electron-style paths into the projects dir
  return '/projects/' + p.replace(/^.*[\\/]/, '');
}

function toGithubSpec(url: string): string | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  return m ? `github:${m[1]}/${m[2].replace(/\.git$/, '')}` : null;
}

async function installBundle(sb: any, root: string, bytes: Uint8Array, name: string) {
  try {
    const map = await readZip(bytes);
    const manifestRaw = [...map.entries()].find(([k]) => k.toLowerCase().endsWith('manifest.json'))?.[1];
    const manifest = manifestRaw ? JSON.parse(dec.decode(manifestRaw)) : {};
    const id = manifest.id || name.replace(/\.(melon|mlc|zip)$/i, '').replace(/[^\w.-]/g, '_');
    const dest = `${root}/${id}`;
    try { await sb.fs.remove(dest, { recursive: true }); } catch {}
    const top = singleTopDir([...map.keys()]);
    for (const [k, v] of map) { const r = top && k.startsWith(top + '/') ? k.slice(top.length + 1) : k; if (r) await sb.fs.writeFile(`${dest}/${r}`, v); }
    return { ok: true, name: manifest.name || id, version: manifest.version, path: dest };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

async function listInstalled(sb: any, root: string) {
  const out: any[] = [];
  let dirs: any[] = [];
  try { dirs = await sb.fs.list(root); } catch { return out; }
  for (const d of dirs) {
    if (d.type !== 'dir') continue;
    const mp = `${root}/${d.name}/manifest.json`;
    try { if (await sb.fs.exists(mp)) out.push({ id: d.name, ...JSON.parse(await sb.fs.readText(mp)) }); else out.push({ id: d.name }); } catch { out.push({ id: d.name }); }
  }
  return out;
}

function singleTopDir(names: string[]): string | null {
  const tops = new Set(names.filter(n => n.includes('/')).map(n => n.split('/')[0]));
  const loose = names.filter(n => !n.includes('/'));
  return tops.size === 1 && loose.length === 0 ? [...tops][0] : null;
}

/** Minimal UST export (enough for OpenUTAU import on desktop). */
function buildUST(p: any): string {
  const tempo = p.tempo || 120;
  const lines = ['[#VERSION]', 'UST Version1.2', '[#SETTING]', `Tempo=${tempo}`, 'Tracks=1', 'Mode2=True'];
  (p.notes || []).sort((a: any, b: any) => a.start - b.start).forEach((n: any, i: number) => {
    lines.push(`[#${String(i).padStart(4, '0')}]`);
    lines.push(`Length=${Math.round((n.duration || 1) * 480)}`);
    lines.push(`Lyric=${n.phoneme || n.lyric || 'あ'}`);
    lines.push(`NoteNum=${n.pitch || 60}`);
    lines.push('PreUtterance=');
  });
  lines.push('[#TRACKEND]');
  return lines.join('\r\n');
}
