"""
MLC Base Classes
================
The contract every voicebank module must implement.

Writing your own module
-----------------------
1. Create a .py file in mlc/modules/
2. Subclass VoicebankModule
3. Implement map_phonemes()
4. Drop it in — MLC will discover it automatically

The module receives a list of PhonemeToken objects (language-agnostic
ARPAbet-style phonemes with stress and syllable info) and must return
a list of SynthToken objects (the actual sounds the voicebank uses).
"""

from dataclasses import dataclass, field
from typing import Protocol


# ── Shared data types ──────────────────────────────────────────────────────

@dataclass
class PhonemeToken:
    """
    One phoneme as produced by the G2P stage.
    Language-agnostic — always ARPAbet-style symbols.
    """
    symbol: str           # ARPAbet symbol, e.g. 'K', 'AE', 'T'
    is_vowel: bool
    stress: int           # 0 = unstressed, 1 = primary, 2 = secondary
    word_index: int       # which word this came from (0-indexed)
    syllable_index: int   # which syllable within the word (0-indexed)
    is_syllable_onset: bool   # first phoneme of a syllable
    is_syllable_coda: bool    # last phoneme of a syllable
    is_word_start: bool
    is_word_end: bool
    source_text: str      # the original grapheme chunk this came from


@dataclass
class SynthToken:
    """
    One synthesis token — what actually goes into the piano roll.
    This is what the voicebank module produces.
    """
    phoneme: str          # the voicebank-specific phoneme string, e.g. 'ku', 'AE', 'sh'
    display: str          # what to show in the Lyrics lane (may differ from phoneme)
    duration_hint: float  # relative duration hint (1.0 = normal, 0.5 = short)
    is_vowel: bool
    stressed: bool
    word_index: int
    syllable_index: int
    # For CVVC banks — the transition phoneme that precedes this one
    prev_transition: str | None = None
    # Metadata the UI can use
    source_phoneme: str = ''   # the ARPAbet symbol this came from
    note: str = ''             # optional note to surface in the UI


@dataclass
class ConversionResult:
    """The full result of an MLC conversion."""
    tokens: list[SynthToken]
    words: list[str]                      # original word list
    word_boundaries: list[tuple[int,int]] # (start_token_idx, end_token_idx) per word
    language_detected: str
    module_id: str
    singability: float
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            'tokens': [
                {
                    'phoneme':          t.phoneme,
                    'display':          t.display,
                    'duration_hint':    round(t.duration_hint, 3),
                    'is_vowel':         t.is_vowel,
                    'stressed':         t.stressed,
                    'word_index':       t.word_index,
                    'syllable_index':   t.syllable_index,
                    'prev_transition':  t.prev_transition,
                    'source_phoneme':   t.source_phoneme,
                    'note':             t.note,
                }
                for t in self.tokens
            ],
            'words':            self.words,
            'word_boundaries':  self.word_boundaries,
            'language':         self.language_detected,
            'module_id':        self.module_id,
            'singability':      self.singability,
            'warnings':         self.warnings,
            'token_count':      len(self.tokens),
        }


# ── VoicebankModule base class ─────────────────────────────────────────────

class VoicebankModule:
    """
    Base class for all MLC voicebank modules.

    Each module encapsulates knowledge about a specific voicebank's
    phoneme set and how to map ARPAbet phonemes into it.

    The key method is map_phonemes() — everything else is metadata.
    """

    # ── Module metadata (override in subclass) ──

    id: str = 'base'
    name: str = 'Base Module'
    description: str = ''
    language: str = 'en'       # primary language ('en', 'ja', 'zh', 'ko', 'any')
    phoneme_set: str = ''      # e.g. 'jp_cv', 'arpabet', 'xsampa'
    version: str = '0.1.0'

    # ── Phoneme inventory ──
    # Subclasses should define this — the set of phonemes this bank supports.
    # MLC uses it to validate output and warn about unsupported sounds.
    supported_phonemes: set[str] = set()

    def map_phonemes(
        self,
        phonemes: list[PhonemeToken],
        singability: float,
    ) -> list[SynthToken]:
        """
        Map a list of ARPAbet PhonemeTokens to SynthTokens for this voicebank.

        singability: float in [0.0, 1.0]
            0.0 = prioritise phonetic accuracy (keep clusters, diphthongs, etc.)
            1.0 = prioritise singability (simplify to closest native syllables)

        This is the one method every module MUST implement.
        """
        raise NotImplementedError(
            f'Module {self.id} must implement map_phonemes()'
        )

    def postprocess(
        self,
        tokens: list[SynthToken],
        singability: float,
    ) -> list[SynthToken]:
        """
        Optional postprocessing step.
        Called after map_phonemes(). Default is a no-op.

        Use this for bank-specific rules like:
        - Inserting breath marks
        - Handling geminate consonants
        - Removing unsupported phonemes gracefully
        """
        return tokens

    def validate(self, tokens: list[SynthToken]) -> list[str]:
        """
        Validate that all output tokens are in this bank's phoneme set.
        Returns a list of warning strings (empty = all good).
        """
        if not self.supported_phonemes:
            return []
        warnings = []
        for t in tokens:
            if t.phoneme not in self.supported_phonemes:
                warnings.append(
                    f'Phoneme "{t.phoneme}" may not be in {self.name}\'s phoneme set'
                )
        return warnings
