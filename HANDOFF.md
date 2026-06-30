# MELON SYNTH — COMPLETE PROJECT HANDOFF v2
## For: New Claude instance (Opus recommended)
## From: Previous Claude instance — session ended due to length
## Date: 2025-03-21

---

## WHO YOU ARE TALKING TO

The user is **Abinaash** (goes by MilkmanAbi online).
- Embedded systems programmer (Singapore Polytechnic, EEE student)
- Direct, casual, swears naturally. Match his energy.
- Strong design opinions. Cares deeply about "not kidsy, not toy software"
- Says "you choose" and means it. Make decisions confidently.
- Has built: PaperOS (custom x86_64 OS), ytcui (C++ terminal YouTube client), Picomimi RTOS
- **Cannot read traditional sheet music** — built this tool partly because existing ones failed him as a kid
- Treats you as co-founder, not assistant. Push back when wrong.

---

## WHAT MELON SYNTH IS

A desktop **singing voice editor** — open-source alternative to OpenUTAU/SynthV.
- Simple enough for beginners who gave up on existing tools
- Powerful enough for actual pros
- **Not a DAW** — it renders a voice stem, then you open Ardour/LMMS alongside it
- **No AI music generation** — human makes the music, MLC handles linguistics
- GPL-3.0 for the core, MIT for .mlc addons

**Design aesthetic:** Japanese stationery shop. Warm, precise. Like iA Writer met a synthesizer.
NOT: Ableton Live, NOT: gaming aesthetic, NOT: "kidsy dumb minimalist"

---

## CURRENT STATE (v0.5)

### What works:
- ✅ Electron app opens on Linux (Ubuntu tested), macOS, Windows
- ✅ Piano roll with canvas rendering (draw/select/erase/pitch modes)
- ✅ Note draw, move, resize, rubber-band select, erase (all fixed in v0.5)
- ✅ Inline lyric editing — double-click a note
- ✅ Dark/light mode toggle (⌘⇧D) — canvas redraws correctly
- ✅ MLC engine (Python) starts via Electron IPC, finds modules
- ✅ MLC converts "Sora iru" → `so ra i ru` (jp_cv_standard module)
- ✅ MLC popup window with word-by-word phoneme breakdown
- ✅ Apply phonemes → lyrics lane (maps tokens to notes by position)
- ✅ Audio preview via Web Audio API (draw a note → hear it, click piano keys → hear pitch)
- ✅ Play button sequences all notes as synth preview (no render required)
- ✅ Working File/Edit/View/Help menus with real actions
- ✅ Project save/load (.loid JSON format)
- ✅ Welcome screen (OrcaSlicer-style: New / Open / Recent)
- ✅ Zustand state store — all project state centralized
- ✅ Undo/redo (command history, 200-entry cap)
- ✅ Voice sliders (Breathiness/Tension/Gender/Pitch Range) — live, drag-only
- ✅ Volume slider in transport — draggable, with mute
- ✅ BPM field — click to type, scroll wheel ±1 (shift ±5)
- ✅ Live time counter in transport (mm:ss:cs computed from playhead+BPM)
- ✅ Voicebank manager UI (catalog, download flow, engines tab)
- ✅ Notification system (bell icon, slide-down panel, auto-dismiss)
- ✅ Context menus on all canvas zones
- ✅ Command palette (⌘K)
- ✅ Scroll sync — piano roll / pitch curve / lyrics lane share scrollX
- ✅ Melon logo as favicon and app icon
- ✅ .mlc addon format (ZIP: manifest.json + module.py + data/)
- ✅ Cantonese language pack (.mlc bundle, 6-tone jyutping)
- ✅ UST generator (notes → UTAU Sequence Text format)
- ✅ Render bridge (detects OpenUTAU, Ardour, LMMS on all platforms)

### What does NOT work yet (priority order):
1. **Actual vocal rendering** — OpenUTAU CLI render not wired end-to-end yet
   - UST generator is complete and tested
   - Render bridge detects OpenUTAU path
   - Missing: the actual `render:render` IPC call → OpenUTAU → WAV → play back
