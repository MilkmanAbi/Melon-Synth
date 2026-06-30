/**
 * Melon Synth - voicebank store (browser).
 *
 * Replaces the Electron voicebank-manager. UTAU voicebanks live in the
 * Substrate VFS under /voicebanks/{id}/ and persist in IndexedDB, so a bank a
 * child installs once is there on every visit, with no server and no install
 * step. Banks come from an uploaded .zip or straight from a GitHub repo via
 * Substrate's git clone.
 *
 * The oto.ini / character.txt parsers are pure so they can be unit-tested.
 */
import { readZip } from './zip';

// ── public shapes (match what the renderer already expects) ────────────────────
export interface OtoEntry {
  file: string;          // sample filename, relative to the oto.ini's folder
  alias: string;         // phoneme/alias the note's lyric maps to
  offset: number;        // ms: leading blank before usable audio
  consonant: number;     // ms: fixed (unstretched) consonant region
  cutoff: number;        // ms: raw cutoff field (>0 from end, <0 length from offset)
  preutter: number;      // ms: vowel onset relative to offset
  overlap: number;       // ms: crossfade region with the previous note
}

export interface VoicebankEntry {
  id: string;
  name: string;
  author?: string;
  path: string;          // VFS path to the bank root
  type: 'cv' | 'cvvc' | 'vcv' | 'diffsinger' | 'unknown';
  language: string;
  image?: string;        // VFS path to icon if present
  installed: boolean;
  size_mb?: number;
  web?: string;
  source?: string;
  aliasCount?: number;
}

// ── pure parsers ───────────────────────────────────────────────────────────────

/** Parse a UTAU oto.ini. Lines: file=alias,offset,consonant,cutoff,preutter,overlap */
export function parseOtoIni(text: string): OtoEntry[] {
  const out: OtoEntry[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const file = line.slice(0, eq).trim();
    const parts = line.slice(eq + 1).split(',');
    const num = (i: number) => { const v = parseFloat(parts[i]); return Number.isFinite(v) ? v : 0; };
    const alias = (parts[0] ?? '').trim();
    out.push({
      file,
      alias: alias || file.replace(/\.wav$/i, ''),
      offset: num(1),
      consonant: num(2),
      cutoff: num(3),
      preutter: num(4),
      overlap: num(5),
    });
  }
  return out;
}

/** Resolve the usable [start,end] sample window in ms given the file length. */
export function otoWindowMs(e: OtoEntry, fileDurationMs: number): { start: number; end: number } {
  const start = e.offset;
  const end = e.cutoff < 0 ? e.offset + -e.cutoff : fileDurationMs - e.cutoff;
  return { start, end: Math.max(end, start + 1) };
}

/** Parse character.txt (UTAU bank metadata). Tolerates `key=value` and `key:value`. */
export function parseCharacterTxt(text: string): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/^([^=:]+)[=:](.*)$/);
    if (m) meta[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return meta;
}

/** Guess the bank format from its aliases (crude but useful for the UI badge). */
export function guessBankType(aliases: string[]): VoicebankEntry['type'] {
  if (aliases.some(a => / /.test(a) && /^[a-z]+ [a-z]+$/i.test(a))) return 'vcv';
  if (aliases.some(a => /^[-\s]?[a-z]+[aiueon]$/i.test(a)) && aliases.some(a => /[aiueon] [a-z]/i.test(a))) return 'cvvc';
  return 'cv';
}

// ── store over the Substrate VFS ───────────────────────────────────────────────

const ROOT = '/voicebanks';
const META = 'melon-bank.json';     // our metadata sidecar written at install time

export class VoicebankStore {
  private sb: any;                  // Substrate handle
  constructor(substrate: any) { this.sb = substrate; }

  private async ensureRoot() { try { await this.sb.fs.mkdir(ROOT); } catch {} }

  /** Install from raw .zip bytes (an uploaded UTAU bank). */
  async installFromZip(bytes: Uint8Array, opts: { id?: string; name?: string; onProgress?: (p: any) => void } = {}): Promise<VoicebankEntry> {
    await this.ensureRoot();
    const entries = await readZip(bytes);

    // strip a single common top-level folder if present (KasaneTeto_CV/...)
    const top = commonTopDir([...entries.keys()]);
    const rel = (name: string) => (top && name.startsWith(top + '/') ? name.slice(top.length + 1) : name);

    const id = opts.id || slug(opts.name || top || 'voicebank') + '-' + shortHash([...entries.keys()].join('|'));
    const dest = `${ROOT}/${id}`;
    try { await this.sb.fs.remove(dest, { recursive: true }); } catch {}
    await this.sb.fs.mkdir(dest);

    let total = 0, done = 0;
    for (const [name, data] of entries) {
      const r = rel(name);
      if (!r) continue;
      await this.sb.fs.writeFile(`${dest}/${r}`, data);
      total += data.length; done++;
      opts.onProgress?.({ phase: 'extract', loaded: done, total: entries.size, path: r });
    }

    return this.finalizeInstall(id, dest, total, 'upload');
  }

