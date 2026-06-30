# Attributions

Melon Synth v1.0.0 Alpha — Open Singing Voice Editor
Copyright (C) 2026 Abinaash (MilkmanAbi)

---

## OpenUTAU

**Copyright (C) stakira**
**License: MIT**
**Source: https://github.com/stakira/OpenUtau**

The following aspects of Melon Synth were informed by reading OpenUTAU's
MIT-licensed source code:

- **UST file format** (`mlc/render/ust_generator.py`)
  UST block structure, field names (Length, Lyric, NoteNum, Velocity,
  Intensity, Modulation, Tempo, PreUtterance, Flags, PBS, PBW, PBY, PBM, VBR)
  were derived from `OpenUtau.Core/Classic/Ust.cs` and `UstNote.cs`.

- **Expression flag letters** (`mlc/render/ust_generator.py`, `src/app/components/VoicePanel.tsx`)
  The mapping of expression names to flag characters:
    g → gender, B → breathiness, H → lowpass, P → normalize
  was taken from `OpenUtau.Core/Format/USTx.cs` `AddDefaultExpressions()`.

- **Vibrato format** (VBR field: length,period,depth,fadeIn,fadeOut,shift,drift)
  from `UstNote.WriteVibrato()`.

- **Pitch bend format** (PBS start point, PBW widths, PBY Y-values, PBM modes)
  from `UstNote.WritePitch()` and `ParsePitchBend()`.

- **Render detection paths** (`mlc/render/render_bridge.py`)
  Default OpenUTAU installation paths per OS were cross-referenced with
  OpenUTAU's own path management code.

OpenUTAU is an incredible project. Credit and thanks to stakira and all
contributors. Full MIT license: https://github.com/stakira/OpenUtau/blob/master/LICENSE

---

## Kasane Teto (voicebank, not bundled)

Kasane Teto voicebank is © Teto_family, licensed CC BY-NC 3.0.
It is NOT bundled with Melon Synth. Users must download it separately.
https://kasaneteto.jp

---

## Inter & JetBrains Mono (fonts, loaded via CDN)

Inter: Copyright (c) Rasmus Andersson. SIL Open Font License 1.1.
JetBrains Mono: Copyright (c) JetBrains. SIL Open Font License 1.1.
Both loaded from Google Fonts — not bundled.
