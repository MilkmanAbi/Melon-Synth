"""
MLC Language Pack: Japanese Native (ja)
========================================
Handles: ja, ja-JP

This is the "obvious but needed" one. Japanese is the native language
for most UTAU/vocaloid banks, but MLC's default espeak path works from
the romanised level. This pack handles:

  - Hiragana  → romaji → ARPAbet
  - Katakana  → romaji → ARPAbet
  - Kanji     → kana via pykakasi (optional) → ARPAbet
  - Romaji input (already ASCII, just normalize)
  - Mixed input (Japanese + English in one line — very common in J-pop)

The key difference from the espeak path:
  - Native kana decomposition is MORE reliable than espeak for Japanese
  - Handles long vowels (ー, aa) correctly
  - Handles っ (geminate) → 'q' marker for UTAU
  - Handles ん (nasal coda) → 'N' phoneme correctly every time
  - No espeak dependency for Japanese content

For kanji, pykakasi converts to kana first. Without it, kanji pass
through to espeak as a fallback.
"""
from __future__ import annotations

import re
import sys
import logging
from pathlib import Path
from typing import Optional

log = logging.getLogger('mlc.ja')

sys.path.insert(0, str(Path(__file__).parent.parent))
from addon_base import LanguagePack
from core.mlc_types import MLCWarning, WarningLevel, AddonType

# ── Hiragana → romaji ─────────────────────────────────────────────────────

HIRAGANA_TO_ROMAJI = {
    # Basic
    'あ':'a', 'い':'i', 'う':'u', 'え':'e', 'お':'o',
    'か':'ka','き':'ki','く':'ku','け':'ke','こ':'ko',
    'さ':'sa','し':'shi','す':'su','せ':'se','そ':'so',
    'た':'ta','ち':'chi','つ':'tsu','て':'te','と':'to',
    'な':'na','に':'ni','ぬ':'nu','ね':'ne','の':'no',
    'は':'ha','ひ':'hi','ふ':'fu','へ':'he','ほ':'ho',
    'ま':'ma','み':'mi','む':'mu','め':'me','も':'mo',
    'や':'ya',          'ゆ':'yu',          'よ':'yo',
    'ら':'ra','り':'ri','る':'ru','れ':'re','ろ':'ro',
    'わ':'wa',          'ゐ':'i', 'ゑ':'e', 'を':'wo',
    'ん':'n',
    # Voiced
    'が':'ga','ぎ':'gi','ぐ':'gu','げ':'ge','ご':'go',
    'ざ':'za','じ':'ji','ず':'zu','ぜ':'ze','ぞ':'zo',
    'だ':'da','ぢ':'ji','づ':'zu','で':'de','ど':'do',
    'ば':'ba','び':'bi','ぶ':'bu','べ':'be','ぼ':'bo',
    # Semi-voiced
    'ぱ':'pa','ぴ':'pi','ぷ':'pu','ぺ':'pe','ぽ':'po',
    # Compound (youon)
    'きゃ':'kya','きゅ':'kyu','きょ':'kyo',
    'しゃ':'sha','しゅ':'shu','しょ':'sho',
    'ちゃ':'cha','ちゅ':'chu','ちょ':'cho',
    'にゃ':'nya','にゅ':'nyu','にょ':'nyo',
    'ひゃ':'hya','ひゅ':'hyu','ひょ':'hyo',
    'みゃ':'mya','みゅ':'myu','みょ':'myo',
    'りゃ':'rya','りゅ':'ryu','りょ':'ryo',
    'ぎゃ':'gya','ぎゅ':'gyu','ぎょ':'gyo',
    'じゃ':'ja', 'じゅ':'ju', 'じょ':'jo',
    'びゃ':'bya','びゅ':'byu','びょ':'byo',
    'ぴゃ':'pya','ぴゅ':'pyu','ぴょ':'pyo',
    # Extended katakana sounds (via hiragana equivalents)
    'ふぁ':'fa','ふぃ':'fi','ふぇ':'fe','ふぉ':'fo',
    'てぃ':'ti','でぃ':'di','とぅ':'tu','どぅ':'du',
    'うぃ':'wi','うぇ':'we','うぉ':'wo',
    # Special
    'っ': 'q',   # geminate marker
    'ー': '_',   # long vowel marker
    'ゔ': 'v',   # rare voiced u
}

# Katakana → Hiragana offset (just subtract 0x60)
def katakana_to_hiragana(text: str) -> str:
    result = []
    for ch in text:
        cp = ord(ch)
        if 0x30A0 <= cp <= 0x30FF:  # Katakana range
            result.append(chr(cp - 0x60))
        else:
            result.append(ch)
    return ''.join(result)

# ── Romaji → ARPAbet ──────────────────────────────────────────────────────
# Japanese romaji syllables → ARPAbet phoneme sequences

