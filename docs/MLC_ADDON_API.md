# MLC Addon API — .mlc Format
## Version 2.0 · 2026

The MLC (Melon Lyric Converter) system is fully extensible through `.mlc` addon bundles.
Any developer can create a `.mlc` file and users drop it into Melon Synth.
No restart needed — hot-reload is built in.

---

## What addons can do

| Addon type | What it does |
|------------|-------------|
| **LanguagePack** | Teach MLC a new source language (Korean, Vietnamese, Thai, ...) |
| **VoicebankMapper** | Map phonemes for a specific voicebank with full control |
| **PipelinePlugin** | Hook into any pipeline stage — pre/post G2P, post-map, rhythm, tone |
| **VoiceProfile** | Optimal settings + phoneme corrections for a specific voicebank |
| **PhonemeSet** | Declare an entirely new phoneme set for a custom voicebank |
| **CompositeAddon** | Ship multiple types in one bundle (e.g. Korean + Teto mapper together) |

---

## manifest.json — complete schema

```json
{
  "id":            "ko_for_teto",
  "name":          "Korean for Kasane Teto",
  "version":       "1.0.0",
  "mlc_api":       "2.0",
  "addon_type":    "composite",
  "description":   "Full Korean language support tuned for Kasane Teto CV voicebanks",
  "author":        "yourname",
  "license":       "MIT",
  "homepage":      "https://github.com/you/ko-for-teto",

  "update_url":    "https://example.com/ko_for_teto/update.json",
  "changelog_url": "https://example.com/ko_for_teto/CHANGELOG.md",
  "min_melon_version": "1.0.0",

  "requires": [
    { "id": "jp_cv_standard", "min_version": "1.0.0" }
  ],

  "pip_deps":     ["jamo"],
  "pip_optional": ["g2pk"],

  "capabilities": {
    "input_languages":       ["ko"],
    "output_phoneme_sets":   ["jp_cv"],
    "target_voicebanks":     ["Kasane Teto", "Kasane Teto V1.0"],
    "has_word_overrides":    true,
    "has_voice_profile":     true,
    "tone_aware":            false,
    "singability_aware":     true
  },

  "tags": ["korean", "teto", "jp-cv", "utau"],

  "entry_point":  "module.KoreanForTetoAddon"
}
```

---

## LanguagePack — teach a new language

```python
from mlc.api import LanguagePack, IPFPhoneme, MLCWarning, MLCContext

class KoreanPack(LanguagePack):
    id      = 'ko_hangul_v2'
    name    = 'Korean Hangul v2'
    handles = ['ko']               # ISO 639-1 language code
    has_tone = False               # Korean is not tonal

    # Called once when addon loads — set up your resources
    def on_load(self):
        import jamo
        self._jamo = jamo
        # Load a custom word dictionary from your bundle's data/
        try:
            self._dict = self.load_json('ko_dictionary.json')
        except FileNotFoundError:
            self._dict = {}

    # Core: convert text to phonemes
    def text_to_phonemes(self, text: str, lang: str, context: MLCContext):
        words = text.split()
        result = []
        for word in words:
            word_low = word.lower()
            # Check our word dictionary first
            if word_low in self._dict:
                result.append(self._dict[word_low])
                continue
            # Otherwise decompose Hangul
            phonemes = self._decompose(word)
            result.append(phonemes)
        return result

    def _decompose(self, word: str) -> list[str]:
        phonemes = []
        for char in word:
            if '\uAC00' <= char <= '\uD7A3':  # Hangul syllable block
                jamo_list = list(self._jamo.j2hcj(self._jamo.h2j(char)))
                phonemes.extend(self._map_jamo(jamo_list))
            else:
                phonemes.append(char)
        return phonemes if phonemes else ['-']

    JAMO_MAP = {
        'ㄱ':'k', 'ㄴ':'n', 'ㄷ':'t', 'ㄹ':'r', 'ㅁ':'m',
        'ㅂ':'p', 'ㅅ':'s', 'ㅇ':'', 'ㅈ':'ch', 'ㅎ':'h',
        'ㅏ':'a', 'ㅣ':'i', 'ㅜ':'u', 'ㅔ':'e', 'ㅗ':'o',
        'ㅡ':'eu', 'ㅐ':'e',  'ㅚ':'oe',
    }

    def _map_jamo(self, jamo_list: list[str]) -> list[str]:
        return [self.JAMO_MAP.get(j, j) for j in jamo_list if j]

    # Validate input — warn about unsupported characters
    def validate_input(self, text: str, lang: str):
        warnings = []
        for char in text:
            if char.isalpha() and not '\uAC00' <= char <= '\uD7A3' and not char.isascii():
                warnings.append(MLCWarning(
                    level='warning', code='UNSUPPORTED_CHAR',
                    message=f'Character "{char}" may not convert correctly',
                    word=char, phoneme='', suggestion='Use Hangul or ASCII text',
                ))
        return warnings

    # Word-level overrides — bypass G2P for specific words
    def get_word_overrides(self):
        from mlc.api import WordOverrideEntry
        return [
            WordOverrideEntry('사랑', ['sa', 'ra', 'ng'], language='ko', note='Love'),
            WordOverrideEntry('하늘', ['ha', 'neu', 'ru'], language='ko', note='Sky'),
        ]
```