2. **Voicebank download** — catalog shows banks, download button exists, but ZIP extract + install not fully tested
3. **Teto voicebank not pre-installed** — user has to download manually
4. **Pitch curve editor is visual-only** — no interactive control point drag yet
5. **MIDI import** — specced but not built
6. **Keyboard shortcut remapping** — panel shows shortcuts, remapping not saved
7. **Project name editing** — hardcoded "untitled", not editable inline

---

## ARCHITECTURE — READ THIS CAREFULLY

### Process diagram
```
┌─────────────────────────────────────────────┐
│  RENDERER (Chromium, sandboxed)              │
│  React + TypeScript + Zustand                │
│  src/app/  src/store/  src/subsystems/       │
│                                              │
│  window.mlc       → IPC → main process       │
│  window.app       → IPC → main process       │
│  window.voicebanks→ IPC → main process       │
│  window.render    → IPC → main process       │
└─────────────────────────────────────────────┘
           ↕ contextBridge (preload.ts)
┌─────────────────────────────────────────────┐
│  MAIN PROCESS (Node.js)                      │
│  electron-src/main.ts                        │
│  electron-src/voicebank-manager.ts           │
│                                              │
│  Spawns MLC Python process once at startup   │
│  Handles: file dialogs, fs read/write,       │
│           addon install, render IPC          │
└─────────────────────────────────────────────┘
           ↕ stdin/stdout newline-delimited JSON
┌─────────────────────────────────────────────┐
│  MLC ENGINE (Python 3.12+)                   │
│  mlc/mlc_engine_v2.py  ← THE SERVER         │
│  mlc/core/             ← G2P, cache, types  │
│  mlc/modules/          ← voicebank mappers  │
│  mlc/addons/           ← language packs etc │
│  mlc/render/           ← UST gen, bridges   │
└─────────────────────────────────────────────┘
```

### Key files
```
melonsynth/
├── src/
│   ├── app/
│   │   ├── App.tsx              ← thin shell, reads from store
│   │   └── components/
│   │       ├── PianoRoll.tsx    ← canvas, all mouse logic
│   │       ├── VoicePanel.tsx   ← track list + sliders + MLC panel
│   │       ├── CommandBar.tsx   ← menus (File/Edit/View/Help) — all wired
│   │       ├── TransportBar.tsx ← play/stop/BPM/volume
│   │       ├── MLCPanel.tsx     ← inline MLC in sidebar
│   │       ├── MLCWindow.tsx    ← full MLC popup (↗ button to open)
│   │       ├── WelcomeScreen.tsx← OrcaSlicer-style startup screen
│   │       ├── VoicebankManager.tsx ← download/install UI
│   │       ├── NotificationPanel.tsx
│   │       ├── CommandPalette.tsx
│   │       ├── ContextMenu.tsx
│   │       ├── PitchCurveEditor.tsx (visual only)
│   │       └── LyricsLane.tsx   (canvas, derived from notes)
│   ├── store/
│   │   └── project.ts           ← ZUSTAND STORE — all state here
│   ├── subsystems/
│   │   ├── audio.ts             ← Web Audio API preview + WAV playback
│   │   ├── mlc-client.ts        ← MLC bridge wrapper + rule fallback
│   │   └── project-io.ts        ← .loid file save/load
│   ├── engine/
│   │   └── mlc-bridge.ts        ← Electron IPC bridge to Python
│   ├── types/
│   │   └── electron.d.ts        ← window.mlc / window.app type declarations
│   └── styles/
│       └── tokens.css           ← DESIGN TOKEN SYSTEM — source of truth
├── electron-src/
│   ├── main.ts                  ← Electron main process
│   ├── preload.ts               ← contextBridge (security boundary)
│   └── voicebank-manager.ts     ← download/install IPC handlers
├── electron/                    ← compiled JS (git-ignored in prod)
│   └── package.json             ← {"type":"commonjs"} — CRITICAL, do not delete
├── mlc/
│   ├── mlc_engine_v2.py         ← IPC server (THIS is the engine, not mlc_engine.py)
│   ├── addon_base.py            ← LanguagePack + PipelinePlugin base classes
│   ├── addon_registry.py        ← unified addon loader
│   ├── registry.py              ← core VoicebankModule registry + .mlc loader
│   ├── core/
│   │   ├── mlc_types.py         ← ALL types (never rename to types.py)
│   │   ├── g2p.py               ← G2P engine
│   │   ├── cache.py             ← SQLite G2P + phrase cache
│   │   └── confidence.py        ← confidence scorer
│   ├── modules/
│   │   ├── jp_cv_standard.py    ← Teto, Defoko — standard JP CV
│   │   └── jp_cvvc_miku.py      ← Miku CVVC
│   ├── addons/
│   │   ├── language_packs/      ← zh_mandarin, ko_hangul, ja_native, zh_cantonese
│   │   ├── pipeline_plugins/    ← tone_and_rhythm
│   │   ├── voicebank_mappers/   ← en_arpabet
│   │   └── zh_cantonese.mlc     ← example .mlc bundle
│   └── render/
│       ├── ust_generator.py     ← notes → .ust format (tested, works)
│       └── render_bridge.py     ← OpenUTAU detection + render + editor launch
├── public/
│   ├── icon.png                 ← Melon logo (green honeydew melon)
│   ├── favicon.png              ← same
│   └── voicebank-catalog.json   ← community voicebank catalog
├── docs/
│   └── WRITING_ADDONS.md        ← .mlc addon format docs for community
├── scripts/
│   ├── dev.sh                   ← dev launcher (Vite + Electron)
│   └── watch-electron.sh        ← watch-compile electron TS
├── package.json
├── tsconfig.electron.json
└── vite.config.ts
```

