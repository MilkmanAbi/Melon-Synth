/**
 * Melon Synth - browser ZIP codec.
 *
 * UTAU voicebanks, .loid v2 projects, and .melon/.mlc addon bundles are all
 * ZIP archives. Electron used adm-zip in the main process; in the browser we
 * read and write archives with the platform's own (De)CompressionStream, so
 * there is no dependency and it runs the same in Node for tests.
 *
 * Supports store (method 0) and deflate (method 8). ZIP64 and encryption are
 * not supported (UTAU banks do not use them); a clear error is thrown if seen.
 */

const SIG_LOCAL = 0x04034b50;
const SIG_CEN = 0x02014b50;
const SIG_EOCD = 0x06054b50;

// ── CRC32 ─────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── (de)compression via platform streams ───────────────────────────────────────
async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  return streamThrough(bytes, ds);
}
async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  return streamThrough(bytes, cs);
}
async function streamThrough(bytes: Uint8Array, transform: any): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  writer.write(bytes); writer.close();
  const reader = transform.readable.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); total += value.length;
  }
  const out = new Uint8Array(total); let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

const utf8 = { enc: new TextEncoder(), dec: new TextDecoder() };

/**
 * Read a ZIP archive into a map of path -> bytes. Directory entries are skipped.
 */
export async function readZip(input: Uint8Array | ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const buf = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // locate End Of Central Directory (scan backwards; comment max 65535)
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP archive (no EOCD)');

  const entryCount = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);          // central dir offset
  if (p === 0xffffffff) throw new Error('ZIP64 archives are not supported');

  const out = new Map<string, Uint8Array>();
  for (let e = 0; e < entryCount; e++) {
    if (dv.getUint32(p, true) !== SIG_CEN) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const flags = dv.getUint16(p + 8, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = utf8.dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) throw new Error(`encrypted ZIP entry not supported: ${name}`);
    if (name.endsWith('/')) continue;             // directory

    // jump to local header to find the actual data start
    if (dv.getUint32(localOff, true) !== SIG_LOCAL) continue;
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);

    let data: Uint8Array;
    if (method === 0) data = comp.slice();
    else if (method === 8) data = await inflateRaw(comp);
    else throw new Error(`unsupported ZIP compression method ${method} for ${name}`);

    out.set(normalizeZipName(name), data);
  }
  return out;
}

/**
 * Write a map of path -> (bytes | string) into a ZIP archive. Deflates by
 * default; pass store=true to skip compression.
 */
export async function writeZip(
  files: Map<string, Uint8Array | string> | Record<string, Uint8Array | string>,
  { store = false }: { store?: boolean } = {},
): Promise<Uint8Array> {
  const entries = files instanceof Map ? [...files.entries()] : Object.entries(files);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const [rawName, rawData] of entries) {
    const name = normalizeZipName(rawName);
    const nameBytes = utf8.enc.encode(name);
    const raw = typeof rawData === 'string' ? utf8.enc.encode(rawData) : rawData;
    const crc = crc32(raw);
    let method = 0, body = raw;
    if (!store) {
      const def = await deflateRaw(raw);
      if (def.length < raw.length) { method = 8; body = def; }
    }

    const local = new Uint8Array(30 + nameBytes.length + body.length);
    const ldv = new DataView(local.buffer);
    ldv.setUint32(0, SIG_LOCAL, true);
    ldv.setUint16(4, 20, true);            // version needed
    ldv.setUint16(6, 0x800, true);         // flags: UTF-8 names
    ldv.setUint16(8, method, true);
    ldv.setUint16(10, 0, true);            // mod time
    ldv.setUint16(12, 0, true);            // mod date
    ldv.setUint32(14, crc, true);
    ldv.setUint32(18, body.length, true);  // compressed size
    ldv.setUint32(22, raw.length, true);   // uncompressed size
    ldv.setUint16(26, nameBytes.length, true);
    ldv.setUint16(28, 0, true);            // extra len
    local.set(nameBytes, 30);
    local.set(body, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(central.buffer);
    cdv.setUint32(0, SIG_CEN, true);
    cdv.setUint16(4, 20, true);            // version made by
    cdv.setUint16(6, 20, true);            // version needed
    cdv.setUint16(8, 0x800, true);         // flags
    cdv.setUint16(10, method, true);
    cdv.setUint16(12, 0, true);
    cdv.setUint16(14, 0, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, body.length, true);
    cdv.setUint32(24, raw.length, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint32(42, offset, true);       // local header offset
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const cdOffset = offset;
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, SIG_EOCD, true);
  edv.setUint16(8, entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, cdSize, true);
  edv.setUint32(16, cdOffset, true);

  const total = offset + cdSize + 22;
  const out = new Uint8Array(total); let o = 0;
  for (const l of locals) { out.set(l, o); o += l.length; }
  for (const c of centrals) { out.set(c, o); o += c.length; }
  out.set(eocd, o);
  return out;
}

/** Normalise separators and strip a leading ./ ; keep forward slashes. */
function normalizeZipName(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\.\//, '');
}

export { crc32 };
