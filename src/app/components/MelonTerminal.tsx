/**
 * Melon Terminal Interface (MTI)
 * ==============================
 * In-app terminal panel for:
 *   - Shell access (bash/cmd)
 *   - MLC pipeline debugging (mlc convert, mlc trace, etc.)
 *   - Python REPL for addon development
 *   - Quick commands (render, voicebank, extension management)
 *
 * Architecture:
 *   Renderer (this component) → IPC → main.ts MTI handlers → child_process
 *   Shell sessions are persistent (pty-like), one-shot commands return full output.
 *
 * Keyboard:
 *   Enter     — execute command
 *   Up/Down   — command history
 *   Tab       — autocomplete (MLC commands)
 *   Ctrl+L    — clear buffer
 *   Ctrl+C    — send SIGINT to session / clear input
 *   Escape    — minimize panel
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Terminal, ChevronDown, ChevronUp, X, Plus,
  Cpu, Hash, Code2, Trash2, Maximize2, Minimize2,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────

interface TermLine {
  text:   string;
  type:   'stdout' | 'stderr' | 'stdin' | 'system' | 'prompt';
  ts:     number;
}

type TabKind = 'shell' | 'mlc' | 'python';

interface TermTab {
  id:        string;
  kind:      TabKind;
  label:     string;
  lines:     TermLine[];
  sessionId: string | null;  // null = one-shot mode, string = persistent session
  history:   string[];
  histIdx:   number;
}

const TAB_ICONS: Record<TabKind, React.ReactNode> = {
  shell:  <Hash size={11}/>,
  mlc:    <Cpu size={11}/>,
  python: <Code2 size={11}/>,
};

const TAB_LABELS: Record<TabKind, string> = {
  shell:  'Shell',
  mlc:    'MLC',
  python: 'Python',
};

const PROMPT_PREFIX: Record<TabKind, string> = {
  shell:  '$ ',
  mlc:    'mlc> ',
  python: '>>> ',
};

// ── Built-in MLC command handler (routes through IPC) ─────────────────────

// ── Utility ───────────────────────────────────────────────────────────────

function parseFlags(parts: string[]): { args: string[]; flags: Record<string, string> } {
  const args: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith('--') && i + 1 < parts.length) {
      flags[parts[i].slice(2)] = parts[++i];
    } else if (!parts[i].startsWith('--')) {
      args.push(parts[i]);
    }
  }
  return { args, flags };
}

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function midiName(n: number) { return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`; }

// ── MLC command router ────────────────────────────────────────────────────

async function executeMlcCommand(cmd: string): Promise<{ stdout: string; stderr: string }> {
  const parts = cmd.trim().split(/\s+/);
  const mlc = (window as any).mlc;
  const store = (await import('../../store/project')).useProjectStore.getState();

  if (!parts.length) return { stdout: '', stderr: '' };

  const sub = parts[0];
  const rest = parts.slice(1).join(' ');
  const { args, flags } = parseFlags(parts.slice(1));

  try {
    switch (sub) {

      // ── MLC Engine ──────────────────────────────────────────────────────
      case 'convert': {
        if (!rest) return { stdout: '', stderr: 'Usage: convert <text> [--module <id>] [--singability <0-1>]' };
        if (!mlc?.convert) return { stdout: '', stderr: 'MLC engine not available' };
        const moduleId = flags.module || flags.m || 'jp_cv_standard';
        const sing = parseFloat(flags.singability || flags.s || '0.5');
        const text = args.join(' ');
        const r = await mlc.convert({ text, moduleId, singability: sing });
        const tokens = (r?.tokens ?? []).map((t: any) => t.display).join(' ');
        const details = (r?.tokens ?? []).map((t: any) =>
          `  ${t.display.padEnd(8)} phoneme=${t.phoneme.padEnd(6)} conf=${Math.round((t.mlc_confidence || 0) * 100)}% src=${t.g2p_source || 'g2p'}`
        ).join('\n');
        return { stdout: `→ ${tokens}\n\n${details}\n\nTokens: ${r?.token_count ?? '?'}  Lang: ${r?.language ?? '?'}  Module: ${r?.module_id ?? '?'}  Time: ${r?.processing_ms ?? '?'}ms`, stderr: '' };
      }
      case 'trace': {
        if (!rest) return { stdout: '', stderr: 'Usage: trace <text> [--module <id>]' };
        if (!mlc?.getPipelineTrace) return { stdout: '', stderr: 'MLC engine not available' };
        const moduleId = flags.module || flags.m || 'jp_cv_standard';
        const r = await mlc.getPipelineTrace({ text: args.join(' '), module_id: moduleId });
        const trace = (r?.trace ?? []).map((s: any, i: number) => {
          let detail = '';
          if (s.backend) detail += `backend: ${s.backend}  `;
          if (s.id) detail += `addon: ${s.id}  `;
          if (s.lang) detail += `lang: ${s.lang}  `;
          if (s.words?.length) detail += `overrode: ${s.words.join(', ')}  `;
          if (s.active?.length) detail += `active: ${s.active.join(', ')}`;
          return `  ${String(i + 1).padStart(2)}. ${s.stage.padEnd(26)} ${detail}`;
        }).join('\n');
        return { stdout: `Pipeline trace for "${args.join(' ')}":\n${trace || '  (no stages)'}`, stderr: '' };
      }
      case 'modules': {
        if (!mlc?.listModules) return { stdout: '', stderr: 'MLC engine not available' };
        const mods = await mlc.listModules();
        const list = (Array.isArray(mods) ? mods : mods?.modules ?? []);
        if (!list.length) return { stdout: '(no modules loaded)', stderr: '' };
        const header = `  ${'ID'.padEnd(22)} ${'LANG'.padEnd(6)} ${'VERSION'.padEnd(10)} NAME`;
        const rows = list.map((m: any) => `  ${m.id.padEnd(22)} ${(m.language||'').padEnd(6)} ${('v'+m.version).padEnd(10)} ${m.name}`);
        return { stdout: `${list.length} module(s):\n${header}\n${'─'.repeat(70)}\n${rows.join('\n')}`, stderr: '' };
      }
      case 'addons': {
        if (!mlc?.listAddonsFull) return { stdout: '', stderr: 'MLC engine not available' };
        const r = await mlc.listAddonsFull();
        const addons = r?.addons ?? [];
        if (!addons.length) return { stdout: '(no addons installed)\nInstall with: ext install <path.mlc>', stderr: '' };
        const header = `  ${'ID'.padEnd(26)} ${'TYPE'.padEnd(20)} VERSION`;
        const rows = addons.map((a: any) => `  ${a.id.padEnd(26)} ${(a.addon_type||'').padEnd(20)} v${a.version}`);
        return { stdout: `${addons.length} addon(s):\n${header}\n${'─'.repeat(60)}\n${rows.join('\n')}`, stderr: '' };
      }
      case 'detect': {
        if (!rest) return { stdout: '', stderr: 'Usage: detect <text>' };
        if (!mlc?.detectLanguage) return { stdout: '', stderr: 'MLC engine not available' };
        const r = await mlc.detectLanguage(rest);
        return { stdout: `Language: ${r?.lang ?? 'unknown'}  Confidence: ${Math.round((r?.confidence || 0) * 100)}%`, stderr: '' };
      }
      case 'ping': {
        const r = await mlc?.ping?.();
        return { stdout: `MLC engine: ${r?.status ?? 'offline'}  v${r?.version ?? '?'}  modules: ${r?.modules ?? '?'}`, stderr: '' };
      }
      case 'cache': {
        const action = parts[1];
        if (action === 'stats') {
          const r = await mlc?.cacheStats?.();
          return { stdout: JSON.stringify(r, null, 2), stderr: '' };
        }
        if (action === 'clear') {
          const target = parts[2] || 'all';
          const r = await mlc?.clearCache?.(target);
          return { stdout: `✓ Cache cleared: ${r?.cleared ?? target}`, stderr: '' };
        }
        return { stdout: '', stderr: 'Usage: cache <stats|clear> [g2p|phrase|all]' };
      }

      // ── Project ─────────────────────────────────────────────────────────
      case 'project':
      case 'info': {
        const notes = store.notes;
        const tracks = store.tracks;
        const selectedTrack = tracks.find((t: any) => t.selected);
        const pitches = notes.map((n: any) => n.pitch);
        const totalBeats = notes.length ? Math.max(...notes.map((n: any) => n.start + n.duration)) : 0;
        const durS = (totalBeats / store.bpm) * 60;
        return { stdout: [
          `Project: ${store.projectName}`,
          `BPM: ${store.bpm}  Snap: ${store.snap}  Mode: ${store.mode}`,
          `Notes: ${notes.length}  Selected: ${notes.filter((n: any) => n.selected).length}`,
          `Tracks: ${tracks.length}  Active: ${selectedTrack?.name ?? '—'}`,
          notes.length ? `Pitch range: ${midiName(Math.min(...pitches))} – ${midiName(Math.max(...pitches))} (${Math.max(...pitches) - Math.min(...pitches)} semitones)` : '',
          notes.length ? `Duration: ${totalBeats.toFixed(1)} beats (${durS < 60 ? durS.toFixed(1) + 's' : Math.floor(durS/60) + ':' + String(Math.round(durS%60)).padStart(2,'0')})` : '',
          selectedTrack ? `Voice: ${selectedTrack.voiceBank || '(none)'}  Path: ${selectedTrack.voicePath || '(not set)'}` : '',
          selectedTrack ? `Breathiness: ${selectedTrack.breathiness}  Tension: ${selectedTrack.tension}  Gender: ${selectedTrack.gender}` : '',
        ].filter(Boolean).join('\n'), stderr: '' };
      }

      // ── Notes ───────────────────────────────────────────────────────────
      case 'notes': {
        const action = parts[1] || 'list';
        if (action === 'count') return { stdout: `${store.notes.length} notes`, stderr: '' };
        if (action === 'list') {
          const sorted = [...store.notes].sort((a: any, b: any) => a.start - b.start).slice(0, 30);
          if (!sorted.length) return { stdout: '(no notes)', stderr: '' };
          const header = `  ${'#'.padStart(3)} ${'PITCH'.padEnd(6)} ${'START'.padEnd(8)} ${'DUR'.padEnd(6)} ${'LYRIC'.padEnd(8)} PHONEME`;
          const rows = sorted.map((n: any, i: number) =>
            `  ${String(i+1).padStart(3)} ${midiName(n.pitch).padEnd(6)} ${n.start.toFixed(2).padEnd(8)} ${n.duration.toFixed(2).padEnd(6)} ${(n.lyric||'').padEnd(8)} ${n.phoneme||'—'}`
          );
          const more = store.notes.length > 30 ? `\n  … and ${store.notes.length - 30} more` : '';
          return { stdout: `${store.notes.length} notes:\n${header}\n${'─'.repeat(56)}\n${rows.join('\n')}${more}`, stderr: '' };
        }
        if (action === 'selected') {
          const sel = store.notes.filter((n: any) => n.selected);
          if (!sel.length) return { stdout: '(no notes selected)', stderr: '' };
          const rows = sel.map((n: any) => `  ${midiName(n.pitch).padEnd(6)} beat ${n.start.toFixed(2)}  dur ${n.duration.toFixed(2)}  "${n.lyric||''}"  ${n.phoneme ? `[${n.phoneme}]` : ''}`);
          return { stdout: `${sel.length} selected:\n${rows.join('\n')}`, stderr: '' };
        }
        if (action === 'clear') {
          store.notes.forEach((n: any) => store.deleteNote(n.id));
          return { stdout: '✓ All notes cleared', stderr: '' };
        }
        return { stdout: '', stderr: 'Usage: notes <list|count|selected|clear>' };
      }

      // ── Voicebanks ──────────────────────────────────────────────────────
      case 'vb': {
        const action = parts[1] || 'list';
        if (action === 'list' || action === 'ls') {
          const vbs = await (window as any).voicebanks?.list?.() ?? [];
          if (!vbs.length) return { stdout: '(no voicebanks installed)\nOpen Voicebank Manager to download one.', stderr: '' };
          const rows = vbs.map((v: any) => `  ${(v.name||v.id).padEnd(20)} ${(v.type||'?').padEnd(6)} ${v.path}`);
          return { stdout: `${vbs.length} voicebank(s):\n${rows.join('\n')}`, stderr: '' };
        }
        if (action === 'scan' || action === 'detect') {
          const sys = await (window as any).voicebanks?.detectSystem?.();
          return { stdout: [
            `OpenUTAU: ${sys?.openutau?.found ? '✓ ' + sys.openutau.path : '✗ not found'}`,
            `Singers dir: ${sys?.singers_dir || '(not found)'}`,
            `Voicebanks: ${(sys?.voicebanks || []).length}`,
            ...(sys?.editors || []).map((e: any) => `${e.name}: ${e.detected ? '✓ ' + e.path : '✗'}`),
          ].join('\n'), stderr: '' };
        }
        return { stdout: '', stderr: 'Usage: vb <list|scan>' };
      }

      // ── Render ──────────────────────────────────────────────────────────
      case 'render': {
        const action = parts[1] || 'run';
        if (action === 'editors') {
          const eds = await (window as any).render?.detectEditors?.() ?? [];
          const rows = (Array.isArray(eds) ? eds : []).map((e: any) => `  ${(e.name||e.id).padEnd(12)} ${e.detected ? '✓ ' + e.path : '✗ not found'}`);
          return { stdout: rows.join('\n') || '(no editors detected)', stderr: '' };
        }
        if (action === 'ust') {
          if (!store.notes.length) return { stdout: '', stderr: 'No notes in project' };
          const r = await (window as any).render?.generateUST?.({
            notes: store.notes.sort((a: any, b: any) => a.start - b.start).map((n: any) => ({
              id: n.id, pitch: n.pitch, start: n.start, duration: n.duration,
              lyric: n.lyric, phoneme: n.phoneme || n.lyric,
            })),
            tempo: store.bpm,
            project_name: store.projectName,
          });
          const preview = (r?.ust || '').split('\n').slice(0, 20).join('\n');
          return { stdout: `UST generated (${(r?.ust||'').split('\n').length} lines):\n${preview}\n…`, stderr: '' };
        }
        if (action === 'run') {
          return { stdout: '', stderr: 'Use the Render button in the transport bar, or File → Export WAV.\nDirect CLI render coming soon.' };
        }
        return { stdout: '', stderr: 'Usage: render <editors|ust|run>' };
      }

      // ── Extensions ──────────────────────────────────────────────────────
      case 'ext': {
        const action = parts[1] || 'list';
        if (action === 'list' || action === 'ls') {
          const exts = await (window as any).app?.listExtensions?.() ?? [];
          const mlcAddons = await mlc?.listAddonsFull?.();
          const mlcList = mlcAddons?.addons ?? [];
          const lines = [
            `MLC addons: ${mlcList.length}`,
            ...mlcList.map((a: any) => `  [mlc]   ${a.id.padEnd(24)} ${(a.addon_type||'').padEnd(16)} v${a.version}`),
            `App extensions: ${exts.length}`,
            ...exts.map((a: any) => `  [melon] ${(a.id||a.name||'?').padEnd(24)} ${(a.addon_type||'app').padEnd(16)} v${a.version||'?'}`),
          ];
          return { stdout: lines.join('\n'), stderr: '' };
        }
        if (action === 'install') {
          return { stdout: '', stderr: 'Use Extensions panel → Browse, or drag & drop a .mlc/.melon file.' };
        }
        return { stdout: '', stderr: 'Usage: ext <list|install>' };
      }

      // ── Playback ────────────────────────────────────────────────────────
      case 'play': { store.setPlaying(true); return { stdout: '▶ Playing', stderr: '' }; }
      case 'stop': { store.setPlaying(false); store.setPlayhead(0); return { stdout: '■ Stopped', stderr: '' }; }
      case 'bpm': {
        if (args[0]) {
          const v = parseInt(args[0]);
          if (v >= 20 && v <= 300) { store.setBpm(v); return { stdout: `BPM → ${v}`, stderr: '' }; }
          return { stdout: '', stderr: 'BPM must be 20–300' };
        }
        return { stdout: `BPM: ${store.bpm}`, stderr: '' };
      }
      case 'snap': {
        if (args[0] && ['1/4','1/8','1/16','1/32'].includes(args[0])) {
          store.setSnap(args[0] as any); return { stdout: `Snap → ${args[0]}`, stderr: '' };
        }
        return { stdout: `Snap: ${store.snap}  (options: 1/4, 1/8, 1/16, 1/32)`, stderr: '' };
      }
      case 'mode': {
        if (args[0] && ['select','draw','erase','pitch'].includes(args[0])) {
          store.setMode(args[0] as any); return { stdout: `Mode → ${args[0]}`, stderr: '' };
        }
        return { stdout: `Mode: ${store.mode}  (options: select, draw, erase, pitch)`, stderr: '' };
      }
      case 'dark': { store.toggleDark(); return { stdout: `Theme → ${store.isDark ? 'light' : 'dark'}`, stderr: '' }; }
      case 'undo': { store.undo(); return { stdout: '↩ Undo', stderr: '' }; }
      case 'redo': { store.redo(); return { stdout: '↪ Redo', stderr: '' }; }

      // ── Help ────────────────────────────────────────────────────────────
      case 'help': {
        const topic = parts[1];
        if (topic === 'convert') return { stdout: 'convert <text> [--module <id>] [--singability <0-1>]\n\nConvert text to phonemes using the MLC engine.\n\nExamples:\n  convert sora iru\n  convert beautiful dream --module en_arpabet\n  convert 你好世界 --module zh_mandarin --singability 0.8', stderr: '' };
        if (topic === 'notes') return { stdout: 'notes <list|count|selected|clear>\n\n  list       Show first 30 notes (sorted by time)\n  count      Count total notes\n  selected   Show selected notes\n  clear      Delete all notes', stderr: '' };
        if (topic === 'vb') return { stdout: 'vb <list|scan>\n\n  list    Show installed voicebanks\n  scan    Detect OpenUTAU, singers dir, and music editors', stderr: '' };
        if (topic === 'render') return { stdout: 'render <editors|ust|run>\n\n  editors   List detected music editors (Ardour, LMMS, Reaper)\n  ust       Generate UST from current notes (preview)\n  run       Trigger full render pipeline', stderr: '' };
        return {
          stdout: [
            '╔══════════════════════════════════════════════════════════════╗',
            '║              Melon Terminal Interface (MTI)                 ║',
            '╚══════════════════════════════════════════════════════════════╝',
            '',
            '  MLC Engine',
            '    convert <text>          Convert text → phonemes',
            '    trace <text>            Trace pipeline step-by-step',
            '    detect <text>           Detect language',
            '    modules                 List loaded voicebank modules',
            '    addons                  List installed MLC addons',
            '    ping                    Check engine status',
            '    cache stats|clear       Manage G2P cache',
            '',
            '  Project',
            '    info / project          Show project overview',
            '    notes list|count|sel    Inspect notes',
            '    notes clear             Delete all notes',
            '    bpm [value]             Get/set BPM',
            '    snap [1/4|1/8|1/16]     Get/set snap grid',
            '    mode [select|draw|...]  Get/set edit mode',
            '',
            '  Voicebanks & Render',
            '    vb list                 Show installed voicebanks',
            '    vb scan                 Detect OpenUTAU & editors',
            '    render editors          List music editors',
            '    render ust              Preview UST output',
            '',
            '  Extensions',
            '    ext list                List all installed addons',
            '',
            '  Playback',
            '    play / stop             Control playback',
            '    dark                    Toggle dark/light mode',
            '    undo / redo             History navigation',
            '',
            '  Type "help <command>" for details (e.g. help convert)',
          ].join('\n'),
          stderr: '',
        };
      }
      default:
        return { stdout: '', stderr: `Unknown command: ${sub}\nType "help" for available commands.` };
    }
  } catch (e: any) {
    return { stdout: '', stderr: `Error: ${e.message || 'Command failed'}` };
  }
}

// ── Python prelude — auto-injected before first command ───────────────────

const PYTHON_PRELUDE = `
import sys, os, json
sys.path.insert(0, os.environ.get('MLC_DIR', '.'))
try:
    from core.g2p import G2PEngine
    from core.mlc_types import SynthToken
except: pass
def midi_to_note(n):
    names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
    return f'{names[n%12]}{n//12-1}'
def note_to_midi(s):
    names = {'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}
    note = s[0].upper()
    sharp = 1 if '#' in s else (-1 if 'b' in s else 0)
    octave = int(s[-1])
    return names[note] + sharp + (octave+1)*12
def gen_scale(root=60, scale='major', n=8):
    intervals = {'major':[0,2,4,5,7,9,11],'minor':[0,2,3,5,7,8,10],'pentatonic':[0,2,4,7,9],'blues':[0,3,5,6,7,10],'chromatic':list(range(12))}
    pat = intervals.get(scale, intervals['major'])
    return [root + pat[i%len(pat)] + 12*(i//len(pat)) for i in range(n)]
print("Python ready. Utilities loaded: midi_to_note(), note_to_midi(), gen_scale()")
print("MLC modules available via: from core.g2p import G2PEngine")
`.trim();

// ── Component ─────────────────────────────────────────────────────────────

interface Props {
  visible:   boolean;
  onToggle:  () => void;
  height:    number;
  onResize:  (h: number) => void;
}

let tabCounter = 0;

export function MelonTerminal({ visible, onToggle, height, onResize }: Props) {
  const [tabs,      setTabs]      = useState<TermTab[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [input,     setInput]     = useState('');
  const [expanded,  setExpanded]  = useState(false);
  const [mlcCmds,   setMlcCmds]  = useState<string[]>([]);

  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);
  const resizing  = useRef(false);

  // Load MLC autocomplete commands
  useEffect(() => {
    (window as any).mti?.mlcCommands?.().then((cmds: string[]) => {
      if (Array.isArray(cmds)) setMlcCmds(cmds);
    }).catch(() => {});
  }, []);

  // Create default tab on first open
  useEffect(() => {
    if (visible && tabs.length === 0) {
      addTab('mlc');
    }
  }, [visible]);

  // Auto-scroll on new lines
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  });

  // Wire up shell session events
  useEffect(() => {
    const mti = (window as any).mti;
    if (!mti) return;

    const onStdout = (sessionId: string, data: string) => {
      setTabs(prev => prev.map(t =>
        t.sessionId === sessionId
          ? { ...t, lines: [...t.lines, { text: data, type: 'stdout' as const, ts: Date.now() }] }
          : t
      ));
    };
    const onStderr = (sessionId: string, data: string) => {
      setTabs(prev => prev.map(t =>
        t.sessionId === sessionId
          ? { ...t, lines: [...t.lines, { text: data, type: 'stderr' as const, ts: Date.now() }] }
          : t
      ));
    };
    const onExit = (sessionId: string, code: number) => {
      setTabs(prev => prev.map(t =>
        t.sessionId === sessionId
          ? { ...t, sessionId: null, lines: [...t.lines, { text: `\nProcess exited with code ${code}`, type: 'system' as const, ts: Date.now() }] }
          : t
      ));
    };

    mti.onStdout?.(onStdout);
    mti.onStderr?.(onStderr);
    mti.onExit?.(onExit);
  }, []);

  const addTab = useCallback((kind: TabKind) => {
    const id = `mti-${++tabCounter}`;
    const welcomeMessages: Record<TabKind, string> = {
      shell:  'Melon Shell — type commands, run scripts\nWorking directory: project root\n',
      mlc:    'Melon Terminal Interface — MLC Engine\nType "help" for commands, "info" for project overview\n',
      python: 'Melon Python — music utilities pre-loaded\nInitializing…\n',
    };
    const tab: TermTab = {
      id, kind,
      label: `${TAB_LABELS[kind]} ${tabCounter}`,
      lines: [{ text: welcomeMessages[kind], type: 'system', ts: Date.now() }],
      sessionId: null,
      history: [],
      histIdx: -1,
    };

    // For shell tabs, spawn a persistent session
    if (kind === 'shell') {
      const sessionId = `session-${tabCounter}`;
      tab.sessionId = sessionId;
      (window as any).mti?.spawnSession?.(sessionId);
    }

    // For Python tabs, inject the prelude
    if (kind === 'python') {
      (async () => {
        const r = await (window as any).mti?.python?.(PYTHON_PRELUDE);
        if (r?.stdout) {
          setTabs(prev => prev.map(t => t.id === id
            ? { ...t, lines: [...t.lines, { text: r.stdout, type: 'stdout' as const, ts: Date.now() }] }
            : t));
        }
        if (r?.stderr) {
          setTabs(prev => prev.map(t => t.id === id
            ? { ...t, lines: [...t.lines, { text: r.stderr, type: 'stderr' as const, ts: Date.now() }] }
            : t));
        }
      })();
    }

    setTabs(prev => [...prev, tab]);
    setActiveTab(id);
    setInput('');
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      const tab = prev.find(t => t.id === id);
      if (tab?.sessionId) (window as any).mti?.kill?.(tab.sessionId);
      const next = prev.filter(t => t.id !== id);
      if (activeTab === id) setActiveTab(next[next.length - 1]?.id ?? '');
      return next;
    });
  }, [activeTab]);

  const currentTab = tabs.find(t => t.id === activeTab);

  const pushLine = useCallback((tabId: string, text: string, type: TermLine['type']) => {
    setTabs(prev => prev.map(t =>
      t.id === tabId
        ? { ...t, lines: [...t.lines, { text, type, ts: Date.now() }] }
        : t
    ));
  }, []);

  const execute = useCallback(async () => {
    if (!currentTab || !input.trim()) return;

    const cmd = input.trim();
    setInput('');

    // Push to history
    setTabs(prev => prev.map(t =>
      t.id === currentTab.id
        ? { ...t, history: [cmd, ...t.history.slice(0, 100)], histIdx: -1 }
        : t
    ));

    // Show the command
    pushLine(currentTab.id, `${PROMPT_PREFIX[currentTab.kind]}${cmd}`, 'stdin');

    if (currentTab.kind === 'shell' && currentTab.sessionId) {
      // Persistent shell — write to stdin
      await (window as any).mti?.write?.(currentTab.sessionId, cmd + '\n');
    } else if (currentTab.kind === 'mlc') {
      // MLC command handler
      const result = await executeMlcCommand(cmd);
      if (result.stdout) pushLine(currentTab.id, result.stdout, 'stdout');
      if (result.stderr) pushLine(currentTab.id, result.stderr, 'stderr');
    } else if (currentTab.kind === 'python') {
      // One-shot Python
      const result = await (window as any).mti?.python?.(cmd);
      if (result?.stdout) pushLine(currentTab.id, result.stdout, 'stdout');
      if (result?.stderr) pushLine(currentTab.id, result.stderr, 'stderr');
      if (!result?.ok && !result?.stderr) {
        pushLine(currentTab.id, 'Python not available. Run via Electron.', 'system');
      }
    }

    // Focus input
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [currentTab, input, pushLine]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      execute();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!currentTab) return;
      const newIdx = Math.min((currentTab.histIdx ?? -1) + 1, currentTab.history.length - 1);
      if (newIdx >= 0 && currentTab.history[newIdx]) {
        setInput(currentTab.history[newIdx]);
        setTabs(prev => prev.map(t => t.id === currentTab.id ? { ...t, histIdx: newIdx } : t));
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!currentTab) return;
      const newIdx = (currentTab.histIdx ?? 0) - 1;
      if (newIdx < 0) {
        setInput('');
        setTabs(prev => prev.map(t => t.id === currentTab.id ? { ...t, histIdx: -1 } : t));
      } else {
        setInput(currentTab.history[newIdx] ?? '');
        setTabs(prev => prev.map(t => t.id === currentTab.id ? { ...t, histIdx: newIdx } : t));
      }
    } else if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (currentTab) {
        setTabs(prev => prev.map(t => t.id === currentTab.id ? { ...t, lines: [] } : t));
      }
    } else if (e.key === 'c' && e.ctrlKey) {
      if (!input) {
        // Send SIGINT to shell session
        if (currentTab?.sessionId) {
          (window as any).mti?.write?.(currentTab.sessionId, '\x03');
        }
      } else {
        setInput('');
      }
    } else if (e.key === 'Escape') {
      onToggle();
    }
  }, [currentTab, input, execute, onToggle]);

  // Resize drag
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    const startY = e.clientY;
    const startH = height;

    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const delta = startY - ev.clientY;
      onResize(Math.max(120, Math.min(600, startH + delta)));
    };
    const onUp = () => {
      resizing.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [height, onResize]);

  if (!visible) return null;

  const panelHeight = expanded ? '80vh' : height;

  return (
    <div style={{
      height: panelHeight, flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg-surface)',
      borderTop: '0.5px solid var(--border-default)',
      position: 'relative',
    }}>
      {/* ── Resize handle ── */}
      <div
        style={{
          position: 'absolute', top: -3, left: 0, right: 0, height: 6,
          cursor: 'row-resize', zIndex: 10,
        }}
        onMouseDown={startResize}
      />

      {/* ── Tab bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        height: 32, flexShrink: 0,
        background: 'var(--bg-sunken)',
        borderBottom: '0.5px solid var(--border-subtle)',
        paddingLeft: 8,
      }}>
        {/* Terminal icon + label */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          paddingRight: 12, marginRight: 4,
          borderRight: '0.5px solid var(--border-subtle)',
          fontSize: 11, fontWeight: 500, color: 'var(--text-tertiary)',
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          <Terminal size={11}/> MTI
        </div>

        {/* Tabs */}
        {tabs.map(t => (
          <div key={t.id}
            onClick={() => { setActiveTab(t.id); setTimeout(() => inputRef.current?.focus(), 0); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              height: 32, padding: '0 10px',
              fontSize: 11, cursor: 'pointer',
              color: t.id === activeTab ? 'var(--text-primary)' : 'var(--text-tertiary)',
              background: t.id === activeTab ? 'var(--bg-surface)' : 'transparent',
              borderBottom: t.id === activeTab ? '2px solid var(--accent)' : '2px solid transparent',
              transition: 'all 100ms',
            }}
          >
            {TAB_ICONS[t.kind]}
            <span>{t.label}</span>
            <button onClick={(e) => { e.stopPropagation(); closeTab(t.id); }} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 14, height: 14, borderRadius: 3, marginLeft: 4,
              color: 'var(--text-tertiary)', cursor: 'pointer',
              opacity: 0.5,
            }}
              onMouseEnter={e => e.currentTarget.style.opacity = '1'}
              onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}
            >
              <X size={9}/>
            </button>
          </div>
        ))}

        {/* New tab button */}
        <button onClick={() => addTab('mlc')} title="New MLC tab" style={{
          width: 24, height: 24, borderRadius: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-tertiary)', cursor: 'pointer', marginLeft: 2,
        }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.color = 'var(--accent)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
        >
          <Plus size={12}/>
        </button>

        {/* Spacer */}
        <div style={{ flex: 1 }}/>

        {/* Tab type quick-add */}
        {(['shell', 'mlc', 'python'] as TabKind[]).map(kind => (
          <button key={kind} onClick={() => addTab(kind)} title={`New ${TAB_LABELS[kind]} tab`}
            style={{
              height: 22, padding: '0 8px', borderRadius: 4,
              fontSize: 10, color: 'var(--text-tertiary)',
              display: 'flex', alignItems: 'center', gap: 4,
              cursor: 'pointer', marginRight: 2,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
          >
            {TAB_ICONS[kind]} {TAB_LABELS[kind]}
          </button>
        ))}

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginRight: 8, marginLeft: 8 }}>
          <button onClick={() => currentTab && setTabs(prev => prev.map(t => t.id === currentTab.id ? { ...t, lines: [] } : t))}
            title="Clear" style={{ width: 22, height: 22, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-tertiary)', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}
          >
            <Trash2 size={11}/>
          </button>
          <button onClick={() => setExpanded(!expanded)} title={expanded ? 'Restore' : 'Maximize'}
            style={{ width: 22, height: 22, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-tertiary)', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}
          >
            {expanded ? <Minimize2 size={11}/> : <Maximize2 size={11}/>}
          </button>
          <button onClick={onToggle} title="Close terminal"
            style={{ width: 22, height: 22, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-tertiary)', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}
          >
            <ChevronDown size={12}/>
          </button>
        </div>
      </div>

      {/* ── Output area ── */}
      <div ref={outputRef} style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden',
        padding: '8px 12px',
        fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6,
        whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        background: 'var(--bg-base)',
      }}
        onClick={() => inputRef.current?.focus()}
      >
        {currentTab?.lines.map((line, i) => (
          <div key={i} style={{
            color: line.type === 'stderr'  ? 'var(--danger)'
                 : line.type === 'stdin'   ? 'var(--accent)'
                 : line.type === 'system'  ? 'var(--text-tertiary)'
                 : 'var(--text-primary)',
            opacity: line.type === 'system' ? 0.7 : 1,
          }}>
            {line.text}
          </div>
        ))}
      </div>

      {/* ── Input line ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        padding: '6px 12px',
        borderTop: '0.5px solid var(--border-subtle)',
        background: 'var(--bg-base)',
        flexShrink: 0,
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 12,
          color: 'var(--accent)', fontWeight: 500, flexShrink: 0,
          userSelect: 'none',
        }}>
          {currentTab ? PROMPT_PREFIX[currentTab.kind] : '> '}
        </span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={currentTab ? `Type a ${currentTab.kind} command…` : 'Open a tab to start'}
          disabled={!currentTab}
          autoFocus
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            fontFamily: 'var(--font-mono)', fontSize: 12,
            color: 'var(--text-primary)', caretColor: 'var(--accent)',
          }}
        />
      </div>
    </div>
  );
}
