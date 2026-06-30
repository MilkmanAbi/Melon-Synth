# Changelog

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
