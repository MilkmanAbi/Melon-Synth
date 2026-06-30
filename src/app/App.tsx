import React, { useEffect, useRef, useCallback } from 'react';
import { CrossPlatformTitleBar } from './components/CrossPlatformTitleBar';
import { CommandBar }       from './components/CommandBar';
import { VoicePanel }       from './components/VoicePanel';
import { PianoRoll }        from './components/PianoRoll';
import { PitchCurveEditor } from './components/PitchCurveEditor';
import { LyricsLane }       from './components/LyricsLane';
import { TransportBar }     from './components/TransportBar';
import { NotificationPanel }from './components/NotificationPanel';
import { CommandPalette }   from './components/CommandPalette';
import { ContextMenu, ContextMenuEntry } from './components/ContextMenu';
import { VoicebankManager } from './components/VoicebankManager';
import { MidiImportDialog } from './components/MidiImportDialog';
import { SettingsPanel }    from './components/SettingsPanel';
import { NotePropertiesPanel } from './components/NotePropertiesPanel';
import {
  Pencil, Copy, Trash2, AlignLeft, Clipboard,
  MousePointer2, Maximize2, Type, RefreshCw,
} from 'lucide-react';
import { useProjectStore, ScrollSyncBus, ContextTarget } from '../store/project';
import { WelcomeScreen, addToRecent } from './components/WelcomeScreen';
import { ExtensionsPanel } from './components/ExtensionsPanel';
import { startUpdateChecker } from '../subsystems/update-checker';
import { SavePrompt } from './components/SavePrompt';
import { MLCWindow }     from './components/MLCWindow';
import { audio }         from '../subsystems/audio';
import { playheadClock } from '../subsystems/playhead';
import { loadMidiFromFile, MidiFile, ImportedNote } from '../subsystems/midi-import';

