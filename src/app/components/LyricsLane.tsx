import React, { useRef, useEffect, useCallback } from 'react';
import { useProjectStore, ScrollSyncBus, ContextTarget } from '../../store/project';

interface LyricCell { beat: number; duration: number; text: string; isEditing: boolean; }

interface Props {
  cells?: LyricCell[];
  isDark: boolean;
  scrollBus: ScrollSyncBus;
  onContextMenu: (e: React.MouseEvent, target: ContextTarget) => void;
}

const PIANO_W   = 52;
const PX_BEAT   = 84;
const LANE_H    = 32;
const BARS      = 16;
const BEATS_PER = 4;

export function LyricsLane({ isDark, scrollBus, onContextMenu }: Props) {
  const { notes } = useProjectStore();
  const cells = notes.map(n => ({
    beat: n.start, duration: n.duration, text: n.lyric, isEditing: false,
  }));
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const wrapRef    = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

  // ── Canvas draw ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w   = BARS * BEATS_PER * PX_BEAT;
    const h   = LANE_H;
    canvas.width=w*dpr; canvas.height=h*dpr;
    canvas.style.width=`${w}px`; canvas.style.height=`${h}px`;
    ctx.scale(dpr, dpr);

    const s   = getComputedStyle(document.documentElement);
    const get = (v:string) => s.getPropertyValue(v).trim();

    ctx.fillStyle = get('--bg-surface');
    ctx.fillRect(0, 0, w, h);

    cells.forEach(cell => {
      const x  = cell.beat * PX_BEAT;
      const cw = cell.duration * PX_BEAT;

      if (cell.isEditing) {
        ctx.fillStyle = get('--accent-subtle');
        ctx.fillRect(x, 0, cw, h);
        ctx.strokeStyle = get('--accent'); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x,h-1.5); ctx.lineTo(x+cw,h-1.5); ctx.stroke();
      }

      ctx.strokeStyle = get('--border-subtle'); ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(x+cw,2); ctx.lineTo(x+cw,h-2); ctx.stroke();

      if (cell.text) {
        ctx.fillStyle = cell.isEditing ? get('--accent-text') : get('--text-primary');
        ctx.font = `400 13px 'Inter', sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(cell.text, x+cw/2, h/2);
      }

      if (cell.isEditing && cell.text) {
        const mw = ctx.measureText(cell.text).width;
        const cx = x+cw/2+mw/2+2;
        ctx.strokeStyle = get('--accent'); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx,6); ctx.lineTo(cx,h-6); ctx.stroke();
      }
    });
  }, [cells, isDark]); // isDark → redraw with new CSS vars

  // ── Scroll sync ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const listener = (x: number) => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      wrap.scrollLeft = x;
      syncingRef.current = false;
    };
    scrollBus.listeners.add(listener);
    const onScroll = () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      scrollBus.scrollX = wrap.scrollLeft;
      scrollBus.listeners.forEach(l => { if (l !== listener) l(wrap.scrollLeft); });
      syncingRef.current = false;
    };
    wrap.addEventListener('scroll', onScroll);
    return () => { scrollBus.listeners.delete(listener); wrap.removeEventListener('scroll', onScroll); };
  }, [scrollBus]);

  // ── Right-click hit-test ─────────────────────────────────────────────────────
  const handleCanvasContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    const wrap   = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect    = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;  // rect already accounts for scroll
    const beat    = canvasX / PX_BEAT;
    // Find which cell was clicked
    const cell = cells.find(c => beat >= c.beat && beat < c.beat + c.duration);
    onContextMenu(e, { zone:'lyrics-cell', beat: cell?.beat ?? beat });
  }, [cells, onContextMenu]);

  return (
    <div style={{
      height:LANE_H, flexShrink:0,
      background:'var(--bg-surface)',
      borderTop:'0.5px solid var(--border-subtle)',
      display:'flex',
    }}>
      <div style={{
        width:PIANO_W, flexShrink:0,
        background:'var(--bg-surface)',
        borderRight:'0.5px solid var(--border-subtle)',
        display:'flex', alignItems:'center',
        padding:'0 var(--space-2)',
        fontSize:'var(--text-sm)', fontWeight:'var(--font-weight-medium)',
        color:'var(--text-secondary)',
      }}>
        Lyrics
      </div>

      <div ref={wrapRef} style={{ flex:1, overflowX:'auto', overflowY:'hidden' }}>
        <canvas
          ref={canvasRef}
          style={{ display:'block', cursor:'text' }}
          onContextMenu={handleCanvasContextMenu}
        />
      </div>
    </div>
  );
}
