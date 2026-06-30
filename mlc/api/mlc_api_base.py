"""
MLC API — Base Classes v2.0
============================
The complete set of base classes addon developers subclass.
Every public method here is stable API — we never remove or rename them.
"""
from __future__ import annotations
import sys
import logging
from pathlib import Path
from typing import Optional, Any

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent / 'core'))

from core.mlc_types import (
    IPFPhoneme, SynthToken, MLCWarning, WarningLevel,
    PipelineHook, AddonType, PhonemeClass, ToneAnnotation, RhythmAnnotation,
)
from mlc_api_types import (
    AddonManifest, AddonCapabilities, WordOverrideEntry,
    PhonemeSetSpec, VoiceProfileSpec, MLCEvent, MLCEventType, MLCContext,
)

log = logging.getLogger('mlc.api')


# ══════════════════════════════════════════════════════════════════════════════
#  AddonBase — every addon inherits from this
# ══════════════════════════════════════════════════════════════════════════════

class AddonBase:
    """
    Base class for ALL MLC addon types.
    Provides: lifecycle hooks, event system, word overrides, logging.
    """

    # ── Identity (MUST override in your class) ────────────────────────────
    id:          str = 'my_addon'
    name:        str = 'My Addon'
    description: str = ''
    author:      str = ''
    version:     str = '1.0.0'
    license:     str = 'MIT'
    homepage:    str = ''

    # ── Set by the registry after loading ────────────────────────────────
    manifest:    Optional[AddonManifest] = None
    data_dir:    Optional[Path]          = None   # path to data/ inside your bundle
    install_dir: Optional[Path]          = None   # where your bundle was extracted

    # ── Subclasses override this ───────────────────────────────────────────
    addon_type:  str = 'base'

    def __init__(self):
        self._log = logging.getLogger(f'mlc.addon.{self.id}')
        self._event_handlers: dict[MLCEventType, list] = {}

    # ── Lifecycle ──────────────────────────────────────────────────────────

    def on_load(self) -> None:
        """
        Called once when your addon is loaded into the registry.
        Use this to load data files, build lookup tables, validate config.
        Raise an exception to abort loading (the registry catches it and logs).
        """
        pass

    def on_unload(self) -> None:
        """Called when your addon is removed or the engine shuts down."""
        pass

    def on_reload(self) -> None:
        """Called when your addon is hot-reloaded (e.g. after update)."""
        self.on_unload()
        self.on_load()

    # ── Word-level overrides ───────────────────────────────────────────────

    def get_word_overrides(self) -> list[WordOverrideEntry]:
        """
        Return a list of word-level phoneme overrides.
        
        These bypass G2P entirely for the specified words and return your
        phonemes directly. Runs BEFORE any G2P processing.
        
        Override this to fix G2P mistakes, handle proper nouns, or tune
        specific words that your voicebank handles differently.
        
        Example:
            def get_word_overrides(self):
                return [
                    WordOverrideEntry('beautiful', ['byu','ti','fu','ru']),
                    WordOverrideEntry('love',      ['ro','bu'],    note='Teto sounds better with ro-bu than ra-bu'),
                    WordOverrideEntry('the',       ['za'],         language='en', priority=10),
                ]
        """
        return []

    def get_word_override(self, word: str, language: str) -> Optional[list[str]]:
        """
        Look up a single word override. Called by the pipeline per word.
        Override get_word_overrides() for bulk declaration, or this method
        for dynamic lookup (e.g. from a large dictionary file).
        
        Return None to let G2P handle the word normally.
        """
        for entry in self.get_word_overrides():
            if entry.word.lower() == word.lower():
                if entry.language in ('*', language):
                    return entry.phonemes
        return None

    # ── Event subscription ─────────────────────────────────────────────────

    def on(self, event_type: MLCEventType, handler) -> None:
        """Subscribe to an MLC event."""
        if event_type not in self._event_handlers:
            self._event_handlers[event_type] = []
        self._event_handlers[event_type].append(handler)

    def dispatch(self, event: MLCEvent) -> None:
        """Called by the engine when an event fires. Do not call directly."""
        for handler in self._event_handlers.get(event.type, []):
            try:
                handler(event)
            except Exception as e:
                self._log.warning(f'Event handler error: {e}')

    # ── Data helpers ───────────────────────────────────────────────────────

    def load_json(self, filename: str) -> Any:
        """Load a JSON file from your bundle's data/ directory."""
        import json
        if not self.data_dir:
            raise FileNotFoundError('No data_dir set — addon not loaded from bundle?')
        path = self.data_dir / filename
        with open(path, encoding='utf-8') as f:
            return json.load(f)

    def data_path(self, filename: str) -> Path:
        """Get path to a file in your bundle's data/ directory."""
        if not self.data_dir:
            raise FileNotFoundError('No data_dir set')
        return self.data_dir / filename

    # ── Info ──────────────────────────────────────────────────────────────

    def get_info(self) -> dict:
        return {
            'id': self.id, 'name': self.name, 'version': self.version,
            'description': self.description, 'author': self.author,
            'license': self.license, 'homepage': self.homepage,
            'addon_type': self.addon_type,
        }


