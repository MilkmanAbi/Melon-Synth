"""
MLC Add-on Base Classes
========================
The contract that every add-on type must implement.

Three base classes, one format (.mlc ZIP bundle):
  - LanguagePack      teaches MLC a new source language's phonology
  - PipelinePlugin    hooks into a named stage of the MLC pipeline
  - VoicebankMapper   already in registry.py as VoicebankModule

A composite add-on can contain multiple classes from multiple types —
e.g. a Korean pack that ships both a LanguagePack AND a VoicebankMapper.

The manifest.json `type` field (or `types` list for composites)
tells the registry which base classes to look for when loading.
"""
from __future__ import annotations

import sys
import logging
from pathlib import Path
from typing import Optional

log = logging.getLogger('mlc.addon')

sys.path.insert(0, str(Path(__file__).parent))
from core.mlc_types import (
    IPFPhoneme, SynthToken, MLCWarning, WarningLevel,
    G2PSource, PhonemeClass, StressLevel, Confidence,
    ToneAnnotation, RhythmAnnotation, PipelineHook, AddonType,
    TokenFlag,
)


# ══════════════════════════════════════════════════════════════════════════
#  LanguagePack
# ══════════════════════════════════════════════════════════════════════════

class LanguagePack:
    """
    Base class for language pack add-ons.

    A LanguagePack teaches MLC how to process a new source language
    before the voicebank mapping step. It handles:
      - Text normalisation (language-specific contractions, numbers)
      - Native script → phoneme decomposition (Hangul, Hanzi, kana)
      - Phonology rules (syllable structure, tone, etc.)
      - Producing IPFPhonemes in the standard format

    Language packs are called by the pipeline INSTEAD of the default
    espeak G2P when the detected language matches.

    The pipeline asks: "who handles 'ko'?" → finds this pack → calls it.
    """

    # ── Identity ──
    id:          str = 'base_langpack'
    name:        str = 'Base Language Pack'
    description: str = ''
    author:      str = ''
    version:     str = '0.1.0'
    addon_type:  AddonType = AddonType.LANGUAGE_PACK

    # ── Languages this pack handles ──
    # Must be BCP-47 language codes: 'ko', 'zh-cmn', 'zh-yue', 'ja', etc.
    handles:     list[str] = []
    # Also handles these as fallback (less specific codes)
    handles_also:list[str] = []

    # ── Capabilities ──
    # Does this pack produce tone annotations?
    has_tone:    bool = False
    # Does this pack produce rhythm hints beyond default weighting?
    has_rhythm:  bool = False
    # Does this pack use a custom phoneme set instead of ARPAbet?
    native_phonemes: bool = False

    # Set by registry after load
    data_dir: Optional[Path] = None

    def on_load(self):
        """Called once after instantiation. Load data files here."""
        pass

    def normalise(self, text: str, lang: str) -> str:
        """
        Language-specific text normalisation.
        Called before phoneme decomposition.
        Override to handle: numbers, contractions, abbreviations,
        language-specific punctuation, romanisation input, etc.
        """
        return text.strip()

    def decompose(self, text: str, lang: str) -> list[list[str]]:
        """
        THE core method. Decompose normalised text into phoneme sequences.

        Returns: list of words, each a list of ARPAbet-style symbols.
        Use ARPAbet for consonants/vowels even for non-English languages
        so the downstream voicebank mapper works uniformly.

        For tone languages: return the phonemes, then annotate tone
        separately via get_tone_annotations().

        Example Korean input: '사랑해'
        Example output: [['S','AA','R','AA','NG'],['HH','EH']]
        """
        raise NotImplementedError(f'{self.__class__.__name__}.decompose() not implemented')

    def syllabify(self, word: str, phonemes: list[str], lang: str) -> list[dict]:
        """
        Optional: override syllabification for this language.
        Returns: [{'phonemes': [...], 'stressed': bool, 'secondary': bool}]
        If not overridden, the default rule-based syllabifier is used.
        """
        return []   # empty = use default

    def get_tone_annotations(
        self,
        word: str,
        syllable_index: int,
        lang: str,
    ) -> Optional[ToneAnnotation]:
        """
        Optional: return tone annotation for a syllable.
        Only relevant for tone languages (Mandarin, Cantonese, Vietnamese).
        Called after decompose() if has_tone=True.
        """
        return None

    def get_rhythm_hints(
        self,
        words: list[str],
        phoneme_lists: list[list[str]],
        lang: str,
    ) -> list[Optional[RhythmAnnotation]]:
        """
        Optional: return rhythm annotations per word.
        Called after decompose() if has_rhythm=True.
        """
        return [None] * len(words)

    def validate_input(self, text: str, lang: str) -> list[MLCWarning]:
        """
        Optional: validate input text before processing.
        Return warnings about mixed scripts, unsupported characters, etc.
        """
        return []

    def get_info(self) -> dict:
        return {
            'id': self.id, 'name': self.name, 'description': self.description,
            'author': self.author, 'version': self.version,
            'addon_type': self.addon_type.value,
            'handles': self.handles, 'handles_also': self.handles_also,
            'has_tone': self.has_tone, 'has_rhythm': self.has_rhythm,
        }


