/**
 * Substrate — Fetcher: the one place network access happens.
 *
 * Wraps global fetch with: bounded retries + backoff, abort, streaming download
 * progress, an optional CORS proxy (for transports that lack permissive CORS),
 * and conditional requests (ETag). Everything above (git, modules) goes through
 * here so a frontend can throttle, log, or kill all I/O from a single chokepoint.
 */
import { concatBytes } from '../util/bytes.js';
import { NetError } from '../core/errors.js';

export class Fetcher {
  constructor({ corsProxy = '', retries = 2, retryDelayMs = 250, timeoutMs = 30000, bus = null } = {}) {
    this.corsProxy = corsProxy;
    this.retries = retries;
    this.retryDelayMs = retryDelayMs;
    this.timeoutMs = timeoutMs;
    this._bus = bus;
    this._active = new Set();
  }

  _proxied(url, useProxy) {
    if (!useProxy || !this.corsProxy) return url;
    // Two common proxy shapes: prefix-style and ?url= style.
    return this.corsProxy.includes('{url}')
      ? this.corsProxy.replace('{url}', encodeURIComponent(url))
      : this.corsProxy + url;
  }

  /**
   * Fetch with retries. Returns a rich result; never throws on non-2xx unless
   * `throwOnError` — instead surfaces {ok:false,status}. Network/abort still throw.
   *
   * opts: { method, headers, body, signal, useProxy, onProgress, etag, throwOnError, as }
   *   as: 'bytes' (default) | 'text' | 'json' | 'response'
   */
  async fetch(url, opts = {}) {
    const { method = 'GET', headers = {}, body, signal, useProxy = false,
            onProgress, etag, throwOnError = false, as = 'bytes' } = opts;
    const target = this._proxied(url, useProxy);
    const reqHeaders = { ...headers };
    if (etag) reqHeaders['If-None-Match'] = etag;

    let lastErr;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const ctl = new AbortController();
      const onAbort = () => ctl.abort();
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      const timer = this.timeoutMs ? setTimeout(() => ctl.abort(new NetError('timeout', { url })), this.timeoutMs) : null;
      this._active.add(ctl);
      try {
        const resp = await fetch(target, { method, headers: reqHeaders, body, signal: ctl.signal });
        if (resp.status === 304) return { ok: true, status: 304, notModified: true, url, etag, bytes: null, text: null };
        if (!resp.ok) {
          if (resp.status >= 500 && attempt < this.retries) { lastErr = new NetError(`HTTP ${resp.status}`, { url, status: resp.status }); await this._backoff(attempt); continue; }
          if (throwOnError) throw new NetError(`HTTP ${resp.status} for ${url}`, { url, status: resp.status });
          return { ok: false, status: resp.status, statusText: resp.statusText, url: resp.url };
        }
        const newEtag = resp.headers.get('etag') || null;
        const ctype = resp.headers.get('content-type') || '';
        if (as === 'response') return { ok: true, status: resp.status, response: resp, etag: newEtag, contentType: ctype, url: resp.url };

        const bytes = await this._readBody(resp, onProgress);
        const result = { ok: true, status: resp.status, url: resp.url, etag: newEtag, contentType: ctype, bytes, size: bytes.byteLength };
        if (as === 'text') result.text = new TextDecoder().decode(bytes);
        if (as === 'json') { result.text = new TextDecoder().decode(bytes); try { result.json = JSON.parse(result.text); } catch (e) { throw new NetError('invalid JSON from ' + url, { url, cause: e }); } }
        return result;
      } catch (e) {
        if (e?.name === 'AbortError' && !(signal && signal.aborted)) { lastErr = new NetError('request timed out', { url }); }
        else if (signal && signal.aborted) { throw new NetError('request aborted', { url }); }
        else lastErr = e;
        if (attempt < this.retries && this._retryable(e)) { await this._backoff(attempt); continue; }
        throw lastErr instanceof NetError ? lastErr : new NetError(`fetch failed: ${lastErr?.message || lastErr}`, { url, cause: lastErr });
      } finally {
        this._active.delete(ctl);
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    }
    throw lastErr;
  }

  async _readBody(resp, onProgress) {
    const total = Number(resp.headers.get('content-length')) || 0;
    if (!onProgress || !resp.body || !resp.body.getReader) return new Uint8Array(await resp.arrayBuffer());
    const reader = resp.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      try { onProgress({ loaded, total }); } catch {}
    }
    return concatBytes(chunks);
  }

  _retryable(e) {
    const m = String(e?.message || '').toLowerCase();
    return m.includes('network') || m.includes('failed') || m.includes('timeout') || e instanceof NetError;
  }
  _backoff(attempt) { return new Promise(r => setTimeout(r, this.retryDelayMs * Math.pow(2, attempt))); }

  /** Cancel every in-flight request. */
  abortAll() { for (const c of this._active) c.abort(); this._active.clear(); }
}
