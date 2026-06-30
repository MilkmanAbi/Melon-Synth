# Changelog

## v0.6.0 — 2026-03-25

### Bug Fixes
- **Fixed crash on startup** — duplicate IPC handler registration (7 channels registered twice)
- **Fixed welcome screen wallpaper** — removed gradient overlay that dimmed the hand-drawn art
- **Fixed "Browse for addon file" button** — null window guard, clear message in browser-dev mode
- **Fixed Export WAV** — now actually triggers the render pipeline instead of just opening a dialog
- **Fixed extension toggle** — enable/disable now persists and notifies

### New: Melon Terminal Interface (MTI)
- In-app terminal with Shell, MLC, and Python tabs
- Built-in MLC command router: `convert`, `trace`, `modules`, `addons`, `detect`, `cache`, `ping`
- Command history (Up/Down), Ctrl+L clear, Ctrl+C interrupt
- Resizable panel with drag handle
- Keyboard: Ctrl+` to toggle, Escape to minimize
- Menu: View → Terminal (MTI), or Command Palette → "Toggle Terminal"
- Full documentation in `docs/MTI.md`

### New: Extension UI Placement System
- `.melon` extensions can now register panels at layout zones: `editor_bottom`, `right_sidebar`, `voice_panel_bottom`, `editor_toolbar`, etc.
- `window.melonAddons` API for panel/toolbar/menu/command registration
- AddonPanelHost wired into the main layout at editor_bottom and right_sidebar
- Extensions receive full `melonAPI` with project, MLC, audio, UI, storage access

### New: End-to-End Render Pipeline
- **Connected the missing link**: 4 IPC handlers (`render:render`, `render:generate-ust`, `editor:detect`, `editor:open`) that bridge the UI to the Python render engine
- Full chain: notes → MLC phonemes → UST → OpenUTAU CLI → WAV → audio playback
- Integrates with `openutau-bundler.ts` for automatic OpenUTAU detection
- Export WAV now renders to a user-chosen path with progress notification

### Documentation
- Complete TypeScript declarations for all 6 window APIs (50+ methods)
- MTI documentation (`docs/MTI.md`)
- Updated HANDOFF.md with full IPC channel map, new architecture diagrams
- Command Palette: added Terminal, Extensions, Install addon commands

## v1.0.0 Alpha — 2026-03-22

First public release. 🍈

### Features
- Piano roll with draw, select, erase, pitch modes
- Snap grid (1/4, 1/8, 1/16, 1/32) with visual subdivision lines
- MLC Engine — lyrics to phonemes (JP CV/CVVC, English, Cantonese, Mandarin, Korean)
- MLC popup window with word-by-word phoneme breakdown and confidence scores
- OpenUTAU render pipeline — notes → UST → WAV with full expression flags
- Voice parameters: Breathiness, Tension, Gender, Pitch Range
- Advanced OpenUTAU expressions: Velocity, Volume, Attack, Decay, Modulation, Tone Shift, Lowpass, Normalize
- Pitch curve editor
- MIDI import with quantize options
- Project save/load (.loid format)
- Voicebank manager with catalog, download, and addon installer
- .mlc addon system (hot-reload, MIT licensed)
- Welcome screen with recent projects and example projects
- Command palette (⌘K) with fuzzy search
- Dark/light mode
- Keyboard shortcuts: ⌘Z/Y undo/redo, ⌘C/V/X copy/paste/cut, ↑↓ transpose, arrows nudge
- Auto-scroll playhead, smooth 60fps canvas animation
- Save prompt before destructive actions
- GNOME-style About screen

### Known limitations (Alpha)
- OpenUTAU render requires OpenUTAU to be installed separately
- No installer yet — run from source
- Voicebank download from catalog is experimental
- Pitch curve editor is functional but lacks smoothing modes