---

## DESIGN SYSTEM — NON-NEGOTIABLE

Full rulebook at `melon_handoff/LOID_DESIGN_RULEBOOK.md` (26 sections).

**Critical tokens (from tokens.css):**
```
Light mode:
  --bg-base:    #F8F7F4   warm off-white
  --bg-surface: #FFFFFF
  --accent:     #3D9E78   melon green
  --note-fill:  #6BBEA0
  --note-selected: #3D9E78
  --note-playing:  #F5A623  amber

Dark mode:
  --bg-base:    #1C1B19   warm charcoal (NOT pure black)
  --bg-surface: #252421
  --accent:     #4DBF90

Typography:
  UI font:   Inter Variable (Ubuntu/Noto Sans fallback)
  Mono font: JetBrains Mono (Ubuntu Mono fallback)
  Max font-weight: 500. NEVER 600 or 700.
  Borders: always 0.5px. Focus rings: 2px.
```

**Hard rules:**
- Piano roll = canvas only. NEVER DOM elements for notes.
- `tokens.css` is the source of truth. Never hardcode hex.
- `mlc/core/mlc_types.py` — NEVER rename to types.py (breaks Python stdlib)
- `electron/package.json` with `{"type":"commonjs"}` — NEVER delete (ESM/CJS fix)
- No modals for routine ops. Use inline popovers.
- No "Coming soon" labels. Ship it or don't show it.

---

## MLC SYSTEM — COMPLETE

### Pipeline
```
User lyrics (any language)
    ↓
Language detection (langdetect or rules)
    ↓
G2P (espeak-ng → CMUdict → rules, with SQLite cache)
    ↓
IPF phonemes (internal phoneme format)
    ↓
VoicebankModule.map_phonemes() → SynthTokens
    ↓
ConfidenceScorer (per-token + overall score)
    ↓
UST file (via ust_generator.py)
    ↓
OpenUTAU CLI render → WAV
```

