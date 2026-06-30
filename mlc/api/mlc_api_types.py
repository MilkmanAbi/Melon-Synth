"""
MLC API — Data Types
====================
All types addon developers interact with.
Stable across MLC versions — we never break these.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional, Any
from enum import Enum


# ── Addon manifest ────────────────────────────────────────────────────────────

@dataclass
class AddonDependency:
    """
    Declares that this addon requires another addon to be installed first.
    
    Example:
        AddonDependency(id='jp_cv_standard', min_version='1.0.0')
        → MLC won't load this addon unless jp_cv_standard >= 1.0.0 is present.
    """
    id:          str
    min_version: str = '0.0.0'
    max_version: Optional[str] = None   # None = any version


@dataclass
class AddonCapabilities:
    """
    Declares what this addon can do.
    MLC uses this to route conversion requests efficiently.
    """
    # Input languages this addon handles (ISO 639-1 codes)
    # '*' means any language
    input_languages:   list[str] = field(default_factory=lambda: ['en'])

    # Output phoneme sets this addon produces
    output_phoneme_sets: list[str] = field(default_factory=list)

    # Specific voicebank names this addon is tuned for
    # Empty = works with any voicebank using the target phoneme set
    target_voicebanks: list[str] = field(default_factory=list)

    # Whether this addon provides word-level G2P overrides
    has_word_overrides: bool = False

    # Whether this addon provides a voice profile
    has_voice_profile: bool = False

    # Whether this addon declares a new phoneme set
    declares_phoneme_set: bool = False

    # Whether this addon respects the singability slider
    singability_aware: bool = True

    # Whether this addon handles tonal languages
    tone_aware: bool = False

    # Whether this addon can handle CVVC transitions
    cvvc_support: bool = False

    # Whether this addon supports diphthongs
    diphthong_support: bool = True


@dataclass
class AddonManifest:
    """
    manifest.json schema v2 — full specification.
    
    Every .mlc bundle MUST have a manifest.json with at least the required fields.
    Optional fields give the addon richer integration with MLC.
    """
    # ── Required ──
    id:            str            # 'jp_cv_utane' — unique, lowercase, underscores only
    name:          str            # 'Utane Uta CV Optimiser'
    version:       str            # '1.2.0' — semver
    mlc_api:       str            # '2.0' — minimum MLC API version required
    addon_type:    str            # 'voicebank_mapper' | 'language_pack' | 'pipeline_plugin'
                                  # | 'voice_profile' | 'phoneme_set' | 'composite'
    # ── Strongly recommended ──
    description:   str = ''
    author:        str = ''
    license:       str = 'MIT'    # SPDX identifier
    homepage:      str = ''       # URL to addon page / GitHub

    # ── Versioning & updates ──
    min_melon_version: str = '1.0.0'   # minimum Melon Synth version
    update_url:    Optional[str] = None # URL to check for updates (returns AddonUpdateInfo JSON)
    changelog_url: Optional[str] = None

    # ── Dependencies ──
    # Other addons that must be installed first
    requires:      list[AddonDependency] = field(default_factory=list)
    # Python packages to install (pip)
    pip_deps:      list[str] = field(default_factory=list)
    # Optional pip packages (installed if available, graceful fallback if not)
    pip_optional:  list[str] = field(default_factory=list)

    # ── Capabilities ──
    capabilities:  AddonCapabilities = field(default_factory=AddonCapabilities)

    # ── Tags for discovery ──
    tags:          list[str] = field(default_factory=list)

    # ── Entry points ──
    # Which Python class to instantiate (defaults: same as addon_type in CamelCase)
    # e.g. 'jp_cv_utane.UtaneMapper' — 'file.ClassName'
    entry_point:   Optional[str] = None

    # For composite addons: list of entry points
    entry_points:  list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            'id': self.id, 'name': self.name, 'version': self.version,
            'mlc_api': self.mlc_api, 'addon_type': self.addon_type,
            'description': self.description, 'author': self.author,
            'license': self.license, 'homepage': self.homepage,
            'tags': self.tags,
        }


# ── Word override ─────────────────────────────────────────────────────────────

@dataclass
class WordOverrideEntry:
    """
    A single word-level phoneme override.
    
    Bypasses G2P for a specific word and returns your phonemes directly.
    Use this to fix G2P mistakes, handle proper nouns, or tune specific words.
    
    Example:
        WordOverrideEntry(
            word='beautiful',
            phonemes=['byu', 'ti', 'fu', 'ru'],
            language='en',
            module_id='jp_cv_standard',  # None = applies to all modules
            priority=100,
            note='Manual tuning — default G2P output is poor for singing',
        )
    """
    word:       str             # The exact word to override (case-insensitive)
    phonemes:   list[str]       # Replacement phoneme sequence

    language:   str = '*'       # Which input language. '*' = all languages
    module_id:  Optional[str] = None  # Which voicebank module. None = all modules

    # Priority: higher = runs first, wins over lower-priority overrides
    # Built-in rules = priority 0, user addons default = 50, high = 100
    priority:   int = 50

    # Optional metadata
    note:       str = ''        # Reason for override (shown in MLC UI)
    stressed:   Optional[list[bool]] = None  # Per-phoneme stress markers


# ── Phoneme set spec ──────────────────────────────────────────────────────────

@dataclass  
class PhonemeSetSpec:
    """
    Declares a new phoneme set.
    
    A phoneme set is a named collection of phonemes that a voicebank supports.
    Define one if you're creating a mapper for a voicebank with a non-standard
    phoneme set (e.g. a new CVVC scheme, VCV, or a completely custom bank).
    
    Example:
        PhonemeSetSpec(
            id='jp_vcv_roro',
            name='Japanese VCV (Roro style)',
            description='VCV phoneme set for banks recorded in Roro style',
            phonemes=['a', 'i', 'u', 'e', 'o', 'a ka', 'i ka', ...],
            from_phoneme_set='jp_cv',  # extends jp_cv
            voicing_pairs=[('ka', 'ga'), ('ta', 'da'), ...],
        )
    """
    id:          str
    name:        str
    description: str = ''
    author:      str = ''

    # The complete list of phonemes this set supports
    phonemes:    list[str] = field(default_factory=list)

    # If this set extends another (inherits all phonemes from parent)
    extends:     Optional[str] = None

    # Voicing pairs: (voiceless, voiced)
    voicing_pairs: list[tuple[str, str]] = field(default_factory=list)

    # Which phonemes are vowels
    vowels:      list[str] = field(default_factory=list)

    # Which phonemes are consonants
    consonants:  list[str] = field(default_factory=list)

    # Phoneme-level documentation (for the MLC UI)
    phoneme_notes: dict[str, str] = field(default_factory=dict)


# ── Voice profile ─────────────────────────────────────────────────────────────

@dataclass
class VoiceProfileSpec:
    """
    Voice profile for a specific voicebank.
    
    Captures the quirks, optimal settings, and corrections for a particular
    voicebank. Think of it as the "user manual" for making that bank sound good.
    
    Example:
        VoiceProfileSpec(
            voicebank_id='utane_uta_v1',
            voicebank_name='Utane Uta',
            phoneme_corrections={
                'ra': 'la',  # Utane's 'ra' sounds better mapped to 'la'
                'ji': 'zi',  # specific quirk for this bank
            },
            optimal_singability=0.72,
            optimal_breathiness=35,
            optimal_tension=58,
            notes='Utane records with a slight head voice quality. '
                  'Keep tension below 65 to avoid harshness.',
        )
    """
    voicebank_id:   str           # must match VoicebankModule.id or target_voicebanks entry
    voicebank_name: str           # human-readable name

    # Phoneme-level corrections: {'G2P output': 'better phoneme for this bank'}
    phoneme_corrections: dict[str, str] = field(default_factory=dict)

    # Optimal default settings for this voicebank
    optimal_singability:  float = 0.65
    optimal_breathiness:  int   = 40
    optimal_tension:      int   = 65
    optimal_gender:       int   = 30
    optimal_velocity:     int   = 100
    optimal_volume:       int   = 100
    optimal_modulation:   int   = 0

    # Custom flags to append to UST render (OpenUTAU flags)
    # e.g. {'all': 'g-5', 'vowels_only': 'B10'}
    render_flags:   dict[str, str] = field(default_factory=dict)

    # Words this voicebank struggles with (auto-warns the user)
    known_difficult_words: list[str] = field(default_factory=list)

    # Human-readable notes shown in the UI
    notes:          str = ''

    # Recommended MLC module to use with this bank
    recommended_module: Optional[str] = None


# ── Events ────────────────────────────────────────────────────────────────────

class MLCEventType(Enum):
    """Events that addons can subscribe to."""
    # Conversion events
    BEFORE_CONVERT   = 'before_convert'    # about to convert text
    AFTER_CONVERT    = 'after_convert'     # conversion complete
    # Addon lifecycle
    ADDON_LOADED     = 'addon_loaded'      # another addon was loaded
    ADDON_UNLOADED   = 'addon_unloaded'    # another addon was removed
    # Engine events
    ENGINE_READY     = 'engine_ready'      # MLC engine fully initialised
    CACHE_CLEARED    = 'cache_cleared'     # G2P cache was cleared


@dataclass
class MLCEvent:
    """An event dispatched by the MLC engine."""
    type:    MLCEventType
    data:    dict = field(default_factory=dict)
    source:  str = 'mlc'    # addon id or 'mlc'


# ── Update info ───────────────────────────────────────────────────────────────

@dataclass
class AddonUpdateInfo:
    """
    Returned by an addon's update_url endpoint.
    
    MLC periodically fetches this URL and notifies the user if a newer
    version is available. Host this as a static JSON file on GitHub or
    your own server.
    
    Schema (JSON):
    {
        "id": "jp_cv_utane",
        "latest_version": "1.3.0",
        "download_url": "https://example.com/jp_cv_utane-1.3.0.mlc",
        "changelog": "Fixed ra→la correction for high notes",
        "min_mlc_api": "2.0",
        "min_melon_version": "1.0.0"
    }
    """
    id:              str
    latest_version:  str
    download_url:    str
    changelog:       str = ''
    min_mlc_api:     str = '2.0'
    min_melon_version: str = '1.0.0'
    is_breaking:     bool = False   # True if update has breaking changes


# ── Context ───────────────────────────────────────────────────────────────────

@dataclass
class MLCContext:
    """
    Runtime context passed to addon hooks.
    Read-only snapshot of the current conversion request.
    """
    text:           str
    language:       str
    module_id:      str
    singability:    float
    voicebank_name: Optional[str] = None
    voicebank_path: Optional[str] = None
    session_id:     str = ''        # unique per conversion request
    extra:          dict = field(default_factory=dict)  # addon-specific context


# ── New addon type contexts ────────────────────────────────────────────────────
# These support the new first-class addon types below.

from dataclasses import dataclass, field as dc_field
from typing import Optional

@dataclass
class OverrideContext:
    """Context passed to WordOverride.get_override() for dynamic overrides."""
    module_id:    str
    language:     str
    singability:  float
    prev_word:    str = ''   # word before this one (empty at start)
    next_word:    str = ''   # word after this one (empty at end)
    word_index:   int = 0
    total_words:  int = 0
    extra:        dict = dc_field(default_factory=dict)


@dataclass
class PostprocessContext:
    """Context passed to OutputPostprocessor.postprocess()."""
    module_id:      str
    language:       str
    singability:    float
    original_words: list  # the source words before G2P
    bpm:            float = 120.0
    extra:          dict  = dc_field(default_factory=dict)


@dataclass
class G2POptions:
    """Options passed to CustomG2P.transcribe()."""
    singability:       float = 0.65
    target_module_id:  str   = ''
    preserve_tone:     bool  = True
    stress_hints:      list  = dc_field(default_factory=list)
    extra:             dict  = dc_field(default_factory=dict)


@dataclass
class G2PResult:
    """Return type from CustomG2P.transcribe()."""
    phonemes:    list          # list[IPFPhoneme]
    words:       list[str]     # original words
    language:    str
    warnings:    list = dc_field(default_factory=list)
    confidence:  float = 0.8
    source:      str  = 'custom_g2p'


@dataclass
class AnalysisResult:
    """Return type from Analyzer.analyze()."""
    score:       float        # 0.0 to 1.0
    label:       str          # e.g. 'excellent', 'acceptable', 'poor'
    warnings:    list = dc_field(default_factory=list)   # list[MLCWarning]
    suggestions: list[str] = dc_field(default_factory=list)
    extra:       dict = dc_field(default_factory=dict)   # analyzer-specific data
