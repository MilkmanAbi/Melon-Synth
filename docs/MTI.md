# Melon Terminal Interface (MTI)

**Power-user terminal for MLC debugging, project introspection, voicebank management, and addon development.**

## Opening MTI

- **Keyboard:** `Ctrl+`` ` `` (backtick)
- **Menu:** View → Terminal (MTI)
- **Command Palette:** `Cmd+K` → "Toggle Terminal"

---

## MLC Tab — full command reference

### MLC Engine

| Command | Description |
|---------|-------------|
| `convert <text>` | Convert text → phonemes. Flags: `--module <id>`, `--singability <0-1>` |
| `trace <text>` | Trace pipeline step-by-step. `--module <id>` |
| `detect <text>` | Detect language with confidence score |
| `modules` | List loaded voicebank modules |
| `addons` | List installed MLC addons |
| `ping` | Check engine status and version |
| `cache stats` | Show G2P/phrase cache stats |
| `cache clear [target]` | Clear cache (`g2p`, `phrase`, `all`) |

### Project

| Command | Description |
|---------|-------------|
| `info` / `project` | Full project overview |
| `notes list` | Show first 30 notes |
| `notes count` | Total note count |
| `notes selected` | Show selected notes |
| `notes clear` | Delete all notes |
| `bpm [value]` | Get/set BPM (20–300) |
| `snap [1/4\|1/8\|...]` | Get/set snap grid |
| `mode [select\|draw\|...]` | Get/set edit mode |

### Voicebanks & Render

| Command | Description |
|---------|-------------|
| `vb list` | Show installed voicebanks |
| `vb scan` | Detect OpenUTAU and editors |
| `render editors` | List detected DAWs |
| `render ust` | Preview UST output |

### Extensions

| Command | Description |
|---------|-------------|
| `ext list` | List all addons |

### Playback

| Command | Description |
|---------|-------------|
| `play` / `stop` | Control playback |
| `dark` | Toggle theme |
| `undo` / `redo` | History |

### Examples

```
mlc> convert sora iru --module jp_cv_standard
→ so ra i ru

  so       phoneme=s o    conf=92% src=g2p
  ra       phoneme=r a    conf=95% src=g2p
  i        phoneme=i      conf=98% src=g2p
  ru       phoneme=r u    conf=94% src=g2p

Tokens: 4  Lang: ja  Module: jp_cv_standard  Time: 12ms
```

```
mlc> info
Project: untitled
BPM: 132  Snap: 1/8  Mode: draw
Notes: 24  Selected: 3
Tracks: 1  Active: Track 1
Pitch range: C4 – G5 (19 semitones)
Duration: 16.0 beats (7.3s)
Voice: Kasane Teto
Breathiness: 40  Tension: 65  Gender: 30
```

---

## Python Tab

Pre-loaded music utilities:

```python
midi_to_note(60)              # → 'C4'
note_to_midi('C#5')           # → 73
gen_scale(60, 'major')        # → [60, 62, 64, 65, 67, 69, 71, 72]
gen_scale(60, 'blues')        # → [60, 63, 65, 66, 67, 70, 72, 75]
gen_scale(60, 'pentatonic')   # → [60, 62, 64, 67, 69, 72, 74, 76]
```

MLC modules:
```python
from core.g2p import G2PEngine
from render.ust_generator import generate_ust
from render.render_bridge import find_openutau, list_installed_voicebanks
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Execute |
| `Up/Down` | History |
| `Ctrl+L` | Clear |
| `Ctrl+C` | Cancel/SIGINT |
| `Escape` | Minimize |

---

## IPC API (for extensions)

```javascript
const r = await window.mti.exec('ls -la');
const r = await window.mti.python('print(gen_scale(60, "blues"))');
await window.mti.spawnSession('s1');
await window.mti.write('s1', 'echo hello\n');
window.mti.onStdout((id, data) => console.log(data));
```
