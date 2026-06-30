# Melon Synth — MLC Engine
# Copyright (C) 2026 Abinaash (MilkmanAbi)
# SPDX-License-Identifier: GPL-3.0-or-later
# https://github.com/MilkmanAbi/Melon-Synth

"""
MLC Types — Complete shared type system v2
Fixes applied from review:
  - SynthToken.g2p_source (structured field, replaces string sniffing)
  - SynthToken.source_confidence (separate from mlc_confidence)
  - SynthToken.flags (LOSSY, APPROXIMATED, FALLBACK_ARTIFACT, etc.)
"""
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Any

class PhonemeClass(Enum):
    VOWEL=auto(); STOP=auto(); FRICATIVE=auto(); AFFRICATE=auto()
    NASAL=auto(); LIQUID=auto(); GLIDE=auto(); SILENCE=auto(); UNKNOWN=auto()

class StressLevel(Enum):
    NONE=0; SECONDARY=2; PRIMARY=1

class Confidence(Enum):
    HIGH="high"; MEDIUM="medium"; LOW="low"; MANUAL="manual"

class WarningLevel(Enum):
    INFO="info"; WARNING="warning"; ERROR="error"

class G2PSource(Enum):
    """Structured field — no more string sniffing."""
    ESPEAK   = "espeak"     # espeak-ng via phonemizer (best)
    CMUDICT  = "cmudict"    # CMU Pronouncing Dictionary (English, very accurate)
    RULES    = "rules"      # rule-based fallback (decent)
    PASSTHRU = "passthru"   # character passthrough (last resort)
    CACHED   = "cached"     # any of the above, served from cache
    MANUAL   = "manual"     # user has hand-edited this token

class TokenFlag(Enum):
    """Flags that describe how a token was produced. Multiple can be set."""
    LOSSY              = "lossy"              # cross-language mapping is inherently lossy
    APPROXIMATED       = "approximated"       # closest match, not exact phoneme
    FALLBACK_ARTIFACT  = "fallback_artifact"  # produced by rule-based fallback
    DIPHTHONG_TAIL     = "diphthong_tail"     # second half of a diphthong
    CLUSTER_REPAIRED   = "cluster_repaired"   # bad consonant cluster was repaired
    CODA_CLOSURE       = "coda_closure"       # inserted vowel to close final consonant
    CVVC_TRANSITION    = "cvvc_transition"    # VC transition for CVVC banks
    FUNCTION_WORD      = "function_word"      # the, a, of, etc.
    USER_LOCKED        = "user_locked"        # user has manually locked this value

@dataclass
class IPFPhoneme:
    symbol:str; phon_class:PhonemeClass
    word_index:int; syllable_index:int; phoneme_index:int; global_index:int
    stress:StressLevel; beat_weight:float; duration_hint:float
    is_onset:bool; is_nucleus:bool; is_coda:bool
    is_word_start:bool; is_word_end:bool; is_vowel:bool
    source_grapheme:str; source_word:str
    ipa_symbol:str=''
    g2p_source:G2PSource=G2PSource.RULES
    source_confidence:float=0.6   # raw confidence from the G2P backend
    confidence:Confidence=Confidence.MEDIUM
    is_silence:bool=False

@dataclass
class IPFWord:
    original:str; normalised:str
    phonemes:list[IPFPhoneme]; syllables:list[list[IPFPhoneme]]
    pos:str=''; is_function_word:bool=False

@dataclass
class IPFDocument:
    words:list[IPFWord]; language:str
    flat_phonemes:list[IPFPhoneme]; phrase_breaks:list[int]
    warnings:list[MLCWarning]

@dataclass
class SynthToken:
    phoneme:str; display:str
    duration_hint:float; beat_weight:float
    is_vowel:bool; stressed:bool; phon_class:PhonemeClass
    word_index:int; syllable_index:int
    source_phoneme:str; source_word:str

    # Structured provenance fields (the review's key fix)
    g2p_source:G2PSource=G2PSource.RULES
    source_confidence:float=0.6     # confidence from the G2P backend itself
    mlc_confidence:float=0.75  # MLC confidence score 0.0-1.0
    flags:set=field(default_factory=set)         # set[TokenFlag]

    # CVVC
    vc_transition:str|None=None

    # Tone + rhythm annotations (set by pipeline plugins)
    tone:   object = None   # ToneAnnotation | None
    rhythm: object = None   # RhythmAnnotation | None
    # Pitch curve hint (set by tone-aware plugin) — list of (t, st) tuples
    pitch_curve_hint: object = None

    # Legacy/UI
    note:str=''
    locked:bool=False

    def has_flag(self, flag:TokenFlag)->bool:
        return flag in self.flags

    def add_flag(self, flag:TokenFlag):
        self.flags.add(flag)

