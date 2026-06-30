/**
 * Substrate — git providers.
 *
 * A provider knows how to (a) list a repo's file tree in as few requests as
 * possible and (b) produce a direct URL for any one file. Substrate ships two:
 *
 *   jsDelivr  — primary. `data.jsdelivr.com` returns the entire flat tree WITH a
 *               per-file SHA-256 in ONE request, no rate limit, CORS-friendly,
 *               and `cdn.jsdelivr.net` serves the bytes from a global CDN. The
 *               bundled hash doubles as our cache key, so re-clones can skip
 *               unchanged files without ever touching the network.
 *
 *   GitHub    — fallback. `api.github.com/.../git/trees/<ref>?recursive=1` lists
 *               the tree in one request (but 60/hr unauthenticated), and
 *               `raw.githubusercontent.com` serves bytes. Used when jsDelivr
 *               doesn't have the ref yet (very fresh commits) or for tags it
 *               hasn't mirrored.
 *
 * Provider.listTree → { resolved, files: [{ path, size, srcId, url }] }
 *   path  : repo-relative, no leading slash
 *   srcId : provider-natural content id (jsDelivr: base64 sha256; GitHub: blob sha1)
 *   url   : direct byte URL
 */
import { GitError } from '../core/errors.js';

/** Accepts the many shapes a human/IDE might pass for "which repo". */
export function parseRepoSpec(spec) {
  if (!spec || typeof spec !== 'string') throw new GitError('empty repo spec');
  spec = spec.trim();
  let provider = 'github', ref = null, owner, repo;

  // explicit provider prefix:  github:owner/repo  /  gh:owner/repo@ref
  const pm = spec.match(/^(github|gh)\s*:\s*(.+)$/i);
  if (pm) { spec = pm[2]; }

  // full URL
  const um = spec.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+))?(?:\/.*)?$/i);
  if (um) { owner = um[1]; repo = um[2]; ref = um[3] || ref; }
  else {
    // owner/repo@ref  or  owner/repo#ref  or owner/repo
    const m = spec.match(/^([^/\s]+)\/([^/\s@#]+)(?:[@#](.+))?$/);
    if (!m) throw new GitError(`unrecognised repo spec: ${spec}`);
    owner = m[1]; repo = m[2].replace(/\.git$/, ''); ref = m[3] || ref;
  }
  return { provider, owner, repo, ref };
}

export class JsDelivrProvider {
  constructor(fetcher) { this.name = 'jsdelivr'; this._f = fetcher; }

  async listTree({ owner, repo, ref }) {
    const v = ref || 'HEAD';
    const api = `https://data.jsdelivr.com/v1/packages/gh/${owner}/${repo}@${encodeURIComponent(v)}?structure=flat`;
    const res = await this._f.fetch(api, { as: 'json' });
    if (!res.ok || !res.json || !Array.isArray(res.json.files)) {
      throw new GitError(`jsdelivr: cannot list ${owner}/${repo}@${v} (status ${res.status})`, { owner, repo, ref: v });
    }
    const resolved = res.json.version || v;
    const files = res.json.files.map(f => {
      const path = f.name.replace(/^\//, '');
      return {
        path, size: f.size || 0, srcId: f.hash,  // base64 sha256
        url: `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${resolved}/${path}`,
      };
    });
    return { resolved, files };
  }
}

export class GitHubProvider {
  constructor(fetcher) { this.name = 'github'; this._f = fetcher; }

  async listTree({ owner, repo, ref }) {
    const r = ref || 'HEAD';
    const api = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(r)}?recursive=1`;
    const res = await this._f.fetch(api, { as: 'json', headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok || !res.json) {
      const msg = res.json?.message || `status ${res.status}`;
      throw new GitError(`github: cannot list ${owner}/${repo}@${r} — ${msg}`, { owner, repo, ref: r, status: res.status });
    }
    if (res.json.truncated) {
      // Tree too large for one response; caller may want the tarball transport instead.
      throw new GitError(`github: tree for ${owner}/${repo} is truncated (too large for trees API)`, { truncated: true });
    }
    const files = (res.json.tree || [])
      .filter(n => n.type === 'blob')
      .map(n => ({
        path: n.path, size: n.size || 0, srcId: n.sha,  // git blob sha1
        url: `https://raw.githubusercontent.com/${owner}/${repo}/${r}/${n.path}`,
      }));
    return { resolved: r, files };
  }
}

/** Default provider chain for `provider: 'auto'`. */
export function buildProviders(fetcher, which = 'auto') {
  const jsd = new JsDelivrProvider(fetcher);
  const gh = new GitHubProvider(fetcher);
  if (which === 'jsdelivr') return [jsd];
  if (which === 'github') return [gh];
  return [jsd, gh]; // auto: jsdelivr first, github fallback
}
