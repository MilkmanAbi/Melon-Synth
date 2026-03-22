"""
MLC Pipeline Plugin: Tone-Aware Pitch Hints
=============================================
Hook: TONE

For tone languages (Mandarin, Cantonese, Vietnamese), this plugin
reads ToneAnnotation data on each SynthToken and converts it into
concrete pitch curve shape suggestions that Melon Synth can use.

What it produces:
  - pitch_curve_hint: a list of (time_fraction, semitone_deviation) points
    that describe the recommended pitch shape for that syllable
  - A pitch_shape string that the UI can render as a visual indicator

Mandarin tone shapes (standard citation tones):
  Tone 1 (55): ___________  flat, high   → [(0, +3.0), (1, +3.0)]
  Tone 2 (35): /            rising       → [(0, -1.5), (1, +3.0)]
  Tone 3 (214):∨            low dip      → [(0, +0.5), (0.35, -2.0), (0.7, -2.0), (1, +1.0)]
  Tone 4 (51): \\           falling      → [(0, +3.5), (1, -2.0)]
  Tone 0:      .            neutral/flat → [(0, 0.0), (1, 0.0)]

These are relative to the note's own pitch — the singer's pitch
is the anchor, the deviation is the expressive curve on top of it.
All values in semitones.

Note: these are HINTS, not commands. The user always overrides.
The UI should show them as a suggested curve preview that the user
can accept, modify, or ignore.
"""
from __future__ import annotations

import sys
import logging
from pathlib import Path
from typing import Optional

log = logging.getLogger('mlc.plugin.tone')

sys.path.insert(0, str(Path(__file__).parent.parent))
from addon_base import PipelinePlugin
from core.mlc_types import (
    SynthToken, IPFPhoneme, ToneAnnotation,
    PipelineHook, AddonType, PhonemeClass,
)

# ── Pitch curve shapes per tone ────────────────────────────────────────────
# Format: list of (time_fraction, semitone_deviation)
# time_fraction: 0.0 = note start, 1.0 = note end
# semitone_deviation: relative to the note's base pitch

MANDARIN_CURVES = {
    1: [(0.0, 2.8),  (0.5, 3.0),  (1.0, 2.8)],           # high level (55)
    2: [(0.0, -1.2), (0.3, 0.0),  (0.7, 1.5), (1.0, 3.0)], # rising (35)
    3: [(0.0, 0.0),  (0.25, -0.5),(0.5, -2.0),(0.75, -2.0),(1.0, 0.5)], # dipping (214)
    4: [(0.0, 3.5),  (0.3, 2.0),  (0.7, 0.0), (1.0, -1.8)], # falling (51)
    0: [(0.0, 0.0),  (1.0, 0.0)],                          # neutral
}

CANTONESE_CURVES = {
    1: [(0.0, 3.0),  (1.0, 3.0)],                         # high level
    2: [(0.0, 1.5),  (0.5, 2.5), (1.0, 3.0)],             # high rising
    3: [(0.0, 2.0),  (1.0, 2.0)],                         # mid level
    4: [(0.0, 1.0),  (0.5, -0.5),(1.0, -1.5)],            # low falling
    5: [(0.0, -1.5), (0.5, 0.0), (1.0, 0.5)],             # low rising
    6: [(0.0, -2.0), (1.0, -2.0)],                        # low level
    0: [(0.0, 0.0),  (1.0, 0.0)],                         # neutral
}

CURVE_BY_LANGUAGE = {
    'zh-cmn': MANDARIN_CURVES,
    'zh':     MANDARIN_CURVES,
    'zh-yue': CANTONESE_CURVES,
    'yue':    CANTONESE_CURVES,
}


class ToneAwarePitchPlugin(PipelinePlugin):
    id          = 'tone_pitch_hints'
    name        = 'Tone-Aware Pitch Hints'
    description = ('Converts tone language annotations (Mandarin/Cantonese) '
                   'into pitch curve shape suggestions for Melon Synth. '
                   'Produces per-token pitch_curve_hint data.')
    author      = 'Melon Synth'
    version     = '1.0.0'
    addon_type  = AddonType.PIPELINE_PLUGIN

    hooks       = [PipelineHook.TONE]
    languages   = ['zh', 'zh-cmn', 'zh-CN', 'zh-TW', 'zh-yue', 'yue']
    priority    = 10  # run early

    def on_tone(
        self,
        tokens: list[SynthToken],
        ipf: list[IPFPhoneme],
    ) -> list[SynthToken]:
        """
        For each token that has a ToneAnnotation, generate a pitch_curve_hint
        and attach it as a custom attribute.

        The pitch_curve_hint is a list of (t, st) tuples:
          t  = time fraction within the note (0.0–1.0)
          st = semitone deviation from base pitch
        """
        for tok in tokens:
            tone = getattr(tok, 'tone', None)
            if tone is None:
                continue

            lang  = tone.language or 'zh'
            curves = CURVE_BY_LANGUAGE.get(lang, MANDARIN_CURVES)
            curve  = curves.get(tone.tone_number, curves[0])

            # Attach as pitch_curve_hint
            tok.pitch_curve_hint = curve  # type: ignore[attr-defined]

            # Also update the note field so the UI can show it
            shape_labels = {
                'flat': '—', 'rise': '↗', 'fall': '↘',
                'dip': '↓↗', 'rise-fall': '↗↘', 'fall-rise': '↘↗',
            }
            shape_sym = shape_labels.get(tone.pitch_shape, '~')
            tok.note = f'Tone {tone.tone_number} {shape_sym} ({tone.tone_name})'

        return tokens