@dataclass
class ConversionOutput:
    tokens:list[SynthToken]; words:list[str]
    word_boundaries:list[tuple[int,int]]; phrase_breaks:list[int]
    language:str; module_id:str; singability:float
    confidence_score:float; warnings:list[MLCWarning]
    processing_ms:int=0

    def to_dict(self)->dict:
        return {
            'tokens':[{
                'phoneme':t.phoneme,'display':t.display,
                'duration_hint':round(t.duration_hint,3),'beat_weight':round(t.beat_weight,3),
                'is_vowel':t.is_vowel,'stressed':t.stressed,'phon_class':t.phon_class.name,
                'word_index':t.word_index,'syllable_index':t.syllable_index,
                'source_phoneme':t.source_phoneme,'source_word':t.source_word,
                'g2p_source':t.g2p_source.value,
                'source_confidence':round(t.source_confidence,3),
                'mlc_confidence':round(float(t.mlc_confidence),3),
                'flags':[f.value for f in t.flags],
                'vc_transition':t.vc_transition,'note':t.note,'locked':t.locked,
            } for t in self.tokens],
            'words':self.words,'word_boundaries':self.word_boundaries,
            'phrase_breaks':self.phrase_breaks,'language':self.language,
            'module_id':self.module_id,'singability':self.singability,
            'confidence_score':round(self.confidence_score,3),
            'warnings':[w.to_dict() for w in self.warnings],
            'processing_ms':self.processing_ms,'token_count':len(self.tokens),
        }

@dataclass
class MLCWarning:
    level:WarningLevel; code:str; message:str
    word:str=''; phoneme:str=''; suggestion:str=''
    def to_dict(self)->dict:
        return {'level':self.level.value,'code':self.code,'message':self.message,
                'word':self.word,'phoneme':self.phoneme,'suggestion':self.suggestion}

@dataclass
class ModuleManifest:
    id:str; name:str; version:str; description:str; author:str; license:str
    language:str; languages:list[str]; phoneme_set:str; target_banks:list[str]
    entry_point:str; mlc_api_version:str; python_requires:str; dependencies:list[str]
    data_files:list[str]=field(default_factory=list)
    confidence_notes:str=''; known_issues:list[str]=field(default_factory=list)
    singability_default:float=0.5; singability_notes:str=''

    @classmethod
    def from_dict(cls,d:dict)->'ModuleManifest':
        return cls(
            id=d['id'],name=d['name'],version=d['version'],
            description=d.get('description',''),author=d.get('author','unknown'),
            license=d.get('license','MIT'),language=d.get('language','en'),
            languages=d.get('languages',[d.get('language','en')]),
            phoneme_set=d.get('phoneme_set',''),target_banks=d.get('target_banks',[]),
            entry_point=d.get('entry_point','module.py'),
            mlc_api_version=d.get('mlc_api_version','1.0.0'),
            python_requires=d.get('python_requires','>=3.9'),
            dependencies=d.get('dependencies',[]),data_files=d.get('data_files',[]),
            confidence_notes=d.get('confidence_notes',''),known_issues=d.get('known_issues',[]),
            singability_default=float(d.get('singability_default',0.5)),
            singability_notes=d.get('singability_notes',''),
        )
    def to_dict(self)->dict:
        return {k:getattr(self,k) for k in self.__dataclass_fields__}


# ══════════════════════════════════════════════════════════════════════════
#  Add-on System Types
# ══════════════════════════════════════════════════════════════════════════

class AddonType(Enum):
    LANGUAGE_PACK    = "language_pack"     # teaches a new source language
    VOICEBANK_MAPPER = "voicebank_mapper"  # maps IPF → voicebank phonemes
    PIPELINE_PLUGIN  = "pipeline_plugin"   # hooks into a pipeline stage
    COMPOSITE        = "composite"         # multiple types in one bundle

class PipelineHook(Enum):
    """Named hook points in the MLC pipeline."""
    PRE_NORMALISE  = "pre_normalise"   # before text cleaning
    POST_NORMALISE = "post_normalise"  # after cleaning, before G2P
    POST_G2P       = "post_g2p"        # after G2P, can rewrite IPF phonemes
    POST_MAP       = "post_map"        # after voicebank mapping
    POST_PROCESS   = "post_process"    # final pass
    RHYTHM         = "rhythm"          # modify beat_weight / duration_hint
    TONE           = "tone"            # annotate tokens with tone metadata


@dataclass
class ToneAnnotation:
    """
    Tone metadata attached to a SynthToken by a tone-aware pipeline plugin.
    Used by Mandarin/Cantonese packs to convey pitch curve intent.

    Melon Synth can optionally use this to auto-sketch pitch curves.
    The annotation is a hint — users always override.
    """
    tone_number:  int              # 1-4 for Mandarin, 1-6 for Cantonese, 0=neutral
    tone_name:    str              # "rising", "falling", "high", "low-dipping", etc.
    pitch_shape:  str              # "flat","rise","fall","dip","rise-fall","fall-rise"
    relative_start: float          # relative pitch start (0.0=low, 1.0=high)
    relative_end:   float          # relative pitch end
    language:     str              # "zh-cmn", "zh-yue", "ko", etc.


@dataclass
class RhythmAnnotation:
    """
    Rhythm metadata that pipeline plugins can attach to SynthTokens.
    Overrides the default duration_hint and beat_weight.
    """
    duration_override:   float | None = None   # beats
    beat_weight_override:float | None = None   # 0.0–1.0
    elongate:            bool = False           # this note should stretch
    elide:               bool = False           # this note can be shortened
    reason:              str = ''


# tone and rhythm fields are added directly to SynthToken dataclass
