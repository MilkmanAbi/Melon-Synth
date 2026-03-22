/**
 * Voice Panel — v3
 * ================
 * Track list + voicebank selector + voice params + MLC panel.
 * "Advanced" panel covers all OpenUTAU expressions:
 *   velocity, volume, attack, decay, modulation, pitch shift, lowpass
 *
 * Expression flags from OpenUTAU source (USTx.cs AddDefaultExpressions):
 *   gender (g):      -100 to +100  — vocal tract length  
 *   breath (B):       0 to 100     — breathiness
 *   lowpass (H):      0 to 100     — low-pass filter
 *   normalize (P):    0 to 100     — amplitude normalization
 *   velocity (vel):   0 to 200     — consonant velocity
 *   volume (vol):     0 to 200     — note volume
 *   attack (atk):     0 to 200     — attack transient
 *   decay (dec):      0 to 100     — decay envelope
 *   modulation (mod): 0 to 100     — vibrato depth
 *   tone shift (shft):-36 to 36    — pitch shift in semitones
 * 
 * Credit: OpenUTAU by stakira (MIT License) — github.com/stakira/OpenUtau
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Volume2, VolumeX, RotateCcw, Plus, ChevronDown, ChevronUp,
  Settings2, Music2, Mic2, ExternalLink,
} from 'lucide-react';
import { useProjectStore, VoiceTrack } from '../../store/project';
import { MLCPanel } from './MLCPanel';

interface Props {
  onContextMenu:         (e: React.MouseEvent) => void;
  onOpenMLCWindow?:      () => void;
  onOpenVoicebankManager?: () => void;
}

// ── Drag slider (no onClick conflict) ────────────────────────────────────────
function Slider({
  value, min = 0, max = 100, onChange, accent = false,
}: {
  value: number; min?: number; max?: number;
  onChange: (v: number) => void; accent?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const calc = useCallback((clientX: number) => {
    if (!trackRef.current) return value;
    const r = trackRef.current.getBoundingClientRect();
    return Math.round(Math.max(min, Math.min(max,
      min + ((clientX - r.left) / r.width) * (max - min)
    )));
  }, [min, max, value]);

  const onDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    onChange(calc(e.clientX));
    const onMove = (ev: MouseEvent) => onChange(calc(ev.clientX));
    const onUp   = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
  }, [calc, onChange]);

  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div ref={trackRef} onMouseDown={onDown} style={{
      height: 3, background: 'var(--bg-sunken)', borderRadius: 'var(--radius-full)',
      position: 'relative', cursor: 'pointer', userSelect: 'none',
    }}>
      <div style={{
        height: '100%', width: `${pct}%`,
        background: accent ? 'var(--accent)' : 'var(--accent)',
        borderRadius: 'var(--radius-full)',
      }}/>
      <div style={{
        position: 'absolute', left: `calc(${pct}% - 5px)`, top: -3.5,
        width: 10, height: 10, borderRadius: '50%',
        background: 'var(--bg-surface)', border: '1.5px solid var(--accent)',
        pointerEvents: 'none',
      }}/>
    </div>
  );
}

// ── A named param row ─────────────────────────────────────────────────────────
function ParamRow({
  label, value, min = 0, max = 100, defaultVal,
  unit = '', hint = '', onChange,
}: {
  label: string; value: number; min?: number; max?: number;
  defaultVal: number; unit?: string; hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 'var(--space-3)' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4,
      }}>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }} title={hint}>
          {label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 'var(--mono-sm)', fontFamily: 'var(--font-mono)',
                         color: 'var(--text-tertiary)', minWidth: 28, textAlign: 'right' }}>
            {value}{unit}
          </span>
          {value !== defaultVal && (
            <button onClick={() => onChange(defaultVal)} title="Reset" style={{
              color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', cursor: 'pointer',
              transition: 'color var(--duration-fast)',
            }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
            >
              <RotateCcw size={10}/>
            </button>
          )}
        </div>
      </div>
      <Slider value={value} min={min} max={max} onChange={onChange}/>
    </div>
  );
}

// ── Main VoicePanel ───────────────────────────────────────────────────────────

const CORE_PARAMS = [
  { key: 'breathiness' as const, label: 'Breathiness', default: 40, hint: 'OpenUTAU flag B — adds breath noise to the vocal tone' },
  { key: 'tension'     as const, label: 'Tension',     default: 65, hint: 'Affects lowpass filter — higher = crisper attack' },
  { key: 'gender'      as const, label: 'Gender',      default: 30, hint: 'OpenUTAU flag g — maps 0=feminine to 100=masculine' },
  { key: 'pitchRange'  as const, label: 'Pitch Range', default: 50, hint: 'Semitone range for pitch deviation effects' },
];

// Advanced params (OpenUTAU expressions, per-note defaults)
const ADV_PARAMS = [
  { key: 'velocity',    label: 'Velocity',     min:   0, max: 200, default: 100, hint: 'Consonant attack speed (vel) — 100 = normal' },
  { key: 'volume',      label: 'Volume',       min:   0, max: 200, default: 100, hint: 'Note loudness (vol) — 100 = normal, 200 = loud' },
  { key: 'attack',      label: 'Attack',       min:   0, max: 200, default: 100, hint: 'Transient sharpness (atk) — affects the onset of each phoneme' },
  { key: 'decay',       label: 'Decay',        min:   0, max: 100, default:   0, hint: 'Decay envelope (dec) — how quickly the note fades at the end' },
  { key: 'modulation',  label: 'Modulation',   min:   0, max: 100, default:   0, hint: 'Vibrato depth (mod) — per-note default modulation amount' },
  { key: 'toneShift',   label: 'Tone Shift',   min: -36, max:  36, default:   0, unit: 'st', hint: 'Pitch shift in semitones (shft) — transposes rendered pitch without changing note' },
  { key: 'lowpass',     label: 'Low-pass',     min:   0, max: 100, default:   0, hint: 'OpenUTAU flag H — muffle the high frequencies' },
  { key: 'normalize',   label: 'Normalize',    min:   0, max: 100, default:  86, hint: 'OpenUTAU flag P — amplitude normalization (default 86)' },
] as const;

export function VoicePanel({ onContextMenu, onOpenMLCWindow, onOpenVoicebankManager }: Props) {
  const { tracks, selectTrack, addTrack, updateTrack } = useProjectStore();
  const [hoverId,  setHoverId]  = useState<string | null>(null);
  const [advOpen,  setAdvOpen]  = useState(false);
  const [vbOpen,   setVbOpen]   = useState(false);
  const [installedVBs, setInstalledVBs] = useState<any[]>([]);

  const sel = tracks.find(t => t.selected) ?? tracks[0];

  // Advanced params stored on the track (extend type with defaults)
  const adv = (sel as any) ?? {};

  // Load installed voicebanks for quick picker
  useEffect(() => {
    if ((window as any).voicebanks?.list) {
      (window as any).voicebanks.list().then(setInstalledVBs).catch(() => {});
    }
  }, []);

  const setAdv = (key: string, v: number) => {
    if (sel) updateTrack(sel.id, { [key]: v } as any);
  };

  return (
    <div onContextMenu={onContextMenu} style={{
      width: 210, flexShrink: 0,
      background: 'var(--bg-surface)',
      borderRight: '0.5px solid var(--border-subtle)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* ── Section: Voices ──────────────────────────────────────────────── */}
      <div style={{
        padding: 'var(--space-3) var(--space-4) var(--space-2)',
        fontSize: 'var(--text-xs)', fontWeight: 500,
        color: 'var(--text-tertiary)', letterSpacing: '0.07em', textTransform: 'uppercase',
      }}>
        Voices
      </div>

      {/* Track list */}
      <div>
        {tracks.map(track => (
          <div key={track.id}
            onClick={() => selectTrack(track.id)}
            onMouseEnter={() => setHoverId(track.id)}
            onMouseLeave={() => setHoverId(null)}
            style={{
              padding: '6px var(--space-3)',
              borderLeft: track.selected ? '2px solid var(--accent)' : '2px solid transparent',
              background: track.selected ? 'var(--accent-subtle)'
                : hoverId === track.id ? 'var(--bg-sunken)' : 'transparent',
              cursor: 'pointer', transition: 'background var(--duration-fast)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: track.color, flexShrink: 0 }}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)', lineHeight: 1.3 }}>
                  {track.name}
                </div>
                <div style={{
                  fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.2,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontStyle: track.voiceBank ? 'normal' : 'italic',
                }}>
                  {track.voiceBank ?? 'no voice bank'}
                </div>
              </div>
              <button onClick={e => { e.stopPropagation(); updateTrack(track.id, { muted: !track.muted }); }}
                style={{ color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                {track.muted ? <VolumeX size={13}/> : <Volume2 size={13}/>}
              </button>
            </div>
          </div>
        ))}
        <button onClick={addTrack} style={{
          width: '100%', padding: '6px var(--space-3)',
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          fontSize: 'var(--text-sm)', color: 'var(--accent)',
          transition: 'background var(--duration-fast)',
        }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-sunken)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <Plus size={13}/> Add voice track
        </button>
      </div>

      <div style={{ height: '0.5px', background: 'var(--border-subtle)', margin: '2px 0' }}/>

      {/* ── Section: Voicebank picker ─────────────────────────────────────── */}
      {sel && (
        <div style={{ padding: '0 var(--space-4)', paddingTop: 'var(--space-2)' }}>
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--text-tertiary)',
                        letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 'var(--space-2)' }}>
            Voicebank
          </div>

          {/* Dropdown trigger */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setVbOpen(v => !v)}
              style={{
                width: '100%', height: 30, display: 'flex', alignItems: 'center',
                gap: 'var(--space-2)', padding: '0 var(--space-2)',
                background: 'var(--bg-sunken)',
                border: '0.5px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-sm)',
                color: sel.voiceBank ? 'var(--text-primary)' : 'var(--text-tertiary)',
                cursor: 'pointer', transition: 'border-color var(--duration-fast)',
                textAlign: 'left',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
            >
              <Music2 size={11} style={{ color: 'var(--accent)', flexShrink: 0 }}/>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {sel.voiceBank ?? 'Select voicebank…'}
              </span>
              {vbOpen ? <ChevronUp size={11}/> : <ChevronDown size={11}/>}
            </button>

            {vbOpen && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 400,
                background: 'var(--bg-overlay)',
                border: '0.5px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                marginTop: 2, overflow: 'hidden',
              }}>
                {installedVBs.length === 0 ? (
                  <div style={{ padding: 'var(--space-3)' }}>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginBottom: 8 }}>
                      No voicebanks installed
                    </div>
                    <button onClick={() => { setVbOpen(false); onOpenVoicebankManager?.(); }}
                      style={{
                        width: '100%', height: 26, background: 'var(--accent)',
                        borderRadius: 'var(--radius-md)', fontSize: 'var(--text-xs)',
                        color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        gap: 4, cursor: 'pointer',
                      }}
                    >
                      <ExternalLink size={10}/> Open Voicebank Manager
                    </button>
                  </div>
                ) : (
                  <>
                    {installedVBs.map((vb: any) => (
                      <button key={vb.id}
                        onClick={() => { updateTrack(sel.id, { voiceBank: vb.name, voicePath: vb.path }); setVbOpen(false); }}
                        style={{
                          width: '100%', padding: '8px var(--space-3)',
                          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                          background: sel.voiceBank === vb.name ? 'var(--accent-subtle)' : 'transparent',
                          borderBottom: '0.5px solid var(--border-subtle)',
                          cursor: 'pointer', textAlign: 'left',
                          transition: 'background var(--duration-fast)',
                        }}
                        onMouseEnter={e => { if (sel.voiceBank !== vb.name) e.currentTarget.style.background = 'var(--bg-sunken)'; }}
                        onMouseLeave={e => { if (sel.voiceBank !== vb.name) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <span style={{ fontSize: 16, flexShrink: 0 }}>🎙️</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)',
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {vb.name}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                            {vb.type?.toUpperCase() ?? 'CV'}
                          </div>
                        </div>
                        {sel.voiceBank === vb.name && (
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }}/>
                        )}
                      </button>
                    ))}
                    <button onClick={() => { setVbOpen(false); onOpenVoicebankManager?.(); }}
                      style={{
                        width: '100%', padding: '8px var(--space-3)',
                        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                        fontSize: 'var(--text-xs)', color: 'var(--accent)',
                        cursor: 'pointer', transition: 'background var(--duration-fast)',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-sunken)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <ExternalLink size={10}/> More voicebanks…
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ height: '0.5px', background: 'var(--border-subtle)', margin: 'var(--space-2) 0' }}/>

      {/* Scrollable params area */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

        {/* ── Core voice params ─────────────────────────────────────────── */}
        {sel && (
          <div style={{ padding: '0 var(--space-4) var(--space-2)' }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500,
                          color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
              Voice properties
            </div>
            {CORE_PARAMS.map(p => (
              <ParamRow key={p.key} label={p.label}
                value={(sel as any)[p.key] ?? p.default}
                defaultVal={p.default} hint={p.hint}
                onChange={v => updateTrack(sel.id, { [p.key]: v } as any)}
              />
            ))}
          </div>
        )}

        <div style={{ height: '0.5px', background: 'var(--border-subtle)', margin: '0 0 var(--space-2)' }}/>

        {/* ── Advanced panel toggle ──────────────────────────────────────── */}
        <button
          onClick={() => setAdvOpen(v => !v)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            padding: 'var(--space-2) var(--space-4)',
            fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
            transition: 'background var(--duration-fast)',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-sunken)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <Settings2 size={13} style={{ color: 'var(--accent)' }}/>
          <span style={{ flex: 1, textAlign: 'left', fontWeight: 500 }}>Advanced</span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            OpenUTAU expressions
          </span>
          {advOpen ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
        </button>

        {/* ── Advanced params (OpenUTAU expressions) ─────────────────────── */}
        {advOpen && sel && (
          <div style={{ padding: '0 var(--space-4) var(--space-3)', background: 'var(--bg-sunken)' }}>
            <div style={{
              fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 'var(--space-3)',
              marginTop: 'var(--space-2)', lineHeight: 1.4,
            }}>
              These values map to OpenUTAU expressions and UST flags.
              They apply as track defaults for all notes.{' '}
              <span style={{ color: 'var(--accent)' }}>
                Credit: OpenUTAU by stakira (MIT)
              </span>
            </div>
            {ADV_PARAMS.map(p => (
              <ParamRow key={p.key} label={p.label}
                value={(adv[p.key] as number) ?? p.default}
                min={p.min} max={p.max} defaultVal={p.default}
                unit={(p as any).unit ?? ''}
                hint={p.hint}
                onChange={v => setAdv(p.key, v)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── MLC Panel ──────────────────────────────────────────────────────── */}
      <MLCPanel onOpenWindow={onOpenMLCWindow}/>
    </div>
  );
}
