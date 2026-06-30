/**
 * Substrate — byte helpers. The canonical in-memory file payload is Uint8Array.
 * Text is UTF-8. These wrap the platform codecs with a few conveniences.
 */
const _enc = new TextEncoder();
const _dec = new TextDecoder('utf-8', { fatal: false });

/** string | Uint8Array | ArrayBuffer → Uint8Array (no copy when already bytes). */
export function toBytes(x) {
  if (x == null) return new Uint8Array(0);
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  if (typeof x === 'string') return _enc.encode(x);
  throw new TypeError('toBytes: unsupported value ' + typeof x);
}

/** bytes → utf-8 string. */
export function toText(x) {
  if (typeof x === 'string') return x;
  return _dec.decode(toBytes(x));
}

/** Concatenate a list of Uint8Arrays into one. */
export function concatBytes(chunks) {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

/** Constant-ish time-ish byte equality (used for cache integrity checks). */
export function bytesEqual(a, b) {
  if (a === b) return true;
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

const HEX = '0123456789abcdef';
export function toHex(bytes) {
  bytes = toBytes(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  return s;
}

/** base64 (standard, with padding) → Uint8Array. Tolerates url-safe and missing pad. */
export function fromBase64(b64) {
  b64 = String(b64).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64')); // node
}

export function toBase64(bytes) {
  bytes = toBytes(bytes);
  if (typeof btoa === 'function') {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  return Buffer.from(bytes).toString('base64'); // node
}

export { _enc as utf8Encoder, _dec as utf8Decoder };