# ══════════════════════════════════════════════════════════════════════════════
#  LanguagePack v2
# ══════════════════════════════════════════════════════════════════════════════

class LanguagePack(AddonBase):
    """
    Teaches MLC how to process a new source language.
    
    When MLC detects your language in the input text, it calls your pack
    instead of the built-in espeak G2P. You convert text → IPFPhonemes.
    
    Quick start — Korean example:
    
        class KoreanPack(LanguagePack):
            id      = 'ko_hangul'
            name    = 'Korean Hangul'
            handles = ['ko']
            
            def text_to_phonemes(self, text, lang, context):
                words = text.split()
                result = []
                for word in words:
                    phonemes = self.decompose_hangul(word)
                    result.append(phonemes)
                return result
            
            def decompose_hangul(self, word):
                # your Hangul decomposition here
                ...
    """
    addon_type = 'language_pack'

    # Languages this pack handles (ISO 639-1 codes)
    # ['ko'] = only Korean, ['zh', 'zh-tw'] = Mandarin + Traditional
    handles:      list[str] = []
    handles_also: list[str] = []   # secondary languages (lower priority)

    # Whether this language uses tones (Mandarin, Cantonese, Vietnamese, Thai)
    has_tone:     bool = False
    # Whether this language needs rhythm annotations
    has_rhythm:   bool = False
    # Whether this language is right-to-left
    is_rtl:       bool = False
    # Script name (for display)
    script:       str  = ''

    # ── Core API (must implement) ──────────────────────────────────────────

    def text_to_phonemes(
        self,
        text:    str,
        lang:    str,
        context: MLCContext,
    ) -> list[list[str]]:
        """
        Convert text to phonemes.
        
        Args:
            text:    The input text (normalised, whitespace-separated words)
            lang:    The detected language code
            context: Conversion context (singability, module_id, etc.)
        
        Returns:
            List of word-level phoneme lists.
            [ ['ko', 'n', 'ni', 'chi', 'wa'],   # word 1
              ['yo', 'ro', 'shi', 'ku'],         # word 2
              ... ]
        
        Each inner list is the phonemes for one word, in order.
        Use standard IPA-ish notation — the voicebank mapper converts
        your phonemes to bank-specific ones.
        """
        raise NotImplementedError(f'{self.__class__.__name__}.text_to_phonemes() not implemented')

    # ── Optional overrides ─────────────────────────────────────────────────

    def normalise(self, text: str, lang: str) -> str:
        """
        Pre-process text before phoneme conversion.
        Handle script-specific normalisation (numbers, punctuation, etc.)
        Default: return text unchanged.
        """
        return text

    def detect_script(self, text: str) -> Optional[str]:
        """
        Detect which script variant is used (e.g. 'traditional' vs 'simplified').
        Return None to use the default.
        """
        return None

    def syllabify(
        self,
        word:     str,
        phonemes: list[str],
        lang:     str,
    ) -> list[dict]:
        """
        Optional: split phonemes into syllables with stress marking.
        Returns: [{'phonemes': [...], 'stressed': bool, 'secondary': bool}]
        Return [] to use MLC's default syllabifier.
        """
        return []

    def get_tone(self, word: str, syllable_idx: int, lang: str) -> Optional[ToneAnnotation]:
        """For tonal languages: return tone for a syllable. Return None = no tone."""
        return None

    def validate_input(self, text: str, lang: str) -> list[MLCWarning]:
        """Check for unsupported characters, mixed scripts, etc."""
        return []


