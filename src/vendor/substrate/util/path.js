/**
 * Substrate — POSIX-ish path utilities.
 * Everything in Substrate uses absolute, forward-slash paths. No drive letters,
 * no backslashes. `/` is root. These helpers are pure and synchronous.
 */

/** Collapse `.`/`..`, dedupe slashes, force leading slash, strip trailing. */
export function normalize(p) {
  if (p == null) return '/';
  p = String(p);
  const abs = p.startsWith('/');
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (out.length) out.pop(); continue; }
    out.push(seg);
  }
  const joined = '/' + out.join('/');
  return abs || true ? joined : joined; // always absolute in Substrate
}

/** Parent directory of a path. parent('/a/b') === '/a', parent('/') === '/'. */
export function dirname(p) {
  p = normalize(p);
  if (p === '/') return '/';
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

/** Last path segment. base('/a/b.txt') === 'b.txt', base('/') === ''. */
export function basename(p) {
  p = normalize(p);
  if (p === '/') return '';
  return p.slice(p.lastIndexOf('/') + 1);
}

/** File extension including the dot, or '' if none. ext('/a/b.txt') === '.txt'. */
export function extname(p) {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i);
}

/** Join fragments into one normalized absolute path. */
export function join(...parts) {
  return normalize(parts.filter(s => s != null && s !== '').join('/'));
}

/** Split into ['a','b','c'] (no empty segments). */
export function segments(p) {
  return normalize(p).split('/').filter(Boolean);
}

/** Is `child` equal to or nested under `parent`? */
export function isUnder(parent, child) {
  parent = normalize(parent);
  child = normalize(child);
  if (parent === '/') return true;
  return child === parent || child.startsWith(parent + '/');
}

/** Path of `child` relative to `parent` (no leading slash). '' if equal. */
export function relative(parent, child) {
  parent = normalize(parent);
  child = normalize(child);
  if (child === parent) return '';
  const pref = parent === '/' ? '/' : parent + '/';
  return child.startsWith(pref) ? child.slice(pref.length) : child.replace(/^\//, '');
}
