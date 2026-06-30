# Melon Synth — MLC Engine
# Copyright (C) 2026 Abinaash (MilkmanAbi)
# SPDX-License-Identifier: GPL-3.0-or-later
# https://github.com/MilkmanAbi/Melon-Synth

"""
MLC Confidence Scorer v2
========================
Fixes from review:
  - Uses token.g2p_source (structured enum, no string sniffing)
  - Uses token.source_confidence (separate from mlc_confidence)
  - Phoneme-type-weighted penalties (vowel mismatch ≠ consonant mismatch)
  - Weighted overall score (stressed tokens count more)
  - TokenFlag tagging (LOSSY, FALLBACK_ARTIFACT, APPROXIMATED)
"""
from __future__ import annotations
import logging
from core.mlc_types import (
    SynthToken, MLCWarning, WarningLevel,
    G2PSource, TokenFlag, PhonemeClass
)

log = logging.getLogger('mlc.confidence')

# Top-5000 English word frequency bucket (simplified)
# Words here get a confidence boost. Not binary — we use a tier.
_FREQ_HIGH = {
    'the','a','an','i','you','he','she','it','we','they','my','your','his','her',
    'our','their','this','that','is','are','was','were','be','been','have','has',
    'had','do','does','did','will','would','can','could','should','not','and','or',
    'but','so','if','when','where','what','who','how','why','love','heart','dream',
    'night','day','time','life','world','light','dark','sky','fly','cry','run',
    'come','go','see','know','feel','want','need','give','make','say','sing',
    'beautiful','wonderful','together','forever','never','always','every','only',
    'still','just','even','back','here','there','now','then','again','before',
    'after','through','away','down','up','out','over','under','around','between',
}

_FREQ_MID = {
    'fire','rain','sun','moon','star','wind','sea','ocean','mountain','river',
    'flower','tree','road','path','hope','faith','trust','breath','voice','song',
    'dance','walk','rise','fall','hold','keep','turn','find','start','show',
    'hear','play','fight','stand','reach','carry','remember','forget','believe',
    'broken','golden','silver','shadow','wonder','shining','calling','running',
    'falling','searching','waiting','tonight','yesterday','someday','tomorrow',
}

# Per-phoneme-class penalty weights
# The review was right: not all mismatches are equal.
_CLASS_PENALTY = {
    PhonemeClass.VOWEL:     0.25,  # vowel mismatch: audible but not catastrophic
    PhonemeClass.STOP:      0.20,  # stop mismatch: noticeable
    PhonemeClass.FRICATIVE: 0.22,
    PhonemeClass.AFFRICATE: 0.22,
    PhonemeClass.NASAL:     0.18,  # nasal mismatch: fairly tolerable
    PhonemeClass.LIQUID:    0.15,  # L→R in JP is standard, low penalty
    PhonemeClass.GLIDE:     0.15,
    PhonemeClass.SILENCE:   0.0,
    PhonemeClass.UNKNOWN:   0.30,  # unknown is concerning
}

# EN→JP lossy mapping: which source ARPAbet phonemes are inherently lossy
_EN_JP_LOSSY: dict[str, dict] = {
    'TH': {'msg':'"th" (think) → "s" — no θ in Japanese','tip':'Standard substitution, sounds fine at singing speed'},
    'DH': {'msg':'"th" (the) → "z" — no ð in Japanese','tip':'Standard, accepted in J-pop style'},
    'V':  {'msg':'"v" → "b" (singable) or "v" (accurate) — JP support varies','tip':'Check if your bank has a v phoneme'},
    'L':  {'msg':'"l" → "r" — no L in Japanese','tip':'Standard and natural. Listeners accept it'},
    'ER': {'msg':'R-coloured vowel → "a" — no equivalent in Japanese','tip':'Sounds natural in J-pop style'},
    'AW': {'msg':'"ow" diphthong collapses at high singability','tip':'Lower singability to keep both vowel sounds'},
    'AY': {'msg':'"i" diphthong collapses at high singability','tip':'Lower singability to preserve the diphthong'},
    'OY': {'msg':'"oy" diphthong collapses at high singability','tip':'Lower singability to preserve the diphthong'},
    'ZH': {'msg':'"zh" (measure) → "z" — no ZH in Japanese','tip':'Standard substitution'},
}


