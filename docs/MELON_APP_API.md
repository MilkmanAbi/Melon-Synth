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
| `notes.read` | Read notes from the project |
| `notes.write` | Add, modify, delete notes |
| `mlc.read` | Call MLC conversion |
| `mlc.write` | Install MLC modules |
| `project.read` | Read project metadata (BPM, name, etc.) |
| `project.write` | Modify BPM, project name |
| `microphone` | Access the microphone |
| `file.read` | Open files from disk |
| `file.write` | Save files to disk |
| `network` | Make HTTP requests |

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