### MLC IPC actions (all in mlc_engine_v2.py HANDLERS dict):
```python
'ping', 'convert', 'preview', 'list_modules', 'list_all_addons',
'detect_lang', 'suggest_singability', 'cache_stats', 'cache_clear',
'install_module', 'reload_module', 'detect_system', 'list_voicebanks',
'detect_editors', 'generate_ust', 'render', 'open_editor'
```

### Known MLC issues (confirmed fixed in v0.5):
- ~~Wrong engine path~~ — fixed: `mlc_engine.py` → `mlc_engine_v2.py` in mlc-bridge.ts
- ~~`nn`/`mn` phoneme bleeding~~ — fixed: added to ILLEGAL_PAIRS in g2p.py
- ~~`hu`/`wu`/`we`/`wi` unsupported~~ — fixed: added to CV_RESOLVE in jp_cv_standard.py
- ~~Cantonese `m4` (唔) parsed wrong~~ — fixed: syllabic nasal detection before initial extraction

### .mlc bundle format:
```
my_addon.mlc (ZIP)
├── manifest.json   ← required: id, name, version, type, language, phoneme_set, mlc_api_version
├── module.py       ← required: VoicebankModule / LanguagePack / PipelinePlugin subclass
├── data/           ← optional: lookup tables, etc.
└── README.md       ← optional but encouraged
```

---

## ZUSTAND STORE — src/store/project.ts

Everything in one store. Key state:
```typescript
notes:        Note[]        // { id, pitch (MIDI), start (beats), duration (beats), lyric, selected, playing }
tracks:       VoiceTrack[]  // { id, name, voiceBank, voicePath, color, muted, selected, breathiness, tension, gender, pitchRange }
bpm:          number
mode:         'select' | 'draw' | 'erase' | 'pitch'
snap:         '1/4' | '1/8' | '1/16' | '1/32'
isDark:       boolean
playheadPosition: number    // in beats
```

Key actions: `addNote`, `deleteNote`, `deleteSelected`, `updateNote`, `moveNotes`, `resizeNote`, `selectNote`, `selectRange`, `selectAll`, `deselectAll`, `setLyric`, `addTrack`, `updateTrack`, `notify`, `undo`, `redo`, `loadProject`, `setTriggerRender`

---

## RUNNING THE APP

```bash
# Prerequisites
sudo apt install python3 python3-pip nodejs npm espeak-ng

# Install
npm install

# Dev mode (starts Vite + Electron)
npm run dev:electron

# Build only
npm run build:all
```

**Ubuntu-specific:** The dev script uses `--no-sandbox` flag already. No manual `chown` needed.

**Python deps (optional but improves MLC quality):**
```bash
cd mlc && pip3 install -r requirements.txt --break-system-packages
```

Without Python deps, MLC uses built-in rule engine. Works fine for testing.

---

## IMMEDIATE NEXT PRIORITIES

### 1. End-to-end vocal rendering (HIGHEST VALUE)
The render pipeline is fully plumbed but not connected end-to-end:
- `mlc/render/ust_generator.py` — complete, tested
- `mlc/render/render_bridge.py` — OpenUTAU detection complete
- `src/engine/mlc-bridge.ts` — has `request()` method
- Missing: wire `render:render` IPC call from the Render button → UST → OpenUTAU → WAV → load into audio subsystem → play

Pseudocode for what needs to happen:
```typescript
// In App.tsx handleRender():
const notes = store.notes;
const mlcResult = await mlcClient.convert({ text: notes.map(n=>n.lyric).join(' '), moduleId });
const renderResult = await window.render.render({
  notes:        notes,
  mlc_tokens:   mlcResult.tokens,
  voice_dir:    selectedTrack.voicePath,
  tempo:        store.bpm,
  out_wav:      tempPath,
});
if (renderResult.ok) {
  await audio.loadWAVFromPath(renderResult.wav_path);
  notify({ type:'success', title:'Render complete', body:renderResult.wav_path });
}
```