class AutoBreathPlugin(PipelinePlugin):
    """
    Pipeline Plugin: Auto Breath Marks
    ====================================
    Hook: POST_PROCESS

    Intelligently inserts breath marks between phrases.
    A breath mark is a short silence token ('-') that UTAU singers
    use to simulate natural breath intake.

    Rules:
      - Insert breath after word-final tokens at phrase boundaries
      - Phrase boundary = gap of >1.5 beats between notes, OR
        end of a syntactic phrase (after punctuation in original)
      - Never insert two consecutive breaths
      - Never insert before the first token or after the last token
      - Breath duration: 0.3–0.5 beats
    """
    id          = 'auto_breath'
    name        = 'Auto Breath Marks'
    description = ('Inserts breath marks ("-") between phrases automatically. '
                   'Makes vocal synthesis sound more natural without manual placement.')
    author      = 'Melon Synth'
    version     = '1.0.0'
    addon_type  = AddonType.PIPELINE_PLUGIN

    hooks       = [PipelineHook.POST_PROCESS]
    languages   = []   # all languages
    priority    = 90   # run late (after everything else)

    # Configurable
    phrase_gap_beats:  float = 1.5   # gap after which to insert breath
    breath_duration:   float = 0.35
    max_tokens_before_breath: int = 12  # force breath every N tokens max

    def on_post_process(
        self,
        tokens: list[SynthToken],
        singability: float,
    ) -> list[SynthToken]:
        if not tokens:
            return tokens

        result: list[SynthToken] = []
        tokens_since_breath = 0

        for i, tok in enumerate(tokens):
            result.append(tok)
            tokens_since_breath += 1

            is_last = (i == len(tokens) - 1)
            if is_last:
                break

            next_tok = tokens[i + 1]

            # Detect phrase boundary
            is_word_end      = tok.source_word != next_tok.source_word
            is_long_gap      = (tok.duration_hint + next_tok.duration_hint) > self.phrase_gap_beats
            force_by_count   = tokens_since_breath >= self.max_tokens_before_breath
            already_breath   = (tok.phoneme == '-')

            if not already_breath and is_word_end and (is_long_gap or force_by_count):
                # Insert breath mark
                breath = SynthToken(
                    phoneme='-', display='-',
                    duration_hint=self.breath_duration,
                    beat_weight=0.0,
                    is_vowel=False, stressed=False,
                    phon_class=PhonemeClass.SILENCE,
                    word_index=tok.word_index,
                    syllable_index=tok.syllable_index,
                    source_phoneme='breath',
                    source_word='',
                    note='auto breath mark',
                )
                from core.mlc_types import TokenFlag
                breath.add_flag(TokenFlag.CODA_CLOSURE)
                result.append(breath)
                tokens_since_breath = 0

        return result


class RhythmNormalizerPlugin(PipelinePlugin):
    """
    Pipeline Plugin: Rhythm Normalizer
    ====================================
    Hook: RHYTHM

    Applies language-pack rhythm hints to SynthTokens.
    When a LanguagePack provides RhythmAnnotation per word,
    this plugin applies those overrides to the tokens.

    Also handles syllable-timed vs stress-timed language adjustment:
      - Stress-timed (English): stressed syllables get longer
      - Syllable-timed (Korean, French, Japanese): roughly equal
      - Mora-timed (Japanese): each mora is one beat unit
    """
    id          = 'rhythm_normalizer'
    name        = 'Rhythm Normalizer'
    description = ('Applies language-aware rhythm hints. Handles syllable-timed '
                   '(Korean, French) vs stress-timed (English) patterns.')
    author      = 'Melon Synth'
    version     = '1.0.0'
    addon_type  = AddonType.PIPELINE_PLUGIN

    hooks       = [PipelineHook.RHYTHM]
    languages   = []   # all languages
    priority    = 30

    SYLLABLE_TIMED = {'ko', 'ko-KR', 'fr', 'fr-FR', 'es', 'es-ES', 'it', 'tr'}
    MORA_TIMED     = {'ja', 'ja-JP'}

    def on_rhythm(self, tokens: list[SynthToken]) -> list[SynthToken]:
        # Detect language from first token's source data
        lang = ''
        for tok in tokens:
            if hasattr(tok, '_lang'):
                lang = tok._lang
                break

        if lang in self.MORA_TIMED:
            return self._apply_mora_timing(tokens)
        elif lang in self.SYLLABLE_TIMED:
            return self._apply_syllable_timing(tokens)
        else:
            return tokens  # keep default stress-timed English behaviour

    def _apply_mora_timing(self, tokens: list[SynthToken]) -> list[SynthToken]:
        """Japanese: each mora gets equal duration regardless of stress."""
        for tok in tokens:
            if tok.is_vowel or tok.phoneme in ('q', 'N', 'n'):
                tok.duration_hint = 1.0
                tok.beat_weight   = 0.7
        return tokens

    def _apply_syllable_timing(self, tokens: list[SynthToken]) -> list[SynthToken]:
        """Syllable-timed: compress the duration spread."""
        for tok in tokens:
            if tok.is_vowel:
                # Reduce the stressed/unstressed gap
                original = tok.duration_hint
                tok.duration_hint = 0.6 + (original - 0.6) * 0.4  # compress toward 0.6
                tok.beat_weight = max(tok.beat_weight * 0.7, 0.4)
        return tokens
