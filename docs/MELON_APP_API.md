# Melon Synth App Extension API — .melon Format
## Version 1.0 · 2026

A `.melon` file is a ZIP archive that extends Melon Synth's UI and functionality.
Drop it into Melon Synth and it installs automatically — no restart needed.

---

## What you can build

| Extension type | Example | Where it appears |
|----------------|---------|-----------------|
| **Tool** | Hum-to-MIDI | Toolbar button → opens a window |
| **Voice panel section** | Advanced vibrato editor | Collapsible section in Voice Panel |
| **Piano roll tool** | Brush mode, chord inserter | Tool buttons in the piano roll toolbar |
| **Menu item** | Export to REAPER RPP | Under File, Edit, or a custom menu |
| **Standalone window** | Phoneme visualiser, spectrum analyser | Floating panel |
| **MLC addon** | Language pack, voicebank mapper | MLC pipeline |

---

## Bundle format

```
my_extension.melon   (ZIP archive)
├── manifest.json    ← required
├── ui/
│   ├── index.html   ← your UI (loaded in a sandboxed webview)
│   ├── style.css
│   └── app.js
├── backend/
│   └── main.py      ← optional Python backend (runs in MLC process)
├── icon.svg         ← 32×32 icon shown in toolbar/menu
└── README.md
```

---

## manifest.json schema

```json
{
  "id":          "hum_to_midi",
  "name":        "Hum to MIDI",
  "version":     "1.0.0",
  "melon_api":   "1.0",
  "description": "Hum a melody, get MIDI notes",
  "author":      "yourname",
  "license":     "MIT",
  "homepage":    "https://github.com/you/hum-to-midi",
  "icon":        "icon.svg",
  "update_url":  "https://example.com/hum_to_midi/update.json",

  "extension_type": "tool",

  "ui": {
    "entry": "ui/index.html",
    "width": 480,
    "height": 360,
    "resizable": true,
    "title": "Hum to MIDI"
  },

  "placements": [
    {
      "type":    "toolbar_button",
      "label":   "Hum to MIDI",
      "icon":    "icon.svg",
      "tooltip": "Record yourself humming and convert to notes",
      "shortcut": "⌘⇧H"
    }
  ],

  "permissions": ["microphone", "notes.write", "mlc.read"],

  "backend": {
    "entry":    "backend/main.py",
    "pip_deps": ["librosa", "numpy"]
  }
}
```

---

## Placement types

### `toolbar_button`
Adds a button to the main toolbar (top right area).
```json
{ "type": "toolbar_button", "label": "My Tool", "icon": "icon.svg", "shortcut": "⌘⇧M" }
```

### `voice_panel_section`
Adds a collapsible section to the Voice Panel (left sidebar).
```json
{ "type": "voice_panel_section", "label": "Vibrato Editor", "default_collapsed": true }
```

### `piano_roll_tool`
Adds a tool button to the piano roll toolbar.
```json
{ "type": "piano_roll_tool", "label": "Chord mode", "icon": "chord.svg", "tool_key": "C" }
```

### `menu_item`
Adds an item to a top menu.
```json
{ "type": "menu_item", "menu": "File", "label": "Export to REAPER...", "shortcut": "⌘⇧R" }
```

### `standalone_window`
A floating window opened programmatically.
```json
{ "type": "standalone_window", "width": 640, "height": 480 }
```

---

## JavaScript API (in your ui/index.html)

The `melon` global object is injected into your UI webview.

```js
// ── Read project data ─────────────────────────────────────────────
const notes = await melon.notes.getAll();
// → [{ id, pitch, start, duration, lyric, phoneme }, ...]

const bpm   = await melon.project.getBpm();
const name  = await melon.project.getName();
const track = await melon.tracks.getSelected();

// ── Write notes ────────────────────────────────────────────────────
await melon.notes.add({ pitch: 60, start: 0, duration: 0.5, lyric: 'la' });
await melon.notes.addMany([...]);
await melon.notes.clear();  // requires notes.write permission

// ── MLC integration ────────────────────────────────────────────────
const result = await melon.mlc.convert({
    text:        'beautiful dream',
    moduleId:    'jp_cv_standard',
    singability: 0.65,
});
// → { tokens: [...], confidence_score: 0.72, warnings: [...] }

await melon.mlc.applyTokens(result.tokens);  // maps to notes in order

// ── Notifications ──────────────────────────────────────────────────
melon.notify({ type: 'success', title: 'Import complete', body: '24 notes added' });
melon.notify({ type: 'error',   title: 'Mic not found' });

// ── Window ────────────────────────────────────────────────────────
melon.window.close();
melon.window.resize(640, 480);

// ── Events ────────────────────────────────────────────────────────
melon.on('notes.changed', (notes) => { /* re-render */ });
melon.on('playback.started', () => { /* respond to play */ });
melon.on('track.selected', (track) => { /* update for track */ });
```

