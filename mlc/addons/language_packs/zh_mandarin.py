"""
MLC Language Pack: Mandarin Chinese (zh-cmn)
=============================================
Handles: zh, zh-cmn, zh-CN, zh-TW

Capabilities:
  - Accepts both Chinese characters (汉字) AND pinyin input
  - Full 4-tone decomposition with pitch curve hints
  - Tone sandhi handling (3rd tone before 3rd tone → 2nd tone)
  - Neutral tone (5th tone) for particles and unstressed syllables
  - Maps Mandarin phonemes to ARPAbet for downstream voicebank mappers
  - Pitch curve annotations that Melon Synth can auto-draw

Tone → Pitch Shape mapping:
  Tone 1 (阴平, high level):    flat high         ˥˥  55
  Tone 2 (阳平, rising):        low to high        ˧˥  35
  Tone 3 (上声, dipping):       mid dip then rise  ˨˩˦  214
  Tone 4 (去声, falling):       high to low        ˥˩  51
  Tone 0 (neutral/light):       short, unstressed  context-dependent

Input formats:
  - Chinese characters: 我爱你  (requires pypinyin)
  - Numbered pinyin:    wo3 ai4 ni3
  - Tone-marked pinyin: wǒ ài nǐ
  - Mixed:              I love you 我爱你

Install pypinyin for character input:
  pip install pypinyin
"""
from __future__ import annotations

import re
import sys
import logging
from pathlib import Path
from typing import Optional

log = logging.getLogger('mlc.zh')

sys.path.insert(0, str(Path(__file__).parent.parent))
from addon_base import LanguagePack
from core.mlc_types import ToneAnnotation, RhythmAnnotation, MLCWarning, WarningLevel, AddonType

# ── Pinyin → ARPAbet mapping ───────────────────────────────────────────────
# Mandarin initials (声母) → ARPAbet consonant(s)

INITIAL_MAP = {
    'b': 'B',   'p': 'P',   'm': 'M',   'f': 'F',
    'd': 'D',   't': 'T',   'n': 'N',   'l': 'L',
    'g': 'K',   'k': 'K',   'h': 'HH',
    'j': 'JH',  'q': 'CH',  'x': 'SH',
    'zh':'JH',  'ch':'CH',  'sh':'SH',  'r': 'R',
    'z': 'Z',   'c': 'S',   's': 'S',
    'y': 'Y',   'w': 'W',
    # Zero initial (no consonant)
    '':  '',
}

# Mandarin finals (韵母) → ARPAbet vowel sequence
FINAL_MAP = {
    'a':   ['AA'],
    'o':   ['OW'],
    'e':   ['EH'],
    'i':   ['IY'],
    'u':   ['UW'],
    'ü':   ['Y','UW'],   # ü (written as u after j/q/x/y)
    'v':   ['Y','UW'],   # alternative ü romanisation
    'ai':  ['AY'],
    'ei':  ['EY'],
    'ao':  ['AW'],
    'ou':  ['OW'],
    'an':  ['AA','N'],
    'en':  ['AH','N'],
    'ang': ['AA','NG'],
    'eng': ['AH','NG'],
    'ong': ['OW','NG'],
    'ia':  ['IY','AA'],
    'ie':  ['IY','EH'],
    'iao': ['IY','AW'],
    'iu':  ['IY','OW'],
    'iou': ['IY','OW'],
    'ian': ['IY','AE','N'],
    'in':  ['IH','N'],
    'iang':['IY','AA','NG'],
    'ing': ['IH','NG'],
    'iong':['IY','OW','NG'],
    'ua':  ['UW','AA'],
    'uo':  ['UW','OW'],
    'uai': ['UW','AY'],
    'ui':  ['UW','EY'],
    'uei': ['UW','EY'],
    'uan': ['UW','AE','N'],
    'un':  ['UW','AH','N'],
    'uen': ['UW','AH','N'],
    'uang':['UW','AA','NG'],
    'üe':  ['Y','UW','EH'],
    've':  ['Y','UW','EH'],
    'üan': ['Y','UW','AE','N'],
    'van': ['Y','UW','AE','N'],
    'ün':  ['Y','IH','N'],
    'vn':  ['Y','IH','N'],
    'er':  ['ER'],        # 儿化音
    'zh':  ['JH','AH'],   # syllabic zh (知、支)
    'ch':  ['CH','AH'],   # syllabic ch
    'sh':  ['SH','AH'],   # syllabic sh
    'r':   ['R','AH'],    # syllabic r
    'z':   ['Z','AH'],    # syllabic z
    'c':   ['S','AH'],    # syllabic c (aspirated)
    's':   ['S','AH'],    # syllabic s
    'yi':  ['IY'],        # standalone yi
    'wu':  ['UW'],        # standalone wu
    'yu':  ['Y','UW'],    # standalone yu
}