---

## VoicebankMapper — voicebank-specific mapping

```python
from mlc.api import VoicebankMapper, IPFPhoneme, SynthToken, VoiceProfileSpec, MLCContext

class UtaneMapper(VoicebankMapper):
    id           = 'jp_cv_utane'
    name         = 'Utane Uta CV Optimiser'
    phoneme_set  = 'jp_cv'
    target_banks = ['Utane Uta', 'Defoko']

    # Supported phonemes (used for validation warnings)
    supported_phonemes = {
        'a','i','u','e','o',
        'ka','ki','ku','ke','ko',
        'sa','shi','su','se','so',
        'ta','chi','tsu','te','to',
        'na','ni','nu','ne','no',
        'ha','hi','fu','he','ho',
        'ma','mi','mu','me','mo',
        'ya','yu','yo','ra','ri','ru','re','ro',
        'wa','wi','we','wo','n',
        'ga','gi','gu','ge','go',
        'za','ji','zu','ze','zo',
        'da','di','du','de','do',
        'ba','bi','bu','be','bo',
        'pa','pi','pu','pe','po',
        'br',  # breath mark
    }

    # Per-phoneme override: Utane-specific corrections
    def map_phoneme(self, phoneme: IPFPhoneme, context: MLCContext):
        overrides = {
            'l':  'ra',   # Utane's l sounds better as ra
            'v':  'ba',   # no V in jp_cv
            'th': 'sa',   # no TH
            'r':  'ra',   # English R → ra
        }
        return overrides.get(phoneme.symbol)

    # Main mapping logic
    def map_phonemes(self, phonemes, singability, context):
        tokens = []
        for ph in phonemes:
            # Check per-phoneme override first
            override = self.map_phoneme(ph, context)
            bank_ph  = override if override else self._default_map(ph)
            tokens.append(SynthToken(
                phoneme=bank_ph, display=bank_ph,
                duration_hint=0.45 if ph.phon_class.name == 'VOWEL' else 0.2,
                is_vowel=ph.phon_class.name in ('VOWEL', 'DIPHTHONG'),
                stressed=ph.stress.name == 'PRIMARY',
                word_index=ph.word_index,
                syllable_index=ph.syllable_index,
                mlc_confidence=0.8,
                g2p_source=ph.g2p_source,
                source_phoneme=ph.symbol,
                source_word=ph.source_word,
            ))
        return tokens

    def _default_map(self, ph: IPFPhoneme) -> str:
        TABLE = {
            'a':'a', 'e':'e', 'i':'i', 'o':'o', 'u':'u',
            'k':'ka', 'g':'ga', 's':'sa', 'z':'za',
            'n':'na', 'm':'ma', 'h':'ha', 'f':'fu',
            # ...
        }
        return TABLE.get(ph.symbol, ph.symbol)

    # Postprocess: add breath marks after long notes
    def postprocess(self, tokens, singability, context):
        result = []
        for i, tok in enumerate(tokens):
            result.append(tok)
            # Insert breath after long vowel runs
            if tok.is_vowel and i > 0 and i % 6 == 0 and singability > 0.5:
                result.append(SynthToken(
                    phoneme='br', display='BR',
                    duration_hint=0.15, is_vowel=False,
                    stressed=False, word_index=tok.word_index,
                    syllable_index=0, mlc_confidence=1.0,
                    g2p_source='mlc_postprocess',
                    source_phoneme='', source_word='',
                ))
        return result

    # Provide voice profile for the UI
    def get_voice_profile(self):
        return VoiceProfileSpec(
            voicebank_id='utane_uta',
            voicebank_name='Utane Uta',
            optimal_breathiness=32,
            optimal_tension=58,
            optimal_gender=35,
            phoneme_corrections={'ra': 'la', 'ri': 'li'},
            notes='Utane has a clear, slightly breathy default tone. '
                  'Keep tension below 65 to avoid harshness on high notes.',
            known_difficult_words=['strands', 'through', 'strength'],
        )

    # Word-level overrides for Utane
    def get_word_overrides(self):
        from mlc.api import WordOverrideEntry
        return [
            WordOverrideEntry('love', ['ro', 'bu'], note='Sounds warmer on Utane'),
            WordOverrideEntry('beautiful', ['byu', 'ti', 'fu', 'ru'],
                            note='Manual fix — G2P splits this poorly'),
        ]
```

