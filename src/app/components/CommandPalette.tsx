/**
 * Command Palette — ⌘K
 * ====================
 * Fuzzy-search over every command in the app.
 * Dismisses on Escape or click outside.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, FileText, Edit2, Music2, Settings, Layers, Mic2,
         ChevronRight, Loader2 } from 'lucide-react';
import { useProjectStore } from '../../store/project';

interface Command {
  id:       string;
  label:    string;
  category: string;
  shortcut?: string;
  icon?:    React.ReactNode;
  action:   () => void;
}

interface Props { onClose: () => void; }

// Simple fuzzy match — returns score (higher = better match)
function fuzzy(query: string, target: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.includes(q)) return 10 + (t.startsWith(q) ? 5 : 0) + (1 / t.length);
  let qi = 0, score = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) { score++; qi++; }
  }
  return qi === q.length ? score / q.length : 0;
}

export function CommandPalette({ onClose }: Props) {
  const [query, setQuery]   = useState('');
  const [sel,   setSel]     = useState(0);
  const inputRef            = useRef<HTMLInputElement>(null);
  const listRef             = useRef<HTMLDivElement>(null);
  const store               = useProjectStore();

  // Build all commands from current store state
  const commands = useMemo((): Command[] => [
    // File
    { id:'new',          label:'New project',           category:'File', shortcut:'⌘N',
      icon:<FileText size={13}/>,
      action: () => { store.loadProject({ version:'1.0', name:'untitled', bpm:120, timeSig:[4,4], tracks:store.tracks, notes:[], pitchPoints:[], createdAt:new Date().toISOString(), modifiedAt:new Date().toISOString() } as any); }},
    { id:'open',         label:'Open project…',         category:'File', shortcut:'⌘O',  icon:<FileText size={13}/>, action: async () => { const {openProject} = await import('../../subsystems/project-io'); const p = await openProject(); if (p) store.loadProject(p); }},
    { id:'save',         label:'Save project',          category:'File', shortcut:'⌘S',  icon:<FileText size={13}/>, action: async () => { const {saveProject,serializeProject} = await import('../../subsystems/project-io'); const p = serializeProject(store.projectName,store.bpm,store.tracks,store.notes,store.pitchPoints); await saveProject(p, store.currentFilePath??null); store.setDirty(false); }},
    // Edit
    { id:'undo',         label:'Undo',                  category:'Edit', shortcut:'⌘Z',  action:()=>store.undo()    },
    { id:'redo',         label:'Redo',                  category:'Edit', shortcut:'⌘⇧Z', action:()=>store.redo()    },
    { id:'copy',         label:'Copy selected notes',   category:'Edit', shortcut:'⌘C',  action:()=>store.copySelected()  },
    { id:'paste',        label:'Paste notes',           category:'Edit', shortcut:'⌘V',  action:()=>store.pasteNotes()    },
    { id:'selectall',    label:'Select all notes',      category:'Edit', shortcut:'⌘A',  action:()=>store.selectAll()     },
    { id:'delete',       label:'Delete selected',       category:'Edit', shortcut:'Del', action:()=>store.deleteSelected()},
    { id:'deselect',     label:'Deselect all',          category:'Edit', shortcut:'Esc', action:()=>store.deselectAll()   },
    { id:'quantize',     label:'Quantize selected',     category:'Edit',                  action:()=>store.quantizeSelected()  },
    { id:'legato',       label:'Legato (fill gaps)',     category:'Edit',                  action:()=>store.legatoSelected()    },
    { id:'transpose+1',  label:'Transpose +1 semitone', category:'Edit', shortcut:'↑',   action:()=>store.transposeSelected(1)  },
    { id:'transpose-1',  label:'Transpose -1 semitone', category:'Edit', shortcut:'↓',   action:()=>store.transposeSelected(-1) },
    { id:'transpose+12', label:'Transpose +1 octave',   category:'Edit', shortcut:'⇧↑',  action:()=>store.transposeSelected(12)  },
    { id:'transpose-12', label:'Transpose -1 octave',   category:'Edit', shortcut:'⇧↓',  action:()=>store.transposeSelected(-12) },
    // Tools
    { id:'mode-draw',   label:'Draw mode',    category:'Tools', shortcut:'N', icon:<Edit2 size={13}/>,   action:()=>store.setMode('draw')   },
    { id:'mode-select', label:'Select mode',  category:'Tools', shortcut:'S', icon:<ChevronRight size={13}/>, action:()=>store.setMode('select') },
    { id:'mode-erase',  label:'Erase mode',   category:'Tools', shortcut:'E', action:()=>store.setMode('erase')  },
    { id:'mode-pitch',  label:'Pitch mode',   category:'Tools', shortcut:'P', action:()=>store.setMode('pitch')  },
    // Snap
    { id:'snap-1/4',   label:'Snap 1/4 beat',  category:'Tools', action:()=>store.setSnap('1/4')  },
    { id:'snap-1/8',   label:'Snap 1/8 beat',  category:'Tools', action:()=>store.setSnap('1/8')  },
    { id:'snap-1/16',  label:'Snap 1/16 beat', category:'Tools', action:()=>store.setSnap('1/16') },
    { id:'snap-1/32',  label:'Snap 1/32 beat', category:'Tools', action:()=>store.setSnap('1/32') },
    // View
    { id:'theme',       label:store.isDark ? 'Switch to light mode' : 'Switch to dark mode',
      category:'View', shortcut:'⌘⇧D', icon:<Layers size={13}/>, action:()=>store.toggleDark() },
    // MLC
    { id:'mlc',         label:'Open Lyric Conversion (MLC)',  category:'MLC', icon:<Mic2 size={13}/>, action:()=>{ onClose(); setTimeout(()=>document.dispatchEvent(new CustomEvent('open-mlc')),10); }},
    { id:'mlc-apply',   label:'Apply MLC to all notes',        category:'MLC', action:async()=>{ /* dispatch */ }},
    // Voice
    { id:'add-track',   label:'Add voice track', category:'Voice', icon:<Music2 size={13}/>, action:()=>store.addTrack() },
    // Transport shortcuts
    { id:'stop',        label:'Stop playback', category:'Transport', shortcut:'.', action:()=>{ store.setPlaying(false); store.setPlayhead(0); }},
    { id:'bpm-up',      label:'BPM +1',        category:'Transport', action:()=>store.setBpm(Math.min(300,store.bpm+1)) },
    { id:'bpm-down',    label:'BPM -1',        category:'Transport', action:()=>store.setBpm(Math.max(20,store.bpm-1))  },
    // Settings
    { id:'settings',    label:'Open settings', category:'App', shortcut:'⌘,', icon:<Settings size={13}/>, action:()=>{ onClose(); setTimeout(()=>document.dispatchEvent(new CustomEvent('open-settings')),10); }},
  ], [store]);

  const results = useMemo(() => {
    if (!query.trim()) return commands.slice(0, 12);
    return commands
      .map(cmd => ({ cmd, score: fuzzy(query, cmd.label) + fuzzy(query, cmd.category) * 0.5 }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map(({ cmd }) => cmd);
  }, [query, commands]);

  useEffect(() => { setSel(0); }, [results]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runCommand = useCallback((cmd: Command) => {
    onClose();
    setTimeout(() => cmd.action(), 10);
  }, [onClose]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape')    { e.preventDefault(); onClose(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, results.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
    if (e.key === 'Enter')     { e.preventDefault(); if (results[sel]) runCommand(results[sel]); }
  }, [results, sel, onClose, runCommand]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[sel] as HTMLElement;
    el?.scrollIntoView({ block:'nearest' });
  }, [sel]);

  // Group results by category
  const grouped = results.reduce((acc, cmd) => {
    (acc[cmd.category] ??= []).push(cmd);
    return acc;
  }, {} as Record<string, Command[]>);

  return (
    <div
      style={{ position:'fixed', inset:0, zIndex:900, background:'rgba(0,0,0,0.3)',
               display:'flex', alignItems:'flex-start', justifyContent:'center', paddingTop:80 }}
      onClick={onClose}
    >
      <div
        style={{
          width:560, maxHeight:440,
          background:'var(--bg-overlay)',
          border:'0.5px solid var(--border-default)',
          borderRadius:'var(--radius-xl)',
          boxShadow:'0 16px 48px rgba(0,0,0,0.20)',
          overflow:'hidden',
          display:'flex', flexDirection:'column',
          animation:'slideDown 150ms var(--ease-out) both',
        }}
        onClick={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {/* Search input */}
        <div style={{ display:'flex', alignItems:'center', gap:'var(--space-3)',
                      padding:'0 var(--space-4)', height:48, flexShrink:0,
                      borderBottom:'0.5px solid var(--border-subtle)' }}>
          <Search size={15} style={{ color:'var(--text-tertiary)', flexShrink:0 }}/>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search commands…"
            style={{
              flex:1, background:'transparent', border:'none', outline:'none',
              fontSize:'var(--text-base)', color:'var(--text-primary)',
              fontFamily:'var(--font-ui)',
            }}
          />
          {query && (
            <button onClick={() => setQuery('')} style={{ color:'var(--text-tertiary)', fontSize:'var(--text-xs)' }}>
              clear
            </button>
          )}
        </div>

        {/* Results */}
        <div ref={listRef} style={{ overflowY:'auto', flex:1, padding:'var(--space-1) 0' }}>
          {results.length === 0 ? (
            <div style={{ padding:'var(--space-6)', textAlign:'center',
                          fontSize:'var(--text-sm)', color:'var(--text-tertiary)' }}>
              No commands found
            </div>
          ) : (
            Object.entries(grouped).map(([cat, cmds]) => (
              <div key={cat}>
                <div style={{ padding:'4px var(--space-4) 2px',
                              fontSize:'var(--text-xs)', color:'var(--text-tertiary)',
                              fontWeight:500, letterSpacing:'0.06em', textTransform:'uppercase' }}>
                  {cat}
                </div>
                {cmds.map(cmd => {
                  const globalIdx = results.indexOf(cmd);
                  const isSelected = globalIdx === sel;
                  return (
                    <button
                      key={cmd.id}
                      onClick={() => runCommand(cmd)}
                      onMouseEnter={() => setSel(globalIdx)}
                      style={{
                        width:'100%', display:'flex', alignItems:'center',
                        gap:'var(--space-3)', padding:'7px var(--space-4)',
                        background: isSelected ? 'var(--bg-sunken)' : 'transparent',
                        textAlign:'left', transition:'background 60ms',
                      }}
                    >
                      <span style={{ color:'var(--text-tertiary)', width:16, display:'flex', justifyContent:'center', flexShrink:0 }}>
                        {cmd.icon}
                      </span>
                      <span style={{ flex:1, fontSize:'var(--text-base)', color:'var(--text-primary)' }}>
                        {cmd.label}
                      </span>
                      {cmd.shortcut && (
                        <span style={{ fontSize:'var(--text-xs)', fontFamily:'var(--font-mono)',
                                       color:'var(--text-tertiary)', background:'var(--bg-sunken)',
                                       padding:'1px 5px', borderRadius:'var(--radius-sm)',
                                       border:'0.5px solid var(--border-subtle)', flexShrink:0 }}>
                          {cmd.shortcut}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{ display:'flex', gap:'var(--space-4)', padding:'6px var(--space-4)',
                      borderTop:'0.5px solid var(--border-subtle)',
                      fontSize:'var(--text-xs)', color:'var(--text-tertiary)', flexShrink:0 }}>
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
