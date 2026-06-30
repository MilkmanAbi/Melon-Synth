/**
 * Piano Roll
 * ==========
 * Canvas-based note editor. All interaction goes through mouse handlers.
 *
 * Key architecture:
 *   - noteBoxes ref: spatial index rebuilt every draw, used for hit testing
 *   - drag ref:      mutable drag state, never React state (no re-render during drag)
 *   - canvasCoords:  converts screen → canvas coords WITHOUT double-counting scroll
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { MousePointer2, Pencil, Eraser, TrendingUp } from 'lucide-react';
import { useProjectStore, snapBeat, snapDuration, ScrollSyncBus, ContextTarget } from '../../store/project';
import { playheadClock } from '../../subsystems/playhead';
import { audio } from '../../subsystems/audio';

interface Props {
  isDark:        boolean;
  scrollBus:     ScrollSyncBus;
  onContextMenu: (e: React.MouseEvent, target: ContextTarget) => void;
}

const PIANO_W   = 52;
const RULER_H   = 24;
const PX_BEAT   = 84;
const PX_SEMI   = 18;
const BARS      = 32;
const BEATS_PER = 4;
const LO        = 36;   // C2
const HI        = 96;   // C7
const TOTAL     = HI - LO + 1;

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const BLACK_KEYS = new Set([1,3,6,8,10]);

const noteName  = (m: number) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);
const isBlack   = (m: number) => BLACK_KEYS.has(m % 12);

interface NoteBox { id: string; x: number; y: number; w: number; h: number; }

type DragType = 'create' | 'move' | 'resize' | 'rubber';
interface DragState {
  type:        DragType;
  startX:      number;
  startY:      number;
  startBeat:   number;
  startPitch:  number;
  noteId?:     string;
  origNotes?:  { id: string; start: number; pitch: number }[];
  rubberX2?:   number;
  rubberY2?:   number;
}

export function PianoRoll({ isDark, scrollBus, onContextMenu }: Props) {
  const {
    notes, mode, snap, setMode, setSnap,
    addNote, updateNote, moveNotes, resizeNote,
    selectNote, selectRange, deselectAll, deleteNote,
    playheadPosition,
  } = useProjectStore();

  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const wrapRef    = useRef<HTMLDivElement>(null);
  const rulerRef   = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const noteBoxes  = useRef<NoteBox[]>([]);
  const drag       = useRef<DragState | null>(null);
  const rafId      = useRef<number>();

  // ── Draw ──────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const W   = BARS * BEATS_PER * PX_BEAT;
    const H   = TOTAL * PX_SEMI;

    if (canvas.width !== W * dpr) {
      canvas.width       = W * dpr;
      canvas.height      = H * dpr;
      canvas.style.width  = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.scale(dpr, dpr);
    }

    const cs  = getComputedStyle(document.documentElement);
    const v   = (k: string) => cs.getPropertyValue(k).trim();

    // Background
    ctx.fillStyle = v('--bg-base');
    ctx.fillRect(0, 0, W, H);

    // Black key rows
    for (let i = 0; i < TOTAL; i++) {
      if (isBlack(LO + i)) {
        ctx.fillStyle = v('--grid-black-key');
        ctx.fillRect(0, (TOTAL - 1 - i) * PX_SEMI, W, PX_SEMI);
      }
    }

    // Middle C tint
    const c4i = 60 - LO;
    if (c4i >= 0 && c4i < TOTAL) {
      ctx.fillStyle = v('--grid-middle-c');
      ctx.fillRect(0, (TOTAL - 1 - c4i) * PX_SEMI, W, PX_SEMI);
    }

    // Horizontal semitone lines
    ctx.strokeStyle = v('--grid-semitone'); ctx.lineWidth = 0.5;
    for (let i = 0; i <= TOTAL; i++) {
      const y = i * PX_SEMI;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Vertical grid — snap-aware
    // We draw lines at 4 levels of hierarchy: bar > beat > 1/8 > snap-subdivision
    // Only draw subdivisions finer than the current snap
    const total    = BARS * BEATS_PER;
    const snapNow  = useProjectStore.getState().snap;
    const snapDivPx: Record<string, number> = {
      '1/4':  PX_BEAT,         // 1 beat = 84px
      '1/8':  PX_BEAT / 2,     // 42px
      '1/16': PX_BEAT / 4,     // 21px
      '1/32': PX_BEAT / 8,     // 10.5px
    };
    const snapPx = snapDivPx[snapNow] ?? PX_BEAT / 4;

    // Draw finest subdivision lines (at current snap) — very faint
    if (snapPx < PX_BEAT) {  // don't draw if snap is 1/4 (= beat lines, drawn below)
      const steps = Math.round((BARS * BEATS_PER * PX_BEAT) / snapPx);
      ctx.strokeStyle = v('--border-subtle');
      ctx.globalAlpha = snapNow === '1/32' ? 0.5 : 0.7;
      ctx.lineWidth = 0.5;
      for (let i = 1; i <= steps; i++) {
        const x = i * snapPx;
        // Skip if this falls on a beat or bar line (drawn with stronger style below)
        const isBeat = Math.abs(x % PX_BEAT) < 0.5;
        if (isBeat) continue;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Beat lines (every beat, not bar)
    ctx.strokeStyle = v('--grid-beat'); ctx.lineWidth = 0.5;
    for (let b = 1; b < total; b++) {
      if (b % BEATS_PER === 0) continue;
      const x = b * PX_BEAT;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }

    // Bar lines (strongest)
    ctx.strokeStyle = v('--grid-bar'); ctx.lineWidth = 0.5;
    for (let bar = 0; bar <= BARS; bar++) {
      const x = bar * BEATS_PER * PX_BEAT;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }

    // Notes — rebuild spatial index
    const boxes: NoteBox[] = [];
    const allNotes = useProjectStore.getState().notes;

    allNotes.forEach(note => {
      const ni = note.pitch - LO;
      if (ni < 0 || ni >= TOTAL) return;
      const x  = note.start * PX_BEAT;
      const nw = Math.max(note.duration * PX_BEAT - 1, 4);
      const y  = (TOTAL - 1 - ni) * PX_SEMI + 1;
      const nh = PX_SEMI - 2;
      boxes.push({ id: note.id, x, y, w: nw, h: nh });

      const fill = note.playing  ? v('--note-playing')
                 : note.selected ? v('--note-selected')
                 : v('--note-fill');
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.roundRect(x, y, nw, nh, 3); ctx.fill();

      if (note.selected) {
        ctx.strokeStyle = v('--accent'); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x + 5, y + 1); ctx.lineTo(x + nw - 5, y + 1); ctx.stroke();
      }

      if (note.playing) {
        ctx.strokeStyle = v('--note-playing');
        ctx.globalAlpha = 0.3; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(x - 1, y - 1, nw + 2, nh + 2, 4); ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Lyric text
      if (nw > 20 && note.lyric) {
        ctx.fillStyle = note.playing ? '#1C1B19' : 'rgba(255,255,255,0.92)';
        ctx.font = `400 11px 'Inter', sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        // Clip long lyrics
        const maxW = nw - 8;
        const text  = note.lyric;
        if (ctx.measureText(text).width > maxW) {
          ctx.save();
          ctx.rect(x + 2, y, nw - 4, nh); ctx.clip();
        }
        ctx.fillText(text, x + nw / 2, y + nh / 2);
        if (ctx.measureText(text).width > maxW) ctx.restore();
      }

      // Resize handle (right 6px)
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(x + nw - 5, y + 1, 4, nh - 2);
    });
    noteBoxes.current = boxes;

    // Rubber-band
    const d = drag.current;
    if (d?.type === 'rubber' && d.rubberX2 != null) {
      const rx = Math.min(d.startX, d.rubberX2);
      const ry = Math.min(d.startY, d.rubberY2!);
      const rw = Math.abs(d.rubberX2 - d.startX);
      const rh = Math.abs(d.rubberY2! - d.startY);
      ctx.fillStyle   = v('--accent-subtle');
      ctx.strokeStyle = v('--accent');
      ctx.lineWidth   = 1;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.globalAlpha = 1;
      ctx.strokeRect(rx, ry, rw, rh);
    }

    // Playhead — use live clock when playing for smooth 60fps, store value when stopped
    const ph = playheadClock.playing ? playheadClock.position : useProjectStore.getState().playheadPosition;
    const px = ph * PX_BEAT;
    ctx.strokeStyle = v('--accent'); ctx.lineWidth = 1.5; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle   = v('--accent');
    ctx.beginPath(); ctx.moveTo(px - 5, 0); ctx.lineTo(px + 5, 0); ctx.lineTo(px, 8); ctx.closePath(); ctx.fill();

  }, [isDark]);

  // ── Draw triggers ───────────────────────────────────────────────────────────
  // Static redraws: whenever state changes (React-driven, one-shot)
  useEffect(() => {
    if (rafId.current) cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(draw);
    return () => { if (rafId.current) cancelAnimationFrame(rafId.current); };
  });

  // Continuous 60fps loop when playing — reads from playheadClock directly
  // completely bypasses React rendering for smooth playhead animation
  useEffect(() => {
    const { isPlaying } = useProjectStore.getState();
    if (!isPlaying) return;

    let animId: number;
    let alive = true;

    const loop = () => {
      if (!alive) return;
      draw();
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);

    return () => { alive = false; cancelAnimationFrame(animId); };
  }, [useProjectStore.getState().isPlaying, draw]); // re-run when play state changes

  // ── Scroll sync ────────────────────────────────────────────────────────────
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const listener = (x: number) => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      wrap.scrollLeft = x;
      if (rulerRef.current) rulerRef.current.style.transform = `translateX(-${x}px)`;
      syncingRef.current = false;
    };
    scrollBus.listeners.add(listener);
    const onScroll = () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      scrollBus.scrollX = wrap.scrollLeft;
      if (rulerRef.current) rulerRef.current.style.transform = `translateX(-${wrap.scrollLeft}px)`;
      scrollBus.listeners.forEach(l => l !== listener && l(wrap.scrollLeft));
      syncingRef.current = false;
    };
    wrap.addEventListener('scroll', onScroll);
    return () => { scrollBus.listeners.delete(listener); wrap.removeEventListener('scroll', onScroll); };
  }, [scrollBus]);

  // ── CORRECT canvas coordinate conversion ─────────────────────────────────
  // getBoundingClientRect() already accounts for scroll — don't add scrollLeft again.
  // When canvas scrolls left by 300px, rect.left decreases by 300px.
  // So (clientX - rect.left) already gives absolute canvas x.
  const canvasCoords = useCallback((e: MouseEvent | React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect   = canvas.getBoundingClientRect();
    return {
      cx: e.clientX - rect.left,
      cy: e.clientY - rect.top,
    };
  }, []);

  const posToNote = (cx: number, cy: number) => ({
    beat:  cx / PX_BEAT,
    pitch: HI - Math.floor(cy / PX_SEMI),
  });

  // Hit detection with padding for easier clicking (especially eraser)
  const hitNote = (cx: number, cy: number, padding = 0): NoteBox | null =>
    [...noteBoxes.current].reverse().find(
      b => cx >= b.x - padding && cx <= b.x + b.w + padding && 
           cy >= b.y - padding && cy <= b.y + b.h + padding
    ) ?? null;

  const isResizeZone = (cx: number, box: NoteBox) => cx >= box.x + box.w - 8;

  // ── Mouse down ─────────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const { cx, cy } = canvasCoords(e);
    const { beat, pitch } = posToNote(cx, cy);
    const state = useProjectStore.getState();
    const { mode, snap } = state;
    const hit = hitNote(cx, cy);

    if (mode === 'erase') {
      // Use larger hit area (8px padding) for easier erasing
      const hit = hitNote(cx, cy, 8);
      if (hit) { deleteNote(hit.id); audio.previewNote(pitch, 60); }
      return;
    }

    if (mode === 'draw') {
      deselectAll();
      const sb  = snapBeat(beat, snap);
      // Use snap division as default note length (1/4→1beat, 1/8→0.5, 1/16→0.25, 1/32→0.125)
      const snapMap: Record<string,number> = {'1/4':1,'1/8':0.5,'1/16':0.25,'1/32':0.125};
      const dur = snapMap[snap] ?? 0.25;
      const id  = addNote({ pitch, start: sb, duration: dur, lyric: '' });
      audio.previewNote(pitch, 200);
      drag.current = { type:'create', startX:cx, startY:cy, startBeat:sb, startPitch:pitch, noteId:id };
      return;
    }

    if (mode === 'select') {
      if (hit) {
        const isSelected = state.notes.find(n => n.id === hit.id)?.selected ?? false;
        if (!isSelected) selectNote(hit.id, e.metaKey || e.ctrlKey);
        const selected = useProjectStore.getState().notes.filter(n => n.selected || n.id === hit.id);
        if (isResizeZone(cx, hit)) {
          drag.current = { type:'resize', startX:cx, startY:cy, startBeat:beat, startPitch:pitch, noteId:hit.id };
        } else {
          drag.current = {
            type:'move', startX:cx, startY:cy, startBeat:beat, startPitch:pitch, noteId:hit.id,
            origNotes: selected.map(n => ({ id:n.id, start:n.start, pitch:n.pitch })),
          };
        }
      } else {
        if (!e.metaKey && !e.ctrlKey) deselectAll();
        drag.current = { type:'rubber', startX:cx, startY:cy, startBeat:beat, startPitch:pitch };
      }
      return;
    }

    if (mode === 'pitch') {
      // Find the note at this beat position
      const notes = useProjectStore.getState().notes;
      const noteAtBeat = notes.find(n => beat >= n.start && beat <= n.start + n.duration);
      if (noteAtBeat) {
        // semitone offset from note pitch: y=0 is on the note, y>0 is higher
        const semOffset = 0; // start flat, user can drag
        useProjectStore.getState().addPitchPoint({ noteId: noteAtBeat.id, x: beat, y: semOffset });
        audio.previewNote(noteAtBeat.pitch, 80);
      }
      return;
    }
  }, [canvasCoords, addNote, deleteNote, deselectAll, selectNote]);

  // ── Mouse move ─────────────────────────────────────────────────────────────
  const onMouseMove = useCallback((e: MouseEvent) => {
    const d = drag.current;
    if (!d) return;
    const { cx, cy } = canvasCoords(e);
    const { beat, pitch } = posToNote(cx, cy);
    const { snap } = useProjectStore.getState();

    if (d.type === 'create' && d.noteId) {
      const rawDur = (cx - d.startX) / PX_BEAT;
      resizeNote(d.noteId, snapDuration(Math.max(PX_BEAT * 0.0625 / PX_BEAT, rawDur), snap));
    }

    if (d.type === 'move' && d.origNotes) {
      const rawDB = beat - d.startBeat;
      const dBeat = snapBeat(rawDB, snap);
      const dPitch = pitch - d.startPitch;
      if (dBeat !== 0 || dPitch !== 0) {
        moveNotes(d.origNotes.map(n => n.id), dPitch, dBeat);
        d.origNotes = d.origNotes.map(n => ({ id:n.id, start:n.start + dBeat, pitch:n.pitch + dPitch }));
        d.startBeat  += dBeat;
        d.startPitch += dPitch;
      }
    }

    if (d.type === 'resize' && d.noteId) {
      const note = useProjectStore.getState().notes.find(n => n.id === d.noteId);
      if (note) {
        const rawDur = (cx - note.start * PX_BEAT) / PX_BEAT;
        resizeNote(d.noteId, snapDuration(Math.max(0.0625, rawDur), snap));
      }
    }

    if (d.type === 'rubber') {
      d.rubberX2 = cx; d.rubberY2 = cy;
      const minBeat  = Math.min(d.startBeat, beat);
      const maxBeat  = Math.max(d.startBeat, beat);
      const minPitch = Math.min(d.startPitch, pitch);
      const maxPitch = Math.max(d.startPitch, pitch);
      selectRange(minBeat, maxBeat, minPitch, maxPitch);
    }
  }, [canvasCoords, moveNotes, resizeNote, selectRange]);

  // ── Mouse up ───────────────────────────────────────────────────────────────
  const onMouseUp = useCallback(() => {
    drag.current = null;
    // Force immediate redraw to clear rubber-band rect
    requestAnimationFrame(() => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(draw);
    });
  }, [draw]);

  // ── Double-click: inline lyric edit ───────────────────────────────────────
  const onDblClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { cx, cy } = canvasCoords(e);
    const hit = hitNote(cx, cy);
    if (!hit) return;
    const note = useProjectStore.getState().notes.find(n => n.id === hit.id);
    if (!note) return;

    // Create invisible overlay to catch clicks outside the input
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 999;
      cursor: default;
    `;
    document.body.appendChild(overlay);

    const input = document.createElement('input');
    input.value = note.lyric;
    input.style.cssText = `
      position: fixed;
      left: ${e.clientX - 20}px;
      top:  ${e.clientY - 10}px;
      width: ${Math.max(hit.w, 40)}px;
      height: 20px;
      font: 400 11px 'Inter', sans-serif;
      text-align: center;
      background: var(--bg-overlay);
      color: var(--text-primary);
      border: 1.5px solid var(--accent);
      border-radius: 4px;
      outline: none;
      z-index: 1000;
      padding: 0 4px;
    `;
    document.body.appendChild(input);
    input.select();
    input.focus();

    const cleanup = () => {
      overlay.remove();
      input.remove();
    };

    const commit = () => {
      useProjectStore.getState().setLyric(note.id, input.value.trim());
      cleanup();
    };

    overlay.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      commit();
    });
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); commit(); }
      if (ev.key === 'Escape') { cleanup(); }
      ev.stopPropagation();
    });
  }, [canvasCoords]);

  // ── Keyboard: canvas-level shortcuts ─────────────────────────────────────
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey;
    if (!meta) {
      if (e.key === 'n' || e.key === 'N') setMode('draw');
      if (e.key === 's' || e.key === 'S') setMode('select');
      if (e.key === 'e' || e.key === 'E') setMode('erase');
      if (e.key === 'p' || e.key === 'P') setMode('pitch');
    }
  }, [setMode]);

  // ── Cursor ─────────────────────────────────────────────────────────────────
  const getCursor = () => {
    if (mode === 'draw')  return 'crosshair';
    if (mode === 'erase') return 'cell';
    if (mode === 'pitch') return 'cell';
    return 'default';
  };

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const { mode: currentMode, snap: currentSnap } = useProjectStore();

  const MODES = [
    { id:'select' as const, icon:MousePointer2, key:'S', title:'Select (S)' },
    { id:'draw'   as const, icon:Pencil,        key:'N', title:'Draw (N)' },
    { id:'erase'  as const, icon:Eraser,        key:'E', title:'Erase (E)' },
    { id:'pitch'  as const, icon:TrendingUp,    key:'P', title:'Pitch (P) — click a note to add control point' },
  ] as const;

  const SNAPS = ['1/4','1/8','1/16','1/32'] as const;

  return (
    <div
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', position:'relative', minHeight:0, outline:'none' }}
    >
      {/* Ruler */}
      <div style={{
        height:RULER_H, flexShrink:0,
        background:'var(--bg-sunken)', borderBottom:'0.5px solid var(--border-subtle)',
        display:'flex', alignItems:'center',
        overflow:'hidden', paddingLeft:PIANO_W,
      }}>
        <div ref={rulerRef} style={{ display:'flex', flexShrink:0, pointerEvents:'none' }}>
          {Array.from({ length:BARS }, (_, i) => (
            <div key={i} style={{
              width: BEATS_PER * PX_BEAT, flexShrink:0,
              fontSize:'var(--mono-sm)', fontFamily:'var(--font-mono)',
              color:'var(--text-tertiary)', paddingLeft:6,
              borderLeft: i > 0 ? '0.5px solid var(--border-default)' : 'none',
            }}>
              {i + 1}
            </div>
          ))}
        </div>
      </div>

      {/* Roll body */}
      <div style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>
        {/* Piano keys */}
        <div style={{
          width:PIANO_W, flexShrink:0,
          background:'var(--bg-sunken)', borderRight:'0.5px solid var(--border-subtle)',
          overflowY:'hidden',
        }}>
          {Array.from({ length:TOTAL }, (_, i) => {
            const m   = HI - i;
            const isC = m % 12 === 0;
            return (
              <div key={i}
                onClick={() => audio.previewNote(m, 400)}
                style={{
                  height: PX_SEMI,
                  display:'flex', alignItems:'center', justifyContent:'flex-end',
                  paddingRight:6, cursor:'pointer',
                  background: isBlack(m) ? 'var(--grid-black-key)' : 'transparent',
                  borderBottom:'0.5px solid var(--border-subtle)',
                  userSelect:'none',
                }}
              >
                {(isC || m === 60) && (
                  <span style={{
                    fontSize:10, fontFamily:'var(--font-mono)',
                    color: m === 60 ? 'var(--accent)' : 'var(--text-tertiary)',
                    fontWeight: m === 60 ? '500' : '400',
                  }}>
                    {noteName(m)}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Canvas */}
        <div ref={wrapRef} data-piano-scroll style={{ flex:1, overflowX:'auto', overflowY:'auto' }}>
          <canvas
            ref={canvasRef}
            style={{ display:'block', cursor:getCursor() }}
            onMouseDown={onMouseDown}
            onDoubleClick={onDblClick}
            onContextMenu={e => {
              e.preventDefault();
              const { cx, cy } = canvasCoords(e);
              const { beat, pitch } = posToNote(cx, cy);
              const hit = hitNote(cx, cy);
              const selCount = useProjectStore.getState().notes.filter(n => n.selected).length;
              if (hit) {
                const isHitSelected = useProjectStore.getState().notes.find(n => n.id === hit.id)?.selected;
                if (selCount > 1 && isHitSelected) onContextMenu(e, { zone:'pianoroll-notes', count:selCount });
                else onContextMenu(e, { zone:'pianoroll-note', noteId:hit.id });
              } else {
                onContextMenu(e, { zone:'pianoroll-empty', beat, pitch });
              }
            }}
          />
        </div>
      </div>

      {/* Mode + snap toolbar */}
      <div style={{
        position:'absolute', top:RULER_H + 8, right:8,
        display:'flex', background:'var(--bg-surface)',
        border:'0.5px solid var(--border-default)',
        borderRadius:'var(--radius-md)', padding:2, gap:1,
        boxShadow:'0 1px 4px rgba(0,0,0,0.06)',
      }}>
        {MODES.map(({ id, icon:Icon, key }) => (
          <button key={id} onClick={() => setMode(id)}
            title={`${id} (${key})`}
            style={{
              width:28, height:24,
              display:'flex', alignItems:'center', justifyContent:'center',
              background: currentMode === id ? 'var(--accent)' : 'transparent',
              color:      currentMode === id ? 'white' : 'var(--text-tertiary)',
              borderRadius:'var(--radius-sm)', transition:'all var(--duration-fast)',
            }}>
            <Icon size={13}/>
          </button>
        ))}
        <div style={{ width:'0.5px', background:'var(--border-subtle)', margin:'4px 2px' }}/>
        <select value={currentSnap} onChange={e => setSnap(e.target.value as any)} style={{
          height:24, padding:'0 4px',
          fontSize:'var(--mono-sm)', fontFamily:'var(--font-mono)',
          color:'var(--text-secondary)', background:'transparent',
          border:'none', outline:'none', cursor:'pointer',
        }}>
          {SNAPS.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>
    </div>
  );
}