# ══════════════════════════════════════════════════════════════════════════
#  PipelinePlugin
# ══════════════════════════════════════════════════════════════════════════

class PipelinePlugin:
    """
    Base class for pipeline plugin add-ons.

    A PipelinePlugin hooks into a specific stage of the MLC pipeline
    and can read/modify the data at that stage.

    Plugins are called in registration order. Multiple plugins can
    attach to the same hook — they run as a chain.

    Hook points:
      PRE_NORMALISE    (text: str, lang: str) → str
      POST_NORMALISE   (text: str, lang: str) → str
      POST_G2P         (phonemes: list[IPFPhoneme], words: list[str]) → list[IPFPhoneme]
      POST_MAP         (tokens: list[SynthToken], singability: float) → list[SynthToken]
      POST_PROCESS     (tokens: list[SynthToken], singability: float) → list[SynthToken]
      RHYTHM           (tokens: list[SynthToken]) → list[SynthToken]
      TONE             (tokens: list[SynthToken], ipf: list[IPFPhoneme]) → list[SynthToken]
    """

    id:         str = 'base_plugin'
    name:       str = 'Base Plugin'
    description:str = ''
    author:     str = ''
    version:    str = '0.1.0'
    addon_type: AddonType = AddonType.PIPELINE_PLUGIN

    # Which hook(s) this plugin attaches to
    hooks:      list[PipelineHook] = []

    # Which languages this plugin applies to (empty = all languages)
    languages:  list[str] = []

    # Which voicebank modules this plugin works with (empty = all)
    modules:    list[str] = []

    # Priority within the same hook (lower = runs first)
    priority:   int = 50

    data_dir: Optional[Path] = None

    def on_load(self):
        pass

    # ── Hook implementations ──
    # Override only the hooks you declared in self.hooks.
    # Unimplemented hooks are silently skipped.

    def on_pre_normalise(self, text: str, lang: str) -> str:
        return text

    def on_post_normalise(self, text: str, lang: str) -> str:
        return text

    def on_post_g2p(
        self,
        phonemes: list[IPFPhoneme],
        words: list[str],
    ) -> list[IPFPhoneme]:
        return phonemes

    def on_post_map(
        self,
        tokens: list[SynthToken],
        singability: float,
    ) -> list[SynthToken]:
        return tokens

    def on_post_process(
        self,
        tokens: list[SynthToken],
        singability: float,
    ) -> list[SynthToken]:
        return tokens

    def on_rhythm(self, tokens: list[SynthToken]) -> list[SynthToken]:
        return tokens

    def on_tone(
        self,
        tokens: list[SynthToken],
        ipf: list[IPFPhoneme],
    ) -> list[SynthToken]:
        return tokens

    def get_info(self) -> dict:
        return {
            'id': self.id, 'name': self.name, 'description': self.description,
            'author': self.author, 'version': self.version,
            'addon_type': self.addon_type.value,
            'hooks': [h.value for h in self.hooks],
            'languages': self.languages, 'modules': self.modules,
            'priority': self.priority,
        }
