/**
 * Substrate — tiny synchronous event bus with wildcard support.
 * Used for cross-subsystem signalling: 'fs:change', 'git:progress',
 * 'cache:evict', 'wasm:exit', etc. A frontend subscribes to drive its UI.
 */
export class EventBus {
  constructor() { this._h = new Map(); }

  /** Subscribe. Returns an unsubscribe fn. `event` may be '*' for everything. */
  on(event, handler) {
    if (!this._h.has(event)) this._h.set(event, new Set());
    this._h.get(event).add(handler);
    return () => this.off(event, handler);
  }

  once(event, handler) {
    const off = this.on(event, (...a) => { off(); handler(...a); });
    return off;
  }

  off(event, handler) {
    this._h.get(event)?.delete(handler);
  }

  emit(event, payload) {
    const direct = this._h.get(event);
    if (direct) for (const h of [...direct]) { try { h(payload, event); } catch (e) { console.error('[substrate] handler error', e); } }
    const star = this._h.get('*');
    if (star) for (const h of [...star]) { try { h(payload, event); } catch (e) { console.error('[substrate] handler error', e); } }
  }

  clear() { this._h.clear(); }
}
