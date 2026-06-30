/**
 * Async Lock — Prevents concurrent execution of async operations
 * ===============================================================
 * Self-healing: locks auto-release after a timeout so a hung dialog or
 * failed IPC call can never permanently brick the UI.
 *
 * Lock categories and their timeouts:
 *   'file-dialog'      30s  — native open/save dialogs
 *   'render'          300s  — render pipeline (can be slow)
 *   'install'          60s  — addon install
 *   'addon-update'     30s  — check for updates
 *   'mlc-convert'      15s  — MLC engine call
 *   'mlc-suggest'      15s  — singability suggestion
 *   'vb-download-*'   120s  — voicebank download
 *   'remove-*'         30s  — addon removal
 *   'update-*'         60s  — addon update
 *   (default)          30s
 *
 * Why not just useState(loading)?
 *   React state updates are async and batched. Between setLoading(true) and
 *   the next render, another click can sneak through. A module-level Map is
 *   synchronous — checked on the same tick as the click event.
 */

const locks = new Map<string, boolean>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Timeout in ms per lock category */
function getTimeout(name: string): number {
  if (name === 'render')                 return 300_000;
  if (name.startsWith('vb-download'))    return 120_000;
  if (name.startsWith('update-'))        return 60_000;
  if (name === 'install')                return 60_000;
  if (name.startsWith('mlc-'))           return 15_000;
  return 30_000; // file-dialog, addon-update, remove-*, default
}

/**
 * Execute `fn` only if lock `name` is not held. Returns the fn's result,
 * or undefined if the lock was already held (call was skipped).
 *
 * The lock auto-releases after a timeout even if `fn` never resolves.
 * This prevents a hung dialog or failed IPC from bricking the UI forever.
 */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (locks.get(name)) return undefined;
  locks.set(name, true);

  // Safety net: release the lock after timeout no matter what
  const prev = timers.get(name);
  if (prev) clearTimeout(prev);
  timers.set(name, setTimeout(() => {
    locks.set(name, false);
    timers.delete(name);
  }, getTimeout(name)));

  try {
    return await fn();
  } finally {
    locks.set(name, false);
    const t = timers.get(name);
    if (t) { clearTimeout(t); timers.delete(name); }
  }
}

/**
 * Returns a wrapped version of `fn` that no-ops if lock `name` is held.
 */
export function asyncLock<T>(name: string, fn: () => Promise<T>): () => Promise<T | undefined> {
  return () => withLock(name, fn);
}

/** Check if a lock is currently held (for UI disabled states) */
export function isLocked(name: string): boolean {
  return locks.get(name) === true;
}
