/**
 * AddonPanelHost
 * ==============
 * Mounts registered .melon addon panels in the correct layout zones.
 * Loaded panels are React components that come from addon bundles.
 *
 * The host injects the MelonAddonAPI as a prop and as window.melonAddon
 * so both prop-based and global access work for addon developers.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useProjectStore } from '../store/project';
import type { MelonAddonAPI, LayoutZone } from './melon-addon-types';

export interface RegisteredPanel {
  addon_id:    string;
  addon_name:  string;
  id:          string;
  display_name:string;
  icon?:       string;
  requested_zone: LayoutZone;
  fallback_zone?: LayoutZone;
  component:   string;          // export name in the addon bundle
  entry_path:  string;          // absolute path to addon's index.js
  default_visible?: boolean;
  resizable?:  boolean;
  collapsible?:boolean;
}

interface Props {
  zone:      LayoutZone;
  className?: string;
  style?:    React.CSSProperties;
}

// Expose React globally so addon scripts can use window.React.createElement
if (typeof window !== 'undefined') {
  (window as any).React    = React;
  (window as any).ReactDOM = { version: React.version };
}

export function AddonPanelHost({ zone, className, style }: Props) {
  const [panels,     setPanels]     = useState<RegisteredPanel[]>([]);
  const [components, setComponents] = useState<Record<string, React.ComponentType<any>>>({});

  const store = useProjectStore();

  // Build the API object that gets injected into every addon panel
  const buildAPI = useCallback((): MelonAddonAPI => ({
    project: {
      getNotes:            () => useProjectStore.getState().notes,
      getTracks:           () => useProjectStore.getState().tracks,
      getBpm:              () => useProjectStore.getState().bpm,
      getTimeSignature:    () => '4/4',
      getProjectName:      () => useProjectStore.getState().projectName,
      getPlayheadPosition: () => useProjectStore.getState().playheadPosition,
      getSelectedNotes:    () => useProjectStore.getState().notes.filter(n => n.selected),

      addNote:    async (note) => { return useProjectStore.getState().addNote(note as any); },
      addNotes:   async (notes) => notes.map(n => useProjectStore.getState().addNote(n as any)),
      updateNote: async (id, patch) => useProjectStore.getState().updateNote(id, patch),
      deleteNote: async (id) => useProjectStore.getState().deleteNote(id),
      deleteNotes:async (ids) => ids.forEach(id => useProjectStore.getState().deleteNote(id)),
      selectNotes:async (ids) => ids.forEach(id => useProjectStore.getState().selectNote(id, true)),
      deselectAll:async () => useProjectStore.getState().deselectAll(),
      setLyric:   async (id, lyric) => useProjectStore.getState().setLyric(id, lyric),
      setBpm:     async (bpm) => useProjectStore.getState().setBpm(bpm),
      on: (event, cb) => {
        // Simplified: subscribe to store changes
        const unsub = useProjectStore.subscribe(cb);
        return unsub;
      },
    },

    mlc: {
      convert:            (params) => (window as any).mlc?.convert(params) ?? Promise.reject('MLC not available'),
      listModules:        ()       => (window as any).mlc?.listModules() ?? Promise.resolve([]),
      detectLanguage:     (text)   => (window as any).mlc?.detectLanguage(text) ?? Promise.resolve('en'),
      suggestSingability: (params) => (window as any).mlc?.suggestSingability(params) ?? Promise.resolve({suggested:0.65}),
    },

    audio: {
      startMicCapture: async () => navigator.mediaDevices.getUserMedia({ audio: true }),
      stopMicCapture:  async () => {},
      getAnalyserNode: ()    => null,
      playNote:        (pitch, dur, vel) => {},
      stopAllNotes:    ()    => {},
      isPlaying:       ()    => useProjectStore.getState().isPlaying,
    },

    ui: {
      notify: (n) => useProjectStore.getState().notify(n),
      showProgress: (label, pct) => {},
      hideProgress: () => {},
      openPanel:  (id) => {},
      closePanel: (id) => {},
      getTheme: () => useProjectStore.getState().isDark ? 'dark' : 'light',
      onThemeChange: (cb) => {
        const unsub = useProjectStore.subscribe(
          (state, prev) => { if (state.isDark !== prev.isDark) cb(state.isDark ? 'dark' : 'light'); }
        );
        return unsub;
      },
      getToken: (name) => getComputedStyle(document.documentElement).getPropertyValue(name),
      tokens:   {},
    },

    commands: {
      register:     (id, handler) => {},
      unregister:   (id) => {},
      execute:      async (id) => {},
      isRegistered: (id) => false,
    },

    storage: {
      get:            async (key)       => {
        const data = await (window as any).app?.getAddonStorage?.(zone) ?? {};
        return data[key] ?? null;
      },
      set:            async (key, val)  => {},
      delete:         async (key)       => {},
      keys:           async ()          => [],
      getProjectData: async (key)       => null,
      setProjectData: async (key, val)  => {},
    },

    addon: { id: '', version: '', name: '', dataDir: '', manifest: null as any },
  }), []);

  // Load registered panels for this zone from main process
  useEffect(() => {
    const loadPanels = async () => {
      try {
        const allPanels: RegisteredPanel[] = await (window as any).melonAddons?.getPanels() ?? [];
        const zonePanels = allPanels.filter(p =>
          p.requested_zone === zone || p.fallback_zone === zone
        );
        setPanels(zonePanels);

        // Dynamically load each addon's JS bundle
        for (const panel of zonePanels) {
          try {
            // In production Electron, we load from the extracted addon path via protocol
            // In dev, we can use dynamic import or script injection
            const mod = await loadAddonBundle(panel.entry_path);
            const ComponentClass = mod[panel.component] || mod.default;
            if (ComponentClass) {
              setComponents(prev => ({ ...prev, [panel.id]: ComponentClass }));
            }
          } catch (e) {
            console.error(`Failed to load addon panel ${panel.id}:`, e);
          }
        }
      } catch (e) {
        console.error('Failed to load addon panels:', e);
      }
    };
    loadPanels();
  }, [zone]);

  if (panels.length === 0) return null;

  const api = buildAPI();

  return (
    <div className={className} style={style}>
      {panels.map(panel => {
        const Component = components[panel.id];
        if (!Component) {
          return (
            <div key={panel.id} style={{ padding: 8, fontSize: 11,
                                          color: 'var(--text-tertiary)' }}>
              Loading {panel.display_name}…
            </div>
          );
        }
        return (
          <AddonPanelWrapper key={panel.id} panel={panel}>
            <Component melonAPI={api} />
          </AddonPanelWrapper>
        );
      })}
    </div>
  );
}

// ── Panel wrapper — handles collapse, resize ─────────────────────────────────

function AddonPanelWrapper({ panel, children }: { panel: RegisteredPanel; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={{ borderTop: '0.5px solid var(--border-subtle)' }}>
      {panel.collapsible && (
        <div
          onClick={() => setCollapsed(c => !c)}
          style={{ display: 'flex', alignItems: 'center', padding: '6px 10px',
                   cursor: 'pointer', userSelect: 'none',
                   fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
                   background: 'var(--bg-sunken)' }}
        >
          <span style={{ marginRight: 6, transform: collapsed ? 'rotate(-90deg)' : '',
                         transition: 'transform 150ms' }}>▾</span>
          {panel.display_name}
        </div>
      )}
      {!collapsed && (
        <div style={{ overflow: 'hidden' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Addon bundle loader ──────────────────────────────────────────────────────

async function loadAddonBundle(entryPath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    // Use a well-known scratchpad — addon scripts write here, we read it after load
    (window as any).__MELON_ADDON_EXPORTS__ = {};

    const script = document.createElement('script');
    script.onerror = () => reject(new Error(`Failed to load addon: ${entryPath}`));
    script.onload  = () => {
      const exports = (window as any).__MELON_ADDON_EXPORTS__ ?? {};
      (window as any).__MELON_ADDON_EXPORTS__ = {};  // clear for next load
      resolve(exports);
    };

    const isDev = !(window as any).__MELON_PACKAGED__;
    script.src = isDev
      ? `file://${entryPath.replace(/\\/g, '/')}`
      : `melon-addon://${entryPath}`;
    document.head.appendChild(script);
  });
}
