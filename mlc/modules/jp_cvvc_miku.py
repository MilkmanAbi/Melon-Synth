# Melon Synth — MLC Engine
# Copyright (C) 2026 Abinaash (MilkmanAbi)
# SPDX-License-Identifier: GPL-3.0-or-later
# https://github.com/MilkmanAbi/Melon-Synth

"""
MLC Module: jp_cvvc_miku v1
============================
Target banks: Hatsune Miku, Miku V4X, Miku NT, and any JP CVVC voicebank
Phoneme set:  Japanese CVVC (CV + VC transition phonemes)

CVVC (Consonant-Vowel / Vowel-Consonant) banks need explicit transition
phonemes between syllables. Where jp_cv produces:

  ku → mo → no

jp_cvvc produces:

  ku → u m → mo → o n → no

The VC transition ("u m", "o n") makes the voice sound smoother and more
connected — especially important for Miku-style banks.

This module outputs vc_transition on each token so Melon Synth can
optionally insert transition notes automatically.
"""
from __future__ import annotations
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from registry import VoicebankModule
from modules.jp_cv_standard import (
    VOWEL_MAP, CONSONANT_MAP, CV_RESOLVE, DIPHTHONG_TAIL, ARPABET_VOWELS
)

# ── VC transition table ───────────────────────────────────────────────────
# Maps (vowel_char, next_consonant_char) → VC transition phoneme
# These are the "a k", "i t", "u m" etc. that CVVC banks need

def _vc(v: str, c: str) -> str:
    """Generate a VC transition string: 'a k', 'i t', etc."""
    return f'{v} {c}'


class JPCVVCMikuModule(VoicebankModule):
    id           = 'jp_cvvc_miku'
    name         = 'Japanese CVVC — Miku Style'
    description  = ('Maps English to JP CVVC phonemes for Hatsune Miku and '
                    'compatible CVVC voicebanks. Includes VC transition phonemes '
                    'for smooth syllable connections.')
    author       = 'Melon Synth'
    version      = '1.0.0'
    language     = 'en'
    languages    = ['en', 'ja']
    phoneme_set  = 'jp_cvvc'
    target_banks = ['Hatsune Miku', 'Miku V4X', 'Miku NT', 'any JP CVVC bank']

    singability_default = 0.60
    singability_notes   = '0.6 balances accuracy with natural flow for CVVC banks'

    # All CV phonemes + VC transitions
    supported_phonemes = (
        set(CV_RESOLVE.values())
        | {f'{v} {c}' for v in 'aeiou'
           for c in ['k','s','t','n','h','m','r','g','z','d','b','p','sh','ch','ts','f','j','w','y']}
        | {'n','N','-','R','a','i','u','e','o'}
    )

    def map_phonemes(self, phonemes: list, singability: float) -> list:
        from core.mlc_types import SynthToken, PhonemeClass, Confidence

        # First pass: generate CV tokens same as standard module
        from modules.jp_cv_standard import JPCVStandardModule
        cv_mod = JPCVStandardModule()
        cv_tokens = cv_mod.map_phonemes(phonemes, singability)
        cv_tokens = cv_mod.postprocess(cv_tokens, singability)

        # Second pass: insert VC transitions between syllables
        result = []
        for i, tok in enumerate(cv_tokens):
            result.append(tok)

            # After a vowel-ending token, if the next token starts with a consonant,
            # insert a VC transition
            if i + 1 < len(cv_tokens):
                next_tok = cv_tokens[i+1]
                cur_ends_vowel = tok.phoneme and tok.phoneme[-1] in 'aeiou'
                next_starts_cons = next_tok.phoneme and next_tok.phoneme[0] not in 'aeiouAEIOU'

                if cur_ends_vowel and next_starts_cons and next_tok.word_index == tok.word_index:
                    last_vowel = tok.phoneme[-1]
                    first_cons = next_tok.phoneme[0]
                    # Multi-char consonants like 'sh', 'ch', 'ts'
                    if len(next_tok.phoneme) >= 2 and next_tok.phoneme[:2] in ('sh','ch','ts'):
                        first_cons = next_tok.phoneme[:2]
                    vc = _vc(last_vowel, first_cons)
                    result.append(SynthToken(
                        phoneme=vc, display=vc,
                        duration_hint=0.20, beat_weight=0.05,
                        is_vowel=False, stressed=False,
                        phon_class=PhonemeClass.LIQUID,
                        word_index=tok.word_index,
                        syllable_index=tok.syllable_index,
                        source_phoneme='',
                        source_word=tok.source_word,
                        vc_transition=vc,
                        note='CVVC transition',
                    ))

        return result

    def postprocess(self, tokens: list, singability: float) -> list:
        # No additional postprocessing needed — standard module handled it
        return tokens
