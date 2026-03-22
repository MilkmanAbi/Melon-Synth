/**
 * OpenUTAU Bundler
 * ================
 * Manages a bundled copy of OpenUTAU so users don't need to install it separately.
 *
 * OpenUTAU is MIT licensed — full credit to stakira and contributors.
 * Source: https://github.com/stakira/OpenUtau
 *
 * Strategy:
 *   1. Check if OpenUTAU is already installed system-wide → use it
 *   2. Check if we have a bundled copy in userData/openutau/ → use it
 *   3. Neither → show a banner asking to download the bundled copy
 *      (we download the official OpenUTAU release from GitHub)
 *
 * This never modifies the user's system — bundled copy goes in userData only.
 */

import { app }   from 'electron';
import * as fs   from 'fs';
import * as path from 'path';
import * as cp   from 'child_process';
import * as os   from 'os';

const OPENUTAU_DIR    = path.join(app.getPath('userData'), 'openutau');
const OPENUTAU_CREDIT = 'OpenUTAU © stakira — MIT License — https://github.com/stakira/OpenUtau';

// Latest stable OpenUTAU release URLs per platform
// Update these when new OpenUTAU versions release
const OPENUTAU_RELEASES: Record<string, { url: string; bin: string }> = {
  linux: {
    url: 'https://github.com/stakira/OpenUtau/releases/latest/download/OpenUtau-linux-x64.tar.gz',
    bin: path.join(OPENUTAU_DIR, 'linux', 'OpenUtau'),
  },
  darwin: {
    url: 'https://github.com/stakira/OpenUtau/releases/latest/download/OpenUtau-osx-x64.tar.gz',
    bin: path.join(OPENUTAU_DIR, 'darwin', 'OpenUtau.app', 'Contents', 'MacOS', 'OpenUtau'),
  },
  win32: {
    url: 'https://github.com/stakira/OpenUtau/releases/latest/download/OpenUtau-win-x64.zip',
    bin: path.join(OPENUTAU_DIR, 'win32', 'OpenUtau.exe'),
  },
};

// System-wide candidate paths (per OS)
const SYSTEM_CANDIDATES: Record<string, string[]> = {
  linux: [
    '/usr/local/bin/openutau', '/usr/bin/openutau',
    path.join(os.homedir(), '.local', 'bin', 'openutau'),
    path.join(os.homedir(), 'OpenUtau', 'OpenUtau'),
  ],
  darwin: [
    '/Applications/OpenUtau.app/Contents/MacOS/OpenUtau',
    path.join(os.homedir(), 'Applications', 'OpenUtau.app', 'Contents', 'MacOS', 'OpenUtau'),
  ],
  win32: [
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'OpenUtau', 'OpenUtau.exe'),
    'C:\\Program Files\\OpenUtau\\OpenUtau.exe',
  ],
};

export interface OpenUTAUStatus {
  found:     boolean;
  path:      string | null;
  source:    'system' | 'bundled' | null;  // where it came from
  version:   string | null;
  credit:    string;
}

// ── Detection ─────────────────────────────────────────────────────────────────