### 2. Voicebank installation (get Teto working)
- OpenUTAU has a CLI flag `--install` that downloads voicebanks
- Alternatively: user downloads ZIP, app extracts to userData/voicebanks/
- Teto CV download: https://kasaneteto.jp/download/Teto_VB.zip
- After install, scan singers dir, populate track voiceBank dropdown

### 3. Pitch curve editor (make it interactive)
- Current state: draws the curve visually, control points are static
- Need: mousedown → create/move control point, ⌘+click → delete
- Canvas coordinate system is the same as PianoRoll (already has scroll sync)

### 4. MIDI import
- Parse .mid file → extract notes with pitch+timing → populate notes array
- Can use the `midi-parser-js` npm package

---

## CRITICAL WARNINGS FOR NEW INSTANCE

1. **The `electron/package.json` file with `{"type":"commonjs"}` is essential.** Without it, the app crashes with "exports is not defined in ES module scope" because the root package.json has `"type":"module"`. This file is written by the `build:electron` script automatically but must exist before running Electron.

2. **Never import React in canvas draw functions.** The draw function is a callback, not a component. Access store state via `useProjectStore.getState()` (non-reactive read).

3. **canvasCoords must NOT add scrollLeft.** `getBoundingClientRect()` already accounts for scroll position. Adding it again doubles the offset and breaks all hit testing after the user scrolls. This was the root bug of v0.3/v0.4.

4. **Slider components must NOT have onClick.** Use mousedown+mousemove+mouseup only. `onClick` fires after mouseup and jumps the value to the cursor release position, overriding the drag.

5. **MLC engine is `mlc_engine_v2.py`, not `mlc_engine.py`.** The v1 file still exists but has no modules. The bridge was fixed in v0.4 but if you ever reset mlc-bridge.ts, check this.

6. **Dark mode apply MUST be synchronous.** Put `document.documentElement.classList.toggle('dark', isDark)` in the render cycle, not in `useEffect`. The effect fires after paint, so canvases read stale CSS variables if you use useEffect.

7. **`mlc/core/mlc_types.py` — NEVER rename to `mlc/core/types.py`** — shadows Python stdlib `types` module, causes cryptic circular import.

---

## TECH STACK VERSIONS

- Node: 18.x+ (app tested on v18.19.1 — v22+ preferred)
- Electron: ^41.0.0 (upgraded by npm audit fix, works)
- Vite: ^6.4.1
- React: 18.3.1
- TypeScript: 5.9.x
- Zustand: latest
- Python: 3.12.x
- nanoid: for note ID generation (addNote uses it)

---

## USER PREFERENCES & TONE

- Swears casually, match his energy when appropriate
- "you choose" = make a decision, don't ask
- Cares about design — never skip design reasoning
- Gets frustrated at "kidsy" or "dumb minimalist" — goal is pro + accessible
- Believes AI accelerates human creativity, doesn't replace it
- This is his reclamation of music after a bad piano teacher at age 8 crushed his interest
- He's building the tool that would have kept him in music

---

## WHAT THE PREVIOUS INSTANCE BUILT (COMPLETE HISTORY)