# ══════════════════════════════════════════════════════════════════════════════
#  VoicebankMapper v2
# ══════════════════════════════════════════════════════════════════════════════

class VoicebankMapper(AddonBase):
    """
    Maps MLC's internal IPF phonemes to a specific voicebank's phoneme set.
    
    This is where you handle the voicebank-specific quirks:
    - Kasane Teto's CV phoneme set has these entries...
    - Utane Uta's CVVC has different transition phonemes...
    - Your custom bank uses a completely different naming scheme...
    
    Quick start:
    
        class UtaneMapper(VoicebankMapper):
            id           = 'jp_cv_utane'
            name         = 'Utane Uta CV Optimiser'
            phoneme_set  = 'jp_cv'
            target_banks = ['Utane Uta', 'Defoko']
            
            # Override words that G2P gets wrong specifically for Utane
            def get_word_overrides(self):
                return [
                    WordOverrideEntry('love', ['ro', 'bu'], note='Sounds better on Utane'),
                ]
            
            # Override phoneme mapping for Utane-specific quirks
            def map_phoneme(self, ipf_phoneme, context):
                if ipf_phoneme.symbol == 'l':
                    return 'ra'  # Utane's l→ra sounds slightly different
                return None  # use default mapping
    """
    addon_type   = 'voicebank_mapper'

    # The phoneme set this mapper outputs (must match voicebank's oto.ini)
    phoneme_set:  str       = ''

    # Voicebank names this mapper is tuned for (used for auto-selection)
    # Empty = works with any bank using this phoneme_set
    target_banks: list[str] = []

    # Complete list of phonemes in this mapper's output set
    supported_phonemes: set[str] = set()

    # ── Core API ──────────────────────────────────────────────────────────

    def map_phonemes(
        self,
        phonemes:    list[IPFPhoneme],
        singability: float,
        context:     MLCContext,
    ) -> list[SynthToken]:
        """
        Map IPF phonemes to SynthTokens for your voicebank.
        
        Args:
            phonemes:    List of IPFPhoneme from G2P
            singability: 0.0 (accurate) to 1.0 (singable)
            context:     Conversion context
        
        Returns:
            List of SynthToken with bank-specific phoneme strings.
        
        This is the core of your mapper. You decide:
          - How many output tokens per input phoneme (consonant clusters → single CV)
          - Which voicebank phoneme string to use
          - How to handle diphthongs, long vowels, special cases
        """
        raise NotImplementedError(f'{self.__class__.__name__}.map_phonemes() not implemented')

    # ── Optional per-phoneme override ────────────────────────────────────

    def map_phoneme(
        self,
        phoneme: IPFPhoneme,
        context: MLCContext,
    ) -> Optional[str]:
        """
        Override a single phoneme mapping.
        Return the bank phoneme string, or None to use the default table.
        
        This is called for EACH phoneme before the main map_phonemes() logic.
        Use it for targeted corrections without reimplementing the whole mapper.
        
        Example:
            def map_phoneme(self, phoneme, context):
                # Utane's 'l' sounds better as 'ra'
                if phoneme.symbol == 'l':
                    return 'ra'
                # High notes — use 'hu' instead of 'fu' for Utane
                if phoneme.symbol == 'f' and context.extra.get('avg_pitch', 60) > 72:
                    return 'hu'
                return None  # use default
        """
        return None

    def postprocess(
        self,
        tokens:      list[SynthToken],
        singability: float,
        context:     MLCContext,
    ) -> list[SynthToken]:
        """
        Final pass after mapping. Fix up the token sequence.
        Useful for: CVVC transitions, illegal clusters, breath marks.
        """
        return tokens

    def validate_output(self, tokens: list[SynthToken]) -> list[MLCWarning]:
        """Check that output phonemes are all in supported_phonemes."""
        warnings = []
        unsupported = {t.phoneme for t in tokens if t.phoneme not in self.supported_phonemes and self.supported_phonemes}
        for ph in unsupported:
            warnings.append(MLCWarning(
                level=WarningLevel.WARNING,
                code='UNSUPPORTED_PHONEME',
                message=f'"{ph}" is not in {self.id} phoneme set',
                word='', phoneme=ph,
                suggestion='Check your oto.ini or choose a different mapper',
            ))
        return warnings

    def get_voice_profile(self) -> Optional[VoiceProfileSpec]:
        """
        Optional: return a voice profile for your target voicebank.
        Shown in the UI as recommended settings.
        """
        return None


