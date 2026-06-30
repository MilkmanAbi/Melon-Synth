<div align="center">
  <img src="public/melon-logo.png" width="96" height="96" alt="Melon Synth logo" style="border-radius:20px"/>
  <h1>Melon Synth</h1>
  <p><strong>Open singing voice editor — v1.0.0 Alpha</strong></p>
  <p>
    <a href="#license"><img alt="GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-green"/></a>
    <a href="https://discord.gg/J9xwk3p9"><img alt="Discord" src="https://img.shields.io/badge/discord-join-7289da"/></a>
    <img alt="platform" src="https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey"/>
  </p>
</div>

---

Melon Synth is a free, open-source singing voice editor built for people who
want to make music without having to read a manual. Draw notes, type lyrics,
convert them to phonemes with the MLC engine, and render with your favourite
UTAU voicebank through OpenUTAU.

Modern. Intuitive. Cross-platform. No gatekeeping. No paywalls.

---

## Features

- **Piano roll** — draw, move, resize, select notes. Double-click to edit lyrics inline.
- **MLC Engine** — converts any language lyrics to phonemes your voicebank can sing. Supports Japanese CV/CVVC, English ARPAbet, Cantonese, Mandarin, Korean.
- **OpenUTAU integration** — renders voice using your installed UTAU voicebanks.
- **Voice parameters** — Breathiness, Tension, Gender, Pitch Range, plus full OpenUTAU expression controls (velocity, volume, attack, decay, modulation, tone shift, lowpass, normalize).
- **Pitch curve editor** — draw portamento and vibrato curves per note.
- **MIDI import** — drag in a .mid file to import notes and tempo.
- **Project files** — saves as `.loid` (JSON, human-readable).
- **Addon system** — extend MLC with `.mlc` bundles (voicebank mappers, language packs, pipeline plugins). MIT licensed so you can share freely.
- **Dark mode** — warm charcoal, not pure black.

---

## Getting started

### Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.10+ (for MLC engine — optional but recommended)
- **OpenUTAU** — for rendering voice to WAV. [Download here](https://www.openutau.com)
- **espeak-ng** — improves G2P quality. `sudo apt install espeak-ng` on Linux.

### Run from source

```bash
git clone https://github.com/MilkmanAbi/Melon-Synth.git
cd Melon-Synth

# Install JS dependencies
npm install

# Install Python MLC dependencies (optional)
cd mlc && pip install -r requirements.txt --break-system-packages && cd ..

# Run
npm run dev:electron
```

### Linux (Ubuntu/Debian) quick note

The first run on Linux may need the Electron sandbox fix:

```bash
# Option A: use our launch script (already includes --no-sandbox flag)
npm run dev:electron

# Option B: fix sandbox permissions permanently
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

---

## Project structure

```
melonsynth/
├── src/                  # React/TypeScript renderer
│   ├── app/              # Components, App.tsx
│   ├── store/            # Zustand state (project.ts)
│   └── subsystems/       # audio.ts, mlc-client.ts, project-io.ts
├── electron-src/         # Electron main process
├── mlc/                  # MLC Python engine (GPL-3.0)
│   ├── mlc_engine_v2.py  # IPC server
│   ├── core/             # G2P, cache, types
│   ├── modules/          # Voicebank mappers (jp_cv_standard, jp_cvvc_miku)
│   ├── addons/           # Language packs, pipeline plugins (MIT)
│   └── render/           # UST generator, OpenUTAU bridge
├── public/               # Static assets, example projects
└── docs/                 # WRITING_ADDONS.md
```

---

## Writing an addon

Drop a `.mlc` file into `userData/addons/` — it hot-reloads with no restart.

```
my_addon.mlc  (ZIP archive)
├── manifest.json   # id, name, version, type, language, mlc_api_version
├── module.py       # VoicebankModule / LanguagePack / PipelinePlugin subclass
└── data/           # optional lookup tables, dictionaries
```

See [docs/WRITING_ADDONS.md](docs/WRITING_ADDONS.md) for the full guide.
Addons are MIT licensed — share freely.

---

## Credits

Built by **MilkmanAbi** (Abinaash), 2026.

**[OpenUTAU](https://github.com/stakira/OpenUtau)** by stakira — MIT License.
The UST format implementation, expression flag definitions (g/B/H/P flags), and
render pipeline architecture were informed by reading OpenUTAU's source code.
OpenUTAU is the backbone of the rendering pipeline.

---

## License

| Component | License |
|-----------|---------|
| Melon Synth (app) | [GPL-3.0-or-later](LICENSE) |
| MLC Engine | [GPL-3.0-or-later](mlc/LICENSE-MLC) |
| MLC Addons (.mlc format) | [MIT](mlc/addons/LICENSE-MIT) |

Melon Synth is free software. You can study it, modify it, and distribute it
under the terms of the GPL. The addon system is MIT so the community can
build and share extensions without GPL obligations.
