/**
 * Welcome Screen
 * ==============
 * OrcaSlicer-style startup: prominent actions, recent files, example projects.
 * Examples load via fetch() from public/examples/ — no Electron IPC needed.
 */

import React, { useState, useEffect } from 'react';
import { Plus, FolderOpen, Music2, Clock, ChevronRight, Sparkles } from 'lucide-react';
import { newProject, openProject } from '../../subsystems/project-io';
import { useProjectStore } from '../../store/project';

interface RecentFile { path: string; name: string; modified: string; }

const RECENT_KEY = 'melon_recent_projects';

export function getRecent(): RecentFile[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    // Sanitize: filter out corrupt entries where path/name are not plain strings
    // (caused by a previous bug that stored an object as the path argument)
    return (Array.isArray(raw) ? raw : []).filter(
      (r: any) => typeof r?.path === 'string' && typeof r?.name === 'string'
    );
  } catch { return []; }
}

export function addToRecent(path: string, name: string) {
  const list = getRecent().filter(r => r.path !== path);
  list.unshift({ path, name, modified: new Date().toISOString() });
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 12)));
}

const EXAMPLES = [
  { name: 'Demo Melody',        desc: 'C major scale · 128 BPM',          file: 'demo-melody.loid',      emoji: '🎵' },
  { name: 'Japanese Phrases',   desc: 'Hiragana vowel row drill',          file: 'japanese-phrases.loid', emoji: '🌸' },
  { name: 'Twinkle Twinkle',    desc: 'きらきら星 · 100 BPM · Teto',      file: 'twinkle-twinkle.loid',  emoji: '⭐' },
];

interface Props { onDismiss: () => void; }

