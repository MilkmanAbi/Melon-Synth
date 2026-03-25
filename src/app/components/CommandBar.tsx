/**
 * Command Bar
 * ===========
 * Replaces the menu bar entirely. Four menus max (design rule).
 * Every item does something. No "coming soon" labels.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Bell, ChevronDown } from 'lucide-react';
import { useProjectStore }   from '../../store/project';
import { saveProject, openProject, newProject, serializeProject } from '../../subsystems/project-io';
import { withLock } from '../../subsystems/async-lock';

interface Props {
  requireSave?:            (onProceed: () => void) => void;
  onOpenNotifications:     () => void;
  hasUnread:               boolean;
  onOpenPalette:           () => void;
  onOpenVoicebankManager?: () => void;
  onImportMidi?:           () => void;
  onOpenSettings?:         () => void;
  onOpenNoteProperties?:   () => void;
  onOpenMLC?:              () => void;
  canUndo?:  boolean;
  canRedo?:  boolean;
  onUndo?:   () => void;
  onRedo?:   () => void;
}

// ── Menu definitions ──────────────────────────────────────────────────────────

type MenuAction = () => void;

interface MenuItem {
  label:     string;
  shortcut?: string;
  danger?:   boolean;
  disabled?: boolean;
  sep?:      true;
  action?:   MenuAction;
  sub?:      MenuItem[];
}

// ── Dropdown component ────────────────────────────────────────────────────────

function Dropdown({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  // We use the parent ref to also check if the click was on the trigger button
  const parentRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    parentRef.current = ref.current?.parentElement as HTMLElement ?? null;
  });

  useEffect(() => {
    // Use pointerdown in capture phase — fires before React's onClick
    // so closing here doesn't conflict with the toggle button's own onClick
    const handler = (e: PointerEvent) => {
      const target = e.target as Node;
      // If click is inside the dropdown itself — let it handle it
      if (ref.current?.contains(target)) return;
      // If click is on the trigger button — let toggle() handle open/close
      if (parentRef.current?.contains(target)) return;
      // Otherwise: click outside, close
      onClose();
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', handler, true);
    document.addEventListener('keydown',     keyHandler);
    return () => {
      document.removeEventListener('pointerdown', handler, true);
      document.removeEventListener('keydown',     keyHandler);
    };
  }, [onClose]);

  return (
    <div ref={ref} style={{
      position:    'absolute',
      top:         '100%',
      left:        0,
      marginTop:   2,
      minWidth:    200,
      background:  'var(--bg-overlay)',
      border:      '0.5px solid var(--border-default)',
      borderRadius:'var(--radius-lg)',
      boxShadow:   '0 4px 20px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08)',
      padding:     '4px 0',
      zIndex:      600,
      animation:   'slideDown 100ms var(--ease-out) both',
    }}>
      {items.map((item, i) => {
        if (item.sep) return (
          <div key={i} style={{ height:'0.5px', background:'var(--border-subtle)', margin:'4px 0' }}/>
        );
        return (
          <button key={i}
            disabled={item.disabled}
            onClick={() => { item.action?.(); onClose(); }}
            style={{
              display:    'flex',
              alignItems: 'center',
              width:      '100%',
              height:     30,
              padding:    '0 var(--space-3)',
              fontSize:   'var(--text-base)',
              color:      item.danger    ? 'var(--danger)'
                        : item.disabled ? 'var(--text-disabled)'
                        : 'var(--text-primary)',
              background: 'transparent',
              cursor:     item.disabled ? 'default' : 'pointer',
              textAlign:  'left',
              transition: 'background var(--duration-fast)',
            }}
            onMouseEnter={e => {
              if (!item.disabled)
                e.currentTarget.style.background = item.danger ? 'var(--danger-subtle)' : 'var(--bg-sunken)';
            }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ flex: 1 }}>{item.label}</span>
            {item.shortcut && (
              <span style={{
                fontSize:   'var(--text-xs)',
                fontFamily: 'var(--font-mono)',
                color:      item.danger ? 'var(--danger)' : 'var(--text-tertiary)',
                marginLeft: 'var(--space-4)',
              }}>
                {item.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── CommandBar ────────────────────────────────────────────────────────────────

export function CommandBar({
  onOpenNotifications, hasUnread, onOpenPalette,
  onOpenVoicebankManager, onImportMidi, onOpenSettings, onOpenNoteProperties,
  onOpenMLC,
  canUndo, canRedo, onUndo, onRedo,
  requireSave,
}: Props) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const store = useProjectStore();

  const toggle = (name: string) =>
    setOpenMenu(prev => prev === name ? null : name);

  // Build menus with live store access
  const MENUS: Record<string, MenuItem[]> = {
    File: [
      {
        label: 'New project', shortcut: '⌘N',
        action: () => {
          const doNew = () => {
            store.loadProject(newProject());
            store.notify({ type:'success', title:'New project created' });
          };
          if (requireSave) requireSave(doNew); else doNew();
        },
      },
      {
        label: 'Open…', shortcut: '⌘O',
        action: () => withLock('file-dialog', async () => {
          const p = await openProject();
          if (!p) return;
          store.loadProject(p);
          store.notify({ type:'success', title:`Opened: ${p.name}` });
        }),
      },
      { label: 'Save', shortcut: '⌘S',
        action: () => withLock('file-dialog', async () => {
          const p = serializeProject(
            store.projectName, store.bpm, store.tracks, store.notes, store.pitchPoints
          );
          const path = await saveProject(p, store.currentFilePath ?? null);
          if (path) {
            store.setCurrentFilePath(path);
            store.setDirty(false);
            store.notify({ type:'success', title:'Project saved', body: path });
          }
        }),
      },
      { label: 'Save as…', shortcut: '⌘⇧S',
        action: () => withLock('file-dialog', async () => {
          const p = serializeProject(
            store.projectName, store.bpm, store.tracks, store.notes, store.pitchPoints
          );
          const path = await saveProject(p, null);
          if (path) {
            store.setCurrentFilePath(path);
            store.setDirty(false);
            store.notify({ type:'success', title:'Saved as', body: path });
          }
        }),
      },
      { sep: true },
      { label: 'Import MIDI…', shortcut: '⌘I',
        action: () => onImportMidi?.(),
      },
      { label: 'Export WAV…',
        action: () => withLock('render', async () => {
          if (!(window as any).app) {
            store.notify({ type:'info', title:'Export requires Electron', body:'Run npm run dev:electron' });
            return;
          }
          const outPath = await withLock('file-dialog', async () => {
            return await (window as any).app.exportWAV(store.projectName + '.wav');
          });
          if (!outPath) return;

          // Check we have notes and a voicebank
          const state = useProjectStore.getState();
          if (!state.notes.length) {
            store.notify({ type:'warning', title:'Nothing to export', body:'Draw some notes first!' });
            return;
          }
          const selectedTrack = state.tracks.find(t => t.selected);
          if (!selectedTrack?.voicePath) {
            store.notify({ type:'warning', title:'No voicebank selected',
              body:'Open the Voicebank Manager and pick a voice.' });
            return;
          }

          store.notify({ type:'info', title:'Exporting…', body:outPath, progress: 10 });

          try {
            // Run MLC conversion first
            const moduleId = selectedTrack.voiceBank?.toLowerCase().includes('miku') ? 'jp_cvvc_miku' : 'jp_cv_standard';
            const sorted = [...state.notes].sort((a,b) => a.start - b.start);

            // Render via the full pipeline
            const result = await (window as any).render.render({
              notes: sorted.map(n => ({
                id: n.id, pitch: n.pitch, start: n.start, duration: n.duration,
                lyric: n.lyric, phoneme: n.phoneme || n.lyric,
                expressions: n.expressions, vibrato: n.vibrato,
                pitchBend: n.pitchBend, flags: n.flags,
              })),
              voice_dir:      selectedTrack.voicePath,
              voicebank_path: selectedTrack.voicePath,
              tempo:          state.bpm,
              out_wav:        outPath,
              project_name:   state.projectName,
              track_params: {
                gender:      selectedTrack.gender      ?? 30,
                breathiness: selectedTrack.breathiness ?? 40,
                tension:     selectedTrack.tension     ?? 65,
                pitchRange:  selectedTrack.pitchRange  ?? 50,
              },
              pitch_points: state.pitchPoints,
            });

            if (result?.ok) {
              store.notify({ type:'success', title:'Exported!', body: outPath,
                action: { label: 'Open folder', onClick: () => {
                  const dir = outPath.replace(/[/\\][^/\\]+$/, '');
                  (window as any).app?.openPath?.(dir);
                }}
              });
            } else {
              store.notify({ type:'error', title:'Export failed', body: result?.error || 'Unknown error' });
            }
          } catch (e: any) {
            store.notify({ type:'error', title:'Export failed', body: e.message });
          }
        }),
      },
      { sep: true },
      { label: 'Manage voicebanks…',
        action: () => onOpenVoicebankManager?.(),
      },
    ],

    Edit: [
      { label: 'Undo', shortcut: '⌘Z',    disabled: !canUndo, action: onUndo },
      { label: 'Redo', shortcut: '⌘⇧Z',   disabled: !canRedo, action: onRedo },
      { sep: true },
      { label: 'Select all',  shortcut: '⌘A', action: () => store.selectAll() },
      { label: 'Deselect',    shortcut: 'Esc', action: () => store.deselectAll() },
      { sep: true },
      { label: 'Duplicate',   shortcut: '⌘D',
        action: () => {
          const sel = store.notes.filter(n => n.selected);
          if (!sel.length) return;
          // Duplicate with 1 beat offset
          store.duplicateSelected(1);
        },
      },
      { label: 'Delete selected', shortcut: 'Del', danger: true, action: () => store.deleteSelected() },
      { sep: true },
      { label: 'Quantize', shortcut: '⌘Q',
        action: () => store.quantizeSelected(),
      },
      { label: 'Transpose +1', shortcut: '⌘↑',
        action: () => store.transposeSelected(1),
      },
      { label: 'Transpose -1', shortcut: '⌘↓',
        action: () => store.transposeSelected(-1),
      },
      { label: 'Transpose +12 (octave)', shortcut: '⌘⇧↑',
        action: () => store.transposeSelected(12),
      },
      { label: 'Transpose -12 (octave)', shortcut: '⌘⇧↓',
        action: () => store.transposeSelected(-12),
      },
      { sep: true },
      { label: 'Humanize',
        action: () => store.humanizeSelected(50),
      },
      { label: 'Legato',
        action: () => store.legatoSelected(),
      },
      { label: 'Add vibrato',
        action: () => store.addVibratoToSelected(),
      },
      { label: 'Remove vibrato',
        action: () => store.removeVibratoFromSelected(),
      },
      { label: 'Merge notes', shortcut: '⌘M',
        action: () => store.mergeSelected(),
      },
    ],

    View: [
      { label: 'Toggle dark mode',    shortcut: '⌘⇧D', action: () => store.toggleDark() },
      { sep: true },
      { label: 'Lyrics Conversion (MLC)', shortcut: '⌘L',
        action: () => onOpenMLC?.(),
      },
      { label: 'Note properties', shortcut: '⌘P',
        action: () => onOpenNoteProperties?.(),
      },
      { sep: true },
      { label: 'Draw mode',   shortcut: 'N', action: () => store.setMode('draw')   },
      { label: 'Select mode', shortcut: 'S', action: () => store.setMode('select') },
      { label: 'Erase mode',  shortcut: 'E', action: () => store.setMode('erase')  },
      { label: 'Pitch mode',  shortcut: 'P', action: () => store.setMode('pitch')  },
      { sep: true },
      { label: `Snap: 1/4  ${store.snap==='1/4' ?'✓':''}`,  action: () => store.setSnap('1/4')  },
      { label: `Snap: 1/8  ${store.snap==='1/8' ?'✓':''}`,  action: () => store.setSnap('1/8')  },
      { label: `Snap: 1/16 ${store.snap==='1/16'?'✓':''}`, action: () => store.setSnap('1/16') },
      { label: `Snap: 1/32 ${store.snap==='1/32'?'✓':''}`, action: () => store.setSnap('1/32') },
      { sep: true },
      { label: 'Settings…', shortcut: '⌘,', action: () => onOpenSettings?.() },
      { sep: true },
      { label: 'Terminal (MTI)',     shortcut: '⌃`',
        action: () => document.dispatchEvent(new CustomEvent('open-mti')),
      },
    ],

    Extensions: [
      { label: 'MLC Addons',
        action: () => document.dispatchEvent(new CustomEvent('open-extensions')),
      },
      { label: 'App Extensions (.melon)',
        action: () => document.dispatchEvent(new CustomEvent('open-extensions')),
      },
      { sep: true },
      { label: 'Install from file…',
        action: () => document.dispatchEvent(new CustomEvent('open-extensions-install')),
      },
      { label: 'Pipeline debugger',
        action: () => document.dispatchEvent(new CustomEvent('open-extensions-debug')),
      },
      { sep: true },
      { label: 'Browse addon catalog',
        action: () => { const u = 'https://github.com/MilkmanAbi/Melon-Synth/discussions'; if ((window as any).app?.openURL) (window as any).app.openURL(u); else window.open(u,'_blank'); },
      },
      { label: 'Write an addon',
        action: () => { const u = 'https://github.com/MilkmanAbi/Melon-Synth/blob/main/docs/MLC_ADDON_API.md'; if ((window as any).app?.openURL) (window as any).app.openURL(u); else window.open(u,'_blank'); },
      },
    ],
    Help: [
      { label: 'Keyboard shortcuts', shortcut: '⌘/', action: () => onOpenSettings?.() },
      { label: 'MLC addon guide',
        action: () => window.open('https://github.com/MilkmanAbi/Melon-Synth/blob/main/docs/WRITING_ADDONS.md', '_blank'),
      },
      { sep: true },
      { label: 'Discord community',
        action: () => window.open('https://discord.gg/J9xwk3p9', '_blank'),
      },
      { label: 'Report a bug',
        action: () => { const u='https://github.com/MilkmanAbi/Melon-Synth/issues'; if((window as any).app?.openURL) (window as any).app.openURL(u); else window.open(u,'_blank'); },
      },
      { sep: true },
      { label: 'Extensions…',
        action: () => document.dispatchEvent(new CustomEvent('open-extensions')),
      },
      { label: 'About Melon Synth',
        action: () => document.dispatchEvent(new CustomEvent('open-about')),
      },
    ],
  };

  const selectedTrack = store.tracks.find(t => t.selected);

  return (
    <div style={{
      height:       40,
      flexShrink:   0,
      background:   'var(--bg-surface)',
      borderBottom: '0.5px solid var(--border-subtle)',
      display:      'flex',
      alignItems:   'center',
      justifyContent: 'space-between',
      padding:      '0 var(--space-4)',
      WebkitAppRegion: 'no-drag' as any,
    }}>

      {/* Left: wordmark + menus */}
      <div style={{ display:'flex', alignItems:'center', gap:2 }}>
        <button
          onClick={() => {
            const doWelcome = () => document.dispatchEvent(new CustomEvent('open-welcome'));
            if (requireSave) requireSave(doWelcome); else doWelcome();
          }}
          title="Back to welcome screen"
          style={{
            fontSize:14, fontWeight:600, color:'var(--accent)',
            letterSpacing:'-0.02em', marginRight:8,
            cursor:'pointer', padding:'2px 4px',
            borderRadius:'var(--radius-sm)',
            transition:'all var(--duration-fast)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background='var(--accent-subtle)'; }}
          onMouseLeave={e => { e.currentTarget.style.background='transparent'; }}
        >
          melon
        </button>

        {Object.entries(MENUS).map(([name, items]) => (
          <div key={name} style={{ position:'relative' }}>
            <button
              onClick={() => toggle(name)}
              style={{
                display:      'flex',
                alignItems:   'center',
                gap:          2,
                padding:      '4px var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                fontSize:     'var(--text-base)',
                color:        openMenu === name ? 'var(--text-primary)' : 'var(--text-secondary)',
                background:   openMenu === name ? 'var(--bg-sunken)'    : 'transparent',
                transition:   'all var(--duration-fast)',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={e => { if (openMenu !== name) e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              {name}
            </button>
            {openMenu === name && (
              <Dropdown items={items} onClose={() => setOpenMenu(null)} />
            )}
          </div>
        ))}
      </div>

      {/* Right: ⌘K, voice chip, bell, render */}
      <div style={{ display:'flex', alignItems:'center', gap:'var(--space-2)' }}>

        {/* ⌘K pill */}
        <button onClick={onOpenPalette} style={{
          display:'flex', alignItems:'center', gap:'var(--space-2)',
          height:26, padding:'0 var(--space-3)',
          background:   'var(--bg-sunken)',
          border:       '0.5px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          fontSize:     'var(--text-sm)',
          color:        'var(--text-tertiary)',
          fontFamily:   'var(--font-mono)',
          transition:   'border-color var(--duration-fast)',
        }}>
          ⌘K
        </button>

        {/* Current voice chip — clickable */}
        <button
          onClick={() => onOpenVoicebankManager?.()}
          title="Select voicebank"
          style={{
            height:26, padding:'0 var(--space-2)',
            background:   'var(--bg-sunken)',
            border:       '0.5px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            display:      'flex', alignItems:'center',
            fontSize:     'var(--text-sm)', color:'var(--text-secondary)',
            gap:          4, cursor:'pointer',
            transition:   'all var(--duration-fast)',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor='var(--accent)'; e.currentTarget.style.color='var(--text-primary)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border-subtle)'; e.currentTarget.style.color='var(--text-secondary)'; }}
        >
          <div style={{ width:6, height:6, borderRadius:'50%', background: selectedTrack?.voiceBank ? (selectedTrack?.color ?? 'var(--accent)') : 'var(--text-tertiary)' }}/>
          {selectedTrack?.voiceBank ? `${selectedTrack.voiceBank} · ${selectedTrack.engine ?? 'OpenUTAU'}` : 'Select voicebank'}
        </button>

        {/* Bell */}
        <button onClick={onOpenNotifications} style={{
          position:'relative', width:32, height:28,
          display:'flex', alignItems:'center', justifyContent:'center',
          color:        hasUnread ? 'var(--text-primary)' : 'var(--text-tertiary)',
          borderRadius: 'var(--radius-md)',
          transition:   'background var(--duration-fast)',
        }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-sunken)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <Bell size={15}/>
          {hasUnread && (
            <div style={{
              position:'absolute', top:6, right:6,
              width:6, height:6, borderRadius:'50%',
              background: 'var(--accent)',
              boxShadow:  '0 0 0 1.5px var(--bg-surface)',
            }}/>
          )}
        </button>

        {/* Render */}
        <button
          onClick={() => store.triggerRender?.()}
          style={{
            height:26, padding:'0 var(--space-3)',
            background:   'var(--accent)',
            borderRadius: 'var(--radius-md)',
            fontSize:     'var(--text-sm)', color:'white',
            fontWeight:   'var(--font-weight-medium)' as any,
            display:      'flex', alignItems:'center', gap:5,
            transition:   'background var(--duration-fast)',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--accent)')}
        >
          <div style={{ width:6, height:6, borderRadius:'50%', background:'rgba(255,255,255,0.8)' }}/>
          Render
        </button>
      </div>
    </div>
  );
}
