# Melon Synth — MLC Engine
# Copyright (C) 2026 Abinaash (MilkmanAbi)
# SPDX-License-Identifier: GPL-3.0-or-later
# https://github.com/MilkmanAbi/Melon-Synth

"""
MLC G2P Engine
==============
Converts raw text into the Intermediate Phoneme Format (IPF).

Architecture:
  TextNormaliser → LanguageRouter → G2PBackend → Syllabifier
                                                → StressAnalyser
                                                → RhythmWeighter
                                                → IPFBuilder

Backends (tried in order):
  1. espeak-ng via phonemizer (best quality, needs system install)
  2. CMUdict via NLTK         (English only, high accuracy)
  3. Rule-based G2P           (any language, decent quality)
  4. Character passthrough    (last resort, always works)
"""

from __future__ import annotations

import re
import logging
from typing import Optional

log = logging.getLogger('mlc.g2p')

# ── ARPAbet vowel set ──────────────────────────────────────────────────────

ARPABET_VOWELS = {
    'AA','AE','AH','AO','AW','AY',
    'EH','ER','EY',
    'IH','IY',
    'OW','OY',
    'UH','UW',
}

ARPABET_PHONEME_CLASS = {
    # Vowels
    **{v: 'VOWEL' for v in ARPABET_VOWELS},
    # Stops
    'B':'STOP','D':'STOP','G':'STOP','K':'STOP','P':'STOP','T':'STOP',
    # Fricatives
    'DH':'FRICATIVE','F':'FRICATIVE','HH':'FRICATIVE','S':'FRICATIVE',
    'SH':'FRICATIVE','TH':'FRICATIVE','V':'FRICATIVE','Z':'FRICATIVE','ZH':'FRICATIVE',
    # Affricates
    'CH':'AFFRICATE','JH':'AFFRICATE',
    # Nasals
    'M':'NASAL','N':'NASAL','NG':'NASAL',
    # Liquids
    'L':'LIQUID','R':'LIQUID',
    # Glides
    'W':'GLIDE','Y':'GLIDE',
}

# ── IPA → ARPAbet ──────────────────────────────────────────────────────────

IPA_TO_ARPABET = {
    # Vowels
    'æ':'AE','ɑ':'AA','ɔ':'AO','ə':'AH','ɛ':'EH','ɪ':'IH','i':'IY',
    'ɨ':'IH','ʊ':'UH','u':'UW','ʌ':'AH','e':'EY','o':'OW',
    # Diphthongs
    'aɪ':'AY','aʊ':'AW','ɔɪ':'OY','eɪ':'EY','oʊ':'OW','ɪə':'IH','ʊə':'UH','eə':'EH',
    # R-coloured
    'ɚ':'ER','ɝ':'ER',
    # Consonants
    'p':'P','b':'B','t':'T','d':'D','k':'K','g':'G',
    'f':'F','v':'V','θ':'TH','ð':'DH','s':'S','z':'Z',
    'ʃ':'SH','ʒ':'ZH','h':'HH','tʃ':'CH','dʒ':'JH',
    'm':'M','n':'N','ŋ':'NG','l':'L','r':'R','w':'W','j':'Y',
}

# ── Contractions ──────────────────────────────────────────────────────────

CONTRACTIONS = {
    "i'm":"i am","i'll":"i will","i've":"i have","i'd":"i would",
    "you're":"you are","you'll":"you will","you've":"you have","you'd":"you would",
    "he's":"he is","she's":"she is","it's":"it is","that's":"that is",
    "there's":"there is","here's":"here is","who's":"who is","what's":"what is",
    "we're":"we are","we'll":"we will","we've":"we have","we'd":"we would",
    "they're":"they are","they'll":"they will","they've":"they have","they'd":"they would",
    "don't":"do not","doesn't":"does not","didn't":"did not","can't":"cannot",
    "couldn't":"could not","wouldn't":"would not","shouldn't":"should not",
    "won't":"will not","isn't":"is not","aren't":"are not",
    "wasn't":"was not","weren't":"were not","haven't":"have not",
    "hasn't":"has not","hadn't":"had not","let's":"let us",
    "that'll":"that will","who'll":"who will","where's":"where is",
    "how's":"how is","when's":"when is","why's":"why is",
    "y'all":"you all","gonna":"going to","wanna":"want to",
    "gotta":"got to","kinda":"kind of","sorta":"sort of",
    "outta":"out of","lotta":"lot of","dunno":"do not know",
    "lemme":"let me","gimme":"give me","tryna":"trying to",
}