export function WelcomeScreen({ onDismiss }: Props) {
  const [recent,  setRecent]  = useState<RecentFile[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const store = useProjectStore();

  useEffect(() => {
    // One-time cleanup: remove corrupt recent entries left by old bug
    const clean = getRecent(); // getRecent now sanitizes
    localStorage.setItem('melon_recent_projects', JSON.stringify(clean));
    setRecent(clean);
  }, []);

  const handleNew = () => {
    store.loadProject(newProject('untitled'));
    onDismiss();
  };

  const handleOpen = async () => {
    setLoading('open');
    const result = await openProject();
    setLoading(null);
    if (!result) return;
    const { project, path } = result as any;
    store.loadProject(project ?? result);  // compat: v2 returns {project,path}, v1 returned project
    if (path) store.setCurrentFilePath(path);
    if (path) addToRecent(path, (project ?? result)?.name ?? 'untitled');
    onDismiss();
    // Scroll piano roll to the first note
    setTimeout(() => {
      const wrap = document.querySelector('[data-piano-scroll]') as HTMLElement;
      if (wrap) {
        const notes = store.notes;
        if (notes.length > 0) {
          const firstBeat = Math.min(...notes.map(n => n.start));
          wrap.scrollLeft = Math.max(0, firstBeat * 84 - 100);
        }
      }
    }, 100);
  };

  const handleRecent = async (file: RecentFile) => {
    setLoading(file.path);
    try {
      const { loadFromPath } = await import('../../subsystems/project-io');
      const project = await loadFromPath(file.path);
      if (!project) throw new Error('Could not parse project file');
      store.loadProject(project);
      store.setCurrentFilePath(file.path);
      onDismiss();
    } catch {
      store.notify({ type: 'error', title: 'Could not open file', body: file.path });
      // Remove from recents if missing
      const updated = getRecent().filter(r => r.path !== file.path);
      localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
      setRecent(updated);
    } finally {
      setLoading(null);
    }
  };

  // Load example - try Electron readFile first, then fetch
  const handleExample = async (file: string) => {
    setLoading(file);
    try {
      let project: any = null;
      if ((window as any).app?.readFile) {
        // Try paths in order: public/examples/, examples/, then root
        for (const path of [`public/examples/${file}`, `examples/${file}`, file]) {
          try {
            const text = await (window as any).app.readFile(path);
            project = JSON.parse(text);
            if (project) break;
          } catch {}
        }
      }
      // Web/dev fallback: Vite serves public/ at root
      if (!project) {
        try {
          const r = await fetch(`/examples/${file}`);
          if (r.ok) project = await r.json();
        } catch {}
      }
      if (!project) throw new Error('Could not load example file');
      if (!project) throw new Error('Could not load example file');
      store.loadProject(project);
      onDismiss();
    } catch (e: any) {
      store.notify({ type: 'error', title: 'Could not load example', body: e.message });
    } finally {
      setLoading(null);
    }
  };

  const fmt = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 800,
      background: '#1C1B19',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      animation: 'fadeIn 200ms ease-out both',
      overflow: 'hidden',
    }}>
      {/* Background wallpaper */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'url(/welcome-bg.png)',
        backgroundSize: 'cover', backgroundPosition: 'center',
        opacity: 1.0, pointerEvents: 'none',
      }}/>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.25) 100%)',
        pointerEvents: 'none',
      }}/>

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* Logo + title */}
        <img src="/melon-logo.png" alt="Melon Synth" style={{
          width: 120, height: 120, objectFit: 'contain',
          marginBottom: 14, borderRadius: 28,
          boxShadow: '0 8px 32px rgba(77,191,144,0.30)',
        }}/>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 38, fontWeight: 600, color: 'var(--accent)', letterSpacing: '-0.03em', marginBottom: 4 }}>
            melon synth
          </div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            Open singing voice editor
          </div>
        </div>

        {/* Card */}
        <div style={{
          width: 600,
          background: 'rgba(255,255,255,0.93)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '0.5px solid rgba(255,255,255,0.7)',
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: '0 16px 48px rgba(0,0,0,0.10)',
        }}>

          {/* New / Open */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '0.5px solid var(--border-subtle)' }}>
            {[
              { label: 'New project', sub: 'Start from scratch', icon: Plus, accent: true, onClick: handleNew, id: 'new' },
              { label: 'Open project', sub: 'Load a .loid file', icon: FolderOpen, accent: false, onClick: handleOpen, id: 'open' },
            ].map(btn => {
              const Icon = btn.icon;
              return (
                <button key={btn.id} onClick={btn.onClick} disabled={loading === 'open' && btn.id === 'open'}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: 10, padding: '24px 20px',
                    background: 'transparent',
                    borderRight: btn.id === 'new' ? '0.5px solid var(--border-subtle)' : 'none',
                    cursor: 'pointer', transition: 'background var(--duration-fast)',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = btn.accent ? 'rgba(77,191,144,0.07)' : 'rgba(0,0,0,0.03)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{
                    width: 44, height: 44, borderRadius: 12,
                    background: btn.accent ? 'var(--accent-subtle)' : 'var(--bg-sunken)',
                    border: `1.5px solid ${btn.accent ? 'var(--accent)' : 'var(--border-default)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon size={20} style={{ color: btn.accent ? 'var(--accent)' : 'var(--text-secondary)' }}/>
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2 }}>{btn.label}</div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>{btn.sub}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Two-column layout below the action buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 160 }}>

            {/* Recent */}
            <div style={{ borderRight: '0.5px solid var(--border-subtle)' }}>
              <div style={{
                padding: '8px 16px', fontSize: 11, fontWeight: 500,
                color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase',
                borderBottom: '0.5px solid var(--border-subtle)',
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <Clock size={10}/> Recent
              </div>
              {recent.length === 0 ? (
                <div style={{ padding: '20px 16px', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', textAlign: 'center' }}>
                  No recent projects
                </div>
              ) : (
                <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                  {recent.map(f => (
                    <button key={f.path} onClick={() => handleRecent(f)} disabled={!!loading}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 16px',
                        background: loading === f.path ? 'var(--bg-sunken)' : 'transparent',
                        borderBottom: '0.5px solid var(--border-subtle)',
                        cursor: loading ? 'wait' : 'pointer', textAlign: 'left',
                        transition: 'background var(--duration-fast)',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-sunken)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <Music2 size={13} style={{ color: 'var(--accent)', flexShrink: 0 }}/>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</div>
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>{fmt(f.modified)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Examples */}
            <div>
              <div style={{
                padding: '8px 16px', fontSize: 11, fontWeight: 500,
                color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase',
                borderBottom: '0.5px solid var(--border-subtle)',
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <Sparkles size={10}/> Examples
              </div>
              {EXAMPLES.map(ex => (
                <button key={ex.file} onClick={() => handleExample(ex.file)}
                  disabled={loading === ex.file}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 16px',
                    background: loading === ex.file ? 'var(--bg-sunken)' : 'transparent',
                    borderBottom: '0.5px solid var(--border-subtle)',
                    cursor: 'pointer', textAlign: 'left',
                    transition: 'background var(--duration-fast)',
                    opacity: loading === ex.file ? 0.6 : 1,
                  }}
                  onMouseEnter={e => { if (loading !== ex.file) e.currentTarget.style.background = 'var(--bg-sunken)'; }}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{ex.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: 500 }}>{ex.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{ex.desc}</div>
                  </div>
                  <ChevronRight size={12} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}/>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 18, fontSize: 11, color: 'var(--text-tertiary)', display: 'flex', gap: 14, alignItems: 'center' }}>
          <span>Melon Synth v1.0.0 Alpha</span>
          <span style={{ opacity: 0.4 }}>·</span>
          {[
            { label: 'GitHub',      url: 'https://github.com/MilkmanAbi/Melon-Synth' },
            { label: 'Discord',     url: 'https://discord.gg/J9xwk3p9' },
            { label: 'Write addon', url: 'https://github.com/MilkmanAbi/Melon-Synth/blob/main/docs/WRITING_ADDONS.md' },
          ].map((l, i, arr) => (
            <React.Fragment key={l.label}>
              <a href={l.url} target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--accent)', fontSize: 11, textDecoration: 'none' }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                onClick={e => { e.preventDefault(); (window as any).app?.openURL?.(l.url); }}
              >
                {l.label}
              </a>
              {i < arr.length - 1 && <span style={{ opacity: 0.4 }}>·</span>}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
