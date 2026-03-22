"""
MLC Module: English ARPAbet Passthrough
========================================
Target banks: English VCCV banks, English CVVC banks, any western
              voicebank that uses ARPAbet or X-SAMPA phonemes

This is the simplest possible mapper — it passes ARPAbet phonemes
through directly, with minimal post-processing.

Why is this useful?
  - English voicebanks (Ritsu English, Defoko English, etc.) use ARPAbet
  - You don't want JP-style CV conversion — you want the actual English phonemes
  - MLC's G2P produces ARPAbet — this mapper just cleans and passes it through

Singability slider for ARPAbet:
  0.0 (accurate): full consonant clusters, all phonemes present
  1.0 (singable):  reduce clusters, simplify to more singable form
  Middle ground:   balanced — what you'd actually sing
"""
from __future__ import annotations

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from registry import VoicebankModule

# All standard ARPAbet phonemes
ARPABET_ALL = {
    # Vowels
    'AA','AE','AH','AO','AW','AY','EH','ER','EY',
    'IH','IY','OW','OY','UH','UW',
    # Consonants
    'B','CH','D','DH','F','G','HH','JH','K','L',
    'M','N','NG','P','R','S','SH','T','TH','V',
    'W','Y','Z','ZH',
    # Silence
    'SP','AP',  # silence, aspirated pause
}

VOWELS = {'AA','AE','AH','AO','AW','AY','EH','ER','EY','IH','IY','OW','OY','UH','UW'}

# Simplified (singable) versions of complex phonemes
SIMPLIFY_MAP = {
    'TH': 'F',   # "think" → more singable as F
    'DH': 'V',   # "the"   → V (closer than Z for singing)
    'NG': 'N',   # word-final NG → N at high singability
    'ZH': 'Z',   # "measure" → Z
}

# Consonant cluster simplification (at high singability)
# Maps (C1, C2) → keep only C2
CLUSTER_DROP = {
    frozenset(['S','T']), frozenset(['S','K']), frozenset(['S','P']),
    frozenset(['T','R']), frozenset(['D','R']), frozenset(['S','T','R']),
}


class EnglishARPAbetModule(VoicebankModule):
    id           = 'en_arpabet'
    name         = 'English ARPAbet Passthrough'
    description  = ('Direct ARPAbet passthrough for English VCCV and CVVC '
                    'voicebanks. Minimal mapping — keeps English phonemes intact.')
    author       = 'Melon Synth'
    version      = '1.0.0'
    language     = 'en'
    languages    = ['en', 'en-us', 'en-gb']
    phoneme_set  = 'arpabet'
    target_banks = ['English VCCV', 'English CVVC', 'Ritsu English',
                    'Delta English', 'any ARPAbet voicebank']

    singability_default = 0.4   # Lower default — we want accuracy for English banks
    singability_notes   = ('0.3–0.5 recommended. English banks are designed for '
                           'accurate English phonemes — singability simplification '
                           'is less aggressive here than for JP banks.')

    supported_phonemes = ARPABET_ALL

    def map_phonemes(self, phonemes: list, singability: float) -> list:
        from core.mlc_types import SynthToken, PhonemeClass, Confidence, G2PSource

        # Class mapping from ARPAbet
        PHON_CLASS = {
            **{v: PhonemeClass.VOWEL     for v in VOWELS},
            'B':PhonemeClass.STOP,  'D':PhonemeClass.STOP,  'G':PhonemeClass.STOP,
            'K':PhonemeClass.STOP,  'P':PhonemeClass.STOP,  'T':PhonemeClass.STOP,
            'CH':PhonemeClass.AFFRICATE, 'JH':PhonemeClass.AFFRICATE,
            'F':PhonemeClass.FRICATIVE, 'V':PhonemeClass.FRICATIVE,
            'S':PhonemeClass.FRICATIVE, 'Z':PhonemeClass.FRICATIVE,
            'SH':PhonemeClass.FRICATIVE, 'ZH':PhonemeClass.FRICATIVE,
            'TH':PhonemeClass.FRICATIVE, 'DH':PhonemeClass.FRICATIVE,
            'HH':PhonemeClass.FRICATIVE,
            'M':PhonemeClass.NASAL, 'N':PhonemeClass.NASAL, 'NG':PhonemeClass.NASAL,
            'L':PhonemeClass.LIQUID, 'R':PhonemeClass.LIQUID,
            'W':PhonemeClass.GLIDE, 'Y':PhonemeClass.GLIDE,
        }

        tokens = []
        i = 0
        n = len(phonemes)

        while i < n:
            ph = phonemes[i]
            sym = ph.symbol

            # Skip invalid / empty phonemes
            if not sym:
                i += 1
                continue

            # Apply singability simplification
            if singability > 0.6 and sym in SIMPLIFY_MAP:
                sym = SIMPLIFY_MAP[sym]

            # At very high singability, drop some cluster consonants
            if singability > 0.8 and i + 1 < n:
                pair = frozenset([sym, phonemes[i+1].symbol])
                if pair in CLUSTER_DROP:
                    i += 1  # skip this consonant, let next one through
                    continue

            phon_cls = PHON_CLASS.get(sym, PhonemeClass.UNKNOWN)
            is_vowel = sym in VOWELS

            # Duration hint: vowels carry the melody, consonants are transitions
            if is_vowel:
                dur = 1.2 if ph.stress.value == 1 else (1.0 if ph.stress.value == 2 else 0.8)
            else:
                dur = 0.25  # consonants are quick

            tokens.append(SynthToken(
                phoneme=sym,
                display=sym,
                duration_hint=dur,
                beat_weight=ph.beat_weight,
                is_vowel=is_vowel,
                stressed=(ph.stress.value == 1),
                phon_class=phon_cls,
                word_index=ph.word_index,
                syllable_index=ph.syllable_index,
                source_phoneme=ph.symbol,
                source_word=ph.source_word,
                g2p_source=ph.g2p_source,
                source_confidence=ph.source_confidence,
                mlc_confidence=ph.confidence,
            ))
            i += 1

        return tokens

    def postprocess(self, tokens: list, singability: float) -> list:
        """
        VCCV-specific: mark VC transitions.
        A VCCV bank needs to know about V→C transitions for smooth synthesis.
        We annotate them here — Melon Synth can optionally show these.
        """
        for i, tok in enumerate(tokens):
            if tok.is_vowel and i + 1 < len(tokens):
                next_tok = tokens[i+1]
                if not next_tok.is_vowel:
                    tok.vc_transition = f'{tok.phoneme} {next_tok.phoneme}'
        return tokens