export default function App() {
  const {
    isDark, toggleDark, setDark,
    copySelected, pasteNotes,
    bpm, setBpm,
    isPlaying, setPlaying, playheadPosition, setPlayhead,
    notes, deleteSelected, selectNote, selectAll, deselectAll,
    tracks, addTrack, selectTrack,
    mode, setMode,
    snap, setSnap,
    notifications, notifOpen, notifPinned,
    setNotifOpen, setNotifPinned, dismissNotif, clearNotifs,
    paletteOpen, setPaletteOpen,
    vbManagerOpen, setVbManagerOpen,
    undo, redo, canUndo, canRedo,
    notify,
    pitchPoints,
  } = useProjectStore();

  const [showWelcome,    setShowWelcome]    = React.useState(true);
  const [extsOpen,       setExtsOpen]       = React.useState(false);
  const [savePrompt,     setSavePrompt]     = React.useState<{ onSave:()=>void; onDiscard:()=>void } | null>(null);

  // Call this instead of window.confirm() anywhere you need save-first logic
  const requireSave = React.useCallback((onProceed: () => void) => {
    const s = useProjectStore.getState();
    if (!s.isDirty || s.notes.length === 0) { onProceed(); return; }
    setSavePrompt({
      onSave: async () => {
        setSavePrompt(null);
        const { saveProject, serializeProject } = await import('../subsystems/project-io');
        const proj = serializeProject(s.projectName, s.bpm, s.tracks, s.notes, s.pitchPoints, s.addonData ?? {});
        const path = await saveProject(proj, s.currentFilePath ?? null);
        if (path) { s.setCurrentFilePath(path); s.setDirty(false); onProceed(); }
        // if path is null user cancelled the file dialog → don't proceed
      },
      onDiscard: () => { setSavePrompt(null); onProceed(); },
    });
  }, []);
  const [mlcWindowOpen,  setMlcWindowOpen]  = React.useState(false);
  const [midiImportFile, setMidiImportFile] = React.useState<MidiFile | null>(null);
  const [settingsOpen,   setSettingsOpen]   = React.useState(false);
  const [settingsTab,    setSettingsTab]    = React.useState<'general'|'shortcuts'|'audio'|'about'>('general');
  const [notePropsOpen,  setNotePropsOpen]  = React.useState(false);
  const [platform,       setPlatform]       = React.useState<string>('darwin');
  const [contextMenu,    setContextMenu]    = React.useState<{
    x: number; y: number; target: ContextTarget;
  } | null>(null);

  const scrollBus = useRef<ScrollSyncBus>({ scrollX: 0, listeners: new Set() });

  // Listen for events dispatched by CommandPalette
  useEffect(() => {
    const onMlc      = () => setMlcWindowOpen(true);
    const onSettings = () => setSettingsOpen(true);
    const onAbout    = () => { setSettingsTab('about'); setSettingsOpen(true); };
    const onWelcome  = () => requireSave(() => setShowWelcome(true));
    const onExtensions      = () => setExtsOpen(true);
    const onExtensionsDebug = () => { setExtsOpen(true); };

    // "Install from file…" — open native dialog, install, notify, open panel
    const onInstallAddon = async () => {
      const result = await (window as any).app?.installAddonDialog?.();
      if (!result) return;
      if (result.canceled) return;
      if (result.ok) {
        notify({ type: 'success', title: `Installed ${result.name ?? 'addon'}`,
                 body: result.version ? `v${result.version}` : undefined });
        setExtsOpen(true); // open panel so user sees what was installed
      } else if (result.error) {
        notify({ type: 'error', title: 'Install failed', body: result.error });
        setExtsOpen(true);
      }
    };
    document.addEventListener('open-mlc',      onMlc);
    document.addEventListener('open-settings', onSettings);
    document.addEventListener('open-about',    onAbout);
    document.addEventListener('open-welcome',     onWelcome);
    document.addEventListener('open-extensions',       onExtensions);
    document.addEventListener('open-extensions-debug',   onExtensionsDebug);
    document.addEventListener('open-extensions-install', onInstallAddon);
    return () => {
      document.removeEventListener('open-mlc',      onMlc);
      document.removeEventListener('open-settings', onSettings);
      document.removeEventListener('open-about',    onAbout);
      document.removeEventListener('open-welcome',     onWelcome);
      document.removeEventListener('open-extensions',       onExtensions);
      document.removeEventListener('open-extensions-debug',   onExtensionsDebug);
      document.removeEventListener('open-extensions-install', onInstallAddon);
    };
  }, []);

  // ── Update checker (runs once, 8s after launch, then every 24h) ──────────────
  useEffect(() => {
    const stop = startUpdateChecker(notify);
    return stop;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Wire note-play highlights into store
  useEffect(() => {
    audio.onNoteStart = (id) => useProjectStore.getState().updateNote(id, { playing: true });
    audio.onNoteStop  = (id) => useProjectStore.getState().updateNote(id, { playing: false });
    audio.onPlayEnd   = () => {
      setPlaying(false);
      useProjectStore.getState().notes.forEach(n => {
        if (n.playing) useProjectStore.getState().updateNote(n.id, { playing: false });
      });
    };
    return () => { audio.onNoteStart = undefined; audio.onNoteStop = undefined; audio.onPlayEnd = undefined; };
  }, []);

  // Drag-and-drop .mlc bundle installation
  useEffect(() => {
    const onDragOver = (e: DragEvent) => { e.preventDefault(); };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      const mlcFiles = files.filter(f => f.name.endsWith('.mlc'));
      if (!mlcFiles.length) return;
      for (const file of mlcFiles) {
        const filePath = (file as any).path;
        if (filePath && (window as any).app?.installAddon) {
          const result = await (window as any).app.installAddon(filePath);
          if (result.ok) {
            notify({ type:'success', title:`Addon installed: ${file.name}`, body:'Hot-reloaded — ready to use' });
          } else {
            notify({ type:'error', title:`Install failed: ${file.name}`, body:result.error });
          }
        }
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => { window.removeEventListener('dragover', onDragOver); window.removeEventListener('drop', onDrop); };
  }, [notify]);

  // ── Apply dark mode synchronously (before paint) ──────────────────────
  const darkApplied = React.useRef(isDark);
  if (darkApplied.current !== isDark) {
    darkApplied.current = isDark;
    document.documentElement.classList.toggle('dark', isDark);
  }
  // Also apply on mount
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    // Persist to localStorage so index.html inline script can restore it without flash
    try { localStorage.setItem('melon-ui-state', JSON.stringify({ isDark })); } catch {}
  }, [isDark]);

  // ── FUNCTIONS — declared BEFORE any useEffect that references them ─────

  const openContextMenu = useCallback((e: React.MouseEvent, target: ContextTarget) => {
    e.preventDefault(); e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, target });
  }, []);

  const handleImportMidi = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mid,.midi';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const midiFile = await loadMidiFromFile(file);
        setMidiImportFile(midiFile);
      } catch (err: any) {
        notify({ type: 'error', title: 'Failed to parse MIDI', body: err.message || 'Invalid MIDI file' });
      }
    };
    input.click();
  }, [notify]);

  const handleMidiImportComplete = useCallback((importedNotes: ImportedNote[], tempo: number) => {
    const store = useProjectStore.getState();
    store.notes.forEach(n => store.deleteNote(n.id));
    setBpm(tempo);
    importedNotes.forEach(note => {
      store.addNote({ pitch: note.pitch, start: note.start, duration: note.duration, lyric: note.lyric });
    });
    notify({ type: 'success', title: 'MIDI imported', body: `${importedNotes.length} notes at ${tempo} BPM` });
    setMidiImportFile(null);
  }, [setBpm, notify]);

  const handleRender = useCallback(async () => {
    const state = useProjectStore.getState();
    const selectedTrack = state.tracks.find(t => t.selected);
    if (!state.notes.length) {
      notify({ type: 'warning', title: 'No notes to render', body: 'Draw some notes first!' });
      return;
    }
    if (!selectedTrack?.voicePath) {
      notify({ type: 'warning', title: 'No voicebank selected',
        body: 'Open the Voicebank Manager and select a voicebank.',
        action: { label: 'Open Manager', onClick: () => setVbManagerOpen(true) } });
      return;
    }
    // Determine MLC module from track's voicebank type
    const moduleId = selectedTrack.voiceBank?.toLowerCase().includes('miku') ? 'jp_cvvc_miku' : 'jp_cv_standard';
    const singability = (selectedTrack.tension ?? 65) / 100;

    notify({ type: 'info', title: 'Converting lyrics…', body: `Module: ${moduleId}`, progress: 10 });
    try {
      // Use note phoneme overrides if already set, otherwise run MLC on the lyrics
      const notesHavePhonemes = state.notes.every(n => n.phoneme);
      let mlcTokens: any[] = [];

      if ((window as any).mlc) {
        // Build text from notes — use phoneme if set, else lyric
        const lyricsText = state.notes.map(n => n.phoneme || n.lyric).join(' ');
        if (!notesHavePhonemes) {
          const mlcResult = await (window as any).mlc.convert({
            text: lyricsText, moduleId, singability,
          });
          mlcTokens = mlcResult.tokens || [];
          // Also persist phonemes back to notes
          const sorted = [...state.notes].sort((a, b) => a.start - b.start);
          mlcTokens.forEach((t: any, i: number) => {
            if (sorted[i]) useProjectStore.getState().updateNote(sorted[i].id, { phoneme: t.display });
          });
        } else {
          // Notes already have phonemes from MLC — use them directly
          mlcTokens = state.notes.sort((a, b) => a.start - b.start).map((n, i) => ({
            phoneme: n.phoneme || n.lyric, display: n.phoneme || n.lyric, word_index: i,
          }));
        }
        notify({ type: 'info', title: 'Rendering voice…', body: 'Calling OpenUTAU…', progress: 40 });
      }

      if ((window as any).render?.render) {
        const result = await (window as any).render.render({
          notes: state.notes
            .sort((a, b) => a.start - b.start)
            .map(n => ({
              id:           n.id,
              pitch:        n.pitch,
              start:        n.start,
              duration:     n.duration,
              lyric:        n.lyric,
              phoneme:      n.phoneme || n.lyric,
              expressions:  n.expressions,
              vibrato:      n.vibrato,
              pitchBend:    n.pitchBend,
              flags:        n.flags,
            })),
          mlc_tokens:     mlcTokens.map((t: any) => ({ phoneme:t.phoneme, display:t.display, word_index:t.word_index })),
          voice_dir:      selectedTrack.voicePath,
          voicebank_path: selectedTrack.voicePath,
          tempo:          state.bpm,
          project_name:   state.projectName,
          track_params: {
            gender:      selectedTrack.gender      ?? 30,
            breathiness: selectedTrack.breathiness ?? 40,
            tension:     selectedTrack.tension     ?? 65,
            pitchRange:  selectedTrack.pitchRange  ?? 50,
          },
          pitch_points: state.pitchPoints,
        });
        if (result?.ok && result.wav_path) {
          notify({ type:'success', title:'Render complete', body:result.wav_path,
            action:{ label:'Play', onClick:()=>{
              import('../subsystems/audio').then(({ audio }) => {
                audio.loadWAVFromPath(result.wav_path).then(() => audio.playWAV(0, state.bpm));
              });
            }}
          });
        } else if (result?.error) {
          notify({ type:'error', title:'Render failed', body:result.error });
        }
      } else {
        // No OpenUTAU — play a preview via Web Audio
        const { audio } = await import('../subsystems/audio');
        audio.playSequence(state.notes, state.bpm);
        notify({ type:'info', title:'Preview playing', body:'Install OpenUTAU for full voice rendering',
          action:{ label:'Get OpenUTAU', onClick:()=>(window as any).app?.openURL?.('https://www.openutau.com') }
        });
      }
    } catch (err: any) {
      notify({ type: 'error', title: 'Render failed', body: err.message || 'Unknown error' });
    }
  }, [notify, setVbManagerOpen]);

  // ── Effects ────────────────────────────────────────────────────────────

  // Update window/document title
  const { projectName, isDirty } = useProjectStore();
  useEffect(() => {
    document.title = `${isDirty ? '● ' : ''}${projectName} — Melon Synth`;
  }, [projectName, isDirty]);

  // Register render callback
  useEffect(() => {
    useProjectStore.getState().setTriggerRender(handleRender);
  }, [handleRender]);

  // Auto-save every 2 minutes if dirty and file path known
  useEffect(() => {
    const id = setInterval(async () => {
      const s = useProjectStore.getState();
      if (!s.isDirty || !s.currentFilePath || !(window as any).app?.writeFile) return;
      try {
        const { serializeProject } = await import('../subsystems/project-io');
        const proj = serializeProject(s.projectName, s.bpm, s.tracks, s.notes, s.pitchPoints, s.addonData ?? {});
        await (window as any).app.writeFile(s.currentFilePath, JSON.stringify(proj, null, 2));
        s.setDirty(false);
        notify({ type:'success', title:'Auto-saved', body:s.currentFilePath });
      } catch {}
    }, 120_000);
    return () => clearInterval(id);
  }, [notify]);

  // Read saved dark preference from Electron
  useEffect(() => {
    // Sync React state with the dark class already applied by index.html inline script
    const htmlDark = document.documentElement.classList.contains('dark');
    setDark(htmlDark);

    // Then check Electron's saved preference (overrides if different)
    if ((window as any).app) {
      (window as any).app.getUIState().then((s: any) => {
        if (typeof s?.isDark === 'boolean') {
          setDark(s.isDark);
          document.documentElement.classList.toggle('dark', s.isDark);
          try { localStorage.setItem('melon-ui-state', JSON.stringify({ isDark: s.isDark })); } catch {}
        }
      }).catch(() => {});
    }
  }, []);

  // Detect platform
  useEffect(() => {
    if ((window as any).electron?.platform) setPlatform((window as any).electron.platform);
    else if ((window as any).app?.getPlatform) setPlatform((window as any).app.getPlatform());
  }, []);

  // System detection
  useEffect(() => {
    const check = async () => {
      if (!(window as any).voicebanks) return;
      try {
        const sys = await (window as any).voicebanks.detectSystem();
        if (!sys.openutau?.found) {
          notify({ type: 'warning', title: 'OpenUTAU not found',
            body: 'Rendering requires OpenUTAU.',
            action: { label: 'Get OpenUTAU', onClick: () => (window as any).app?.openURL('https://www.openutau.com') } });
        }
        const vbs = await (window as any).voicebanks.list();
        if (vbs.length === 0 && sys.openutau?.found) {
          notify({ type: 'info', title: 'No voicebanks installed', body: 'Download a voicebank to start!',
            action: { label: 'Browse', onClick: () => setVbManagerOpen(true) } });
        }
      } catch (e) { console.error('System detection failed:', e); }
    };
    const t = setTimeout(check, 1500);
    return () => clearTimeout(t);
  }, [notify, setVbManagerOpen]);

  // Save dark preference
  useEffect(() => {
    (window as any).app?.saveUIState({ isDark });
  }, [isDark]);

  // Render completion events
  useEffect(() => {
    const render = (window as any).render;
    if (!render) return;
    const onComplete = async (result: any) => {
      if (result.ok && result.wav_path) {
        notify({ type: 'success', title: 'Render complete',
          body: `${result.wav_path.split('/').pop()} · ${result.duration_ms}ms`,
          action: { label: 'Play', onClick: () => {
            audio.loadWAVFromPath(result.wav_path).then(() => { setPlaying(true); audio.playWAV(0, bpm); });
          }}
        });
        try { await audio.loadWAVFromPath(result.wav_path); } catch {}
      } else {
        notify({ type: 'error', title: 'Render failed', body: result.error || 'Unknown error' });
      }
    };
    const onError = (err: any) => notify({ type: 'error', title: 'Render failed', body: err.error || 'Unknown error' });
    render.onComplete(onComplete);
    render.onError(onError);
  }, [bpm]);

  // Keyboard shortcuts — handleImportMidi is now defined above, safe to reference
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === 'k')                             { e.preventDefault(); setPaletteOpen(true); return; }
      if (meta && e.key === 's' && !e.shiftKey) {
        e.preventDefault();
        const s = useProjectStore.getState();
        import('../subsystems/project-io').then(async ({ saveProject, serializeProject }) => {
          const p = serializeProject(s.projectName, s.bpm, s.tracks, s.notes, s.pitchPoints);
          const path = await saveProject(p, s.currentFilePath ?? null);
          if (path) { s.setCurrentFilePath(path); s.setDirty(false); notify({ type:'success', title:'Saved', body:path }); }
        });
        return;
      }
      if (meta && e.key === 's' && e.shiftKey) {
        e.preventDefault();
        const s = useProjectStore.getState();
        import('../subsystems/project-io').then(async ({ saveProject, serializeProject }) => {
          const p = serializeProject(s.projectName, s.bpm, s.tracks, s.notes, s.pitchPoints);
          const path = await saveProject(p, null);
          if (path) { s.setCurrentFilePath(path); s.setDirty(false); notify({ type:'success', title:'Saved as', body:path }); }
        });
        return;
      }
      if (meta && e.key === 'i')                             { e.preventDefault(); handleImportMidi(); return; }
      if (meta && e.key === ',')                             { e.preventDefault(); setSettingsOpen(true); return; }
      if (meta && e.shiftKey && e.key.toLowerCase() === 'd'){ e.preventDefault(); toggleDark(); return; }
      if (meta && e.key === 'z' && !e.shiftKey)             { e.preventDefault(); undo(); return; }
      if (meta && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); return; }
      if (meta && e.key === 'a')                            { e.preventDefault(); selectAll(); return; }
      if (meta && e.key === 'c')                            { e.preventDefault(); copySelected(); return; }
      if (meta && e.key === 'v')                            { e.preventDefault(); pasteNotes(); return; }
      if (meta && e.key === 'd')                            { e.preventDefault();
        const s = useProjectStore.getState(); const sel = s.notes.filter(n=>n.selected);
        if (sel.length) { copySelected(); pasteNotes(); } return; }
      if (e.key === '.' && !meta)                           { setPlaying(false); setPlayhead(0); audio.stopWAV(); audio.stopSequence(); return; }
      if (e.key === 'ArrowUp'   && !meta && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault(); useProjectStore.getState().transposeSelected(e.shiftKey ? 12 : 1); return; }
      if (e.key === 'ArrowDown' && !meta && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault(); useProjectStore.getState().transposeSelected(e.shiftKey ? -12 : -1); return; }
      if (e.key === 'ArrowLeft' && !meta && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        const snap = useProjectStore.getState().snap;
        const div = snap === '1/4' ? 1 : snap === '1/8' ? 0.5 : snap === '1/16' ? 0.25 : 0.125;
        const sel = useProjectStore.getState().notes.filter(n=>n.selected);
        if (sel.length) useProjectStore.getState().moveNotes(sel.map(n=>n.id), 0, -div);
        return; }
      if (e.key === 'ArrowRight' && !meta && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        const snap = useProjectStore.getState().snap;
        const div = snap === '1/4' ? 1 : snap === '1/8' ? 0.5 : snap === '1/16' ? 0.25 : 0.125;
        const sel = useProjectStore.getState().notes.filter(n=>n.selected);
        if (sel.length) useProjectStore.getState().moveNotes(sel.map(n=>n.id), 0, div);
        return; }
      if (e.key === 'Escape') {
        setPaletteOpen(false); setContextMenu(null);
        if (!notifPinned) setNotifOpen(false);
        deselectAll(); return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') &&
          !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault(); deleteSelected(); return;
      }
      if (e.code === 'Space' && !meta &&
          !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        const newPlaying = !isPlaying;
        setPlaying(newPlaying);
        if (newPlaying) {
          const state = useProjectStore.getState();
          playheadClock.start(state.playheadPosition, state.bpm);
          audio.resume().then(() => {
            if (audio.hasWAV) audio.playWAV(state.playheadPosition, state.bpm);
            else audio.playSequence(useProjectStore.getState().notes, state.bpm, state.playheadPosition);
          });
        } else {
          playheadClock.stop();
          audio.stopWAV(); audio.stopSequence();
        }
        return;
      }
      if (!meta && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        if (e.key === 's' || e.key === 'S') setMode('select');
        if (e.key === 'n' || e.key === 'N') setMode('draw');
        if (e.key === 'e' || e.key === 'E') setMode('erase');
        if (e.key === 'p' || e.key === 'P') setMode('pitch');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [notifPinned, isPlaying, handleImportMidi, toggleDark, undo, redo, selectAll, deselectAll, deleteSelected, setMode]);

  // Playhead animation — rAF loop, no stale closure
  // We store the start position in a ref so the loop doesn't re-init on every setPlayhead call
  const playStartTimeRef = useRef<number>(0);
  const playStartBeatRef = useRef<number>(0);

  useEffect(() => {
    if (!isPlaying) return;
    // Capture start position NOW, from store (not from stale closure)
    const startBeat = useProjectStore.getState().playheadPosition;
    playStartTimeRef.current = performance.now();
    playStartBeatRef.current = startBeat;

    let rafId: number;
    let running = true;

    const tick = () => {
      if (!running) return;
      const elapsed = (performance.now() - playStartTimeRef.current) / 1000;
      const bpmNow  = useProjectStore.getState().bpm;
      const newPos  = playStartBeatRef.current + (elapsed * bpmNow / 60);
      if (newPos >= 128) {
        setPlaying(false);
        setPlayhead(0);
        audio.stopSequence();
        useProjectStore.getState().notes.forEach(n => {
          if (n.playing) useProjectStore.getState().updateNote(n.id, { playing: false });
        });
        return;
      }
      setPlayhead(newPos);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(rafId);
    };
  }, [isPlaying]); // ONLY isPlaying — not bpm or playheadPosition

  // ── Context menu builder ───────────────────────────────────────────────
  const buildMenuItems = (target: ContextTarget): ContextMenuEntry[] => {
    switch (target.zone) {
      case 'pianoroll-note': return [
        { label: 'Edit lyric', icon: <Type size={13}/>, onClick: () => {
          const note = useProjectStore.getState().notes.find(n => n.id === (target as any).noteId);
          if (!note) return;
          const lyric = window.prompt('Lyric:', note.lyric ?? '');
          if (lyric !== null) useProjectStore.getState().setLyric(note.id, lyric.trim());
        }},
        { label: 'Duplicate note', icon: <Copy size={13}/>,    shortcut: '⌘D', onClick: () => {
        const s = useProjectStore.getState(); const n = s.notes.find(n => n.id === (target as any).noteId);
        if (n) s.addNote({ pitch:n.pitch, start:n.start + n.duration, duration:n.duration, lyric:n.lyric });
      } },
        { separator: true },
        { label: 'Delete note',    icon: <Trash2 size={13}/>,  shortcut: 'Del', danger: true,
          onClick: () => { useProjectStore.getState().deleteNote((target as any).noteId); } },
      ];
      case 'pianoroll-notes': return [
        { label: `Duplicate ${(target as any).count} notes`, icon: <Copy size={13}/>, shortcut: '⌘D', onClick: () => {
        const s = useProjectStore.getState(); const sel = s.notes.filter(n=>n.selected);
        const offset = Math.max(...sel.map(n=>n.start+n.duration)) - Math.min(...sel.map(n=>n.start));
        sel.forEach(n => s.addNote({pitch:n.pitch, start:n.start+offset, duration:n.duration, lyric:n.lyric}));
      } },
        { label: 'Quantize selection', icon: <AlignLeft size={13}/>, onClick: () => {
          useProjectStore.getState().quantizeSelected();
          const n = useProjectStore.getState().notes.filter(x => x.selected).length;
          if (n) notify({ type:'success', title:`Quantized ${n} notes` });
        }},
        { separator: true },
        { label: `Delete ${(target as any).count} notes`, icon: <Trash2 size={13}/>, shortcut: 'Del', danger: true,
          onClick: () => deleteSelected() },
      ];
      case 'pianoroll-empty': return [
        { label: 'Insert note here', icon: <Pencil size={13}/>,       onClick: () => {} },
        { label: 'Paste', icon: <Clipboard size={13}/>, shortcut: '⌘V', onClick: () => useProjectStore.getState().pasteNotes() },
        { separator: true },
        { label: 'Select all',       icon: <MousePointer2 size={13}/>, shortcut: '⌘A', onClick: selectAll },
        { label: 'Zoom to fit', icon: <Maximize2 size={13}/>, shortcut: '⌘0', onClick: () => { /* TODO: implement zoom */ } },
      ];
      case 'pitch-point': return [
        { label: 'Smooth (bezier)', onClick: () => { /* bezier is default mode */ } },
        { label: 'Sharp (linear)',  onClick: () => { /* linear mode TODO */ } },
        { separator: true },
        { label: 'Delete point', icon: <Trash2 size={13}/>, danger: true, onClick: () => {
          const t = target as any;
          if (t.pointNoteId != null && t.pointX != null)
            useProjectStore.getState().deletePitchPoint(t.pointNoteId, t.pointX);
        }},
      ];
      case 'pitch-empty': return [
        { label: 'Add control point', onClick: () => {
          const t = target as any;
          if (t.beat != null) {
            const notes = useProjectStore.getState().notes;
            const note  = notes.find(n => n.start <= t.beat && n.start + n.duration > t.beat);
            if (note) useProjectStore.getState().addPitchPoint({ noteId: note.id, x: t.beat, y: 0 });
          }
        }},
        { separator: true },
        { label: 'Flat (reset)', icon: <RefreshCw size={13}/>, onClick: () => useProjectStore.getState().clearPitchPoints() },
        { label: 'Note Properties…', onClick: () => setNotePropsOpen(true) },
        { label: 'Fall',    onClick: () => {
          const s = useProjectStore.getState(); const sel = s.notes.find(n=>n.selected);
          if (sel) { s.clearPitchPoints(sel.id); s.addPitchPoint({noteId:sel.id,x:sel.start,y:0}); s.addPitchPoint({noteId:sel.id,x:sel.start+sel.duration,y:-1.5}); }
        }},
        { label: 'Rise',    onClick: () => {
          const s = useProjectStore.getState(); const sel = s.notes.find(n=>n.selected);
          if (sel) { s.clearPitchPoints(sel.id); s.addPitchPoint({noteId:sel.id,x:sel.start,y:-0.5}); s.addPitchPoint({noteId:sel.id,x:sel.start+sel.duration,y:0.5}); }
        }},
      ];
      case 'lyrics-cell': return [
        { label: 'Edit lyric', onClick: () => {
          const beat = (target as any).beat;
          const note = useProjectStore.getState().notes.find(n => n.start === beat);
          if (note) {
            const lyric = window.prompt('Edit lyric:', note.lyric ?? '');
            if (lyric !== null) useProjectStore.getState().setLyric(note.id, lyric.trim());
          }
        }},
        { label: 'Clear lyric', onClick: () => {
          const beat = (target as any).beat;
          const note = useProjectStore.getState().notes.find(n => n.start === beat);
          if (note) useProjectStore.getState().setLyric(note.id, '');
        }},
        { label: 'Auto-split syllables', onClick: () => {
          const text = window.prompt('Paste full lyrics (space-separated syllables):');
          if (!text) return;
          const syllables = text.trim().split(/\s+/);
          const sorted = [...useProjectStore.getState().notes].sort((a,b)=>a.start-b.start);
          syllables.forEach((syl, i) => { if (sorted[i]) useProjectStore.getState().setLyric(sorted[i].id, syl); });
        }},
      ];
      case 'voice-panel': return [
        { label: 'Change voice bank', onClick: () => setVbManagerOpen(true) },
        { separator: true },
        { label: 'Add track', onClick: addTrack },
        { label: 'Remove track', icon: <Trash2 size={13}/>, danger: true, onClick: () => {
          const s = useProjectStore.getState();
          const sel = s.tracks.find(t => t.selected);
          if (sel && s.tracks.length > 1) s.removeTrack(sel.id);
        }},
      ];
      default: return [];
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div
      style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column',
               background: 'var(--bg-base)', overflow: 'hidden', position: 'relative' }}
      onClick={() => setContextMenu(null)}
    >
      <CrossPlatformTitleBar
        projectName={useProjectStore.getState().projectName}
        isDirty={useProjectStore.getState().isDirty}
        platform={platform}
        onRename={(name) => useProjectStore.getState().setProjectName(name)}
      />
      <CommandBar
        requireSave={requireSave}
        onOpenNotifications={() => setNotifOpen(!notifOpen)}
        hasUnread={notifications.length > 0}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenVoicebankManager={() => setVbManagerOpen(true)}
        onImportMidi={handleImportMidi}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenNoteProperties={() => setNotePropsOpen(true)}
        onOpenMLC={() => setMlcWindowOpen(true)}
        canUndo={canUndo()} canRedo={canRedo()}
        onUndo={undo} onRedo={redo}
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <VoicePanel
          onContextMenu={(e) => openContextMenu(e, { zone: 'voice-panel' })}
          onOpenMLCWindow={() => setMlcWindowOpen(true)}
          onOpenVoicebankManager={() => setVbManagerOpen(true)}
        />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <PianoRoll       isDark={isDark} scrollBus={scrollBus.current} onContextMenu={openContextMenu} />
          <PitchCurveEditor isDark={isDark} scrollBus={scrollBus.current} onContextMenu={openContextMenu} />
          <LyricsLane      isDark={isDark} scrollBus={scrollBus.current} onContextMenu={openContextMenu} />
        </div>
        {notePropsOpen && <NotePropertiesPanel onClose={() => setNotePropsOpen(false)} />}
      </div>

      <TransportBar
        isPlaying={isPlaying} bpm={bpm} playheadBeats={playheadPosition}
        onPlayPause={() => {
          const nowPlaying = !isPlaying;
          setPlaying(nowPlaying);
          if (nowPlaying) {
            const state = useProjectStore.getState();
            playheadClock.start(state.playheadPosition, state.bpm);
            audio.resume().then(() => {
              if (audio.hasWAV) audio.playWAV(state.playheadPosition, state.bpm);
              else audio.playSequence(state.notes, state.bpm, state.playheadPosition);
            });
          } else {
            playheadClock.stop();
            audio.stopWAV(); audio.stopSequence();
            useProjectStore.getState().notes.forEach(n => {
              if (n.playing) useProjectStore.getState().updateNote(n.id, { playing: false });
            });
          }
        }}
        onStop={() => { playheadClock.stop(); setPlaying(false); setPlayhead(0); audio.stopWAV(); audio.stopSequence(); }}
        onBpmChange={setBpm}
        onRender={handleRender}
      />

      {notifOpen && (
        <NotificationPanel
          notifications={notifications} isPinned={notifPinned}
          onClose={() => setNotifOpen(false)}
          onTogglePin={() => setNotifPinned(!notifPinned)}
          onDismiss={dismissNotif} onClearAll={clearNotifs}
        />
      )}
      {paletteOpen    && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      {mlcWindowOpen  && <MLCWindow onClose={() => setMlcWindowOpen(false)} />}
      {showWelcome    && <WelcomeScreen onDismiss={() => setShowWelcome(false)} />}
      {extsOpen     && <ExtensionsPanel onClose={() => setExtsOpen(false)} />}
      {savePrompt && (
        <SavePrompt
          projectName={useProjectStore.getState().projectName}
          onSave={savePrompt.onSave}
          onDiscard={savePrompt.onDiscard}
          onCancel={() => setSavePrompt(null)}
        />
      )}
      {vbManagerOpen  && (
        <VoicebankManager
          onClose={() => setVbManagerOpen(false)}
          onSelectBank={(vb) => {
            setVbManagerOpen(false);
            const t = tracks.find(t => t.selected);
            if (t) useProjectStore.getState().updateTrack(t.id, { voiceBank: vb.name, voicePath: vb.path });
          }}
        />
      )}
      {midiImportFile && (
        <MidiImportDialog
          midiFile={midiImportFile}
          onClose={() => setMidiImportFile(null)}
          onImport={handleMidiImportComplete}
        />
      )}
      {settingsOpen  && <SettingsPanel onClose={() => { setSettingsOpen(false); setSettingsTab('general'); }} initialTab={settingsTab} />}
      {contextMenu   && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y}
          items={buildMenuItems(contextMenu.target)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