function detectSystemOpenUTAU(): string | null {
  const platform = process.platform;
  const candidates = SYSTEM_CANDIDATES[platform] ?? [];

  // Check PATH first
  try {
    const which = cp.execSync(
      platform === 'win32' ? 'where openutau' : 'which openutau',
      { encoding: 'utf8', timeout: 2000 },
    ).trim().split('\n')[0];
    if (which && fs.existsSync(which)) return which;
  } catch {}

  // Check known paths
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function detectBundledOpenUTAU(): string | null {
  const release = OPENUTAU_RELEASES[process.platform];
  if (!release) return null;
  return fs.existsSync(release.bin) ? release.bin : null;
}

export function detectOpenUTAU(): OpenUTAUStatus {
  // System install wins — user may have a newer version
  const systemPath = detectSystemOpenUTAU();
  if (systemPath) {
    return {
      found: true, path: systemPath, source: 'system',
      version: getOpenUTAUVersion(systemPath), credit: OPENUTAU_CREDIT,
    };
  }

  // Bundled copy
  const bundledPath = detectBundledOpenUTAU();
  if (bundledPath) {
    return {
      found: true, path: bundledPath, source: 'bundled',
      version: getOpenUTAUVersion(bundledPath), credit: OPENUTAU_CREDIT,
    };
  }

  return { found: false, path: null, source: null, version: null, credit: OPENUTAU_CREDIT };
}

function getOpenUTAUVersion(binPath: string): string | null {
  try {
    const out = cp.execSync(`"${binPath}" --version`, {
      encoding: 'utf8', timeout: 3000,
    });
    const m = out.match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : 'unknown';
  } catch {
    return 'unknown';
  }
}

// ── Download & install bundled copy ──────────────────────────────────────────

export async function downloadBundledOpenUTAU(
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const platform = process.platform;
  const release  = OPENUTAU_RELEASES[platform];
  if (!release) {
    return { ok: false, error: `Unsupported platform: ${platform}` };
  }

  const destDir = path.join(OPENUTAU_DIR, platform);
  fs.mkdirSync(destDir, { recursive: true });

  const tmpFile = path.join(OPENUTAU_DIR, `openutau_download.tmp`);

  try {
    // Download with progress
    await downloadFile(release.url, tmpFile, onProgress);

    // Extract
    if (release.url.endsWith('.tar.gz')) {
      cp.execSync(`tar -xzf "${tmpFile}" -C "${destDir}"`, { timeout: 60000 });
    } else if (release.url.endsWith('.zip')) {
      cp.execSync(`python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "${tmpFile}" "${destDir}"`, { timeout: 60000 });
    }

    // Make executable on Unix
    if (platform !== 'win32' && fs.existsSync(release.bin)) {
      fs.chmodSync(release.bin, 0o755);
    }

    fs.unlinkSync(tmpFile);

    if (!fs.existsSync(release.bin)) {
      return { ok: false, error: 'Extraction succeeded but binary not found' };
    }

    return { ok: true, path: release.bin };
  } catch (e: any) {
    try { fs.unlinkSync(tmpFile); } catch {}
    return { ok: false, error: String(e.message ?? e) };
  }
}

async function downloadFile(
  url:        string,
  dest:       string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const { net } = await import('electron');
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    let total = 0;
    let done  = 0;
    const out = fs.createWriteStream(dest);

    req.on('response', (res) => {
      total = parseInt(res.headers['content-length'] as string ?? '0', 10);
      res.on('data', (chunk: Buffer) => {
        out.write(chunk);
        done += chunk.length;
        onProgress?.(done, total);
      });
      res.on('end', () => { out.close(); resolve(); });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.end();
  });
}

// ── Singers directory ─────────────────────────────────────────────────────────

export function getSingersDir(): string | null {
  const platform = process.platform;

  const candidates: string[] = {
    linux:  [
      path.join(os.homedir(), '.config', 'OpenUtau', 'Singers'),
      path.join(os.homedir(), '.local', 'share', 'OpenUtau', 'Singers'),
      path.join(OPENUTAU_DIR, 'linux', 'Singers'),
    ],
    darwin: [
      path.join(os.homedir(), 'Library', 'Application Support', 'OpenUtau', 'Singers'),
      path.join(OPENUTAU_DIR, 'darwin', 'Singers'),
    ],
    win32:  [
      path.join(os.homedir(), 'AppData', 'Roaming', 'OpenUtau', 'Singers'),
      path.join(os.homedir(), 'AppData', 'Local', 'OpenUtau', 'Singers'),
    ],
  }[platform as 'linux'|'darwin'|'win32'] ?? [];

  return candidates.find(d => fs.existsSync(d)) ?? null;
}
