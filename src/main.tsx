import React from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/tokens.css";
import "./styles/index.css";

// ── Top-level error boundary ─────────────────────────────────────────────────
// Catches any render crash and shows a readable error instead of blank white.
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh',
          background: '#1C1B19', color: '#F8F7F4',
          fontFamily: 'system-ui, sans-serif', padding: 40, gap: 16,
        }}>
          <div style={{ fontSize: 32 }}>🍈</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Melon Synth crashed on startup</div>
          <pre style={{
            background: '#2A2927', padding: '16px 20px', borderRadius: 8,
            fontSize: 12, color: '#E8607A', maxWidth: 700, overflow: 'auto',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {error.message}{'\n\n'}{error.stack}
          </pre>
          <div style={{ fontSize: 13, color: '#9A9590' }}>
            Press F12 → Console for more detail. Report this at github.com/MilkmanAbi/Melon-Synth/issues
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 20px', borderRadius: 6, background: '#3D9E78',
              color: 'white', border: 'none', fontSize: 13, cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Global error handler catches crashes outside React's boundary
window.onerror = (msg, src, line, col, err) => {
  console.error('[MelonSynth] Unhandled error:', msg, src, line, col, err);
};
window.onunhandledrejection = (e) => {
  console.error('[MelonSynth] Unhandled promise rejection:', e.reason);
};

import { bootMelonPlatform } from "./platform/substrate-host";

// Boot the in-browser backend (Substrate) before React mounts so that
// window.app / window.voicebanks / window.render / window.mlc exist by the time
// any component checks for them. This is what turns the web build into the full
// app instead of the degraded fallback.
//
// We never let boot block the UI forever: it is raced against a timeout, and
// any failure is swallowed, so the app always renders. Worst case it comes up
// in degraded mode rather than showing a blank screen.
const bootTimeout = new Promise<void>(resolve => setTimeout(resolve, 8000));

function mount() {
  createRoot(document.getElementById("root")!).render(
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  );
}

Promise.race([
  bootMelonPlatform().then(() => undefined),
  bootTimeout,
])
  .catch(err => console.error("[MelonSynth] platform boot failed:", err))
  .finally(mount);
