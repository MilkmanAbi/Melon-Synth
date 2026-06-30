/**
 * Substrate — hashing + small concurrency primitives.
 */
import { toBytes, toHex, fromBase64, toBase64 } from './bytes.js';

/** SHA-256 → lowercase hex. Uses WebCrypto (browser + node 16+). */
export async function sha256Hex(data) {
  const buf = await crypto.subtle.digest('SHA-256', toBytes(data));
  return toHex(new Uint8Array(buf));
}

/** SHA-256 → standard base64 (matches jsDelivr's `hash` field exactly). */
export async function sha256Base64(data) {
  const buf = await crypto.subtle.digest('SHA-256', toBytes(data));
  return toBase64(new Uint8Array(buf));
}

/** Convert jsDelivr-style base64 sha256 into our hex object-key form. */
export function b64HashToHex(b64) {
  return toHex(fromBase64(b64));
}

/** A promise you can resolve/reject from the outside. */
export function defer() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Async mutex. `await lock.acquire()` → release fn. Serialises critical sections. */
export class Mutex {
  constructor() { this._tail = Promise.resolve(); }
  async acquire() {
    let release;
    const next = new Promise(res => { release = res; });
    const prev = this._tail;
    this._tail = this._tail.then(() => next);
    await prev;
    return release;
  }
  /** Run `fn` while holding the lock. */
  async run(fn) {
    const release = await this.acquire();
    try { return await fn(); } finally { release(); }
  }
}

/**
 * Run `tasks` (array of () => Promise) with bounded concurrency.
 * Returns results in input order. Used by the git client to fan out file
 * fetches without hammering the CDN with thousands of parallel requests.
 */
export async function pool(tasks, limit = 8, onSettle) {
  const results = new Array(tasks.length);
  let i = 0;
  const workers = new Array(Math.min(limit, tasks.length)).fill(0).map(async () => {
    while (i < tasks.length) {
      const idx = i++;
      try { results[idx] = await tasks[idx](); }
      catch (e) { results[idx] = { __error: e }; }
      if (onSettle) onSettle(idx, results[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}