# ══════════════════════════════════════════════════════════════════════════════
#  PipelinePlugin v2
# ══════════════════════════════════════════════════════════════════════════════

class PipelinePlugin(AddonBase):
    """
    Hooks into MLC pipeline stages to read or modify conversion data.
    
    Unlike LanguagePack and VoicebankMapper which handle specific inputs/outputs,
    a PipelinePlugin can touch ALL conversions (or filter by language/module).
    
    Quick start — a plugin that adds breath marks every 4 syllables:
    
        class AutoBreath(PipelinePlugin):
            id       = 'auto_breath'
            name     = 'Auto Breath Marks'
            hooks    = [PipelineHook.POST_MAP]
            priority = 30
            
            def on_post_map(self, tokens, singability, context):
                result = []
                for i, tok in enumerate(tokens):
                    result.append(tok)
                    if tok.is_vowel and i > 0 and i % 8 == 0:
                        result.append(SynthToken(
                            phoneme='br', display='BR',
                            duration_hint=0.2, is_vowel=False,
                            ...
                        ))
                return result
    """
    addon_type = 'pipeline_plugin'

    # Which hooks to attach to (declare all hooks you implement)
    hooks:     list[PipelineHook] = []
    # Filter: only run for these languages (empty = all)
    languages: list[str]          = []
    # Filter: only run for these module IDs (empty = all)
    modules:   list[str]          = []
    # Priority: lower number = runs earlier in the chain (default 50)
    priority:  int                 = 50

    def _matches(self, context: MLCContext) -> bool:
        """Internal: check if this plugin applies to the current context."""
        if self.languages and context.language not in self.languages:
            return False
        if self.modules and context.module_id not in self.modules:
            return False
        return True

    # ── Hook implementations — override the ones you declared ─────────────

    def on_pre_normalise(self, text: str, lang: str, context: MLCContext) -> str:
        """Before text cleaning. Return modified text."""
        return text

    def on_post_normalise(self, text: str, lang: str, context: MLCContext) -> str:
        """After text cleaning, before G2P. Return modified text."""
        return text

    def on_post_g2p(
        self,
        phonemes: list[IPFPhoneme],
        words:    list[str],
        context:  MLCContext,
    ) -> list[IPFPhoneme]:
        """After G2P. Can rewrite IPF phonemes. Return modified list."""
        return phonemes

    def on_post_map(
        self,
        tokens:      list[SynthToken],
        singability: float,
        context:     MLCContext,
    ) -> list[SynthToken]:
        """After voicebank mapping. Can insert/remove/modify tokens."""
        return tokens

    def on_post_process(
        self,
        tokens:      list[SynthToken],
        singability: float,
        context:     MLCContext,
    ) -> list[SynthToken]:
        """Final pass. Return the finished token sequence."""
        return tokens

    def on_rhythm(self, tokens: list[SynthToken], context: MLCContext) -> list[SynthToken]:
        """Modify duration_hint and beat_weight per token."""
        return tokens

    def on_tone(
        self,
        tokens:  list[SynthToken],
        ipf:     list[IPFPhoneme],
        context: MLCContext,
    ) -> list[SynthToken]:
        """Annotate tokens with tone data (for tonal languages)."""
        return tokens


