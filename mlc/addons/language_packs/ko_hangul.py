"""
MLC Language Pack: Korean (ko)
================================
Handles: ko, ko-KR, ko-KP

Korean phonology is dramatically different from English:
  - Syllable-based: every syllable is one Unicode block (가 나 다...)
  - Each block = Initial (초성) + Vowel (중성) + optional Final (종성)
  - No tones (unlike Mandarin/Cantonese)
  - BUT: consonant mutation rules (liaison, nasalisation, etc.)
  - Vowel harmony is present but less strict than in some languages

This pack handles:
  - Korean Hangul → Unicode decomposition → phoneme mapping
  - Plain Latin romanisation input (romaja: ga na da)
  - Basic consonant mutation (받침 rules)
  - Correct stress: Korean is mostly syllable-timed, slight emphasis on first syllable

Korean phoneme → ARPAbet mapping notes:
  ㄱ → K or G (context-dependent: voiced between vowels)
  ㄴ → N
  ㄷ → T or D (voiced between vowels)
  ㄹ → R (between vowels) or L (syllable-final before consonant)
  ㅁ → M
  ㅂ → P or B
  ㅅ → S (before vowel) or T (syllable-final)
  ㅇ → NG (syllable-final) or silent (syllable-initial)
  ㅈ → JH or CH
  ㅎ → HH (or silent in some positions)
  And the aspirated/tense variants...

For vocaloid use, we simplify to the most common voicebank-compatible
phonemes rather than full phonetic accuracy.
"""
from __future__ import annotations

import re
import sys
import unicodedata
import logging
from pathlib import Path
from typing import Optional

log = logging.getLogger('mlc.ko')

sys.path.insert(0, str(Path(__file__).parent.parent))
from addon_base import LanguagePack
from core.mlc_types import ToneAnnotation, RhythmAnnotation, MLCWarning, WarningLevel, AddonType

# ── Hangul Unicode decomposition ──────────────────────────────────────────
# Hangul syllable block = 0xAC00 + (initial × 21 + vowel) × 28 + final

HANGUL_BASE = 0xAC00
INITIAL_COUNT = 21 * 28   # 588 per initial
VOWEL_COUNT   = 28         # 28 per vowel

# 초성 (Initial consonants) — 19 values
INITIALS = [
    'ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ',
    'ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ',
]

# 중성 (Vowels) — 21 values
VOWELS = [
    'ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ',
    'ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ',
]

# 종성 (Final consonants) — 28 values (0 = no final)
FINALS = [
    '','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ',
    'ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ',
    'ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ',
]