class ConfidenceScorer:
    """
    Assigns mlc_confidence and flags to each SynthToken.
    Uses structured provenance fields — no string sniffing.
    """

    def score(
        self,
        tokens:              list[SynthToken],
        module_supported:    set[str],
        source_lang:         str,
        target_phoneme_set:  str,
    ) -> tuple[list[SynthToken], list[MLCWarning], float]:
        """
        Returns (scored_tokens, warnings, overall_score).
        Modifies tokens in-place.
        """
        warnings: list[MLCWarning] = []
        weighted_scores: list[tuple[float, float]] = []  # (score, weight)

        for token in tokens:
            score, tok_warnings = self._score_one(
                token, module_supported, source_lang, target_phoneme_set
            )
            # Weight: stressed vowels matter more for overall quality perception
            weight = 2.0 if (token.stressed and token.is_vowel) else 1.0
            weighted_scores.append((score, weight))
            warnings.extend(tok_warnings)

            token.mlc_confidence = round(max(0.0, min(1.0, score)), 3)

        # Weighted average — stressed tokens influence overall more
        if weighted_scores:
            total_weight = sum(w for _, w in weighted_scores)
            overall = sum(s * w for s, w in weighted_scores) / total_weight
        else:
            overall = 0.0

        # Deduplicate warnings by (code, word)
        seen = set()
        deduped = []
        for w in warnings:
            key = (w.code, w.word, w.phoneme)
            if key not in seen:
                seen.add(key)
                deduped.append(w)

        return tokens, deduped, overall

    def _score_one(
        self,
        token:             SynthToken,
        supported:         set[str],
        source_lang:       str,
        target_phoneme_set:str,
    ) -> tuple[float, list[MLCWarning]]:

        score    = 0.75   # baseline: assume OK unless proven otherwise
        warnings = []

        # ── 1. G2P source quality (structured, no string sniffing) ─────────
        src_bonus = {
            G2PSource.CMUDICT:  +0.18,   # very reliable
            G2PSource.ESPEAK:   +0.12,   # reliable
            G2PSource.CACHED:   +0.10,   # same as source, just cached
            G2PSource.MANUAL:   +0.20,   # user said so, trust completely
            G2PSource.RULES:    -0.10,   # fallback, less reliable
            G2PSource.PASSTHRU: -0.20,   # last resort
        }
        score += src_bonus.get(token.g2p_source, 0.0)

        # ── 2. Propagate source_confidence (separate, no feedback loop) ────
        # Blend: 70% MLC's assessment, 30% backend's own confidence
        score = score * 0.70 + token.source_confidence * 0.30

        # ── 3. Fallback artifact flag ──────────────────────────────────────
        if token.has_flag(TokenFlag.FALLBACK_ARTIFACT):
            score -= 0.15
            warnings.append(MLCWarning(
                level=WarningLevel.WARNING,
                code='FALLBACK_ARTIFACT',
                message=f'G2P fallback produced a suspect phoneme cluster for "{token.source_word}"',
                word=token.source_word,
                phoneme=token.source_phoneme,
                suggestion='Install espeak-ng for significantly better quality on this word',
            ))

        if token.has_flag(TokenFlag.CLUSTER_REPAIRED):
            score -= 0.08  # small penalty — we fixed it, but it was wrong
            token.note = token.note + ' (cluster repaired)' if token.note else 'cluster repaired'

        # ── 4. Phoneme support check (class-weighted penalty) ──────────────
        if supported and token.phoneme not in supported:
            penalty = _CLASS_PENALTY.get(token.phon_class, 0.25)
            score -= penalty
            warnings.append(MLCWarning(
                level=WarningLevel.WARNING,
                code='UNSUPPORTED_PHONEME',
                message=f'"{token.phoneme}" may not be in this voicebank\'s phoneme set',
                word=token.source_word,
                phoneme=token.phoneme,
                suggestion='Check your voicebank phoneme list or adjust singability',
            ))

        # ── 5. Word frequency tier (boost, not binary) ────────────────────
        w = token.source_word.lower()
        if w in _FREQ_HIGH:
            score += 0.10
        elif w in _FREQ_MID:
            score += 0.05

        # ── 6. Cross-language lossy mapping ───────────────────────────────
        if source_lang.startswith('en') and target_phoneme_set.startswith('jp'):
            lossy = _EN_JP_LOSSY.get(token.source_phoneme)
            if lossy and not token.has_flag(TokenFlag.DIPHTHONG_TAIL):
                score -= 0.08
                token.add_flag(TokenFlag.LOSSY)
                warnings.append(MLCWarning(
                    level=WarningLevel.INFO,
                    code='LOSSY_MAPPING',
                    message=lossy['msg'],
                    word=token.source_word,
                    phoneme=token.source_phoneme,
                    suggestion=lossy['tip'],
                ))

        # ── 7. Clamp to [0, 1] ────────────────────────────────────────────
        return max(0.0, min(1.0, score)), warnings
