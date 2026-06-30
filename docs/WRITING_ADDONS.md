# Writing a Melon Synth Addon (.mlc Bundle Format)

> **License:** Your addon code is MIT-licensed by default.
> The `.mlc` format is open and community-owned. No approval process, no store.
> Drop your file into the addons folder, and it works.

---

## What a `.mlc` file is

A `.mlc` file is a ZIP archive. Rename any `.mlc` to `.zip` and you can open it.

```
your_addon.mlc  (ZIP archive)
├── manifest.json       ← REQUIRED: who you are and what this does
├── module.py           ← REQUIRED: the actual code (entry point)
├── data/               ← optional: lookup tables, exception dicts, etc.
│   └── phoneme_map.json
└── README.md           ← optional, but please include one
```

---

## The three addon types

### 1. `voicebank_mapper`
Maps processed phonemes → the specific syllables a voicebank can sing.
Write one for a new UTAU bank, a DiffSinger model, or any custom phoneme set.

### 2. `language_pack`
Teaches MLC a new source language. The G2P layer that converts
"안녕하세요" or "你好" into the internal phoneme format (IPF).

### 3. `pipeline_plugin`
Hooks into a named stage of the MLC pipeline. Can add tone curves,
breathing marks, rhythm normalisation — anything post-G2P.

One `.mlc` file can contain all three types.

---

## manifest.json

```json
{
  "id":           "jp_cv_kikuo",
  "name":         "Kikuo-style JP CV Mapper",
  "version":      "1.0.0",
  "description":  "Maps English/Japanese to Kikuo Moe voicebank phonemes with breathy vowel tails",
  "author":       "your-github-handle",
  "license":      "MIT",
  "mlc_api_version": "1.0.0",
  "type":         "voicebank_mapper",
  "language":     "ja",
  "languages":    ["en", "ja"],
  "phoneme_set":  "jp_cv_kikuo",
  "target_banks": ["Kikuo Moe", "MIKU Append Soft"],
  "entry_point":  "module.py",
  "dependencies": [],
  "tags":         ["japanese", "breathy", "vocaloid"]
}
```

### Required fields
| Field | Description |
|---|---|
| `id` | Unique identifier — alphanumeric + `_` or `-`. Must be unique globally. |
| `name` | Human-readable display name |
| `version` | Semantic version (major.minor.patch) |
| `type` | `voicebank_mapper`, `language_pack`, `pipeline_plugin`, or a list |
| `language` | Primary source language code (`en`, `ja`, `zh`, `ko`, ...) |
| `phoneme_set` | What phoneme set your module targets |
| `mlc_api_version` | Minimum MLC API version required. Use `"1.0.0"` now. |

### Optional fields
| Field | Description |
|---|---|
| `languages` | All source languages this handles |
| `target_banks` | Specific voicebanks this is tuned for |
| `dependencies` | pip packages to auto-install: `["pyopenjtalk>=0.3"]` |
| `tags` | For search/filtering in the addon manager |

---

## Writing a `voicebank_mapper`

This is the most common addon type. Subclass `VoicebankModule` from `registry.py`.

```python
# module.py
from pathlib import Path
from registry import VoicebankModule
from core.mlc_types import IPFPhoneme, SynthToken, PhonemeClass

# The phoneme set for your target voicebank.
# This is every syllable the voicebank can actually sing.
PHONEMES = {
    'a','i','u','e','o',
    'ka','ki','ku','ke','ko',
    'sa','shi','su','se','so',
    # ... add all phonemes your bank supports
    'n',   # nasal coda
    '-',   # breath mark / pause
    'R',   # vibrato marker
}

# How English ARPAbet vowels map to this bank's vowels
VOWEL_MAP = {
    'AA':'a','AE':'a','AH':'a','AO':'o','AW':'a',
    'AY':'a','EH':'e','ER':'e','EY':'e','IH':'i',
    'IY':'i','OW':'o','OY':'o','UH':'u','UW':'u',
}


class KikuoMapper(VoicebankModule):
    # These are read by the registry and displayed in the UI
    id          = 'jp_cv_kikuo'
    name        = 'Kikuo-style JP CV'
    description = 'Kikuo Moe / soft append style. Adds breathy vowel tails at phrase ends.'
    author      = 'your-name'
    version     = '1.0.0'
    language    = 'ja'
    languages   = ['en', 'ja']
    phoneme_set = 'jp_cv_kikuo'
    target_banks = ['Kikuo Moe', 'MIKU Append Soft']
    supported_phonemes = PHONEMES

    def on_load(self):
        # Called once after instantiation.
        # Load your data files here:
        # if self.data_dir and (self.data_dir / 'exceptions.json').exists():
        #     self.exceptions = json.loads(...)
        pass

    def map_phonemes(
        self,
        phonemes: list,      # list of IPFPhoneme from the G2P engine
        singability: float,  # 0.0=accurate, 1.0=maximally singable
    ) -> list:               # list of SynthToken
        tokens = []
        for ph in phonemes:
            # ph.symbol is an ARPAbet phoneme like 'B', 'AH', 'N', etc.
            # ph.is_vowel, ph.stress, ph.duration_hint, ph.word_index, etc.
            token = self._map_one(ph, singability)
            if token:
                tokens.append(token)
        return tokens

    def _map_one(self, ph: IPFPhoneme, singability: float) -> SynthToken:
        # Your mapping logic here.
        # See modules/jp_cv_standard.py for a complete reference implementation.
        vowel = VOWEL_MAP.get(ph.symbol, 'a')
        return SynthToken(
            phoneme=vowel,
            display=vowel,
            duration_hint=ph.duration_hint,
            beat_weight=ph.beat_weight,
            is_vowel=True,
            stressed=False,
            phon_class=PhonemeClass.VOWEL,
            word_index=ph.word_index,
            syllable_index=ph.syllable_index,
            source_phoneme=ph.symbol,
            source_word=ph.source_word,
            mlc_confidence=ph.confidence,
            g2p_source=ph.g2p_source,
            source_confidence=ph.source_confidence,
        )
```