# ══════════════════════════════════════════════════════════════════════════════
#  VoiceProfile — standalone profile addon
# ══════════════════════════════════════════════════════════════════════════════

class VoiceProfile(AddonBase):
    """
    A standalone voice profile for a specific voicebank.
    
    Install this and Melon Synth auto-applies the optimal settings when
    you select the matching voicebank. Shows recommended sliders, warns
    about known problem words, and provides phoneme corrections.
    
    Example — Utane Uta profile:
    
        class UtaneProfile(VoiceProfile):
            id             = 'profile_utane_uta'
            name           = 'Utane Uta Voice Profile'
            target_banks   = ['Utane Uta', 'Defoko']
            
            def get_profile(self):
                return VoiceProfileSpec(
                    voicebank_id='utane_uta',
                    voicebank_name='Utane Uta',
                    optimal_breathiness=32,
                    optimal_tension=58,
                    phoneme_corrections={'ra': 'la', 'ri': 'li'},
                    notes='Keep tension below 65. Breathiness at 32 suits her natural tone.',
                )
    """
    addon_type   = 'voice_profile'
    target_banks: list[str] = []

    def get_profile(self) -> VoiceProfileSpec:
        raise NotImplementedError(f'{self.__class__.__name__}.get_profile() not implemented')


# ══════════════════════════════════════════════════════════════════════════════
#  PhonemeSet — declare a new phoneme set
# ══════════════════════════════════════════════════════════════════════════════

class PhonemeSet(AddonBase):
    """
    Declares a new phoneme set that other addons can target.
    
    Ship this if you're creating mappers for a non-standard voicebank.
    Other addon developers can then declare `target_phoneme_set = 'your_set_id'`
    and Melon Synth routes correctly.
    """
    addon_type = 'phoneme_set'

    def get_spec(self) -> PhonemeSetSpec:
        raise NotImplementedError(f'{self.__class__.__name__}.get_spec() not implemented')


# ══════════════════════════════════════════════════════════════════════════════
#  CompositeAddon — multiple types in one .mlc
# ══════════════════════════════════════════════════════════════════════════════

class CompositeAddon(AddonBase):
    """
    Ships multiple addon types in a single .mlc bundle.
    
    Use this when your addon naturally combines concerns:
    - A Korean pack that ships BOTH the LanguagePack AND a jp_cv mapper
    - A Utane bundle with a VoicebankMapper, VoiceProfile, and word overrides
    - A plugin that also declares a new phoneme set
    
    Example:
    
        class KoreanForTeto(CompositeAddon):
            id   = 'ko_for_teto'
            name = 'Korean for Kasane Teto'
            
            class Language(LanguagePack):
                handles = ['ko']
                def text_to_phonemes(self, text, lang, context): ...
            
            class Mapper(VoicebankMapper):
                phoneme_set  = 'jp_cv'
                target_banks = ['Kasane Teto']
                def map_phonemes(self, phonemes, singability, context): ...
            
            def get_components(self):
                return [self.Language(), self.Mapper()]
    """
    addon_type = 'composite'

    def get_components(self) -> list[AddonBase]:
        """Return all component addons in this composite."""
        raise NotImplementedError(f'{self.__class__.__name__}.get_components() not implemented')


