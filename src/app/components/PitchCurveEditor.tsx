import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useProjectStore, ScrollSyncBus, ContextTarget, PitchPoint } from '../../store/project';

interface Props {
  isDark: boolean;
  scrollBus: ScrollSyncBus;
  onContextMenu: (e: React.MouseEvent, target: ContextTarget) => void;
}

const PIANO_W   = 52;
const PX_BEAT   = 84;
const BARS      = 16;
const BEATS_PER = 4;
const DEFAULT_H = 120;
const MIN_H     = 60;
const MAX_H     = 280;
const HIT_RADIUS = 10; // px radius for control-point hit-testing

interface DragState {
  type: 'point' | 'create' | null;
  pointNoteId?: string;
  pointX?: number;
  startCanvasX: number;
  startCanvasY: number;
  startPointX?: number;
  startPointY?: number;
}

export function PitchCurveEditor({ isDark, scrollBus, onContextMenu }: Props) {
  const { 
    pitchPoints: controlPoints, 
    notes,
    addPitchPoint, 
    deletePitchPoint,
    movePitchPoint,
  } = useProjectStore();
  
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const wrapRef    = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const [panelH, setPanelH]   = useState(DEFAULT_H);
  const [semRange, setSemRange] = useState(2);
  const [hoveredPoint, setHoveredPoint] = useState<{noteId:string;x:number}|null>(null);
  const dragRef = useRef<DragState>({ type: null, startCanvasX: 0, startCanvasY: 0 });
  
  // Panel resize state
  const resizing     = useRef(false);
  const resizeStartY   = useRef(0);
  const resizeStartH   = useRef(DEFAULT_H);

  // Conversion helpers
  const beatToCanvas = (beat: number) => beat * PX_BEAT;
  const canvasToBeat = (px: number) => px / PX_BEAT;
  const semToCanvas = (sem: number, centerY: number, pxPerSt: number) => centerY - sem * pxPerSt;
  const canvasToSem = (py: number, centerY: number, pxPerSt: number) => (centerY - py) / pxPerSt;

  // Find control point at canvas position
  const hitTestPoint = useCallback((canvasX: number, canvasY: number): PitchPoint | null => {
    const cY = panelH / 2;
    const pxPerSt = (panelH / 2) / semRange;
    
    for (const p of controlPoints) {
      const px = beatToCanvas(p.x);
      const py = semToCanvas(p.y, cY, pxPerSt);
      if (Math.hypot(canvasX - px, canvasY - py) <= HIT_RADIUS) {
        return p;
      }
    }
    return null;
  }, [controlPoints, panelH, semRange]);

  // Find the nearest note for a given beat position
  const findNearestNote = useCallback((beat: number): string | null => {
    if (notes.length === 0) return null;
    let nearest: string | null = null;
    let minDist = Infinity;
    for (const note of notes) {
      // Check if beat is within note range
      if (beat >= note.start && beat <= note.start + note.duration) {
        return note.id;
      }
      // Otherwise find closest note
      const dist = Math.min(Math.abs(beat - note.start), Math.abs(beat - (note.start + note.duration)));
      if (dist < minDist) {
        minDist = dist;
        nearest = note.id;
      }
    }
    return nearest;
  }, [notes]);

  // ── Drag-to-resize handle ─────────────────────────────────────────────────────
  const onHandleMouseDown = (e: React.MouseEvent) => {
    resizing.current  = true;
    resizeStartY.current = e.clientY;
    resizeStartH.current = panelH;
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const delta = resizeStartY.current - ev.clientY;
      setPanelH(Math.min(MAX_H, Math.max(MIN_H, resizeStartH.current + delta)));
    };
    const onUp = () => {
      resizing.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ── Mouse interaction handlers ────────────────────────────────────────────────
  const getCanvasCoords = useCallback((e: React.MouseEvent): {x: number, y: number} => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,  // rect already accounts for scroll offset
      y: e.clientY - rect.top,
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return; // Only left click
    
    const { x: canvasX, y: canvasY } = getCanvasCoords(e);
    const cY = panelH / 2;
    const pxPerSt = (panelH / 2) / semRange;
    
    // ⌘/Ctrl+click = delete point
    if (e.metaKey || e.ctrlKey) {
      const point = hitTestPoint(canvasX, canvasY);
      if (point) {
        deletePitchPoint(point.noteId, point.x);
        return;
      }
    }
    
    // Check if clicking on existing point
    const point = hitTestPoint(canvasX, canvasY);
    if (point) {
      // Start dragging existing point
      dragRef.current = {
        type: 'point',
        pointNoteId: point.noteId,
        pointX: point.x,
        startCanvasX: canvasX,
        startCanvasY: canvasY,
        startPointX: point.x,
        startPointY: point.y,
      };
      
      // Select the point
      useProjectStore.setState(state => ({
        pitchPoints: state.pitchPoints.map(p => ({
          ...p,
          selected: p.noteId === point.noteId && Math.abs(p.x - point.x) < 0.001,
        })),
      }));
    } else {
      // Create new point
      const beat = canvasToBeat(canvasX);
      const sem = canvasToSem(canvasY, cY, pxPerSt);
      const noteId = findNearestNote(beat);
      
      if (noteId) {
        // Clamp semitones to range
        const clampedSem = Math.max(-semRange, Math.min(semRange, sem));
        addPitchPoint({ noteId, x: beat, y: clampedSem });
        
        // Start dragging the new point
        dragRef.current = {
          type: 'create',
          pointNoteId: noteId,
          pointX: beat,
          startCanvasX: canvasX,
          startCanvasY: canvasY,
          startPointX: beat,
          startPointY: clampedSem,
        };
      }
    }
    
    e.preventDefault();
  }, [hitTestPoint, panelH, semRange, deletePitchPoint, addPitchPoint, findNearestNote, getCanvasCoords]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x: canvasX, y: canvasY } = getCanvasCoords(e);
    const cY = panelH / 2;
    const pxPerSt = (panelH / 2) / semRange;
    
    // Dragging a point
    if (dragRef.current.type === 'point' || dragRef.current.type === 'create') {
      const { pointNoteId, startPointX, startPointY, startCanvasX, startCanvasY, pointX: origX } = dragRef.current;
      if (!pointNoteId || startPointX === undefined || startPointY === undefined) return;
      
      const dx = canvasX - startCanvasX;
      const dy = canvasY - startCanvasY;
      const newX = startPointX + canvasToBeat(dx);
      const newY = startPointY - (dy / pxPerSt); // Invert because canvas Y is down
      const clampedY = Math.max(-semRange, Math.min(semRange, newY));
      
      // Update point via store action
      movePitchPoint(pointNoteId, origX ?? startPointX, Math.max(0, newX), clampedY);
      
      // Update the origX for next move
      dragRef.current.pointX = Math.max(0, newX);
      dragRef.current.startPointX = Math.max(0, newX);
      dragRef.current.startPointY = clampedY;
      dragRef.current.startCanvasX = canvasX;
      dragRef.current.startCanvasY = canvasY;
      
      return;
    }
    
    // Hover detection
    const point = hitTestPoint(canvasX, canvasY);
    if (point) {
      setHoveredPoint({ noteId: point.noteId, x: point.x });
    } else {
      setHoveredPoint(null);
    }
  }, [hitTestPoint, panelH, semRange, getCanvasCoords]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = { type: null, startCanvasX: 0, startCanvasY: 0 };
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredPoint(null);
    // Don't clear drag state - handle it on mouseup
  }, []);

  // Global mouseup handler for drag release
  useEffect(() => {
    const onMouseUp = () => {
      dragRef.current = { type: null, startCanvasX: 0, startCanvasY: 0 };
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, []);

  // ── Canvas draw ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w   = BARS * BEATS_PER * PX_BEAT;
    const h   = panelH;
    canvas.width  = w*dpr; canvas.height = h*dpr;
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const s   = getComputedStyle(document.documentElement);
    const get = (v:string) => s.getPropertyValue(v).trim();

    ctx.fillStyle = get('--bg-sunken');
    ctx.fillRect(0, 0, w, h);

    const cY      = h/2;
    const pxPerSt = (h/2) / semRange;

    // Note regions (subtle highlight for note coverage)
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)';
    for (const note of notes) {
      const x = note.start * PX_BEAT;
      const width = note.duration * PX_BEAT;
      ctx.fillRect(x, 0, width, h);
    }

    // Semitone grid lines
    ctx.strokeStyle = get('--border-subtle'); ctx.lineWidth = 0.5;
    for (let st=-semRange; st<=semRange; st+=0.5) {
      if (st===0) continue;
      const y = cY - st*pxPerSt;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
    }

    // Center dashed line (pitch baseline)
    ctx.strokeStyle = get('--border-default'); ctx.lineWidth = 1;
    ctx.setLineDash([5,4]);
    ctx.beginPath(); ctx.moveTo(0,cY); ctx.lineTo(w,cY); ctx.stroke();
    ctx.setLineDash([]);

    // Sort points by x for curve drawing
    const sortedPoints = [...controlPoints].sort((a, b) => a.x - b.x);

    // Curve (smooth bezier through points)
    if (sortedPoints.length >= 2) {
      ctx.strokeStyle = get('--accent'); ctx.lineWidth = 2;
      ctx.beginPath();
      const pts = sortedPoints.map(p => ({ x:p.x*PX_BEAT, y:cY - p.y*pxPerSt }));
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i=1; i<pts.length; i++) {
        const prev = pts[i-1], cur = pts[i];
        const cpx  = (prev.x+cur.x)/2;
        ctx.bezierCurveTo(cpx, prev.y, cpx, cur.y, cur.x, cur.y);
      }
      ctx.stroke();
    }

    // Control points + bezier handles
    controlPoints.forEach(p => {
      const px = p.x*PX_BEAT, py = cY - p.y*pxPerSt;
      const isHovered = hoveredPoint?.noteId === p.noteId && Math.abs(hoveredPoint.x - p.x) < 0.001;
      const isActive = p.selected || isHovered;
      
      if (p.selected) {
        // Draw bezier handles for selected point
        const hx = 28;
        [[-hx,-8],[hx,8]].forEach(([dx,dy]) => {
          ctx.strokeStyle = get('--accent'); ctx.globalAlpha = 0.45;
          ctx.lineWidth = 1; ctx.setLineDash([3,2]);
          ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(px+dx,py+dy); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = get('--bg-surface');
          ctx.strokeStyle = get('--accent'); ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(px+dx, py+dy, 3.5, 0, Math.PI*2);
          ctx.fill(); ctx.stroke();
        });
        ctx.globalAlpha = 1;
      }
      
      // Main control point
      ctx.fillStyle   = get('--bg-surface');
      ctx.strokeStyle = isActive ? get('--accent') : get('--border-strong');
      ctx.lineWidth   = isActive ? 2 : 1.5;
      ctx.beginPath(); ctx.arc(px, py, isActive ? 6 : 4, 0, Math.PI*2);
      ctx.fill(); ctx.stroke();
      
      // Inner dot for active points
      if (isActive) {
        ctx.fillStyle = get('--accent');
        ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI*2);
        ctx.fill();
      }
    });

  }, [controlPoints, panelH, semRange, isDark, hoveredPoint, notes]);

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
    const { x: canvasX, y: canvasY } = getCanvasCoords(e);
    const point = hitTestPoint(canvasX, canvasY);

    if (point) {
      // Select the point
      useProjectStore.setState(state => ({
        pitchPoints: state.pitchPoints.map(p => ({
          ...p,
          selected: p.noteId === point.noteId && Math.abs(p.x - point.x) < 0.001,
        })),
      }));
      onContextMenu(e, { zone:'pitch-point', pointIdx: controlPoints.indexOf(point) });
    } else {
      onContextMenu(e, { zone:'pitch-empty' });
    }
  }, [controlPoints, hitTestPoint, onContextMenu, getCanvasCoords]);

  return (
    <div style={{
      height:panelH, flexShrink:0,
      background:'var(--bg-sunken)',
      borderTop:'0.5px solid var(--border-subtle)',
      display:'flex', position:'relative',
    }}>
      {/* Resize handle */}
      <div onMouseDown={onHandleMouseDown} style={{
        position:'absolute', top:0, left:0, right:0, height:6,
        cursor:'ns-resize', zIndex:10,
        display:'flex', alignItems:'center', justifyContent:'center',
      }}>
        <div style={{ width:24, height:2, background:'var(--border-default)', borderRadius:2 }}/>
      </div>

      {/* Left label */}
      <div style={{
        width:PIANO_W, flexShrink:0,
        background:'var(--bg-sunken)',
        borderRight:'0.5px solid var(--border-subtle)',
        display:'flex', flexDirection:'column',
        justifyContent:'center', padding:'0 var(--space-2)',
        gap:3,
      }}>
        <div style={{ fontSize:'var(--text-sm)', fontWeight:'var(--font-weight-medium)', color:'var(--text-secondary)' }}>
          Pitch
        </div>
        <div style={{ fontSize:'var(--mono-sm)', fontFamily:'var(--font-mono)', color:'var(--text-tertiary)' }}>
          ±{semRange}st
        </div>
        <div style={{ display:'flex', gap:2, marginTop:2 }}>
          {['+','-'].map(op => (
            <button key={op}
              onClick={() => setSemRange(r => op==='+' ? Math.max(1,r-1) : Math.min(12,r+1))}
              style={{
                width:16, height:16, borderRadius:'var(--radius-sm)',
                fontSize:12, lineHeight:1,
                color:'var(--text-tertiary)', display:'flex', alignItems:'center', justifyContent:'center',
                border:'0.5px solid var(--border-subtle)',
                transition:'all var(--duration-fast)',
              }}
            >{op}</button>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div ref={wrapRef} style={{ flex:1, overflowX:'auto', overflowY:'hidden' }}>
        <canvas
          ref={canvasRef}
          style={{ 
            display:'block', 
            cursor: hoveredPoint ? 'grab' : 'crosshair',
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onContextMenu={handleCanvasContextMenu}
        />
      </div>
    </div>
  );
}