# Simple English number words
_ONES = ['','one','two','three','four','five','six','seven','eight','nine',
         'ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen',
         'seventeen','eighteen','nineteen']
_TENS = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety']

def _num_to_words(n: int) -> str:
    if n < 0:   return 'negative ' + _num_to_words(-n)
    if n == 0:  return 'zero'
    if n < 20:  return _ONES[n]
    if n < 100: return _TENS[n//10] + ('' if n%10==0 else ' '+_ONES[n%10])
    if n < 1000:return _ONES[n//100]+' hundred'+('' if n%100==0 else ' '+_num_to_words(n%100))
    return str(n)

# ── Text Normaliser ────────────────────────────────────────────────────────

class TextNormaliser:
    """Language-aware text normalisation before G2P."""

    def normalise(self, text: str, lang: str) -> str:
        text = text.strip()

        if lang in ('en', 'en-us', 'en-gb'):
            text = self._normalise_english(text)
        elif lang == 'ja':
            text = self._normalise_japanese(text)
        else:
            text = self._normalise_generic(text)

        return text

    def _normalise_english(self, text: str) -> str:
        text = text.lower()
        # Expand contractions
        for contraction, expanded in CONTRACTIONS.items():
            text = re.sub(r'\b' + re.escape(contraction) + r'\b', expanded, text)
        # Expand numbers
        text = re.sub(r'\b(\d+)\b', lambda m: _num_to_words(int(m.group(1))), text)
        # Strip punctuation
        text = re.sub(r"[,!?;:()\[\]{}\".…]+", ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text

    def _normalise_japanese(self, text: str) -> str:
        # For Japanese, phonemizer handles kana/kanji via espeak
        # Just strip Western punctuation
        text = re.sub(r'[,!?;:()\[\]{}\".…]+', ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text

    def _normalise_generic(self, text: str) -> str:
        text = re.sub(r"[,!?;:()\[\]{}\".…]+", ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text


# ── G2P Backends ───────────────────────────────────────────────────────────

class G2PResult:
    """Result from any G2P backend."""
    def __init__(self, arpabet: list[str], confidence: float, backend: str):
        self.arpabet    = arpabet   # list of ARPAbet symbols
        self.confidence = confidence
        self.backend    = backend


class EspeakBackend:
    """G2P via espeak-ng + phonemizer. Best quality."""
    _ready = False
    _phonemize = None

    @classmethod
    def ensure(cls) -> bool:
        if cls._ready:
            return True
        try:
            from phonemizer import phonemize
            from phonemizer.backend import EspeakBackend as ESB
            ESB.version()
            cls._phonemize = phonemize
            cls._ready = True
            return True
        except Exception as e:
            log.warning(f'espeak backend not available: {e}')
            return False

    LANG_MAP = {
        'en':'en-us','en-us':'en-us','en-gb':'en-gb',
        'ja':'ja','zh':'cmn','ko':'ko',
        'fr':'fr','de':'de','es':'es','it':'it',
        'pt':'pt','ru':'ru','nl':'nl','pl':'pl',
        'sv':'sv','da':'da','fi':'fi','nb':'nb',
        'ar':'ar','hi':'hi','tr':'tr','vi':'vi',
    }

    @classmethod
    def convert(cls, word: str, lang: str) -> Optional[G2PResult]:
        if not cls.ensure():
            return None
        espeak_lang = cls.LANG_MAP.get(lang, 'en-us')
        try:
            ipa = cls._phonemize(
                word, language=espeak_lang, backend='espeak',
                with_stress=True, strip=True,
            ).strip()
            arpabet = _ipa_to_arpabet(ipa)
            return G2PResult(arpabet, confidence=0.92, backend='espeak')
        except Exception as e:
            log.debug(f'espeak failed for "{word}": {e}')
            return None


class CMUDictBackend:
    """G2P via CMUdict. English only, very high accuracy for covered words."""
    _dict = None
    _ready = False

    @classmethod
    def ensure(cls) -> bool:
        if cls._ready:
            return True
        try:
            import nltk
            for corpus in ['cmudict']:
                try:
                    nltk.data.find(f'corpora/{corpus}')
                except LookupError:
                    nltk.download(corpus, quiet=True)
            from nltk.corpus import cmudict
            cls._dict = cmudict.dict()
            cls._ready = True
            return True
        except Exception as e:
            log.warning(f'CMUdict not available: {e}')
            return False

    @classmethod
    def convert(cls, word: str, lang: str) -> Optional[G2PResult]:
        if lang not in ('en', 'en-us', 'en-gb'):
            return None
        if not cls.ensure() or cls._dict is None:
            return None
        word_lower = word.lower().strip("'-")
        if word_lower not in cls._dict:
            return None
        phones = cls._dict[word_lower][0]
        # Strip stress digits: 'AE1' → 'AE'
        arpabet = [p.rstrip('012') for p in phones]
        # Reconstruct stress from digits
        stressed = [int(p[-1]) if p[-1].isdigit() else 0 for p in phones]
        return G2PResult(arpabet, confidence=0.98, backend='cmudict')


class RuleBasedBackend:
    """
    Rule-based G2P. Works for any Latin-script language.
    Not perfect but always produces something reasonable.
    """

    VOWEL_MAP = {
        'a':'AE','e':'EH','i':'IH','o':'AO','u':'AH','y':'IY',
    }
    CONS_MAP = {
        'b':'B','c':'K','d':'D','f':'F','g':'G','h':'HH','j':'JH',
        'k':'K','l':'L','m':'M','n':'N','p':'P','q':'K','r':'R',
        's':'S','t':'T','v':'V','w':'W','x':'K','z':'Z',
    }
    DIGRAPHS = {
        'ch':'CH','sh':'SH','th':'TH','ph':'F','wh':'W',
        'ng':'NG','nk':'NG K','ck':'K','qu':'K W','gh':'F',
        'tch':'CH','dge':'JH',
    }

    @classmethod
    def convert(cls, word: str, lang: str) -> G2PResult:
        word = word.lower()
        result = []
        i = 0
        while i < len(word):
            # Try 3-char digraph
            three = word[i:i+3]
            if three in cls.DIGRAPHS:
                result.extend(cls.DIGRAPHS[three].split())
                i += 3; continue
            # Try 2-char digraph
            two = word[i:i+2]
            if two in cls.DIGRAPHS:
                result.extend(cls.DIGRAPHS[two].split())
                i += 2; continue
            # Single char
            ch = word[i]
            if ch in cls.VOWEL_MAP:
                result.append(cls.VOWEL_MAP[ch])
            elif ch in cls.CONS_MAP:
                result.append(cls.CONS_MAP[ch])
            # else: silent/unknown — skip
            i += 1
        return G2PResult(result or ['AH'], confidence=0.55, backend='rules')


# ── Syllabifier ────────────────────────────────────────────────────────────

class Syllabifier:
    """
    Splits an ARPAbet sequence into syllable groups with stress.
    Tries CMUdict first for English, falls back to rule-based.
    """

    def syllabify(
        self,
        word: str,
        arpabet: list[str],
        lang: str,
    ) -> list[dict]:
        """
        Returns: [{'phonemes': [...], 'stressed': bool, 'secondary': bool}]
        """
        # Try CMUdict with stress digits for English
        if lang in ('en', 'en-us', 'en-gb') and CMUDictBackend.ensure():
            result = self._from_cmudict(word)
            if result:
                return result

        return self._rule_based(arpabet)

    def _from_cmudict(self, word: str) -> Optional[list[dict]]:
        if not CMUDictBackend._dict:
            return None
        entry = CMUDictBackend._dict.get(word.lower().strip("'-"))
        if not entry:
            return None
        phones = entry[0]  # list like ['B', 'IH0', 'G', 'IH1', 'N', 'ER0']
        return self._cmu_phones_to_syllables(phones)

    def _cmu_phones_to_syllables(self, phones: list[str]) -> list[dict]:
        """Group CMUdict phones (with stress digits) into syllables."""
        syllables: list[dict] = []
        current: list[str] = []
        current_stress = 0
        current_secondary = False

        def flush():
            if current:
                syllables.append({
                    'phonemes': [p.rstrip('012') for p in current],
                    'stressed': current_stress == 1,
                    'secondary': current_stress == 2,
                })

        for phone in phones:
            stress = int(phone[-1]) if phone[-1].isdigit() else 0
            symbol = phone.rstrip('012')
            is_vowel = symbol in ARPABET_VOWELS

            if is_vowel:
                # New syllable nucleus — close previous if it had a vowel
                prev_vowels = [p for p in current if p.rstrip('012') in ARPABET_VOWELS]
                if prev_vowels:
                    flush()
                    current = [phone]
                    current_stress = stress
                    current_secondary = (stress == 2)
                else:
                    current.append(phone)
                    current_stress = stress
                    current_secondary = (stress == 2)
            else:
                current.append(phone)

        flush()

        # Fallback: if no syllables, treat whole word as one
        if not syllables:
            syllables = [{'phonemes': [p.rstrip('012') for p in phones],
                         'stressed': True, 'secondary': False}]

        # Ensure at least one stressed syllable
        if not any(s['stressed'] for s in syllables):
            syllables[0]['stressed'] = True

        return syllables

    def _rule_based(self, arpabet: list[str]) -> list[dict]:
        """Simple rule: one syllable per vowel."""
        syllables: list[dict] = []
        current: list[str] = []
        has_vowel = False

        for ph in arpabet:
            is_v = ph in ARPABET_VOWELS
            if is_v and has_vowel:
                syllables.append({'phonemes': current, 'stressed': False, 'secondary': False})
                current = [ph]
            else:
                current.append(ph)
                if is_v:
                    has_vowel = True

        if current:
            syllables.append({'phonemes': current, 'stressed': False, 'secondary': False})

        # Default: stress first syllable
        if syllables:
            syllables[0]['stressed'] = True

        return syllables or [{'phonemes': arpabet or ['AH'], 'stressed': True, 'secondary': False}]


# ── Rhythm Weighter ────────────────────────────────────────────────────────

class RhythmWeighter:
    """
    Assigns beat weights and duration hints to phonemes.
    Beat weight (0.0–1.0) reflects the metrical importance of the syllable —
    this is used by Melon Synth to suggest which notes should be longer.

    Rules:
      - Primary stressed syllable in a content word: 1.0
      - Secondary stressed syllable:                 0.65
      - Unstressed syllable in a content word:       0.5
      - Function word syllable (the, a, of, ...):    0.3
      - Coda consonant:                              0.2
      - Onset consonant:                             0.15
    """

    FUNCTION_WORDS = {
        'the','a','an','of','in','on','at','to','for','and','or','but','with',
        'by','as','if','so','yet','nor','from','into','onto','upon','than','that',
        'this','these','those','it','its','is','are','was','were','be','been',
        'being','have','has','had','do','does','did','will','would','shall',
        'should','may','might','must','can','could','not','no',
    }

    def weight(
        self,
        phoneme: str,
        syllable: dict,
        word: str,
        is_vowel: bool,
        is_nucleus: bool,
    ) -> tuple[float, float]:
        """Returns (beat_weight, duration_hint)."""
        word_l = word.lower()
        is_function = word_l in self.FUNCTION_WORDS

        if not is_vowel:
            # Consonants have low weight but non-zero duration
            return (0.15, 0.3)

        # Vowel / nucleus
        if is_function:
            return (0.3, 0.7)
        if syllable.get('stressed'):
            return (1.0, 1.2)
        if syllable.get('secondary'):
            return (0.65, 0.95)
        return (0.5, 0.85)


# ── IPF Builder ────────────────────────────────────────────────────────────

class IPFBuilder:
    """
    Assembles IPFPhoneme objects from G2P + syllabification results.
    """

    def build(
        self,
        words: list[str],
        arpabet_lists: list[list[str]],
        syllable_groups: list[list[dict]],
        confidences: list[float],
    ) -> list:  # list[IPFPhoneme]
        from core.mlc_types import (
            IPFPhoneme, PhonemeClass, StressLevel, Confidence
        )

        rhythm = RhythmWeighter()
        result: list[IPFPhoneme] = []
        global_idx = 0

        CLASS_MAP = {
            'VOWEL': PhonemeClass.VOWEL, 'STOP': PhonemeClass.STOP,
            'FRICATIVE': PhonemeClass.FRICATIVE, 'AFFRICATE': PhonemeClass.AFFRICATE,
            'NASAL': PhonemeClass.NASAL, 'LIQUID': PhonemeClass.LIQUID,
            'GLIDE': PhonemeClass.GLIDE,
        }

        for word_idx, (word, arpabet, syllables, conf) in enumerate(
            zip(words, arpabet_lists, syllable_groups, confidences)
        ):
            # Flatten phonemes with syllable/stress context
            flat: list[tuple[str, int, dict, int]] = []
            # (symbol, syl_idx, syl_dict, ph_within_syl)
            for syl_idx, syl in enumerate(syllables):
                for ph_i, ph in enumerate(syl['phonemes']):
                    flat.append((ph, syl_idx, syl, ph_i))

            total = len(flat)
            for i, (sym, syl_idx, syl, ph_within_syl) in enumerate(flat):
                is_vowel  = sym in ARPABET_VOWELS
                phon_cls  = CLASS_MAP.get(
                    ARPABET_PHONEME_CLASS.get(sym, 'UNKNOWN'),
                    PhonemeClass.UNKNOWN
                )

                # Syllable roles
                syl_phones = syl['phonemes']
                vowel_pos  = next((j for j, p in enumerate(syl_phones) if p in ARPABET_VOWELS), None)
                is_onset   = vowel_pos is not None and ph_within_syl < vowel_pos
                is_nucleus = ph_within_syl == vowel_pos if vowel_pos is not None else is_vowel
                is_coda    = vowel_pos is not None and ph_within_syl > vowel_pos

                # Stress
                if syl.get('stressed'):
                    stress = StressLevel.PRIMARY
                elif syl.get('secondary'):
                    stress = StressLevel.SECONDARY
                else:
                    stress = StressLevel.NONE

                beat_w, dur_h = rhythm.weight(sym, syl, word, is_vowel, is_nucleus)

                conf_enum = (
                    Confidence.HIGH   if conf >= 0.9 else
                    Confidence.MEDIUM if conf >= 0.6 else
                    Confidence.LOW
                )

                result.append(IPFPhoneme(
                    symbol=sym, phon_class=phon_cls,
                    word_index=word_idx, syllable_index=syl_idx,
                    phoneme_index=ph_within_syl, global_index=global_idx,
                    stress=stress, beat_weight=beat_w, duration_hint=dur_h,
                    is_onset=is_onset, is_nucleus=is_nucleus, is_coda=is_coda,
                    is_word_start=(i == 0), is_word_end=(i == total - 1),
                    is_vowel=is_vowel, source_grapheme=sym,
                    source_word=word, confidence=conf_enum,
                ))
                global_idx += 1

        return result


# ── Full G2P Pipeline ─────────────────────────────────────────────────────

class G2PEngine:
    """
    Orchestrates the full text → IPFPhoneme pipeline.
    Tries backends in order of quality, falls back gracefully.
    """

    def __init__(self):
        self.normaliser  = TextNormaliser()
        self.syllabifier = Syllabifier()
        self.builder     = IPFBuilder()

    def process(self, text: str, lang: str) -> tuple[list, list[str], str]:
        """
        Returns (flat_ipf_phonemes, word_list, normalised_text).
        """
        normalised = self.normaliser.normalise(text, lang)
        words = normalised.split()

        arpabet_lists: list[list[str]] = []
        confidences:   list[float]     = []

        for word in words:
            # Try backends in priority order
            result = (
                EspeakBackend.convert(word, lang)
                or CMUDictBackend.convert(word, lang)
                or RuleBasedBackend.convert(word, lang)
            )
            arpabet_lists.append(result.arpabet)
            confidences.append(result.confidence)
            log.debug(f'{word} → {result.arpabet} (backend={result.backend}, conf={result.confidence:.2f})')

        syllable_groups = [
            self.syllabifier.syllabify(word, arp, lang)
            for word, arp in zip(words, arpabet_lists)
        ]

        phonemes = self.builder.build(words, arpabet_lists, syllable_groups, confidences)
        return phonemes, words, normalised


# ── IPA → ARPAbet ─────────────────────────────────────────────────────────

def _ipa_to_arpabet(ipa: str) -> list[str]:
    result: list[str] = []
    ipa = ipa.replace('ˈ','').replace('ˌ','').replace('ː','').replace('ʔ','')
    i = 0
    while i < len(ipa):
        two = ipa[i:i+2]
        if two in IPA_TO_ARPABET:
            mapped = IPA_TO_ARPABET[two]
            result.extend(mapped.split() if mapped else [])
            i += 2; continue
        one = ipa[i]
        if one in IPA_TO_ARPABET:
            mapped = IPA_TO_ARPABET[one]
            result.extend(mapped.split() if mapped else [])
        elif one not in ' .-,\n\t':
            log.debug(f'Unknown IPA symbol: {repr(one)}')
        i += 1
    return result


# ── Cluster Repair ─────────────────────────────────────────────────────────
# Fixes bad consonant clusters produced by rule-based fallback.
# Called as the final step in G2PEngine.process() before IPFBuilder.

# Valid JP-mappable consonant pairs (C1+C2 where both can form syllables)
_VALID_CLUSTERS = {
    'tr', 'dr', 'str', 'br', 'pr', 'fr', 'gr', 'cr', 'kr',
    'bl', 'pl', 'fl', 'sl', 'cl', 'gl',
    'sk', 'sp', 'st', 'sn', 'sm', 'sw',
    'tw', 'dw', 'th', 'sh', 'ch', 'ng', 'nk',
}

# Phonemes that can't appear together in ARPAbet without a vowel between them
# (these indicate a fallback artifact)
_ILLEGAL_PAIRS = {
    ('M','N'),('N','M'),('M','L'),('L','M'),('N','L'),('L','N'),
    ('R','L'),('L','R'),('M','R'),('R','M'),
    ('B','D'),('D','B'),('G','D'),('D','G'),('P','B'),('B','P'),
    ('F','V'),('V','F'),('S','Z'),('Z','S'),
    ('M','B'),('N','D'),('N','G'),
    # Double nasals: nn/mn bleeding — ARPAbet can produce these at word
    # boundaries (e.g. "unknown", "innocent"). Collapse via schwa insertion
    # so the synthesiser doesn't receive two adjacent identical nasals.
    ('N','N'),('M','M'),
}

VOWELS_SET = {
    'AA','AE','AH','AO','AW','AY','EH','ER','EY','IH','IY','OW','OY','UH','UW'
}

def repair_clusters(arpabet: list[str]) -> tuple[list[str], bool]:
    """
    Detect and repair illegal consonant clusters in an ARPAbet sequence.
    Returns (repaired_list, was_repaired).

    Repair strategy: insert 'AH' (schwa) between illegal pairs.
    This is linguistically the right thing — a short unstressed vowel
    between two consonants that can't be pronounced together.

    Example: ['M','N'] → ['M','AH','N']
             ['D','R','IY','M'] stays as-is (DR is valid)
    """
    if len(arpabet) < 2:
        return arpabet, False

    result = []
    repaired = False
    i = 0

    while i < len(arpabet):
        result.append(arpabet[i])

        if i + 1 < len(arpabet):
            cur  = arpabet[i]
            nxt  = arpabet[i+1]
            both_cons = (cur not in VOWELS_SET and nxt not in VOWELS_SET)

            if both_cons and (cur, nxt) in _ILLEGAL_PAIRS:
                # Insert schwa between illegal pair
                result.append('AH')
                repaired = True

        i += 1

    return result, repaired


class G2PResultFull:
    """G2P result with structured source tracking."""
    def __init__(self, arpabet, confidence, backend_str, was_repaired=False):
        self.arpabet      = arpabet
        self.confidence   = confidence
        self.was_repaired = was_repaired
        # Map string → G2PSource enum
        from core.mlc_types import G2PSource
        _map = {
            'espeak':  G2PSource.ESPEAK,
            'cmudict': G2PSource.CMUDICT,
            'rules':   G2PSource.RULES,
        }
        for k in _map:
            if k in backend_str:
                self.g2p_source = _map[k]
                return
        self.g2p_source = G2PSource.RULES


class G2PEngineV2(G2PEngine):
    """
    G2P engine with structured source tracking and cluster repair.
    Extends G2PEngine — drop-in replacement.
    """

    def process_full(self, text: str, lang: str):
        """
        Like process() but returns full provenance per word.
        Returns (ipf_phonemes, words, normalised, word_sources)
        where word_sources is list[G2PResultFull].
        """
        from core.mlc_types import G2PSource, TokenFlag

        normalised = self.normaliser.normalise(text, lang)
        words      = normalised.split()

        arpabet_lists:  list[list[str]] = []
        full_results:   list[G2PResultFull] = []
        confidences:    list[float] = []

        for word in words:
            raw = (
                EspeakBackend.convert(word, lang)
                or CMUDictBackend.convert(word, lang)
                or RuleBasedBackend.convert(word, lang)
            )

            # Cluster repair for fallback results
            repaired = False
            arpabet  = raw.arpabet
            if raw.backend == 'rules':
                arpabet, repaired = repair_clusters(raw.arpabet)

            full = G2PResultFull(arpabet, raw.confidence, raw.backend, repaired)
            arpabet_lists.append(full.arpabet)
            full_results.append(full)
            confidences.append(full.confidence)

            log.debug(
                f'{word} → {full.arpabet} '
                f'(src={full.g2p_source.value}, conf={full.confidence:.2f}'
                f'{", repaired" if full.was_repaired else ""})'
            )

        syllable_groups = [
            self.syllabifier.syllabify(w, a, lang)
            for w, a in zip(words, arpabet_lists)
        ]

        phonemes = self._build_with_provenance(
            words, arpabet_lists, syllable_groups, full_results
        )

        return phonemes, words, normalised, full_results

    def _build_with_provenance(self, words, arpabet_lists, syllable_groups, sources):
        """Build IPFPhonemes with full G2PSource + source_confidence."""
        from core.mlc_types import (
            IPFPhoneme, PhonemeClass, StressLevel, Confidence, G2PSource, TokenFlag
        )

        rhythm     = RhythmWeighter()
        result     = []
        global_idx = 0

        CLASS_MAP = {
            'VOWEL':PhonemeClass.VOWEL,'STOP':PhonemeClass.STOP,
            'FRICATIVE':PhonemeClass.FRICATIVE,'AFFRICATE':PhonemeClass.AFFRICATE,
            'NASAL':PhonemeClass.NASAL,'LIQUID':PhonemeClass.LIQUID,
            'GLIDE':PhonemeClass.GLIDE,
        }

        for word_idx, (word, arpabet, syllables, src) in enumerate(
            zip(words, arpabet_lists, syllable_groups, sources)
        ):
            flat = []
            for syl_idx, syl in enumerate(syllables):
                for ph_i, ph in enumerate(syl['phonemes']):
                    flat.append((ph, syl_idx, syl, ph_i))

            total = len(flat)
            for i, (sym, syl_idx, syl, ph_within_syl) in enumerate(flat):
                is_vowel = sym in ARPABET_VOWELS
                phon_cls = CLASS_MAP.get(
                    ARPABET_PHONEME_CLASS.get(sym,'UNKNOWN'),
                    PhonemeClass.UNKNOWN
                )

                syl_phones = syl['phonemes']
                vowel_pos  = next(
                    (j for j,p in enumerate(syl_phones) if p in ARPABET_VOWELS), None
                )
                is_onset  = ph_within_syl < vowel_pos if vowel_pos is not None else False
                is_nucleus = ph_within_syl == vowel_pos if vowel_pos is not None else is_vowel
                is_coda   = ph_within_syl > vowel_pos if vowel_pos is not None else False

                stress = (
                    StressLevel.PRIMARY   if syl.get('stressed')  else
                    StressLevel.SECONDARY if syl.get('secondary') else
                    StressLevel.NONE
                )

                beat_w, dur_h = rhythm.weight(sym, syl, word, is_vowel, is_nucleus)

                conf_enum = (
                    Confidence.HIGH   if src.confidence >= 0.90 else
                    Confidence.MEDIUM if src.confidence >= 0.65 else
                    Confidence.LOW
                )

                result.append(IPFPhoneme(
                    symbol=sym, phon_class=phon_cls,
                    word_index=word_idx, syllable_index=syl_idx,
                    phoneme_index=ph_within_syl, global_index=global_idx,
                    stress=stress, beat_weight=beat_w, duration_hint=dur_h,
                    is_onset=is_onset, is_nucleus=is_nucleus, is_coda=is_coda,
                    is_word_start=(i==0), is_word_end=(i==total-1),
                    is_vowel=is_vowel, source_grapheme=sym, source_word=word,
                    g2p_source=src.g2p_source,
                    source_confidence=src.confidence,
                    confidence=conf_enum,
                ))
                global_idx += 1

        return result