# ══════════════════════════════════════════════════════════════════════════════
#  WordOverride — first-class type (checked BEFORE G2P)
# ══════════════════════════════════════════════════════════════════════════════

class WordOverride(AddonBase):
    """
    Bypasses G2P for specific words. Highest priority in the pipeline.
    Checked BEFORE G2P runs. If your override matches, G2P is skipped entirely.

    Simple usage — static table:
        class MyOverrides(WordOverride):
            id = 'my_overrides'
            overrides = {
                'love':      ['ro', 'bu'],
                'beautiful': ['byu', 'ti', 'fu', 'ru'],
            }

    Advanced usage — dynamic per-word context:
        def get_override(self, word, context):
            if word == 'a' and context.next_word[:1] in 'aeiou':
                return ['a']  # lengthened 'a' before vowel
            return None  # fall through to G2P
    """
    addon_type    = 'word_override'

    for_modules:  list[str] = []   # empty = applies to all voicebank modules
    for_languages:list[str] = []   # empty = applies to all source languages
    priority:     int        = 50  # lower = checked first

    # Static table — override in your subclass OR populate in on_load()
    # Keys are lowercase words. Values are phoneme lists in the TARGET phoneme set.
    overrides:    dict = {}

    def get_overrides(self) -> dict[str, list[str]]:
        """Return the complete static override table. Cached after first call."""
        return self.overrides

    def get_override(self, word: str, context: 'OverrideContext') -> Optional[list[str]]:
        """
        Dynamic lookup. Return phonemes if overriding, None to fall through to G2P.
        Default: checks self.get_overrides() table.
        Override this for context-aware decisions.
        """
        table = self.get_overrides()
        return table.get(word.lower())

    def matches(self, module_id: str, language: str) -> bool:
        """Internal: does this override apply to this module/language?"""
        if self.for_modules and module_id not in self.for_modules:
            return False
        if self.for_languages and language not in self.for_languages:
            return False
        return True


# ══════════════════════════════════════════════════════════════════════════════
#  PhonemeCorrector — runs AFTER G2P, BEFORE voicebank mapping
# ══════════════════════════════════════════════════════════════════════════════

class PhonemeCorrector(AddonBase):
    """
    Post-G2P IPF rewriter. Sees the full phoneme sequence across all words.
    Can rewrite, insert, delete, or reorder phonemes.

    Distinct from PipelinePlugin.on_post_g2p() because:
    - Has dedicated priority ordering separate from plugins
    - Focused API — only does phoneme correction, nothing else
    - Cleaner for addon devs: one method to implement, clear contract

    Use cases:
        - Fix G2P errors for a specific accent or dialect
        - Handle English liaison ('an apple' → vowel linking)
        - Simplify phoneme clusters a voicebank can't handle
        - Add connective phonemes between words
    """
    addon_type    = 'phoneme_corrector'
    for_modules:  list[str] = []
    for_languages:list[str] = []
    priority:     int        = 50

    def correct(self, phonemes: list, words: list[str],
                lang: str, module_id: str) -> list:
        """
        Rewrite the IPF phoneme list. Return the modified list.
        Can be same length, shorter, or longer than input.
        Mark changed phonemes with TokenFlag.PHONEME_CORRECTED if possible.
        """
        raise NotImplementedError(f'{self.__class__.__name__}.correct() not implemented')

    def matches(self, module_id: str, language: str) -> bool:
        if self.for_modules and module_id not in self.for_modules:
            return False
        if self.for_languages and language not in self.for_languages:
            return False
        return True


# ══════════════════════════════════════════════════════════════════════════════
#  OutputPostprocessor — runs AFTER voicebank mapping AND module.postprocess()
# ══════════════════════════════════════════════════════════════════════════════

