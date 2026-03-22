#!/usr/bin/env python3
"""
MLC Test Corpus
===============
20 sentences across 4 difficulty tiers.
Tests the full pipeline including cluster repair, confidence scoring,
and flag tagging.

Run: python tests/test_corpus.py
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent / 'core'))

from registry import MLCRegistry, VoicebankModule
from core.g2p import G2PEngineV2
from core.confidence import ConfidenceScorer
from core.mlc_types import G2PSource, TokenFlag, Confidence

ROOT = Path(__file__).parent.parent

# ── Test corpus ────────────────────────────────────────────────────────────

CORPUS = [
    # Tier 0: Dead simple. Should be near-perfect even with rule-based G2P.
    {'text': 'I love you',          'tier': 0, 'desc': 'Basic short phrase'},
    {'text': 'fly to me',           'tier': 0, 'desc': 'Simple verb phrase'},
    {'text': 'sing my song',        'tier': 0, 'desc': 'Simple imperative'},

    # Tier 1: Common vocabulary, single syllable words, minimal clusters.
    {'text': 'never gonna give you up',            'tier': 1, 'desc': 'Classic, common words'},
    {'text': 'beautiful dream fly up to the sky',  'tier': 1, 'desc': 'Original test sentence'},
    {'text': 'hold me close tonight',              'tier': 1, 'desc': 'Common song phrase'},
    {'text': 'reach for the stars above',          'tier': 1, 'desc': 'Common, minor clusters'},

    # Tier 2: Multi-syllable words, some clusters, diphthongs.
    {'text': 'somewhere over the rainbow',         'tier': 2, 'desc': 'Diphthongs + clusters'},
    {'text': 'through the darkness and the light', 'tier': 2, 'desc': 'TH phoneme stress test'},
    {'text': 'everything I ever wanted',           'tier': 2, 'desc': 'Multi-syllable + clusters'},
    {'text': 'every breath you take',              'tier': 2, 'desc': 'TH + common words'},
    {'text': 'strength comes from within',         'tier': 2, 'desc': 'Serious cluster: STR + NGTh'},

    # Tier 3: Hard. Unusual words, dense clusters, edge cases.
    {'text': 'extraordinary circumstances require extraordinary strength', 'tier': 3, 'desc': 'Long complex words'},
    {'text': 'glimpse through the chrysanthemum twilight',                'tier': 3, 'desc': 'Rare vocab, brutal clusters'},
    {'text': "you're the world's most beautiful catastrophe",              'tier': 3, 'desc': 'Contraction + rare word'},
    {'text': 'lightning strikes the rhythm of my aching heart',           'tier': 3, 'desc': 'Dense clusters'},

    # Edge cases
    {'text': "don't stop me now I'm having such a good time",  'tier': 2, 'desc': 'Contractions'},
    {'text': 'it was three years ago on a bright spring morning', 'tier': 2, 'desc': 'Numbers + time phrase'},
    {'text': 'yeah yeah yeah oh oh oh',                         'tier': 0, 'desc': 'Vocal fillers'},
    {'text': 'uh huh mmm yeah baby',                            'tier': 0, 'desc': 'Non-word vocals'},
]

SINGABILITIES = [0.3, 0.65, 0.9]


def run_corpus():
    # Setup
    registry = MLCRegistry(ROOT / 'modules', ROOT / 'user_modules')
    registry.discover_all()

    module  = registry.get('jp_cv_standard')
    if not module:
        print('ERROR: jp_cv_standard module not found')
        sys.exit(1)

    g2p    = G2PEngineV2()
    scorer = ConfidenceScorer()

    results_by_tier: dict[int, list] = {0:[], 1:[], 2:[], 3:[]}
    total_tokens  = 0
    total_time_ms = 0
    artifact_words = []
    repaired_words = []

    print(f'\n{"═"*72}')
    print(f'  MLC TEST CORPUS  —  {len(CORPUS)} sentences  ×  {len(SINGABILITIES)} singability values')
    print(f'  Module: {module.name} v{module.version}')
    print(f'{"═"*72}')

    for entry in CORPUS:
        text = entry['text']
        tier = entry['tier']
        desc = entry['desc']

        t0 = time.time()
        try:
            ipf, words, normalised, sources = g2p.process_full(text, 'en')
        except Exception as e:
            print(f'  [T{tier}] CRASH in G2P: {e}  ← "{text[:40]}"')
            continue

        # Test at middle singability for corpus run
        sing = 0.65
        try:
            synth  = module.map_phonemes(ipf, sing)
            synth  = module.postprocess(synth, sing)
            synth, warns, conf = scorer.score(
                synth, module.supported_phonemes, 'en', 'jp_cv'
            )
        except Exception as e:
            print(f'  [T{tier}] CRASH in mapping: {e}  ← "{text[:40]}"')
            continue

        elapsed = int((time.time()-t0)*1000)
        total_time_ms += elapsed
        total_tokens  += len(synth)

        # Detect artifacts and repairs
        for s in sources:
            if s.was_repaired:
                repaired_words.append((s.g2p_source.value, text))
        for tok in synth:
            if tok.has_flag(TokenFlag.FALLBACK_ARTIFACT):
                artifact_words.append((tok.source_word, text))

        # Count confidence distribution
        hi  = sum(1 for t in synth if t.mlc_confidence==Confidence.HIGH)
        mid = sum(1 for t in synth if t.mlc_confidence==Confidence.MEDIUM)
        lo  = sum(1 for t in synth if t.mlc_confidence==Confidence.LOW)

        phoneme_str = ' · '.join(t.display for t in synth)
        # Truncate long sequences
        if len(phoneme_str) > 55:
            phoneme_str = phoneme_str[:52] + '…'

        conf_bar = _conf_bar(conf)
        print(f'\n  [T{tier}] {desc}')
        print(f'  IN : {text}')
        print(f'  OUT: {phoneme_str}')
        print(f'  {conf_bar}  {conf:.0%} conf  |  {len(synth)} tokens  |  {elapsed}ms  |  ✓{hi} ≈{mid} ✗{lo}')

        results_by_tier[tier].append(conf)

        # Show warnings (filtered to important ones)
        important = [w for w in warns if w.level.value in ('warning','error')]
        if important:
            for w in important[:2]:  # cap at 2
                print(f'  ⚠  {w.code}: {w.message[:60]}')

    # ── Summary ────────────────────────────────────────────────────────────

    print(f'\n{"═"*72}')
    print(f'  SUMMARY')
    print(f'{"─"*72}')
    print(f'  Total tokens:    {total_tokens}')
    print(f'  Total time:      {total_time_ms}ms  ({total_time_ms//len(CORPUS)}ms avg per sentence)')
    print(f'  Repairs:         {len(repaired_words)} words had cluster repair applied')
    print(f'  Artifacts:       {len(artifact_words)} fallback artifacts detected & flagged')
    print()

    print(f'  Confidence by tier:')
    for tier in range(4):
        scores = results_by_tier[tier]
        if scores:
            avg = sum(scores)/len(scores)
            bar = _conf_bar(avg)
            print(f'    T{tier} ({"easy" if tier==0 else "medium" if tier==1 else "hard" if tier==2 else "brutal"}): '
                  f'{bar}  {avg:.0%}  ({len(scores)} sentences)')

    print()
    print(f'  Cluster repairs:')
    for src, sentence in repaired_words[:5]:
        print(f'    [{src}] "{sentence[:50]}"')
    if not repaired_words:
        print(f'    None (rule-based G2P wasn\'t triggered, or no bad clusters)')

    print(f'{"═"*72}\n')

    # ── Singability comparison for one sentence ────────────────────────────

    test_sent = 'beautiful dream fly up to the sky tonight'
    print(f'  Singability comparison: "{test_sent}"')
    print(f'{"─"*72}')

    ipf, words, _, _ = g2p.process_full(test_sent, 'en')
    for sing in SINGABILITIES:
        synth  = module.map_phonemes(ipf, sing)
        synth  = module.postprocess(synth, sing)
        synth, _, conf = scorer.score(synth, module.supported_phonemes, 'en', 'jp_cv')
        seq = ' · '.join(t.display for t in synth)
        if len(seq) > 55: seq = seq[:52]+'…'
        print(f'  {sing:.1f}  {seq}')
    print(f'{"═"*72}\n')


def _conf_bar(score: float) -> str:
    """ASCII confidence bar."""
    filled = int(score * 10)
    color  = '█' if score >= 0.8 else '▓' if score >= 0.6 else '░'
    return '[' + color*filled + '·'*(10-filled) + ']'


if __name__ == '__main__':
    run_corpus()
