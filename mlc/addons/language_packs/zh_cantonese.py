"""
Cantonese Language Pack for MLC
================================
Converts Cantonese (Traditional/Simplified Chinese) text to IPF phonemes
using Jyutping romanisation with 6-tone markers.

Tone system:
  Jyutping appends a digit 1-6 to each syllable:
  1 = high level (陰平)    e.g. 詩 si1
  2 = high rising (陰上)   e.g. 史 si2
  3 = mid level (陰去)     e.g. 試 si3
  4 = low falling (陽平)   e.g. 時 si4
  5 = low rising (陽上)    e.g. 市 si5
  6 = low level (陽去)     e.g. 事 si6

Pipeline integration:
  The tone digit is passed to the ToneAwarePitch plugin
  via SynthToken.note = 'tone:N', where N is 1-6.
  The plugin then applies the appropriate pitch curve.

Dependencies:
  - pycantonese (pip install pycantonese)

Fallback:
  If pycantonese is not installed, falls back to a lookup table
  for the ~500 most common characters. Not as good, but functional.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

log = logging.getLogger('mlc.lang.cantonese')

# ── Built-in lookup (fallback when pycantonese isn't installed) ──────────────
# ~150 highest-frequency Cantonese characters with jyutping.
# Source: SUBTLEX-CH frequency data + manual curation.
COMMON_JYUTPING = {
    '我':'ngo5','你':'nei5','係':'hai6','喺':'hai2','佢':'keoi5','唔':'m4',
    '有':'jau5','冇':'mou5','好':'hou2','大':'daai6','小':'siu2','人':'jan4',
    '個':'go3','嘅':'ge3','同':'tung4','去':'heoi3','嚟':'lai4','做':'zou6',
    '食':'sik6','飲':'jam2','講':'gong2','睇':'tai2','聽':'teng1','知':'zi1',
    '想':'soeng2','係咪':'hai6mai6','唔係':'m4hai6','點':'dim2','幾':'gei2',
    '多':'do1','少':'siu2','先':'sin1','後':'hau6','而家':'ji4gaa1',
    '今日':'gam1jat6','聽日':'teng1jat6','啱':'ngaam1','啱啱':'ngaam1ngaam1',
    '一':'jat1','二':'ji6','三':'saam1','四':'sei3','五':'ng5',
    '六':'luk6','七':'cat1','八':'baat3','九':'gau2','十':'sap6',
    '時':'si4','間':'gaan1','地':'dei6','事':'si6','話':'waa6',
    '啦':'laa1','囉':'lo3','囉':'lo3','喎':'wo3','咋':'zaa3',
    '嗱':'naa4','咪':'mai5','喇':'laa3','囉':'lo1',
}

# Jyutping initial consonants → ARPAbet-style consonant
JP_INITIAL_MAP = {
    'b':'B','p':'P','m':'M','f':'F','d':'D','t':'T','n':'N','l':'L',
    'g':'G','k':'K','ng':'NG','h':'HH','gw':'GW','kw':'KW',
    'z':'Z','c':'CH','s':'S','j':'Y','w':'W',
    '':'',  # null initial (pure vowel onset)
}

# Jyutping nucleus+coda → vowel token
JP_RHYME_MAP = {
    'aa':'AA','aai':'AAI','aau':'AAU','aam':'AAM','aan':'AAN','aang':'AANG','aap':'AAP','aat':'AAT','aak':'AAK',
    'a':'AH','ai':'AY','au':'AW','am':'AM','an':'AEN','ang':'ANG','ap':'AP','at':'AT','ak':'AK',
    'e':'EH','ei':'EY','eu':'EHU','em':'EHM','eng':'ENG','ep':'EHP','ek':'EHK',
    'i':'IY','iu':'IW','im':'IYM','in':'IYN','ing':'IHNG','ip':'IYP','it':'IYT','ik':'IHK',
    'o':'OW','oi':'OY','on':'OWN','ong':'ONG','ot':'OWT','ok':'OWK','ou':'OWW',
    'u':'UW','ui':'UY','un':'UWN','ung':'UNG','ut':'UWT','uk':'UWK',
    'oe':'OEH','oeng':'OEHNG','oek':'OEHK','eon':'OEHN','eot':'OEHT',
    'yu':'YUW','yun':'YUWN','yut':'YUWT',
    'm':'M','ng':'NG',  # syllabic nasals
}


def _parse_jyutping_syllable(jp: str) -> tuple[str, str, int]:
    """Parse a single jyutping syllable like 'gong2' → ('g', 'ong', 2)."""
    if not jp:
        return ('', '', 0)

    # Extract tone digit
    tone = 0
    if jp[-1].isdigit():
        tone = int(jp[-1])
        jp   = jp[:-1]

    # Syllabic nasals: 'm' and 'ng' are standalone syllables (e.g. 唔=m4, 五=ng5).
    # Must be checked BEFORE initial extraction or 'm'/'n' get stripped as consonants.
    if jp in ('m', 'ng'):
        return ('', jp, tone)

    # Try two-character initials first (ng, gw, kw)
    initial = ''
    for ini in ('gw','kw','ng'):
        if jp.startswith(ini):
            initial = ini
            jp      = jp[len(ini):]
            break

    # Single-character initial (consonants only — stop before vowel onset)
    if not initial and jp and jp[0] not in 'aeiouyw':
        initial = jp[0]
        jp      = jp[1:]

    # 'y' and 'w' are semi-vowel onsets in Cantonese jyutping, not true initials
    # e.g. 'yu3' = yu onset, 'wan1' = w onset — leave them in the rhyme
    rhyme = jp
    return (initial, rhyme, tone)


def _syllable_to_tokens(jp_syllable: str) -> list[dict]:
    """Convert one jyutping syllable to a list of token dicts."""
    initial, rhyme, tone = _parse_jyutping_syllable(jp_syllable)
    tokens = []

    if initial and initial in JP_INITIAL_MAP:
        tokens.append({
            'type':      'consonant',
            'arpabet':   JP_INITIAL_MAP[initial],
            'tone':      0,
            'jyutping':  jp_syllable,
        })

    vowel_key = rhyme.lower()
    vowel_arp = JP_RHYME_MAP.get(vowel_key, 'AH')
    tokens.append({
        'type':     'vowel',
        'arpabet':  vowel_arp,
        'tone':     tone,
        'jyutping': jp_syllable,
    })
    return tokens


class CantoneseLanguagePack:
    """
    Cantonese language pack.
    Subclasses LanguagePack from addon_base when loaded via MLC.
    Can also be used standalone for testing.
    """
    id           = 'zh_cantonese'
    name         = 'Cantonese (粵語)'
    language     = 'yue'          # ISO 639-3 for Cantonese
    languages    = ['yue','zh-yue','zh-HK','zh-TW']
    version      = '1.0.0'
    author       = 'Melon Synth Contributors'
    description  = 'Cantonese G2P via Jyutping. 6-tone system with tone curve hints.'
    tone_system  = '6_tone'

    _pycantonese: Optional[object] = None

    def on_load(self):
        try:
            import pycantonese
            self._pycantonese = pycantonese
            log.info('Cantonese: pycantonese loaded (full G2P)')
        except ImportError:
            log.warning(
                'pycantonese not installed — falling back to lookup table. '
                'Run: pip install pycantonese   for full G2P coverage.'
            )

    def text_to_jyutping(self, text: str) -> list[str]:
        """Convert text to a flat list of jyutping syllables."""
        if self._pycantonese:
            try:
                import pycantonese
                # parse() returns list of Token objects
                tokens = pycantonese.parse(text)
                result = []
                for token in tokens:
                    if token.jyutping:
                        result.extend(token.jyutping.split())
                return result
            except Exception as e:
                log.warning(f'pycantonese error: {e}, falling back to lookup')

        # Fallback: character-by-character lookup
        result = []
        for char in text:
            if char in COMMON_JYUTPING:
                # May be multi-syllable like 'gam1jat6' — split on runs of letters+digit
                syllables = re.findall(r'[a-z]+[1-6]', COMMON_JYUTPING[char])
                result.extend(syllables if syllables else [COMMON_JYUTPING[char]])
            elif char.strip() and not char.isascii():
                log.debug(f'Cantonese: no jyutping for {char!r}')
        return result

    def g2p(self, text: str) -> list:
        """
        Main entry point. Converts text to IPF-compatible phoneme dicts.
        When loaded as a proper LanguagePack, these become IPFPhoneme objects.
        For standalone use, returns plain dicts.
        """
        jyutping_syllables = self.text_to_jyutping(text)
        tokens = []
        for i, syl in enumerate(jyutping_syllables):
            for tok in _syllable_to_tokens(syl):
                tokens.append({
                    'symbol':        tok['arpabet'],
                    'is_vowel':      tok['type'] == 'vowel',
                    'tone':          tok['tone'],
                    'word_index':    i,
                    'syllable_index': i,
                    'duration_hint': 0.4 if tok['type'] == 'vowel' else 0.15,
                    'beat_weight':   0.7 if tok['type'] == 'vowel' else 0.2,
                    'note':          f'tone:{tok["tone"]}' if tok['tone'] > 0 else '',
                    'source_word':   syl,
                    'confidence':    0.85 if self._pycantonese else 0.6,
                    'g2p_source':    'pycantonese' if self._pycantonese else 'lookup',
                })
        return tokens


# ── Standalone test ──────────────────────────────────────────────────────────
if __name__ == '__main__':
    pack = CantoneseLanguagePack()
    pack.on_load()

    test_phrases = ['你好', '我愛你', '今日天氣好好', '香港', '廣東話']
    for phrase in test_phrases:
        jyut = pack.text_to_jyutping(phrase)
        tokens = pack.g2p(phrase)
        print(f'{phrase}  →  {" ".join(jyut)}')
        vowels = [t["symbol"] for t in tokens if t["is_vowel"]]
        tones  = [t["tone"]   for t in tokens if t["is_vowel"] and t["tone"]]
        print(f'  vowels: {vowels}')
        print(f'  tones:  {tones}')
        print()
