/**
 * Chord Inserter — Melon Synth app extension
 * Inserts chord notes at the playhead position.
 * Exported as window.MelonChordInserter for AddonPanelHost.
 */

const NOTE_MAP = {
  'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'F':5,
  'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11
};

const CHORD_INTERVALS = {
  '':    [0,4,7],       'm':   [0,3,7],
  '7':   [0,4,7,10],   'maj7':[0,4,7,11],
  'm7':  [0,3,7,10],   'sus2':[0,2,7],
  'sus4':[0,5,7],      'dim': [0,3,6],
  'aug': [0,4,8],      'add9':[0,4,7,14],
  '6':   [0,4,7,9],    '9':   [0,4,7,10,14],
};

function ChordInserterPanel({ melonAPI }) {
  const [root,   setRoot]   = React.useState('C');
  const [oct,    setOct]    = React.useState(4);
  const [type,   setType]   = React.useState('');
  const [status, setStatus] = React.useState('');
  const [busy,   setBusy]   = React.useState(false);

  async function insert() {
    setBusy(true); setStatus('');
    try {
      const rootMidi = NOTE_MAP[root] + (oct + 1) * 12;
      const ivs      = CHORD_INTERVALS[type] ?? [0,4,7];
      const pos      = melonAPI.project.getPlayheadPosition();
      await melonAPI.project.addNotes(ivs.map(i => ({
        pitch: rootMidi + i, start: pos, duration: 1, lyric: root + type,
      })));
      const name = `${root}${type}`;
      setStatus(`✓ ${name} inserted`);
      melonAPI.ui.notify({ type:'success', title:`Inserted ${name}` });
      setTimeout(() => setStatus(''), 3000);
    } catch(e) {
      setStatus('Error: ' + e.message);
    } finally { setBusy(false); }
  }

  const roots = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const types = Object.keys(CHORD_INTERVALS);

  const s = {
    wrap:   { padding:'10px 12px', fontFamily:'system-ui, sans-serif', fontSize:12 },
    row:    { display:'flex', gap:6, marginBottom:8 },
    sel:    { flex:1, height:28, borderRadius:6, border:'0.5px solid var(--border-subtle)',
              background:'var(--bg-sunken)', color:'var(--text-primary)', fontSize:12, padding:'0 6px' },
    grid:   { display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:4, marginBottom:8 },
    chip:   (active) => ({
              height:26, borderRadius:6, fontSize:11, fontWeight: active ? 600 : 400,
              background: active ? 'var(--accent)' : 'var(--bg-sunken)',
              color: active ? 'white' : 'var(--text-secondary)',
              border: `0.5px solid ${active ? 'var(--accent)' : 'var(--border-subtle)'}`,
              cursor:'pointer',
            }),
    btn:    { width:'100%', height:30, borderRadius:6, background:'var(--accent)',
              color:'white', fontSize:12, fontWeight:600, cursor:'pointer',
              opacity: busy ? 0.6 : 1, border:'none' },
    status: { fontSize:11, color:'var(--accent)', textAlign:'center', marginTop:4, minHeight:16 },
  };

  return React.createElement('div', { style: s.wrap },
    React.createElement('div', { style: s.row },
      React.createElement('select', { value: root, onChange: e => setRoot(e.target.value), style: s.sel },
        roots.map(r => React.createElement('option', { key:r, value:r }, r))
      ),
      React.createElement('select', { value: oct, onChange: e => setOct(+e.target.value), style: { ...s.sel, flex:'none', width:50 } },
        [2,3,4,5,6].map(o => React.createElement('option', { key:o, value:o }, o))
      ),
    ),
    React.createElement('div', { style: s.grid },
      types.map(t => React.createElement('button', {
        key: t, style: s.chip(type === t),
        onClick: () => setType(t),
      }, t === '' ? 'Major' : t))
    ),
    React.createElement('button', { style: s.btn, disabled: busy, onClick: insert },
      busy ? 'Inserting…' : `Insert ${root}${type || ''}`
    ),
    status && React.createElement('div', { style: s.status }, status),
  );
}

// Export for AddonPanelHost dynamic loading
window.MelonChordInserter = { ChordInserterPanel };