  /** Install straight from a GitHub repo (owner/repo[/subdir]) via Substrate clone. */
  async installFromGitHub(spec: string, opts: { id?: string; subdir?: string; ref?: string; onProgress?: (p: any) => void } = {}): Promise<VoicebankEntry> {
    await this.ensureRoot();
    const id = opts.id || slug(spec.replace(/^github:/, '').replace(/[/@]/g, '-'));
    const dest = `${ROOT}/${id}`;
    try { await this.sb.fs.remove(dest, { recursive: true }); } catch {}
    const summary = await this.sb.git.clone(spec, {
      into: dest, ref: opts.ref,
      filter: (p: string) => !p.includes('.git/'),
      onProgress: opts.onProgress,
    });
    return this.finalizeInstall(id, dest, summary.bytesDownloaded || 0, 'github');
  }

  /** Parse metadata after files are on disk, write the sidecar, return the entry. */
  private async finalizeInstall(id: string, dest: string, bytes: number, source: string): Promise<VoicebankEntry> {
    const otoPath = await this.findFirst(dest, 'oto.ini');
    const charPath = await this.findFirst(dest, 'character.txt');
    let aliases: string[] = [];
    if (otoPath) {
      try { aliases = parseOtoIni(await this.sb.fs.readText(otoPath)).map(e => e.alias); } catch {}
    }
    let name = id, author = '', image = '';
    if (charPath) {
      try {
        const meta = parseCharacterTxt(await this.sb.fs.readText(charPath));
        name = meta.name || name; author = meta.author || meta.cv || '';
        if (meta.image) image = `${dirOf(charPath)}/${meta.image}`;
      } catch {}
    }
    const lang = /[\u3040-\u30ff]/.test(aliases.join('')) || aliases.some(a => /^(a|i|u|e|o|ka|ki)$/.test(a)) ? 'ja' : 'en';
    const entry: VoicebankEntry = {
      id, name, author, path: dest,
      type: guessBankType(aliases),
      language: lang,
      image: image || undefined,
      installed: true,
      size_mb: Math.round((bytes / 1024 / 1024) * 10) / 10,
      source,
      aliasCount: aliases.length,
    };
    await this.sb.fs.writeText(`${dest}/${META}`, JSON.stringify(entry, null, 2));
    return entry;
  }

  /** List every installed bank by scanning the VFS. */
  async list(): Promise<VoicebankEntry[]> {
    await this.ensureRoot();
    const out: VoicebankEntry[] = [];
    let dirs: any[] = [];
    try { dirs = await this.sb.fs.list(ROOT); } catch { return out; }
    for (const d of dirs) {
      if (d.type !== 'dir') continue;
      const base = `${ROOT}/${d.name}`;
      const metaPath = `${base}/${META}`;
      if (await this.sb.fs.exists(metaPath)) {
        try { out.push(JSON.parse(await this.sb.fs.readText(metaPath))); continue; } catch {}
      }
      // no sidecar (e.g. a bank dropped in manually) - synthesise one
      const oto = await this.findFirst(base, 'oto.ini');
      if (oto) out.push(await this.finalizeInstall(d.name, base, 0, 'manual'));
    }
    return out;
  }

  async remove(id: string): Promise<void> {
    try { await this.sb.fs.remove(`${ROOT}/${id}`, { recursive: true }); } catch {}
  }

  /**
   * Load a bank for synthesis: every oto entry with its sample resolved to a
   * VFS path, keyed by alias (later entries win on collision).
   */
  async loadBank(bankPath: string): Promise<{ entries: Map<string, OtoEntry & { samplePath: string }>; root: string }> {
    const otoPaths = await this.findAll(bankPath, 'oto.ini');
    const map = new Map<string, OtoEntry & { samplePath: string }>();
    for (const otoPath of otoPaths) {
      const folder = dirOf(otoPath);
      let text = '';
      try { text = await this.sb.fs.readText(otoPath); } catch { continue; }
      for (const e of parseOtoIni(text)) {
        map.set(e.alias, { ...e, samplePath: `${folder}/${e.file}` });
      }
    }
    return { entries: map, root: bankPath };
  }

  async readSample(samplePath: string): Promise<Uint8Array | null> {
    try { return await this.sb.fs.readFile(samplePath); } catch { return null; }
  }

  // ── helpers ──────────────────────────────────────────────────────────────────
  private async findFirst(base: string, filename: string): Promise<string | null> {
    const all = await this.findAll(base, filename, 1);
    return all[0] ?? null;
  }
  private async findAll(base: string, filename: string, limit = Infinity): Promise<string[]> {
    const found: string[] = [];
    const walk = async (dir: string, depth: number) => {
      if (found.length >= limit || depth > 6) return;
      let entries: any[] = [];
      try { entries = await this.sb.fs.list(dir); } catch { return; }
      for (const e of entries) {
        const p = `${dir}/${e.name}`;
        if (e.type === 'dir') await walk(p, depth + 1);
        else if (e.name.toLowerCase() === filename.toLowerCase()) {
          found.push(p);
          if (found.length >= limit) return;
        }
      }
    };
    await walk(base, 0);
    return found;
  }
}

// ── small utils ────────────────────────────────────────────────────────────────
function commonTopDir(names: string[]): string | null {
  const tops = new Set(names.filter(n => n.includes('/')).map(n => n.split('/')[0]));
  const looseFiles = names.filter(n => !n.includes('/'));
  return tops.size === 1 && looseFiles.length === 0 ? [...tops][0] : null;
}
function dirOf(p: string): string { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); }
function slug(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'bank'; }
function shortHash(s: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36).slice(0, 6);
}
