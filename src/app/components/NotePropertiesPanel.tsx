/**
 * Note Properties Panel — Pro Feature Editor
 * ===========================================
 * Detailed editing panel for selected note(s). Shows:
 *   - Basic properties (pitch, start, duration, lyric)
 *   - Expression parameters (velocity, intensity, etc.)
 *   - Vibrato settings
 *   - Portamento control
 *   - Flags and advanced settings
 *
 * Appears when notes are selected and user wants detailed control.
 * Supports multi-select editing (changes apply to all selected notes).
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  X, Music, Waves, Sliders, ArrowUpDown, ChevronDown, ChevronRight,
  Zap, Wind, Volume2, Radio, RotateCcw
} from 'lucide-react';
import {
  useProjectStore, Note, VibratoParams, NoteExpressions,
  DEFAULT_VIBRATO, DEFAULT_EXPRESSIONS
} from '../../store/project';

interface Props {
  onClose: () => void;
}

// ── Helper: MIDI note to display name ────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function midiToName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES[midi % 12];
  return `${note}${octave}`;
}

// ── Mini slider component ────────────────────────────────────────────────────

function MiniSlider({
  label, value, min, max, onChange, unit = '', showValue = true, onReset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  unit?: string;
  showValue?: boolean;
  onReset?: () => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  
  return (
    <div style={{ marginBottom: 'var(--space-2)' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 4, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
      }}>
        <span>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {showValue && (
            <span style={{ fontFamily: 'var(--font-mono)', minWidth: 32, textAlign: 'right' }}>
              {value}{unit}
            </span>
          )}
          {onReset && (
            <button
              onClick={onReset}
              style={{ color: 'var(--text-tertiary)', display: 'flex', cursor: 'pointer' }}
              title="Reset to default"
            >
              <RotateCcw size={10} />
            </button>
          )}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: '100%', height: 4,
          WebkitAppearance: 'none', appearance: 'none',
          background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--bg-sunken) ${pct}%, var(--bg-sunken) 100%)`,
          borderRadius: 'var(--radius-full)',
          cursor: 'pointer',
        }}
      />
    </div>
  );
}

// ── Collapsible section ──────────────────────────────────────────────────────

function Section({
  title, icon, children, defaultOpen = true,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  
  return (
    <div style={{ marginBottom: 'var(--space-3)' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          width: '100%', padding: 'var(--space-2) 0',
          fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)',
          color: 'var(--text-primary)', cursor: 'pointer',
          borderBottom: '0.5px solid var(--border-subtle)',
        }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {icon}
        {title}
      </button>
      {open && (
        <div style={{ paddingTop: 'var(--space-2)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────────────────

export function NotePropertiesPanel({ onClose }: Props) {
  const { notes, updateNote, setExpressionSelected, addVibratoToSelected, removeVibratoFromSelected, setPortamentoSelected } = useProjectStore();
  
  const selectedNotes = useMemo(() => notes.filter(n => n.selected), [notes]);
  const count = selectedNotes.length;
  
  if (count === 0) {
    return (
      <div style={{
        width: 260, background: 'var(--bg-surface)',
        borderLeft: '0.5px solid var(--border-subtle)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: 'var(--space-3)',
          borderBottom: '0.5px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
            Note Properties
          </span>
          <button onClick={onClose} style={{ color: 'var(--text-tertiary)', cursor: 'pointer' }}>
            <X size={14} />
          </button>
        </div>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)', padding: 'var(--space-4)',
          textAlign: 'center',
        }}>
          Select one or more notes to edit their properties
        </div>
      </div>
    );
  }
  
  // For single note, show exact values. For multiple, show "mixed" or average
  const single = count === 1 ? selectedNotes[0] : null;
  
  // Get common/average values for multi-select
  const avgExpressions = useMemo(() => {
    if (single) return single.expressions;
    const sum: NoteExpressions = { ...DEFAULT_EXPRESSIONS };
    for (const key of Object.keys(sum) as (keyof NoteExpressions)[]) {
      sum[key] = Math.round(selectedNotes.reduce((acc, n) => acc + n.expressions[key], 0) / count);
    }
    return sum;
  }, [selectedNotes, single, count]);
  
  const avgPortamento = useMemo(() => {
    if (single) return single.portamento;
    return Math.round(selectedNotes.reduce((acc, n) => acc + n.portamento, 0) / count);
  }, [selectedNotes, single, count]);
  
  const hasVibrato = selectedNotes.some(n => n.vibrato !== null);
  const allHaveVibrato = selectedNotes.every(n => n.vibrato !== null);
  
  // Handlers for multi-select editing
  const handleExprChange = useCallback((key: keyof NoteExpressions, value: number) => {
    setExpressionSelected({ [key]: value });
  }, [setExpressionSelected]);
  
  const handlePortamentoChange = useCallback((value: number) => {
    setPortamentoSelected(value);
  }, [setPortamentoSelected]);
  
  return (
    <div style={{
      width: 260, background: 'var(--bg-surface)',
      borderLeft: '0.5px solid var(--border-subtle)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: 'var(--space-3)',
        borderBottom: '0.5px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)' }}>
            {count === 1 ? 'Note Properties' : `${count} Notes Selected`}
          </div>
          {single && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>
              {midiToName(single.pitch)} · {single.lyric || '—'}
            </div>
          )}
        </div>
        <button onClick={onClose} style={{ color: 'var(--text-tertiary)', cursor: 'pointer' }}>
          <X size={14} />
        </button>
      </div>
      
      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-3)' }}>
        
        {/* Basic Info (single note only) */}
        {single && (
          <Section title="Basic" icon={<Music size={12} />} defaultOpen={true}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)',
              fontSize: 'var(--text-xs)',
            }}>
              <div>
                <div style={{ color: 'var(--text-tertiary)', marginBottom: 2 }}>Pitch</div>
                <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                  {midiToName(single.pitch)} ({single.pitch})
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--text-tertiary)', marginBottom: 2 }}>Start</div>
                <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                  {single.start.toFixed(2)} beats
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--text-tertiary)', marginBottom: 2 }}>Duration</div>
                <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                  {single.duration.toFixed(2)} beats
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--text-tertiary)', marginBottom: 2 }}>Lyric</div>
                <input
                  type="text"
                  value={single.lyric}
                  onChange={(e) => updateNote(single.id, { lyric: e.target.value })}
                  style={{
                    width: '100%', padding: '2px 4px',
                    background: 'var(--bg-sunken)', border: '0.5px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)',
                    fontFamily: 'var(--font-mono)', color: 'var(--text-primary)',
                  }}
                />
              </div>
            </div>
          </Section>
        )}
        
        {/* Expression */}
        <Section title="Expression" icon={<Sliders size={12} />} defaultOpen={true}>
          <MiniSlider
            label="Velocity"
            value={avgExpressions.velocity}
            min={0}
            max={200}
            onChange={(v) => handleExprChange('velocity', v)}
            onReset={() => handleExprChange('velocity', 100)}
          />
          <MiniSlider
            label="Intensity"
            value={avgExpressions.intensity}
            min={0}
            max={200}
            onChange={(v) => handleExprChange('intensity', v)}
            onReset={() => handleExprChange('intensity', 100)}
          />
          <MiniSlider
            label="Modulation"
            value={avgExpressions.modulation}
            min={0}
            max={100}
            onChange={(v) => handleExprChange('modulation', v)}
            unit="%"
            onReset={() => handleExprChange('modulation', 0)}
          />
          <MiniSlider
            label="Breathiness"
            value={avgExpressions.breathiness}
            min={0}
            max={100}
            onChange={(v) => handleExprChange('breathiness', v)}
            unit="%"
            onReset={() => handleExprChange('breathiness', 50)}
          />
          <MiniSlider
            label="Tension"
            value={avgExpressions.tension}
            min={0}
            max={100}
            onChange={(v) => handleExprChange('tension', v)}
            unit="%"
            onReset={() => handleExprChange('tension', 50)}
          />
        </Section>
        
        {/* Vibrato */}
        <Section title="Vibrato" icon={<Waves size={12} />} defaultOpen={false}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 'var(--space-2)',
          }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              {allHaveVibrato ? 'Vibrato enabled' : hasVibrato ? 'Mixed' : 'No vibrato'}
            </span>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                onClick={addVibratoToSelected}
                style={{
                  padding: '2px 6px', fontSize: 'var(--text-xs)',
                  background: 'var(--accent)', color: 'white',
                  borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                }}
              >
                Add
              </button>
              <button
                onClick={removeVibratoFromSelected}
                style={{
                  padding: '2px 6px', fontSize: 'var(--text-xs)',
                  background: 'var(--bg-sunken)', color: 'var(--text-secondary)',
                  borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                }}
              >
                Remove
              </button>
            </div>
          </div>
          
          {allHaveVibrato && single?.vibrato && (
            <>
              <MiniSlider
                label="Length"
                value={single.vibrato.length}
                min={0}
                max={100}
                unit="%"
                onChange={(v) => updateNote(single.id, {
                  vibrato: { ...single.vibrato!, length: v }
                })}
              />
              <MiniSlider
                label="Depth"
                value={single.vibrato.depth}
                min={0}
                max={200}
                unit=" cents"
                onChange={(v) => updateNote(single.id, {
                  vibrato: { ...single.vibrato!, depth: v }
                })}
              />
              <MiniSlider
                label="Period"
                value={single.vibrato.period}
                min={50}
                max={500}
                unit="ms"
                onChange={(v) => updateNote(single.id, {
                  vibrato: { ...single.vibrato!, period: v }
                })}
              />
              <MiniSlider
                label="Fade In"
                value={single.vibrato.fadeIn}
                min={0}
                max={100}
                unit="%"
                onChange={(v) => updateNote(single.id, {
                  vibrato: { ...single.vibrato!, fadeIn: v }
                })}
              />
              <MiniSlider
                label="Fade Out"
                value={single.vibrato.fadeOut}
                min={0}
                max={100}
                unit="%"
                onChange={(v) => updateNote(single.id, {
                  vibrato: { ...single.vibrato!, fadeOut: v }
                })}
              />
            </>
          )}
        </Section>
        
        {/* Pitch / Portamento */}
        <Section title="Pitch Control" icon={<ArrowUpDown size={12} />} defaultOpen={false}>
          <MiniSlider
            label="Portamento"
            value={avgPortamento}
            min={0}
            max={100}
            unit="%"
            onChange={handlePortamentoChange}
            onReset={() => handlePortamentoChange(0)}
          />
          <div style={{
            fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)',
            marginTop: 'var(--space-2)',
          }}>
            Portamento controls how much the note glides from the previous pitch.
            0% = no glide, 100% = full glide.
          </div>
        </Section>
        
        {/* Flags (single note only) */}
        {single && (
          <Section title="Engine Flags" icon={<Zap size={12} />} defaultOpen={false}>
            <input
              type="text"
              value={single.flags}
              onChange={(e) => updateNote(single.id, { flags: e.target.value })}
              placeholder="e.g. g-5 Y0 H0"
              style={{
                width: '100%', padding: '4px 6px',
                background: 'var(--bg-sunken)', border: '0.5px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)',
                fontFamily: 'var(--font-mono)', color: 'var(--text-primary)',
              }}
            />
            <div style={{
              fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)',
              marginTop: 'var(--space-2)',
            }}>
              Engine-specific flags. Common: g (gender), Y (brightness), H (breathiness)
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

export default NotePropertiesPanel;