---

## Writing a `language_pack`

Subclass `LanguagePack` from `addon_base.py`.

```python
# module.py
from addon_base import LanguagePack
from core.mlc_types import IPFPhoneme

class VietnameseLanguagePack(LanguagePack):
    id           = 'vi_vietnamese'
    name         = 'Vietnamese Language Pack'
    language     = 'vi'
    version      = '1.0.0'
    tone_system  = '6_tone'  # Vietnamese has 6 tones

    def g2p(self, text: str) -> list:  # list[IPFPhoneme]
        # Convert Vietnamese text to IPF phonemes.
        # You can use any library — pyvi, underthesea, etc.
        raise NotImplementedError
```

---

## Writing a `pipeline_plugin`

Subclass `PipelinePlugin` from `addon_base.py`.

```python
# module.py
from addon_base import PipelinePlugin
from core.mlc_types import PipelineHook, SynthToken

class AutoBreathPlugin(PipelinePlugin):
    id     = 'autobreath_jp'
    name   = 'Auto Breath Marks'
    hook   = PipelineHook.POST_MAP   # runs after voicebank mapping

    def process(self, tokens: list, context: dict) -> list:
        # Insert breath marks ('-') before long notes at phrase boundaries.
        out = []
        for i, token in enumerate(tokens):
            if i > 0 and token.beat_weight > 0.8:
                out.append(SynthToken(phoneme='-', display='↗', duration_hint=0.2, ...))
            out.append(token)
        return out
```

---

## Building and installing

**Create the bundle:**
```bash
cd your_addon_dir/
zip -r your_addon.mlc manifest.json module.py data/ README.md
```

**Install in Melon Synth:**
- Drag and drop the `.mlc` file onto the Melon Synth window
- Or: Addons → Install addon → pick the file
- Or: Copy to `~/.config/melon-synth/addons/` (Linux) / `~/Library/Application Support/Melon Synth/addons/` (macOS) / `%APPDATA%\melon-synth\addons\` (Windows)

**Hot reload:** No restart needed. Melon Synth watches the addons folder.
If you're developing, drop an updated `.mlc` in and it reloads automatically.

---

## Reference implementations

Look at these built-in modules to understand real-world patterns:

| File | What it demonstrates |
|---|---|
| `mlc/modules/jp_cv_standard.py` | Complete voicebank mapper — diphthong handling, consonant clusters, final consonant treatment |
| `mlc/modules/jp_cvvc_miku.py` | CVVC with VC transitions — more complex mapping, transition tokens |
| `mlc/addons/language_packs/zh_mandarin.py` | Language pack — pinyin G2P, tone sandhi, 4-tone system |
| `mlc/addons/language_packs/ko_hangul.py` | Language pack — Hangul decomposition, syllabification |
| `mlc/addons/pipeline_plugins/tone_and_rhythm.py` | Pipeline plugin — ToneAwarePitch, AutoBreath, RhythmNormalizer |
| `mlc/addons/voicebank_mappers/en_arpabet.py` | Minimal mapper — VCCV/CVVC passthrough, ~50 lines |

`en_arpabet.py` is the "hello world" — read it first.

---

## Sharing your addon

1. Put it on GitHub with the tag `melon-synth-addon`
2. Submit a PR to add it to the community addon list at `docs/COMMUNITY_ADDONS.md`
3. No approval process. The community will try it and give feedback.

The `.mlc` format belongs to the community. Melon Synth is GPL — your addons are MIT.
You own your work.