---

## Python backend API

Your `backend/main.py` runs in the MLC Python process.
Define a class that inherits from `MelonExtensionBackend`:

```python
from mlc.api.melon_ext import MelonExtensionBackend

class HumToMidiBackend(MelonExtensionBackend):
    id = 'hum_to_midi'
    
    def on_load(self):
        import librosa
        self._librosa = librosa
    
    # The frontend calls this via: await melon.backend.call('process_audio', { ... })
    def process_audio(self, audio_data: bytes, sample_rate: int) -> list[dict]:
        """
        Process raw audio and return detected note events.
        """
        import numpy as np
        audio = np.frombuffer(audio_data, dtype=np.float32)
        
        # your analysis here...
        pitches, magnitudes = self._librosa.piptrack(y=audio, sr=sample_rate)
        
        notes = []
        # ... extract notes ...
        
        return notes  # list of {pitch, start, duration}
    
    def on_notes_changed(self, notes: list[dict]):
        """Called when the project notes change."""
        pass
```

The frontend calls backend methods with:
```js
const notes = await melon.backend.call('process_audio', { audio, sampleRate });
```

---

## Permissions

Extensions declare which capabilities they need in `manifest.json`:

| Permission | What it allows |
|------------|----------------|
| `project.read` | Read notes, tracks, BPM, project metadata |
| `project.write` | Add, modify, delete notes and tracks, change BPM |
| `mlc.convert` | Call MLC conversion engine |
| `audio.play` | Trigger audio playback (preview notes) |
| `audio.capture` | Capture audio stream from microphone |
| `microphone` | Access the microphone (MediaDevices) |
| `filesystem.read` | Read files from disk via OS dialog |
| `filesystem.write` | Write/save files to disk via OS dialog |
| `network` | Make outbound HTTP requests |
| `notifications` | Show notifications in the bell panel |
| `clipboard` | Read/write system clipboard |

Users see the permission list before installing. Permissions not declared are blocked.

---

## Update manifest (for auto-updates)

Host a JSON file at your `update_url`:

```json
{
  "id":             "hum_to_midi",
  "latest_version": "1.2.0",
  "download_url":   "https://example.com/hum_to_midi-1.2.0.melon",
  "changelog":      "Improved pitch detection, added breath detection",
  "min_melon_api":  "1.0",
  "is_breaking":    false
}
```

Melon Synth checks this URL periodically and shows an update badge in the Extensions panel.

---

## Example: Chord Inserter

A tool that lets you type a chord name and inserts the notes:

```json
{
  "id": "chord_inserter",
  "name": "Chord Inserter",
  "melon_api": "1.0",
  "extension_type": "tool",
  "ui": { "entry": "ui/index.html", "width": 320, "height": 200 },
  "placements": [
    { "type": "piano_roll_tool", "label": "Chord", "tool_key": "C" }
  ],
  "permissions": ["notes.write", "project.read"]
}
```

```html
<!-- ui/index.html -->
<input id="chord" placeholder="Cmaj7, Am, G7..." />
<button onclick="insert()">Insert at playhead</button>

<script>
const CHORDS = {
  'C':    [60, 64, 67],
  'Cmaj7':[60, 64, 67, 71],
  'Am':   [57, 60, 64],
  // ...
};

async function insert() {
  const name  = document.getElementById('chord').value.trim();
  const pitches = CHORDS[name];
  if (!pitches) { melon.notify({ type:'error', title:`Unknown chord: ${name}` }); return; }
  const pos   = await melon.project.getPlayheadPosition();
  await melon.notes.addMany(pitches.map(p => ({ pitch: p, start: pos, duration: 1, lyric: name })));
  melon.notify({ type:'success', title:`Inserted ${name}` });
  melon.window.close();
}
</script>
```

---

## Coming soon (planned for v2)

- Custom rendering engines (replace OpenUTAU with your own synth)
- Timeline tracks (add a separate track type)  
- Real-time audio analysis plugins
- Collaboration extensions (shared cursors, comments)

---

## React Panel Extensions (v0.6+)

Instead of a separate webview, you can write a React component that mounts directly inside Melon Synth's layout. This is the **preferred approach** for panels, sidebars, and toolbars.

### How it works

1. Your `.melon` bundle includes a compiled React component (in `index.js`)
2. Your `manifest.json` declares `contributes.panels` with layout zones
3. Melon Synth's `AddonPanelHost` mounts your component and passes a `melonAPI` prop

### manifest.json for a React panel

