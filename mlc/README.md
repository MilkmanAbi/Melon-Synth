# MLC — Melon Lyric Conversion Engine

MLC takes lyrics in any language and converts them into the phoneme sequences a vocaloid/UTAU voicebank needs to sing them. It removes the hardest part of vocal synthesis: figuring out how to break every word into the sounds the engine understands.

You write "beautiful dream" — MLC gives you `byu ti fu ru` `do ri i mu` (or the equivalent for your voicebank). You focus on the music.

---

## How it works

```
Your lyrics (any language)
       ↓
  Language detection
       ↓
  Text normalisation    (contractions, numbers, punctuation)
       ↓
  G2P via espeak-ng     (grapheme → ARPAbet phonemes)
       ↓
  Syllabification       (where are the syllable boundaries?)
  + Stress analysis     (which syllables are stressed?)
       ↓
  Voicebank module      (ARPAbet → your bank's phoneme set)
       ↓
  Singability pass      (controlled by a slider: accurate ↔ singable)
       ↓
  Phoneme sequence      (dropped into Melon Synth's Lyrics lane)
```

The core pipeline is language-agnostic. The voicebank modules handle the final mapping into whatever phoneme set a specific bank uses.

---

## Setup

### 1. Install system dependency

espeak-ng is the G2P backbone. Install it at the OS level:

```bash
# Ubuntu/Debian
sudo apt install espeak-ng

# macOS
brew install espeak

# Windows
# Download installer from https://github.com/espeak-ng/espeak-ng/releases
# Add espeak-ng to your PATH

# Arch
sudo pacman -S espeak-ng

# Fedora
sudo dnf install espeak-ng
```

### 2. Install Python dependencies

```bash
cd mlc/
pip install -r requirements.txt
```

### 3. Run the test suite

```bash
python tests/test_mlc.py
```

### 4. Try it manually

```bash
echo '{"id":"1","action":"convert","text":"beautiful dream","module_id":"jp_cv_standard","singability":0.5}' | python mlc_engine.py
```

---

## The singability slider

Every conversion takes a `singability` value from `0.0` to `1.0`.

| Value | Behaviour |
|-------|-----------|
| `0.0` | Maximum accuracy. Diphthongs become two notes. Final consonants get closure vowels. Phoneme distinctions (v vs b, th vs s) are preserved where possible. |
| `0.5` | Balanced. Good starting point for most songs. |
| `1.0` | Maximum singability. Diphthongs collapse to their dominant vowel. Final consonants are dropped. Everything maps to the closest natural Japanese syllable. Flows easily but less precise. |

You start at 0.5 and tune from there. Most pop songs sound great at 0.6–0.7.

---

## Writing a voicebank module

A module is a single Python file in `mlc/modules/`. MLC discovers it automatically on startup.

```python
# mlc/modules/my_bank.py

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from mlc_base import VoicebankModule, PhonemeToken, SynthToken

class MyBankModule(VoicebankModule):
    id          = 'my_bank'
    name        = 'My Custom Bank'
    description = 'Maps to My Bank phoneme set'
    language    = 'en'
    phoneme_set = 'custom'
    version     = '0.1.0'

    # Tell MLC what phonemes your bank supports
    supported_phonemes = {'a', 'i', 'u', 'e', 'o', 'ka', 'ki', ...}

    def map_phonemes(
        self,
        phonemes: list[PhonemeToken],
        singability: float,
    ) -> list[SynthToken]:
        """
        phonemes: list of PhonemeToken
            Each has: symbol (ARPAbet), is_vowel, stress (0/1/2),
            word_index, syllable_index, is_word_start, is_word_end, etc.

        singability: float 0.0–1.0
            0.0 = accurate, 1.0 = singable. Use this to choose between
            your accurate and simplified mappings.

        Return: list of SynthToken
            Each has: phoneme (your bank's symbol), display (shown in UI),
            duration_hint (1.0 = normal), is_vowel, stressed, word_index, etc.
        """
        tokens = []
        for ph in phonemes:
            # Your mapping logic here
            tokens.append(SynthToken(
                phoneme='a',          # whatever your bank calls this sound
                display='a',          # what Melon Synth shows in the lyrics lane
                duration_hint=1.0,
                is_vowel=ph.is_vowel,
                stressed=(ph.stress == 1),
                word_index=ph.word_index,
                syllable_index=ph.syllable_index,
                source_phoneme=ph.symbol,
            ))
        return tokens
```

That's it. Drop the file in `mlc/modules/` and restart Melon Synth. Your module will appear in the voice selector.

### PhonemeToken fields

| Field | Type | Description |
|-------|------|-------------|
| `symbol` | str | ARPAbet symbol (`K`, `AE`, `SH`, etc.) |
| `is_vowel` | bool | True for vowel phonemes |
| `stress` | int | `0` unstressed, `1` primary stress, `2` secondary |
| `word_index` | int | Which word (0-indexed) |
| `syllable_index` | int | Which syllable within the word |
| `is_syllable_onset` | bool | First phoneme of a syllable |
| `is_syllable_coda` | bool | Last phoneme of a syllable |
| `is_word_start` | bool | First phoneme of a word |
| `is_word_end` | bool | Last phoneme of a word |
| `source_text` | str | Original grapheme this came from |

### SynthToken fields

| Field | Type | Description |
|-------|------|-------------|
| `phoneme` | str | The bank's phoneme string |
| `display` | str | What to show in the Lyrics lane |
| `duration_hint` | float | Relative duration (1.0 normal, 0.5 short, 1.5 long) |
| `is_vowel` | bool | Whether this is a vowel-carrying token |
| `stressed` | bool | Whether this token carries stress |
| `word_index` | int | Source word index |
| `syllable_index` | int | Source syllable index |
| `prev_transition` | str | CVVC only — VC transition preceding this token |
| `note` | str | Optional note surfaced in the UI (e.g. "diphthong tail") |

---

## Built-in modules

| Module ID | Name | Target |
|-----------|------|--------|
| `jp_cv_standard` | Japanese CV — Standard UTAU | Kasane Teto, Defoko, most UTAU JP CV banks |

Planned:
- `jp_cvvc_miku` — Hatsune Miku-style CVVC
- `en_arpabet` — Western VCCV banks (ARPAbet passthrough)
- `en_xsampa` — X-SAMPA banks

---

## IPC protocol

MLC runs as a persistent subprocess. Electron communicates via newline-delimited JSON.

**Request:**
```json
{"id": "uuid", "action": "convert", "text": "beautiful dream", "module_id": "jp_cv_standard", "singability": 0.5}
```

**Response:**
```json
{
  "id": "uuid",
  "ok": true,
  "data": {
    "tokens": [
      {"phoneme": "byu", "display": "byu", "duration_hint": 1.2, "is_vowel": false, "stressed": true, ...},
      {"phoneme": "ti",  "display": "ti",  "duration_hint": 0.85, ...},
      ...
    ],
    "words": ["beautiful", "dream"],
    "word_boundaries": [[0, 4], [5, 7]],
    "language": "en",
    "module_id": "jp_cv_standard",
    "singability": 0.5,
    "warnings": [],
    "token_count": 8
  },
  "error": null
}
```

**Actions:** `convert`, `list_modules`, `detect_lang`, `ping`