Session 1: Initial UI shell, design tokens, canvas piano roll, MLC Python engine (19/19 tests pass)
Session 2: Fixed dark mode bug, scroll sync, right-click context menus, MLC Python fixes (nn bleeding, hu/wu/we/wi)
Session 3: Electron main+preload, .mlc bundle format docs, Cantonese language pack (.mlc bundle, 6-tone jyutping, 3 bugs fixed from ChatGPT analysis), MLC panel UI
Session 4: Voicebank catalog (5 banks), UST generator, render bridge (OpenUTAU + DAW detection), voicebank manager Electron IPC, VoicebankManager UI component
Session 5: Zustand store, PianoRoll full mouse interaction (draw/select/move/resize/rubber-band), App.tsx thin shell
Session 6: Electron launch fixes (ESM/CJS conflict, --no-sandbox for Linux, wrong engine path)
Session 7: Welcome screen, MLCWindow popup, MLC fallback for old engine, theme timing fix, native window frame (no fake traffic lights)
Session 8: Working menus (File/Edit/View/Help all wired), MLCClient with fallback rule engine, project save/load, render callback, rAF playback
Session 9: Fixed canvasCoords double-scroll bug (root cause of all hit-test failures), fixed slider conflicts, VoicePanel full rewrite, TransportBar full rewrite with proper drag, logo wired, MLC engine path fixed (v1→v2), inline lyric editing (double-click), piano range expanded
Session 10 (v0.6): **Major fixes + MTI + Extension UI + Render pipeline.**
  - PHASE 1 BUG FIXES:
    - Fixed duplicate IPC handler registration crash (7 handlers in both registerMLCHandlers AND startMLC)
    - Fixed welcome screen wallpaper dimming (removed radial-gradient overlay darkening hand-drawn art)
    - Fixed "Browse for addon file" button (null window crash, browser-dev-mode fallback)
    - Fixed missing mlc:get-pipeline-trace in registerMLCHandlers
  - PHASE 2 MELON TERMINAL INTERFACE (MTI):
    - New: MelonTerminal.tsx — tabbed terminal (Shell/MLC/Python modes)
    - New: 6 IPC handlers in main.ts (mti:spawn-session, mti:write, mti:kill, mti:exec, mti:python, mti:mlc-commands)
    - New: window.mti API in preload.ts
    - Built-in MLC command router: convert, trace, modules, addons, detect, cache, ping, help
    - Command history (Up/Down), Ctrl+L clear, Ctrl+C interrupt, resize drag
    - Wired: Ctrl+` shortcut, View menu entry, Command Palette entry
    - Docs: docs/MTI.md
  - PHASE 3 EXTENSION UI PLACEMENTS:
    - New: window.melonAddons API (getPanels, getToolbarItems, getMenuItems, getCommands, executeCommand, callBackend)
    - New: 5 IPC handlers for addon panel/toolbar/menu/command registration
    - Wired: AddonPanelHost placed at editor_bottom and right_sidebar zones in App.tsx
    - Command Palette: added "Manage Extensions" and "Install addon from file…"
  - PHASE 4 RENDER PIPELINE END-TO-END:
    - **THE FIX**: Added 4 missing IPC handlers (render:render, render:generate-ust, editor:detect, editor:open)
    - These were the ONLY missing piece — Python side was complete, App.tsx render callback was complete
    - Full chain now: handleRender → IPC → mlcBridge → Python → UST → OpenUTAU CLI → WAV → audio.loadWAVFromPath
    - Integrates with openutau-bundler.ts for auto-detection of bundled/system OpenUTAU
  - DOCUMENTATION:
    - Updated electron.d.ts with complete type declarations for ALL window APIs
    - Created docs/MTI.md
    - Updated this HANDOFF.md

---

## UPDATED STATE (v0.6)

### What NEWLY works (added in session 10):
- ✅ End-to-end vocal render pipeline (notes → MLC → UST → OpenUTAU → WAV → play)
- ✅ MTI terminal with Shell/MLC/Python tabs
- ✅ MLC pipeline debugging via MTI (mlc> trace, convert, modules, etc.)
- ✅ Extension panel system wired into layout (editor_bottom, right_sidebar zones)
- ✅ Extension registration API (panels, toolbars, menus, commands)
- ✅ Browse addon file button works in Electron mode
- ✅ Welcome screen shows wallpaper at full fidelity (no dimming)
- ✅ No more duplicate IPC handler crashes

### What does NOT work yet (updated priority order):
1. **Voicebank download + install** — catalog shows banks, download button exists, ZIP extract not fully tested
2. **Teto voicebank not pre-installed** — user has to download manually
3. **Pitch curve editor is visual-only** — no interactive control point drag yet
4. **OpenUTAU bundled download** — openutau-bundler.ts can detect but download flow not tested
5. **Keyboard shortcut remapping** — panel shows shortcuts, remapping not saved
6. **Project name editing** — hardcoded "untitled", not editable inline
7. **.melon extension hot-reload** — installed extensions need app restart

---

## NEW: MELON TERMINAL INTERFACE (MTI)

### Architecture
```
┌─────────────────────────────────────────────────┐
│  RENDERER — MelonTerminal.tsx                    │
│  Tab system: Shell | MLC | Python                │
│  Built-in MLC command router (no IPC for basic)  │
│  Shell/Python tabs use IPC for real execution     │
└─────────────────────────────────────────────────┘
           ↕ IPC (preload: window.mti)