```json
{
  "id":          "vibrato_editor",
  "name":        "Advanced Vibrato",
  "version":     "1.0.0",
  "type":        "app_addon",
  "min_melon":   "0.6.0",
  "entry_point": "index.js",
  "permissions": ["project.read", "project.write"],

  "contributes": {
    "panels": [
      {
        "id":             "vibrato_panel",
        "display_name":   "Advanced Vibrato",
        "icon":           "Activity",
        "requested_zone": "voice_panel_bottom",
        "fallback_zone":  "right_sidebar",
        "collapsible":    true,
        "resizable":      true,
        "component":      "VibratoPanel"
      }
    ],
    "commands": [
      { "id": "vibrato.reset",  "label": "Reset vibrato" },
      { "id": "vibrato.preset", "label": "Apply vibrato preset" }
    ],
    "toolbar_items": [
      { "id": "vibrato_btn", "icon": "Activity", "tooltip": "Vibrato Editor", "command": "vibrato.open" }
    ]
  }
}
```

### Writing the React component (index.js)

```jsx
// Use window.React — it's exposed by Melon Synth
const { useState, useEffect } = window.React;

function VibratoPanel({ melonAPI }) {
  const [notes, setNotes] = useState([]);

  useEffect(() => {
    setNotes(melonAPI.project.getSelectedNotes());
    const unsub = melonAPI.project.on('change', () => {
      setNotes(melonAPI.project.getSelectedNotes());
    });
    return unsub;
  }, []);

  return window.React.createElement('div', {
    style: { padding: 12, fontFamily: 'var(--font-ui)', fontSize: 'var(--text-sm)' }
  },
    window.React.createElement('div', {
      style: { fontWeight: 500, color: 'var(--text-primary)', marginBottom: 8 }
    }, `Vibrato · ${notes.length} selected`),
    // ... your UI here
  );
}

// Register exports so AddonPanelHost can find the component
window.__MELON_ADDON_EXPORTS__ = { VibratoPanel };
```

### Layout zones

| Zone | Location | Best for |
|------|----------|----------|
| `voice_panel_bottom` | Below voice sliders (left sidebar) | Voice/track tools |
| `voice_panel_tab` | Extra tab in voice panel | Alternative views |
| `editor_toolbar` | Above piano roll | Tool buttons |
| `editor_bottom` | Below lyrics lane | Analysis, waveform |
| `right_sidebar` | Right side panel | Inspectors, browsers |
| `floating_window` | Standalone draggable | Big tools |
| `command_bar_right` | Top-right of command bar | Quick actions |

### melonAPI reference (prop passed to your component)

```typescript
interface MelonAddonAPI {
  project: {
    getNotes():            Note[];
    getTracks():           Track[];
    getBpm():              number;
    getProjectName():      string;
    getPlayheadPosition(): number;
    getSelectedNotes():    Note[];
    addNote(note):         Promise<string>;  // returns note ID
    updateNote(id, patch): Promise<void>;
    deleteNote(id):        Promise<void>;
    setLyric(id, lyric):   Promise<void>;
    setBpm(bpm):           Promise<void>;
    on(event, callback):   () => void;  // returns unsubscribe fn
  };
  mlc: {
    convert(params):            Promise<ConversionResult>;
    listModules():              Promise<ModuleInfo[]>;
    detectLanguage(text):       Promise<string>;
    suggestSingability(params): Promise<{suggested, reason}>;
  };
  audio: {
    playNote(pitch, dur, vel):  void;
    stopAllNotes():             void;
    isPlaying():                boolean;
  };
  ui: {
    notify(n):       void;    // {type, title, body}
    getTheme():      string;  // 'dark' | 'light'
    onThemeChange(cb): () => void;
    getToken(name):  string;  // CSS custom property value
  };
  storage: {
    get(key):        Promise<any>;
    set(key, value): Promise<void>;
  };
}
```

### Design tokens for addon CSS

Use CSS variables for colors so your addon works in both light and dark mode:

```css
/* Always use these — never hardcode hex values */
var(--bg-base)         /* page background */
var(--bg-surface)      /* card/panel background */
var(--bg-sunken)       /* input/inset background */
var(--text-primary)    /* main text */
var(--text-secondary)  /* labels, descriptions */
var(--text-tertiary)   /* hints, timestamps */
var(--accent)          /* melon green — buttons, links */
var(--border-subtle)   /* light borders */
var(--border-default)  /* standard borders */
var(--font-ui)         /* Inter — body text */
var(--font-mono)       /* JetBrains Mono — code, values */
var(--text-sm)         /* 12px */
var(--text-base)       /* 14px */
var(--radius-md)       /* 6px — buttons, inputs */
var(--radius-lg)       /* 8px — cards */
```

---

## MTI Access for Extensions

Extensions can use the Melon Terminal Interface for debugging:

```javascript
// Run a shell command
const result = await window.mti.exec('ls -la', '/some/path');

// Run Python in MLC environment
const pyResult = await window.mti.python('from core.g2p import G2PEngine; print("ok")');

// Spawn a persistent shell session
await window.mti.spawnSession('my-ext-session');
await window.mti.write('my-ext-session', 'echo hello\n');
window.mti.onStdout((id, data) => {
  if (id === 'my-ext-session') console.log(data);
});
```