ROMAJI_TO_ARPABET = {
    'a':['AA'], 'i':['IY'], 'u':['UW'], 'e':['EH'], 'o':['OW'],
    'ka':['K','AA'], 'ki':['K','IY'], 'ku':['K','UW'], 'ke':['K','EH'], 'ko':['K','OW'],
    'sa':['S','AA'], 'shi':['SH','IY'], 'su':['S','UW'], 'se':['S','EH'], 'so':['S','OW'],
    'ta':['T','AA'], 'chi':['CH','IY'], 'tsu':['S','UW'], 'te':['T','EH'], 'to':['T','OW'],
    'na':['N','AA'], 'ni':['N','IY'], 'nu':['N','UW'], 'ne':['N','EH'], 'no':['N','OW'],
    'ha':['HH','AA'], 'hi':['HH','IY'], 'fu':['F','UW'], 'he':['HH','EH'], 'ho':['HH','OW'],
    'ma':['M','AA'], 'mi':['M','IY'], 'mu':['M','UW'], 'me':['M','EH'], 'mo':['M','OW'],
    'ya':['Y','AA'], 'yu':['Y','UW'], 'yo':['Y','OW'],
    'ra':['R','AA'], 'ri':['R','IY'], 'ru':['R','UW'], 're':['R','EH'], 'ro':['R','OW'],
    'wa':['W','AA'], 'wo':['W','OW'], 'wi':['W','IY'], 'we':['W','EH'],
    'n': ['N'], 'N': ['NG'],
    'ga':['G','AA'], 'gi':['G','IY'], 'gu':['G','UW'], 'ge':['G','EH'], 'go':['G','OW'],
    'za':['Z','AA'], 'ji':['JH','IY'], 'zu':['Z','UW'], 'ze':['Z','EH'], 'zo':['Z','OW'],
    'da':['D','AA'], 'de':['D','EH'], 'do':['D','OW'],
    'ba':['B','AA'], 'bi':['B','IY'], 'bu':['B','UW'], 'be':['B','EH'], 'bo':['B','OW'],
    'pa':['P','AA'], 'pi':['P','IY'], 'pu':['P','UW'], 'pe':['P','EH'], 'po':['P','OW'],
    'sha':['SH','AA'], 'shi':['SH','IY'], 'shu':['SH','UW'], 'she':['SH','EH'], 'sho':['SH','OW'],
    'cha':['CH','AA'], 'chi':['CH','IY'], 'chu':['CH','UW'], 'che':['CH','EH'], 'cho':['CH','OW'],
    'kya':['K','Y','AA'], 'kyu':['K','Y','UW'], 'kyo':['K','Y','OW'],
    'nya':['N','Y','AA'], 'nyu':['N','Y','UW'], 'nyo':['N','Y','OW'],
    'hya':['HH','Y','AA'], 'hyu':['HH','Y','UW'], 'hyo':['HH','Y','OW'],
    'mya':['M','Y','AA'], 'myu':['M','Y','UW'], 'myo':['M','Y','OW'],
    'rya':['R','Y','AA'], 'ryu':['R','Y','UW'], 'ryo':['R','Y','OW'],
    'gya':['G','Y','AA'], 'gyu':['G','Y','UW'], 'gyo':['G','Y','OW'],
    'ja':['JH','AA'], 'ju':['JH','UW'], 'jo':['JH','OW'],
    'bya':['B','Y','AA'], 'byu':['B','Y','UW'], 'byo':['B','Y','OW'],
    'pya':['P','Y','AA'], 'pyu':['P','Y','UW'], 'pyo':['P','Y','OW'],
    'fa':['F','AA'], 'fi':['F','IY'], 'fe':['F','EH'], 'fo':['F','OW'],
    'va':['V','AA'], 'vi':['V','IY'], 'vu':['V','UW'], 've':['V','EH'], 'vo':['V','OW'],
    # Geminate and long vowel
    'q':  ['q'],   # geminate consonant marker (ッ)
    '_':  ['_'],   # long vowel marker (ー)
}

def kana_to_romaji(text: str) -> list[str]:
    """
    Convert kana text to a list of romaji syllables.
    Handles geminate (っ) and long vowel (ー) markers.
    Returns: ['ku', 'mo', 'no', ...] or ['sha', 'do', 'u', ...]
    """
    # Convert katakana → hiragana first
    text = katakana_to_hiragana(text)

    syllables = []
    i = 0
    while i < len(text):
        # Try 2-char compound first (e.g. しゃ)
        if i + 1 < len(text):
            two = text[i:i+2]
            if two in HIRAGANA_TO_ROMAJI:
                syllables.append(HIRAGANA_TO_ROMAJI[two])
                i += 2
                continue
        # Single char
        one = text[i]
        if one in HIRAGANA_TO_ROMAJI:
            syllables.append(HIRAGANA_TO_ROMAJI[one])
        elif one.isascii():
            syllables.append(one)  # Pass through ASCII (mixed content)
        # else: unknown — skip
        i += 1

    return syllables