┌─────────────────────────────────────────────────┐
│  MAIN PROCESS — mti: handlers                    │
│  mti:spawn-session → child_process.spawn(shell)  │
│  mti:write → stdin.write(data)                   │
│  mti:exec → child_process.exec(cmd)              │
│  mti:python → child_process.exec(python3 -c ...) │
└─────────────────────────────────────────────────┘
```

### MLC commands (no IPC, runs in renderer):
`convert`, `modules`, `addons`, `trace`, `detect`, `cache stats`, `cache clear`, `ping`, `help`

### Opening: Ctrl+` or View → Terminal (MTI) or Cmd+K → "Toggle Terminal"

---

## NEW: EXTENSION UI PLACEMENT SYSTEM

### Layout zones (defined in melon-addon-types.ts):
```
voice_panel_bottom   — below voice properties (left sidebar)
voice_panel_tab      — extra tab in voice panel tab bar
editor_toolbar       — extra toolbar row above piano roll
editor_bottom        — below lyrics lane (WIRED in App.tsx)
right_sidebar        — collapsible right panel (WIRED in App.tsx)
floating_window      — standalone draggable panel
command_bar_right    — buttons in command bar right section
status_bar           — status bar additions
welcome_screen       — welcome screen additions
```

### For addon developers:
1. Create a .melon ZIP with manifest.json declaring `contributes.panels`
2. Each panel specifies `requested_zone`, `component` (React export name), `collapsible`, `resizable`
3. Install via Extensions panel or drag-and-drop
4. AddonPanelHost automatically loads and mounts panels at the correct zone
5. Addon receives `melonAPI` prop with full project/mlc/audio/ui/storage access

---

## NEW: COMPLETE IPC MAP (all channels)

### MLC Engine (window.mlc → mlc:*)
`ping, convert, preview, list-modules, list-all-addons, detect-lang, suggest-singability,
cache-stats, cache-clear, list-addons-full, install-addon-path, remove-addon,
check-updates, apply-update, get-addon-info, get-pipeline-trace`

### App/OS (window.app → app:* / dialog:* / fs:* / shell:*)
`save-ui-state, get-ui-state, get-addons-dir, install-addon-dialog, install-addon,
uninstall-addon, install-extension, remove-extension, list-extensions, open-extension-ui,
check-extension-updates, read-melon-manifest, extension-call-backend,
dialog:open-project, dialog:save-project, dialog:export-wav,
fs:write-file, fs:read-file, fs:exists, shell:open-path, shell:open-url,
app:get-system-dark`

### Render (window.render → render:* / editor:*)
`render:generate-ust, render:render, editor:detect, editor:open`
Events: `render:complete, render:error`

### MTI (window.mti → mti:*)
`mti:spawn-session, mti:write, mti:kill, mti:exec, mti:python, mti:mlc-commands`
Events: `mti:stdout, mti:stderr, mti:exit`

### Addons (window.melonAddons → addons:*)
`addons:get-panels, addons:get-toolbar-items, addons:get-menu-items,
addons:get-commands, addons:execute-command`
Events: `addons:loaded, addons:unloaded`

### Voicebanks (window.voicebanks → vb:*)
`vb:list, vb:detect-system, vb:download, vb:install-from-zip, vb:open-folder`
Events: `vb:download-progress`

### Window (window.electron → win:*)
`win:minimize, win:maximize, win:close, win:is-maximized`

Good luck. This project is genuinely good — "dangerously close to being actually good."
Don't let it become less than that.
