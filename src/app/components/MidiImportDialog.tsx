/**
 * MIDI Import Dialog
 * ===================
 * Shows when user imports a .mid file.
 * Displays track list, lets user select which track to import,
 * optionally quantize, and preview before committing.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Music, FileMusic, Check, X, AlertCircle,
  Loader2, Grid3X3, ChevronDown,
} from 'lucide-react';
import { MidiFile, getMidiSummary, convertMidiTrack, ImportedNote } from '../../subsystems/midi-import';
import { useProjectStore } from '../../store/project';

interface Props {
  midiFile:  MidiFile;
  onClose:   () => void;
  onImport:  (notes: ImportedNote[], tempo: number) => void;
}

const QUANTIZE_OPTIONS: { label: string; value: number }[] = [
  { label: 'None (as-is)',   value: 0 },
  { label: '1/4 note',       value: 1 },
  { label: '1/8 note',       value: 0.5 },
  { label: '1/16 note',      value: 0.25 },
  { label: '1/32 note',      value: 0.125 },
];

const LYRIC_PRESETS: { label: string; value: string }[] = [
  { label: 'la',  value: 'la' },
  { label: 'na',  value: 'na' },
  { label: 'a',   value: 'a' },
  { label: 'ku',  value: 'ku' },
  { label: 'do',  value: 'do' },
  { label: 're',  value: 're' },
];

export function MidiImportDialog({ midiFile, onClose, onImport }: Props) {
  const summary = getMidiSummary(midiFile);
  const [selectedTrack, setSelectedTrack] = useState(summary.tracks[0]?.index ?? 0);
  const [quantize,      setQuantize]      = useState(0.25); // 1/16 default
  const [lyricPrefix,   setLyricPrefix]   = useState('la');
  const [useMidiTempo,  setUseMidiTempo]  = useState(true);
  const [replaceNotes,  setReplaceNotes]  = useState(true);
  const [previewNotes,  setPreviewNotes]  = useState<ImportedNote[]>([]);
  const [showLyricDropdown, setShowLyricDropdown] = useState(false);

  const { bpm: currentBpm } = useProjectStore();

  // Generate preview when settings change
  useEffect(() => {
    try {
      const notes = convertMidiTrack(midiFile, selectedTrack, {
        quantize,
        lyricPrefix,
        minDuration: 0.125,
      });
      setPreviewNotes(notes);
    } catch (e) {
      setPreviewNotes([]);
    }
  }, [midiFile, selectedTrack, quantize, lyricPrefix]);

  const handleImport = useCallback(() => {
    const tempo = useMidiTempo ? midiFile.tempo : currentBpm;
    onImport(previewNotes, tempo);
    onClose();
  }, [previewNotes, useMidiTempo, midiFile.tempo, currentBpm, onImport, onClose]);

  // Format duration in mm:ss
  const formatDuration = (beats: number, bpm: number) => {
    const seconds = (beats / bpm) * 60;
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'fadeIn 120ms var(--ease-out) both',
    }} onClick={onClose}>
      <div style={{
        width: 520, maxHeight: '80vh',
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border-default)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column',
        animation: 'slideDown 180ms var(--ease-out) both',
        overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{
          height: 52, flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          padding: '0 var(--space-5)',
          borderBottom: '0.5px solid var(--border-subtle)',
        }}>
          <FileMusic size={18} style={{ color: 'var(--accent)' }}/>
          <span style={{ flex: 1, fontSize: 'var(--text-md)', fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)' }}>
            Import MIDI
          </span>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: 'var(--radius-md)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-tertiary)',
            transition: 'all var(--duration-fast)',
          }}>
            <X size={16}/>
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-5)' }}>
          
          {/* File info */}
          <div style={{
            padding: 'var(--space-3)',
            background: 'var(--bg-sunken)',
            borderRadius: 'var(--radius-lg)',
            marginBottom: 'var(--space-4)',
            display: 'flex', gap: 'var(--space-4)',
          }}>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 2 }}>Tempo</div>
              <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)' }}>
                {midiFile.tempo} BPM
              </div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 2 }}>Duration</div>
              <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)' }}>
                {formatDuration(summary.duration, midiFile.tempo)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 2 }}>Tracks</div>
              <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)' }}>
                {summary.trackCount}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 2 }}>Total Notes</div>
              <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)' }}>
                {summary.noteCount}
              </div>
            </div>
          </div>

          {/* Track selection */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{
              fontSize: 'var(--text-xs)', fontWeight: 'var(--font-weight-medium)',
              color: 'var(--text-tertiary)', letterSpacing: '0.05em',
              textTransform: 'uppercase', marginBottom: 'var(--space-2)',
            }}>
              Select Track
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {summary.tracks.map(track => (
                <button
                  key={track.index}
                  onClick={() => setSelectedTrack(track.index)}
                  style={{
                    padding: 'var(--space-3)',
                    background: selectedTrack === track.index ? 'var(--accent-subtle)' : 'var(--bg-sunken)',
                    border: `1px solid ${selectedTrack === track.index ? 'var(--accent)' : 'var(--border-subtle)'}`,
                    borderRadius: 'var(--radius-md)',
                    display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                    cursor: 'pointer',
                    transition: 'all var(--duration-fast)',
                  }}
                >
                  <div style={{
                    width: 18, height: 18, borderRadius: 'var(--radius-full)',
                    border: `1.5px solid ${selectedTrack === track.index ? 'var(--accent)' : 'var(--border-default)'}`,
                    background: selectedTrack === track.index ? 'var(--accent)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {selectedTrack === track.index && <Check size={10} color="white"/>}
                  </div>
                  <Music size={14} style={{ color: 'var(--text-tertiary)' }}/>
                  <span style={{ flex: 1, textAlign: 'left', fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                    {track.name || `Track ${track.index + 1}`}
                  </span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    {track.noteCount} notes · Ch {track.channel + 1}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Options grid */}
          <div style={{ 
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)',
            marginBottom: 'var(--space-4)',
          }}>
            {/* Quantize */}
            <div>
              <div style={{
                fontSize: 'var(--text-xs)', fontWeight: 'var(--font-weight-medium)',
                color: 'var(--text-tertiary)', letterSpacing: '0.05em',
                textTransform: 'uppercase', marginBottom: 'var(--space-2)',
              }}>
                Quantize
              </div>
              <select
                value={quantize}
                onChange={e => setQuantize(parseFloat(e.target.value))}
                style={{
                  width: '100%', height: 36,
                  padding: '0 var(--space-3)',
                  background: 'var(--bg-surface)',
                  border: '0.5px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-primary)',
                }}
              >
                {QUANTIZE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Default lyric */}
            <div style={{ position: 'relative' }}>
              <div style={{
                fontSize: 'var(--text-xs)', fontWeight: 'var(--font-weight-medium)',
                color: 'var(--text-tertiary)', letterSpacing: '0.05em',
                textTransform: 'uppercase', marginBottom: 'var(--space-2)',
              }}>
                Default Lyric
              </div>
              <button
                onClick={() => setShowLyricDropdown(!showLyricDropdown)}
                style={{
                  width: '100%', height: 36,
                  padding: '0 var(--space-3)',
                  background: 'var(--bg-surface)',
                  border: '0.5px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-primary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}
              >
                <span style={{ fontFamily: 'var(--font-mono)' }}>{lyricPrefix}</span>
                <ChevronDown size={14} style={{ color: 'var(--text-tertiary)' }}/>
              </button>
              {showLyricDropdown && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0,
                  marginTop: 4, zIndex: 10,
                  background: 'var(--bg-surface)',
                  border: '0.5px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                  overflow: 'hidden',
                }}>
                  {LYRIC_PRESETS.map(preset => (
                    <button
                      key={preset.value}
                      onClick={() => { setLyricPrefix(preset.value); setShowLyricDropdown(false); }}
                      style={{
                        width: '100%', padding: 'var(--space-2) var(--space-3)',
                        textAlign: 'left',
                        fontSize: 'var(--text-sm)',
                        color: lyricPrefix === preset.value ? 'var(--accent)' : 'var(--text-primary)',
                        background: lyricPrefix === preset.value ? 'var(--accent-subtle)' : 'transparent',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Checkboxes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={useMidiTempo}
                onChange={e => setUseMidiTempo(e.target.checked)}
                style={{ width: 16, height: 16 }}
              />
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                Use MIDI tempo ({midiFile.tempo} BPM)
              </span>
              {!useMidiTempo && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  (will keep current {currentBpm} BPM)
                </span>
              )}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={replaceNotes}
                onChange={e => setReplaceNotes(e.target.checked)}
                style={{ width: 16, height: 16 }}
              />
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                Replace existing notes
              </span>
              {!replaceNotes && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  (will add to existing)
                </span>
              )}
            </label>
          </div>

          {/* Preview summary */}
          <div style={{
            marginTop: 'var(--space-4)',
            padding: 'var(--space-3)',
            background: 'var(--success-subtle)',
            border: '0.5px solid var(--success)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-sm)',
            color: 'var(--success)',
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          }}>
            <Check size={14}/>
            Ready to import {previewNotes.length} notes
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: 'var(--space-4) var(--space-5)',
          borderTop: '0.5px solid var(--border-subtle)',
          display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)',
        }}>
          <button onClick={onClose} style={{
            height: 36, padding: '0 var(--space-4)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-secondary)',
            border: '0.5px solid var(--border-default)',
          }}>
            Cancel
          </button>
          <button onClick={handleImport} style={{
            height: 36, padding: '0 var(--space-4)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'white',
            background: 'var(--accent)',
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          }}>
            <FileMusic size={14}/>
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
