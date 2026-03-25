/**
 * Transport Bar
 * =============
 * Play/pause/stop, BPM (click to type, scroll to increment),
 * time display (computed live), volume with real drag, render, export.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { SkipBack, Play, Pause, Square, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { withLock } from '../../subsystems/async-lock';

interface Props {
  isPlaying:     boolean;
  bpm:           number;
  playheadBeats: number;
  onPlayPause:   () => void;
  onStop:        () => void;
  onBpmChange:   (bpm: number) => void;
  onRender?:     () => void;
}

function beatsToTime(beats: number, bpm: number): string {
  const s   = (beats / bpm) * 60;
  const m   = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs  = Math.floor((s % 1) * 100);
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}:${String(cs).padStart(2,'0')}`;
}

// ── Proper draggable slider ───────────────────────────────────────────────────
function HSlider({
  value, min = 0, max = 100, width = 80,
  onChange, color = 'var(--accent)',
}: {
  value: number; min?: number; max?: number; width?: number;
  onChange: (v: number) => void; color?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const pct = ((value - min) / (max - min)) * 100;

  const getVal = useCallback((clientX: number) => {
    if (!trackRef.current) return value;
    const r = trackRef.current.getBoundingClientRect();
    return Math.round(Math.max(min, Math.min(max, min + ((clientX - r.left) / r.width) * (max - min))));
  }, [min, max, value]);

  const onDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    onChange(getVal(e.clientX));

    const onMove = (ev: MouseEvent) => { if (isDragging.current) onChange(getVal(ev.clientX)); };
    const onUp   = () => {
      isDragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
  }, [getVal, onChange]);

  return (
    <div
      ref={trackRef}
      onMouseDown={onDown}
      style={{
        width, height:3,
        background:'var(--border-subtle)',
        borderRadius:'var(--radius-full)',
        position:'relative', cursor:'pointer',
        userSelect:'none',
      }}
    >
      <div style={{
        height:'100%', width:`${pct}%`,
        background:color,
        borderRadius:'var(--radius-full)',
      }}/>
      <div style={{
        position:'absolute',
        left:`calc(${pct}% - 5px)`, top:-3.5,
        width:10, height:10, borderRadius:'50%',
        background:'var(--bg-surface)',
        border:`1.5px solid ${color}`,
        boxShadow:'0 1px 3px rgba(0,0,0,0.12)',
        pointerEvents:'none',
      }}/>
    </div>
  );
}

export function TransportBar({
  isPlaying, bpm, playheadBeats, onPlayPause, onStop, onBpmChange, onRender,
}: Props) {
  const [editingBpm, setEditingBpm] = useState(false);
  const [bpmInput,   setBpmInput]   = useState(String(bpm));
  const [volume,     setVolume]     = useState(70);
  const [muted,      setMuted]      = useState(false);

  // Sync volume to audio subsystem
  useEffect(() => {
    import('../../subsystems/audio').then(({ audio }) => {
      audio.setVolume(muted ? 0 : volume / 100);
    }).catch(() => {});
  }, [volume, muted]);

  const commitBpm = () => {
    const v = parseInt(bpmInput);
    if (!isNaN(v) && v >= 20 && v <= 300) onBpmChange(v);
    else setBpmInput(String(bpm));
    setEditingBpm(false);
  };

  // Scroll wheel on BPM
  const onBpmScroll = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1 : -1;
    const step  = e.shiftKey ? 5 : 1;
    onBpmChange(Math.max(20, Math.min(300, bpm + delta * step)));
  };

  const btn = (active?: boolean): React.CSSProperties => ({
    width:32, height:28,
    display:'flex', alignItems:'center', justifyContent:'center',
    background: active ? 'var(--accent)' : 'var(--bg-sunken)',
    border: active ? 'none' : '0.5px solid var(--border-default)',
    borderRadius:'var(--radius-md)',
    color: active ? 'white' : 'var(--text-primary)',
    cursor:'pointer', transition:'all var(--duration-fast)', flexShrink:0,
  });

  return (
    <div style={{
      height:48, flexShrink:0,
      background:'var(--bg-surface)',
      borderTop:'0.5px solid var(--border-subtle)',
      display:'flex', alignItems:'center',
      padding:'0 var(--space-4)', gap:'var(--space-3)',
    }}>

      {/* Transport */}
      <div style={{ display:'flex', gap:'var(--space-1)' }}>
        <button style={btn()} onClick={() => { onStop(); }} title="Return to start"><SkipBack size={14}/></button>
        <button style={btn(true)} onClick={onPlayPause} title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}>
          {isPlaying ? <Pause size={14} fill="white"/> : <Play size={14} fill="white"/>}
        </button>
        <button style={btn()} onClick={onStop} title="Stop"><Square size={14}/></button>
        <button style={btn()} onClick={() => {}} title="Jump to end"><SkipForward size={14}/></button>
      </div>

      {/* BPM */}
      <div style={{ display:'flex', alignItems:'center', gap:5 }}>
        <span style={{ fontSize:'var(--text-xs)', color:'var(--text-tertiary)', letterSpacing:'0.05em', textTransform:'uppercase' }}>BPM</span>
        {editingBpm ? (
          <input
            autoFocus
            value={bpmInput}
            onChange={e => setBpmInput(e.target.value)}
            onBlur={commitBpm}
            onKeyDown={e => {
              if (e.key === 'Enter')  commitBpm();
              if (e.key === 'Escape') { setBpmInput(String(bpm)); setEditingBpm(false); }
              e.stopPropagation();
            }}
            style={{
              width:44, height:24, textAlign:'center',
              background:'var(--bg-sunken)',
              border:'1.5px solid var(--accent)',
              borderRadius:'var(--radius-md)',
              fontSize:'var(--mono-base)', fontFamily:'var(--font-mono)',
              color:'var(--text-primary)', outline:'none',
            }}
          />
        ) : (
          <div
            onClick={() => { setEditingBpm(true); setBpmInput(String(bpm)); }}
            onWheel={onBpmScroll}
            title="Click to edit · scroll to change · ⇧scroll ±5"
            style={{
              width:44, height:24, textAlign:'center',
              background:'var(--bg-sunken)',
              border:'0.5px solid var(--border-default)',
              borderRadius:'var(--radius-md)',
              fontSize:'var(--mono-base)', fontFamily:'var(--font-mono)',
              color:'var(--text-primary)',
              display:'flex', alignItems:'center', justifyContent:'center',
              cursor:'text', userSelect:'none',
            }}
          >
            {bpm}
          </div>
        )}
      </div>

      {/* Time sig */}
      <div style={{ fontSize:'var(--mono-base)', fontFamily:'var(--font-mono)', color:'var(--text-secondary)', flexShrink:0 }}>
        4 / 4
      </div>

      {/* Position */}
      <div style={{ fontSize:'var(--mono-base)', fontFamily:'var(--font-mono)', color:'var(--text-primary)', letterSpacing:'0.03em', flexShrink:0 }}>
        {beatsToTime(playheadBeats, bpm)}
      </div>

      <div style={{ flex:1 }}/>

      {/* Volume */}
      <div style={{ display:'flex', alignItems:'center', gap:'var(--space-2)' }}>
        <button
          onClick={() => setMuted(m => !m)}
          style={{ color:'var(--text-tertiary)', display:'flex', alignItems:'center', flexShrink:0, cursor:'pointer' }}
        >
          {muted || volume === 0 ? <VolumeX size={13}/> : <Volume2 size={13}/>}
        </button>
        <HSlider
          value={volume}
          onChange={setVolume}
          width={80}
        />
      </div>

      {/* Divider */}
      <div style={{ width:'0.5px', height:20, background:'var(--border-subtle)', flexShrink:0 }}/>

      {/* Export WAV */}
      <button
        onClick={() => withLock('file-dialog', async () => {
          const path = (window as any).app
            ? await (window as any).app.exportWAV('export.wav')
            : null;
          if (!path && !(window as any).app) {
            console.warn('Export requires Electron');
          }
        })}
        style={{
          height:28, padding:'0 var(--space-3)',
          border:'0.5px solid var(--border-default)',
          borderRadius:'var(--radius-md)',
          fontSize:'var(--text-sm)', color:'var(--text-secondary)',
          transition:'all var(--duration-fast)', flexShrink:0,
        }}
        onMouseEnter={e => { e.currentTarget.style.background='var(--bg-sunken)'; e.currentTarget.style.borderColor='var(--border-strong)'; }}
        onMouseLeave={e => { e.currentTarget.style.background='transparent'; e.currentTarget.style.borderColor='var(--border-default)'; }}
      >
        Export WAV
      </button>

      {/* Open in Music Editor */}
      <button
        onClick={() => withLock('file-dialog', async () => {
          if ((window as any).render) {
            const editors = await (window as any).render.detectEditors();
            const found   = editors.find((e: any) => e.detected);
            if (found) {
              (window as any).render.openInEditor({ editorId: found.id, wavPath: '' });
            } else {
              console.warn('No music editor detected');
            }
          }
        })}
        style={{
          display:'flex', alignItems:'center', gap:4,
          fontSize:'var(--text-sm)', color:'var(--accent)', flexShrink:0,
          transition:'opacity var(--duration-fast)',
        }}
        onMouseEnter={e => (e.currentTarget.style.opacity='0.7')}
        onMouseLeave={e => (e.currentTarget.style.opacity='1')}
      >
        Open in Music Editor ↗
      </button>
    </div>
  );
}
