"""
MLC Public API — v2.0
=====================
Import everything addon developers need from here.
Never import from mlc internals directly.

Usage in your addon:
    from mlc.api import (
        AddonBase, LanguagePack, VoicebankMapper, PipelinePlugin,
        VoiceProfile, PhonemeSet, WordOverride,
        IPFPhoneme, SynthToken, MLCWarning,
        PipelineHook, AddonType, PhonemeClass, StressLevel,
        hook, word_override, voice_profile,
    )
"""

from mlc_api_types import (
    OverrideContext, PostprocessContext, G2POptions, G2PResult, AnalysisResult,
    AddonManifest, AddonCapabilities, AddonDependency,
    WordOverrideEntry, PhonemeSetSpec, VoiceProfileSpec,
    MLCEvent, MLCEventType, AddonUpdateInfo,
    MLCContext,
)
from mlc_api_base import (
    AddonBase, LanguagePack, VoicebankMapper, PipelinePlugin,
    VoiceProfile, PhonemeSet, CompositeAddon,
    # New first-class addon types
    WordOverride, PhonemeCorrector, OutputPostprocessor, CustomG2P, Analyzer,
)

# Re-export core types addon developers need
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent / 'core'))

from core.mlc_types import (
    IPFPhoneme, SynthToken, MLCWarning, WarningLevel,
    G2PSource, PhonemeClass, StressLevel, Confidence,
    ToneAnnotation, RhythmAnnotation, PipelineHook, AddonType,
    TokenFlag,
)

MLC_API_VERSION = '2.0.0'

__all__ = [
    # Manifest + metadata
    'AddonManifest', 'AddonCapabilities', 'AddonDependency',
    'AddonUpdateInfo', 'MLCContext',
    # Spec types
    'WordOverrideEntry', 'PhonemeSetSpec', 'VoiceProfileSpec',
    # Events
    'MLCEvent', 'MLCEventType',
    # Base classes
    'AddonBase', 'LanguagePack', 'VoicebankMapper', 'PipelinePlugin',
    'VoiceProfile', 'PhonemeSet', 'CompositeAddon',
    'WordOverride', 'PhonemeCorrector', 'OutputPostprocessor', 'CustomG2P', 'Analyzer',
    'OverrideContext', 'PostprocessContext', 'G2POptions', 'G2PResult', 'AnalysisResult',
    # Core types
    'IPFPhoneme', 'SynthToken', 'MLCWarning', 'WarningLevel',
    'G2PSource', 'PhonemeClass', 'StressLevel', 'Confidence',
    'ToneAnnotation', 'RhythmAnnotation', 'PipelineHook', 'AddonType',
    'TokenFlag',
    # Version
    'MLC_API_VERSION',
]
