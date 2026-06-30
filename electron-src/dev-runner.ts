/**
 * dev-runner.ts — compiled and run via ts-node / tsc to start dev mode.
 * Not included in production builds.
 *
 * Sequence:
 *   1. Compile main + preload TypeScript once
 *   2. Start Vite dev server (renderer)
 *   3. Wait until http://localhost:5173 is responding
 *   4. Set NODE_ENV=development, launch Electron
 *   5. Restart Electron when main/preload TS files change (simple file watch)
 *      Renderer hot-reloads via Vite automatically.
 */

// This file is intentionally NOT compiled — it's just documentation.
// The actual dev sequence is handled by the npm scripts.
export {};