class OutputPostprocessor(AddonBase):
    """
    Final-layer SynthToken rewriter. Last chance before output.
    Distinct from PipelinePlugin.on_post_process() for the same reasons
    as PhonemeCorrector above — dedicated type, dedicated priority, clear contract.

    Use cases:
        - Voicebank-specific timing quirks (shorten certain consonants for Utane)
        - Add geminate markers for phoneme combos
        - Insert breathing marks at specific positions
        - Adjust duration hints based on musical context
    """
    addon_type    = 'output_postprocessor'
    for_modules:  list[str] = []
    for_languages:list[str] = []
    priority:     int        = 50

    def postprocess(self, tokens: list, context: 'PostprocessContext') -> list:
        """
        Modify the final SynthToken list. Return the modified list.
        context.module_id, .singability, .language, .original_words, .bpm
        """
        raise NotImplementedError(f'{self.__class__.__name__}.postprocess() not implemented')

    def matches(self, module_id: str, language: str) -> bool:
        if self.for_modules and module_id not in self.for_modules:
            return False
        if self.for_languages and language not in self.for_languages:
            return False
        return True


# ══════════════════════════════════════════════════════════════════════════════
#  CustomG2P — complete G2P replacement for a language
# ══════════════════════════════════════════════════════════════════════════════

class CustomG2P(AddonBase):
    """
    Complete G2P replacement for one or more languages.
    When a CustomG2P handles a language, MLC's built-in G2P is bypassed entirely.

    Difference from LanguagePack:
      - LanguagePack.text_to_phonemes() returns raw string lists (simpler API)
      - CustomG2P.transcribe() returns a full G2PResult with confidence/warnings
      - CustomG2P.can_handle() enables per-word fallback to built-in G2P
      - Multiple CustomG2Ps for the same language: priority wins

    Use cases:
        - High-quality offline Japanese G2P using Open JTalk
        - Cloud-based G2P with better accuracy for rare words
        - Phonetic system for constructed languages
        - Singing-specific G2P accounting for prosody
    """
    addon_type    = 'custom_g2p'
    handles:      list[str] = []   # language codes this G2P handles
    priority:     int        = 50  # higher = runs first when multiple match same lang

    def transcribe(self, text: str, lang: str,
                   options: 'G2POptions') -> 'G2PResult':
        """
        Transcribe text → G2PResult with IPFPhonemes.
        options.singability, .target_module_id, .preserve_tone, .stress_hints
        """
        raise NotImplementedError(f'{self.__class__.__name__}.transcribe() not implemented')

    def can_handle(self, word: str, lang: str) -> bool:
        """
        Optional: return False to fall back to built-in G2P for this specific word.
        Useful for hybrid systems: handle known vocabulary, delegate unknown words.
        Default: always handle (return True).
        """
        return True


# ══════════════════════════════════════════════════════════════════════════════
#  Analyzer — read-only analysis, never modifies tokens
# ══════════════════════════════════════════════════════════════════════════════

class Analyzer(AddonBase):
    """
    Read-only analysis of MLC output. Cannot modify tokens.
    Returns analysis data surfaced in the UI and debug panel.

    Use cases:
        - Pronunciation quality scoring
        - Singability estimation with rationale
        - Detect problematic phoneme sequences
        - Style analysis (too accurate? too simplified?)
        - Rhyme / meter analysis
        - Per-word confidence breakdown
    """
    addon_type    = 'analyzer'
    for_modules:  list[str] = []
    for_languages:list[str] = []

    def analyze(self, tokens: list, source_text: str, lang: str) -> 'AnalysisResult':
        """
        Analyze the token list. Non-destructive — tokens are NOT modified.
        Return AnalysisResult with score (0-1), label, warnings, suggestions.
        """
        raise NotImplementedError(f'{self.__class__.__name__}.analyze() not implemented')


# Re-import context types so they're available when base classes use them
from mlc_api_types import OverrideContext, PostprocessContext, G2POptions, G2PResult, AnalysisResult
