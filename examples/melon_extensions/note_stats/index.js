/**
 * Note Stats — Example Melon Synth Extension
 * ============================================
 * Shows real-time project statistics in a compact panel.
 * This is the canonical "hello world" for .melon extension development.
 *
 * How it works:
 *   1. Melon Synth loads this JS file when the extension is installed
 *   2. AddonPanelHost finds the exported component name from manifest.json
 *   3. The component receives `melonAPI` as a prop — this is your entire API
 *   4. Use CSS variables (var(--accent), etc.) for theming — it auto-adapts to dark/light
 *
 * To install: ZIP this folder as note_stats.melon, drag into Extensions panel
 */

// Access React from the host app — it's exposed as window.React
const { createElement: h, useState, useEffect, useCallback } = window.React;

// Helper: MIDI note number → note name
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function midiToName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
}

// ── The panel component ─────────────────────────────────────────────────────

function NoteStatsPanel({ melonAPI }) {
  const [stats, setStats] = useState(null);

  const computeStats = useCallback(() => {
    const notes  = melonAPI.project.getNotes();
    const tracks = melonAPI.project.getTracks();
    const bpm    = melonAPI.project.getBpm();

    if (notes.length === 0) {
      setStats({ empty: true, noteCount: 0 });
      return;
    }

    const pitches   = notes.map(n => n.pitch);
    const starts    = notes.map(n => n.start);
    const durations = notes.map(n => n.duration);
    const selected  = notes.filter(n => n.selected);

    const minPitch   = Math.min(...pitches);
    const maxPitch   = Math.max(...pitches);
    const totalBeats = Math.max(...notes.map(n => n.start + n.duration));
    const totalDurS  = (totalBeats / bpm) * 60;

    // Average note density (notes per beat)
    const density = totalBeats > 0 ? (notes.length / totalBeats).toFixed(2) : '0';

    // Most common pitch
    const pitchCounts = {};
    pitches.forEach(p => { pitchCounts[p] = (pitchCounts[p] || 0) + 1; });
    const mostCommon = Object.entries(pitchCounts).sort((a, b) => b[1] - a[1])[0];

    // Lyrics coverage
    const withLyrics = notes.filter(n => n.lyric && n.lyric.trim()).length;

    setStats({
      empty:       false,
      noteCount:   notes.length,
      selectedCount: selected.length,
      trackCount:  tracks.length,
      bpm,
      pitchRange:  `${midiToName(minPitch)} – ${midiToName(maxPitch)}`,
      pitchSpan:   maxPitch - minPitch,
      totalBeats:  totalBeats.toFixed(1),
      totalDur:    totalDurS < 60
        ? `${totalDurS.toFixed(1)}s`
        : `${Math.floor(totalDurS / 60)}:${String(Math.round(totalDurS % 60)).padStart(2, '0')}`,
      density,
      mostCommon:  mostCommon ? `${midiToName(Number(mostCommon[0]))} (×${mostCommon[1]})` : '—',
      lyricsCoverage: `${withLyrics}/${notes.length}`,
      avgDuration: (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2),
    });
  }, [melonAPI]);

  // Compute on mount and subscribe to changes
  useEffect(() => {
    computeStats();
    const unsub = melonAPI.project.on('change', computeStats);
    return unsub;
  }, [computeStats]);

  if (!stats) return null;

  // ── Styles ──────────────────────────────────────────────────────────────
  const panelStyle = {
    padding: '10px 14px',
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-sm)',
    lineHeight: 1.6,
    color: 'var(--text-secondary)',
  };

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '4px 16px',
  };

  const labelStyle = {
    color: 'var(--text-tertiary)',
    fontSize: 11,
  };

  const valueStyle = {
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    fontWeight: 500,
  };

  if (stats.empty) {
    return h('div', { style: { ...panelStyle, color: 'var(--text-tertiary)', textAlign: 'center', padding: 20 } },
      'Draw some notes to see stats'
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const stat = (label, value) =>
    h('div', { style: { display: 'flex', justifyContent: 'space-between' } },
      h('span', { style: labelStyle }, label),
      h('span', { style: valueStyle }, value),
    );

  return h('div', { style: panelStyle },
    h('div', { style: gridStyle },
      stat('Notes',       stats.noteCount + (stats.selectedCount ? ` (${stats.selectedCount} sel)` : '')),
      stat('Tracks',      stats.trackCount),
      stat('BPM',         stats.bpm),
      stat('Duration',    stats.totalDur),
      stat('Pitch range', stats.pitchRange),
      stat('Span',        stats.pitchSpan + ' semitones'),
      stat('Density',     stats.density + ' notes/beat'),
      stat('Most used',   stats.mostCommon),
      stat('Avg length',  stats.avgDuration + ' beats'),
      stat('Lyrics',      stats.lyricsCoverage),
    ),
  );
}

// ── Export — this is how AddonPanelHost finds your component ──────────────

window.__MELON_ADDON_EXPORTS__ = { NoteStatsPanel };