# ── Tone pitch shapes ──────────────────────────────────────────────────────
# (tone_number, tone_name, pitch_shape, relative_start, relative_end)
TONE_SHAPES = {
    1: ToneAnnotation(1, 'high level',   'flat',      0.85, 0.85, 'zh-cmn'),
    2: ToneAnnotation(2, 'rising',       'rise',      0.30, 0.90, 'zh-cmn'),
    3: ToneAnnotation(3, 'low dipping',  'dip',       0.45, 0.55, 'zh-cmn'),  # full 214 shape
    4: ToneAnnotation(4, 'falling',      'fall',      0.95, 0.10, 'zh-cmn'),
    0: ToneAnnotation(0, 'neutral',      'flat',      0.50, 0.50, 'zh-cmn'),
}

# Tone sandhi: tone 3 before tone 3 → tone 2 (一 yī before 4 → yí, etc.)
# Simplified: just handle the most common case
def apply_tone_sandhi(tones: list[int]) -> list[int]:
    result = list(tones)
    for i in range(len(result) - 1):
        if result[i] == 3 and result[i+1] == 3:
            result[i] = 2   # 上声连读变阳平
    return result

# ── Tone mark → number ────────────────────────────────────────────────────
TONE_MARKS = {
    'ā':('a',1),'á':('a',2),'ǎ':('a',3),'à':('a',4),
    'ē':('e',1),'é':('e',2),'ě':('e',3),'è':('e',4),
    'ī':('i',1),'í':('i',2),'ǐ':('i',3),'ì':('i',4),
    'ō':('o',1),'ó':('o',2),'ǒ':('o',3),'ò':('o',4),
    'ū':('u',1),'ú':('u',2),'ǔ':('u',3),'ù':('u',4),
    'ǖ':('ü',1),'ǘ':('ü',2),'ǚ':('ü',3),'ǜ':('ü',4),
}

def strip_tone_marks(pinyin: str) -> tuple[str, int]:
    """Remove tone diacritics from pinyin, return (base_pinyin, tone_number)."""
    tone = 0
    result = []
    for ch in pinyin:
        if ch in TONE_MARKS:
            base, t = TONE_MARKS[ch]
            result.append(base)
            tone = t
        else:
            result.append(ch)
    return ''.join(result), tone

def parse_numbered_pinyin(syllable: str) -> tuple[str, int]:
    """Parse 'wo3' → ('wo', 3). Returns ('', 0) if not numbered pinyin."""
    m = re.match(r'^([a-züvāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+)([0-5]?)$', syllable.lower())
    if not m:
        return syllable, 0
    base = m.group(1)
    tone = int(m.group(2)) if m.group(2) else 0
    # Strip any tone diacritics
    base, embedded_tone = strip_tone_marks(base)
    return base, embedded_tone or tone

# ── Main decomposition ────────────────────────────────────────────────────

def decompose_pinyin_syllable(syllable: str) -> tuple[list[str], int]:
    """
    Decompose one pinyin syllable into ARPAbet phonemes + tone number.
    Returns (arpabet_list, tone_number).
    """
    base, tone = parse_numbered_pinyin(syllable)
    base = base.lower().strip()

    # Try to split into initial + final
    # Initials are 1-2 characters
    initial = ''
    final   = base

    for length in (2, 1):
        candidate_i = base[:length]
        candidate_f = base[length:]
        if candidate_i in INITIAL_MAP and candidate_f in FINAL_MAP:
            initial = candidate_i
            final   = candidate_f
            break
        # Special: standalone syllables (yi, wu, yu, er, etc.)
        if base in FINAL_MAP:
            initial = ''
            final   = base
            break

    # Build ARPAbet
    phonemes: list[str] = []

    init_arp = INITIAL_MAP.get(initial, '')
    if init_arp:
        phonemes.extend(init_arp.split())

    fin_arp = FINAL_MAP.get(final, ['AH'])  # fallback to schwa
    phonemes.extend(fin_arp)

    return phonemes, tone