---

## PipelinePlugin — hook into any stage

```python
from mlc.api import PipelinePlugin, PipelineHook, SynthToken, MLCContext

class AutoBreathPlugin(PipelinePlugin):
    """Insert breath marks automatically every N syllables."""
    id       = 'auto_breath'
    name     = 'Auto Breath Marks'
    hooks    = [PipelineHook.POST_MAP]
    priority = 30   # runs before most other plugins

    # Config (settable by user in future)
    syllables_per_breath: int = 8

    def on_post_map(self, tokens, singability, context):
        if singability < 0.4:
            return tokens  # don't add breath at very low singability

        result   = []
        vowel_count = 0
        for tok in tokens:
            result.append(tok)
            if tok.is_vowel:
                vowel_count += 1
                if vowel_count >= self.syllables_per_breath:
                    result.append(SynthToken(
                        phoneme='br', display='BR',
                        duration_hint=0.18, is_vowel=False,
                        stressed=False,
                        word_index=tok.word_index, syllable_index=0,
                        mlc_confidence=1.0,
                        g2p_source='auto_breath', source_phoneme='', source_word='',
                    ))
                    vowel_count = 0
        return result
```

---

## CompositeAddon — multiple types in one .mlc

```python
from mlc.api import CompositeAddon, LanguagePack, VoicebankMapper

class KoreanForTetoAddon(CompositeAddon):
    id   = 'ko_for_teto'
    name = 'Korean for Kasane Teto'

    class Language(LanguagePack):
        handles = ['ko']
        def text_to_phonemes(self, text, lang, context): ...

    class Mapper(VoicebankMapper):
        phoneme_set  = 'jp_cv'
        target_banks = ['Kasane Teto']
        def map_phonemes(self, phonemes, singability, context): ...

    def get_components(self):
        lang   = self.Language()
        mapper = self.Mapper()
        # Share data_dir with components
        lang.data_dir   = self.data_dir
        mapper.data_dir = self.data_dir
        return [lang, mapper]
```

---

## Word override dictionary (data/overrides.json)

Instead of hardcoding overrides in Python, you can ship a JSON file:

```json
{
  "_meta": { "language": "en", "module": "jp_cv_standard", "priority": 60 },
  "beautiful":  ["byu", "ti", "fu", "ru"],
  "love":       ["ro", "bu"],
  "world":      ["wa", "a", "ru", "do"],
  "dream":      ["do", "ri", "i", "mu"],
  "heart":      ["ha", "a", "to"],
  "sky":        ["su", "ka", "i"],
  "night":      ["na", "i", "to"],
  "star":       ["su", "ta", "a"]
}
```

Load it in `on_load()`:
```python
def on_load(self):
    raw = self.load_json('overrides.json')
    meta = raw.pop('_meta', {})
    lang = meta.get('language', '*')
    self._overrides = {
        word: WordOverrideEntry(word, phonemes, language=lang)
        for word, phonemes in raw.items()
    }

def get_word_overrides(self):
    return list(self._overrides.values())
```

---

## Versioning and updates

Addon versions follow **semver** (`MAJOR.MINOR.PATCH`):
- `MAJOR` — breaking change (incompatible phoneme set change)
- `MINOR` — new feature (added phonemes, new language)
- `PATCH` — bug fix

MLC enforces `mlc_api` version compatibility:
- `"mlc_api": "2.0"` → requires MLC API ≥ 2.0

Host an `update_url` JSON to enable auto-update notifications:
```json
{
  "id":             "ko_for_teto",
  "latest_version": "1.2.0",
  "download_url":   "https://example.com/ko_for_teto-1.2.0.mlc",
  "changelog":      "Improved Hangul decomposition for compound consonants",
  "is_breaking":    false
}
```

---

## Testing your addon

```bash
cd your_addon/
# Test directly with the MLC engine
echo '{"id":"t1","action":"convert","text":"안녕하세요","module_id":"jp_cv_standard"}' \
  | python3 path/to/melonsynth/mlc/mlc_engine_v2.py

# Run the MLC test suite
python3 path/to/melonsynth/mlc/tests/test_addons.py
```