class JapaneseLanguagePack(LanguagePack):
    id           = 'ja_native'
    name         = 'Japanese Native'
    description  = ('Native Japanese Kana decomposition. More reliable than '
                    'espeak for Japanese input. Handles hiragana, katakana, '
                    'geminate consonants (っ→q), long vowels (ー), and nasal '
                    'coda (ん→N). Kanji requires pykakasi.')
    author       = 'Melon Synth'
    version      = '1.0.0'
    addon_type   = AddonType.LANGUAGE_PACK

    handles      = ['ja', 'ja-JP']
    handles_also = []
    has_tone     = False
    has_rhythm   = False

    _pykakasi_available = False

    def on_load(self):
        try:
            import pykakasi
            self._pykakasi_available = True
            log.info('pykakasi available — kanji input supported')
        except ImportError:
            log.info('pykakasi not installed — kanji will use espeak fallback')
            log.info('Install with: pip install pykakasi')

    def normalise(self, text: str, lang: str) -> str:
        # Normalise Unicode (NFC)
        import unicodedata
        text = unicodedata.normalize('NFC', text)
        # Convert full-width numbers/letters to half-width
        text = text.translate(str.maketrans(
            'ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ'
            'ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ'
            '０１２３４５６７８９',
            'abcdefghijklmnopqrstuvwxyz'
            'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
            '0123456789'
        ))
        text = re.sub(r'\s+', ' ', text).strip()
        return text

    def decompose(self, text: str, lang: str) -> list[list[str]]:
        words  = text.split()
        result = []

        for word in words:
            if self._has_kanji(word) and self._pykakasi_available:
                kana = self._kanji_to_kana(word)
            else:
                kana = word

            phonemes = self._kana_word_to_arpabet(kana)
            result.append(phonemes)

        return result

    def syllabify(self, word: str, phonemes: list[str], lang: str) -> list[dict]:
        """
        Japanese syllabification: each kana character is one mora (syllable).
        This is the correct linguistic approach — not vowel-counting.
        """
        # Convert to kana if needed
        kana = katakana_to_hiragana(word)

        syllables = []
        i = 0
        while i < len(kana):
            # 2-char compound?
            if i + 1 < len(kana) and kana[i:i+2] in HIRAGANA_TO_ROMAJI:
                romaji = HIRAGANA_TO_ROMAJI[kana[i:i+2]]
                syl_ph = ROMAJI_TO_ARPABET.get(romaji, ['AH'])
                syllables.append({'phonemes': syl_ph, 'stressed': (i==0), 'secondary': False})
                i += 2
            elif kana[i] in HIRAGANA_TO_ROMAJI:
                romaji = HIRAGANA_TO_ROMAJI[kana[i]]
                syl_ph = ROMAJI_TO_ARPABET.get(romaji, ['AH'])
                syllables.append({'phonemes': syl_ph, 'stressed': (i==0), 'secondary': False})
                i += 1
            else:
                i += 1

        return syllables or []

    def _has_kanji(self, text: str) -> bool:
        return any('\u4e00' <= c <= '\u9fff' or '\u3400' <= c <= '\u4dbf' for c in text)

    def _kanji_to_kana(self, text: str) -> str:
        try:
            import pykakasi
            kks  = pykakasi.kakasi()
            result = kks.convert(text)
            return ''.join(item['hira'] for item in result)
        except Exception as e:
            log.warning(f'pykakasi failed for {text}: {e}')
            return text

    def _kana_word_to_arpabet(self, text: str) -> list[str]:
        """Convert kana (or romaji) to flat ARPAbet list."""
        romaji_syllables = kana_to_romaji(text)
        phonemes: list[str] = []

        for syl in romaji_syllables:
            if syl == 'q':
                # Geminate: double the next consonant — mark with 'q' for UTAU
                phonemes.append('q')
            elif syl == '_':
                # Long vowel: extend previous vowel
                phonemes.append('_')
            elif syl in ROMAJI_TO_ARPABET:
                phonemes.extend(ROMAJI_TO_ARPABET[syl])
            elif len(syl) == 1 and syl.isalpha():
                # Single ASCII letter — pass through
                phonemes.append(syl.upper())
            # else: unknown, skip

        return phonemes or ['AH']

    def validate_input(self, text: str, lang: str) -> list[MLCWarning]:
        warnings = []
        if self._has_kanji(text) and not self._pykakasi_available:
            warnings.append(MLCWarning(
                level=WarningLevel.INFO,
                code='MISSING_PYKAKASI',
                message='Kanji detected — pykakasi not installed, falling back to espeak',
                suggestion='Run: pip install pykakasi — for better kanji support',
            ))
        return warnings