class MandarinLanguagePack(LanguagePack):
    id           = 'zh_mandarin'
    name         = 'Mandarin Chinese'
    description  = ('Full Mandarin Chinese support with 4-tone decomposition '
                    'and pitch curve hints. Accepts Chinese characters (needs '
                    'pypinyin), numbered pinyin (wo3 ai4 ni3), and tone-marked '
                    'pinyin (wǒ ài nǐ).')
    author       = 'Melon Synth'
    version      = '1.0.0'
    addon_type   = AddonType.LANGUAGE_PACK  # noqa

    handles      = ['zh', 'zh-cmn', 'zh-CN', 'zh-TW', 'zh-SG']
    handles_also = ['cmn']
    has_tone     = True
    has_rhythm   = False

    _pypinyin_available = False

    def on_load(self):
        try:
            import pypinyin
            self._pypinyin_available = True
            log.info('pypinyin available — Chinese character input supported')
        except ImportError:
            log.info('pypinyin not installed — only pinyin input supported')
            log.info('Install with: pip install pypinyin')

    def normalise(self, text: str, lang: str) -> str:
        # Convert fullwidth to halfwidth
        text = text.translate(str.maketrans(
            '　！？，。、；：""''（）【】',
            ' !?,.、;:""\'\'()[]'
        ))
        # Normalise spaces
        text = re.sub(r'\s+', ' ', text).strip()
        return text

    def decompose(self, text: str, lang: str) -> list[list[str]]:
        """
        Decompose text into word-level ARPAbet lists.
        Handles characters, numbered pinyin, and tone-marked pinyin.
        """
        words = text.split()
        result = []

        for word in words:
            # Check if it's Chinese characters
            if self._has_chinese(word) and self._pypinyin_available:
                phonemes = self._from_characters(word)
            else:
                # Treat as pinyin (possibly numbered)
                phonemes = self._from_pinyin(word)
            result.append(phonemes)

        return result

    def _has_chinese(self, text: str) -> bool:
        return any('\u4e00' <= ch <= '\u9fff' for ch in text)

    def _from_characters(self, text: str) -> list[str]:
        """Convert Chinese characters to ARPAbet via pypinyin."""
        try:
            from pypinyin import lazy_pinyin, Style
            pinyin_list = lazy_pinyin(text, style=Style.TONE3)
            all_phonemes = []
            for py in pinyin_list:
                phonemes, _ = decompose_pinyin_syllable(py)
                all_phonemes.extend(phonemes)
            return all_phonemes
        except Exception as e:
            log.warning(f'pypinyin failed for {text}: {e}')
            return ['AH']

    def _from_pinyin(self, text: str) -> list[str]:
        """Convert pinyin syllable(s) to ARPAbet."""
        # Handle multi-syllable pinyin merged without spaces (rare but happens)
        phonemes, _ = decompose_pinyin_syllable(text)
        return phonemes

    def get_tone_annotations(
        self,
        word: str,
        syllable_index: int,
        lang: str,
    ) -> Optional[ToneAnnotation]:
        """Return tone annotation for this syllable."""
        words = word.split()
        if syllable_index >= len(words):
            return None

        # Parse tone from the syllable
        _, tone = parse_numbered_pinyin(words[syllable_index] if words else word)

        # Apply sandhi (simplified: per-word)
        tones = []
        for w in words:
            _, t = parse_numbered_pinyin(w)
            tones.append(t)
        tones = apply_tone_sandhi(tones)
        tone  = tones[syllable_index] if syllable_index < len(tones) else tone

        return TONE_SHAPES.get(tone, TONE_SHAPES[0])

    def validate_input(self, text: str, lang: str) -> list[MLCWarning]:
        warnings = []
        if self._has_chinese(text) and not self._pypinyin_available:
            warnings.append(MLCWarning(
                level=WarningLevel.WARNING,
                code='MISSING_PYPINYIN',
                message='Chinese character input detected but pypinyin is not installed',
                suggestion='Run: pip install pypinyin — then Chinese characters will be fully supported',
            ))
        return warnings