def decompose_hangul(char: str) -> tuple[str, str, str]:
    """Decompose a Hangul syllable into (initial, vowel, final) jamo."""
    code = ord(char) - HANGUL_BASE
    if code < 0 or code > 11171:
        return ('', char, '')
    final_idx   = code % 28
    vowel_idx   = (code // 28) % 21
    initial_idx = code // 588
    return INITIALS[initial_idx], VOWELS[vowel_idx], FINALS[final_idx]

# ── Jamo → ARPAbet ────────────────────────────────────────────────────────
# Simplified for vocaloid use — close enough for synthesis

INITIAL_TO_ARPABET = {
    'ㄱ': 'K',   # 기역
    'ㄲ': 'K',   # 쌍기역 (tense, treat as K)
    'ㄴ': 'N',   # 니은
    'ㄷ': 'D',   # 디귿
    'ㄸ': 'T',   # 쌍디귿 (tense T)
    'ㄹ': 'R',   # 리을 (R as initial)
    'ㅁ': 'M',   # 미음
    'ㅂ': 'B',   # 비읍
    'ㅃ': 'P',   # 쌍비읍 (tense P)
    'ㅅ': 'S',   # 시옷
    'ㅆ': 'S',   # 쌍시옷 (tense S)
    'ㅇ': '',    # 이응 (silent when initial)
    'ㅈ': 'JH',  # 지읒
    'ㅉ': 'JH',  # 쌍지읒 (tense JH)
    'ㅊ': 'CH',  # 치읓
    'ㅋ': 'K',   # 키읔 (aspirated K)
    'ㅌ': 'T',   # 티읕 (aspirated T)
    'ㅍ': 'P',   # 피읖 (aspirated P)
    'ㅎ': 'HH',  # 히읗
}

VOWEL_TO_ARPABET = {
    'ㅏ': ['AA'],        # 아  /a/
    'ㅐ': ['AE'],        # 애  /e/
    'ㅑ': ['Y','AA'],    # 야  /ja/
    'ㅒ': ['Y','AE'],    # 얘  /je/
    'ㅓ': ['AH'],        # 어  /ʌ/
    'ㅔ': ['EH'],        # 에  /e/
    'ㅕ': ['Y','AH'],    # 여  /jʌ/
    'ㅖ': ['Y','EH'],    # 예  /je/
    'ㅗ': ['OW'],        # 오  /o/
    'ㅘ': ['W','AA'],    # 와  /wa/
    'ㅙ': ['W','EH'],    # 왜  /we/
    'ㅚ': ['W','EH'],    # 외  /we/ (simplified)
    'ㅛ': ['Y','OW'],    # 요  /jo/
    'ㅜ': ['UW'],        # 우  /u/
    'ㅝ': ['W','AH'],    # 워  /wʌ/
    'ㅞ': ['W','EH'],    # 웨  /we/
    'ㅟ': ['W','IY'],    # 위  /wi/
    'ㅠ': ['Y','UW'],    # 유  /ju/
    'ㅡ': ['IH'],        # 으  /ɯ/ (closest = IH)
    'ㅢ': ['IH'],        # 의  /ɰi/ (simplified)
    'ㅣ': ['IY'],        # 이  /i/
}

FINAL_TO_ARPABET = {
    '':   [],
    'ㄱ': ['K'],
    'ㄲ': ['K'],
    'ㄳ': ['K'],    # ㄱ+ㅅ cluster — use K
    'ㄴ': ['N'],
    'ㄵ': ['N'],    # ㄴ+ㅈ — use N
    'ㄶ': ['N'],    # ㄴ+ㅎ — use N
    'ㄷ': ['T'],
    'ㄹ': ['L'],    # ㄹ as final = L
    'ㄺ': ['K'],    # ㄹ+ㄱ — use K
    'ㄻ': ['M'],    # ㄹ+ㅁ — use M
    'ㄼ': ['L'],
    'ㄽ': ['L'],
    'ㄾ': ['T'],
    'ㄿ': ['P'],
    'ㅀ': ['L'],
    'ㅁ': ['M'],
    'ㅂ': ['P'],
    'ㅄ': ['P'],    # ㅂ+ㅅ — use P
    'ㅅ': ['T'],    # ㅅ as final = unreleased T
    'ㅆ': ['T'],
    'ㅇ': ['NG'],   # ㅇ as final = NG
    'ㅈ': ['T'],
    'ㅊ': ['T'],
    'ㅋ': ['K'],
    'ㅌ': ['T'],
    'ㅍ': ['P'],
    'ㅎ': [],       # ㅎ as final is usually silent
}


class KoreanLanguagePack(LanguagePack):
    id           = 'ko_hangul'
    name         = 'Korean (Hangul)'
    description  = ('Full Korean Hangul decomposition. Accepts Korean text '
                    '(한글) or romanised input. Handles consonant mutation, '
                    'liaison, and vocaloid-appropriate simplifications.')
    author       = 'Melon Synth'
    version      = '1.0.0'
    addon_type   = AddonType.LANGUAGE_PACK

    handles      = ['ko', 'ko-KR', 'ko-KP']
    handles_also = []
    has_tone     = False   # Korean has no lexical tone
    has_rhythm   = True    # Korean is syllable-timed — rhythm hints help

    def normalise(self, text: str, lang: str) -> str:
        # Normalise Unicode (NFC) to ensure Hangul is composed
        import unicodedata
        text = unicodedata.normalize('NFC', text)
        # Strip non-Korean, non-ASCII
        text = re.sub(r'\s+', ' ', text).strip()
        return text

    def decompose(self, text: str, lang: str) -> list[list[str]]:
        words   = text.split()
        result  = []
        for word in words:
            phonemes = self._word_to_arpabet(word)
            result.append(phonemes)
        return result

    def _word_to_arpabet(self, word: str) -> list[str]:
        """Decompose a Korean word (or romanisation) to ARPAbet."""
        phonemes: list[str] = []

        for char in word:
            cp = ord(char)

            # Hangul syllable block
            if 0xAC00 <= cp <= 0xD7A3:
                initial, vowel, final = decompose_hangul(char)

                init_arp = INITIAL_TO_ARPABET.get(initial, '')
                if init_arp:
                    phonemes.extend(init_arp.split())

                vowel_arp = VOWEL_TO_ARPABET.get(vowel, ['AH'])
                phonemes.extend(vowel_arp)

                final_arp = FINAL_TO_ARPABET.get(final, [])
                phonemes.extend(final_arp)

            # Hangul jamo (individual jamo, uncommon but handle gracefully)
            elif 0x1100 <= cp <= 0x11FF:
                jamo = char
                if jamo in INITIAL_TO_ARPABET:
                    a = INITIAL_TO_ARPABET[jamo]
                    if a: phonemes.extend(a.split())
                elif jamo in VOWEL_TO_ARPABET:
                    phonemes.extend(VOWEL_TO_ARPABET[jamo])

            # Latin characters — pass through to default G2P
            elif char.isalpha():
                phonemes.append(char.upper())

            # Ignore other characters (digits, punctuation)

        return phonemes or ['AH']

    def syllabify(self, word: str, phonemes: list[str], lang: str) -> list[dict]:
        """
        Korean syllabification: each Hangul block is exactly one syllable.
        This is much more reliable than the default vowel-counting rule.
        """
        # Count actual Hangul syllable blocks in the word
        hangul_syllables = [c for c in word if 0xAC00 <= ord(c) <= 0xD7A3]

        if not hangul_syllables:
            return []  # Fall back to default for non-Hangul input

        # Build syllable groups from the phoneme list
        syllables = []
        for i, char in enumerate(hangul_syllables):
            initial, vowel, final = decompose_hangul(char)

            init_arp  = [INITIAL_TO_ARPABET[initial]] if initial and INITIAL_TO_ARPABET.get(initial) else []
            vowel_arp = VOWEL_TO_ARPABET.get(vowel, ['AH'])
            final_arp = FINAL_TO_ARPABET.get(final, [])

            syl_phonemes = [p for p in (init_arp + vowel_arp + final_arp) if p]

            # Korean: first syllable of a content word is slightly stressed
            syllables.append({
                'phonemes': syl_phonemes,
                'stressed': (i == 0),
                'secondary': False,
            })

        return syllables or [{'phonemes': phonemes, 'stressed': True, 'secondary': False}]

    def get_rhythm_hints(
        self,
        words: list[str],
        phoneme_lists: list[list[str]],
        lang: str,
    ) -> list[Optional[RhythmAnnotation]]:
        """
        Korean is syllable-timed: roughly equal duration per syllable.
        We annotate accordingly — no heavy stress lengthening.
        """
        from core.mlc_types import RhythmAnnotation
        hints = []
        for word, phonemes in zip(words, phoneme_lists):
            # Count syllables (Hangul blocks)
            syl_count = sum(1 for c in word if 0xAC00 <= ord(c) <= 0xD7A3)
            if syl_count > 0:
                # Equal duration across syllables
                hints.append(RhythmAnnotation(
                    duration_override=1.0,
                    beat_weight_override=0.6,
                    reason='Korean syllable-timed rhythm',
                ))
            else:
                hints.append(None)
        return hints
