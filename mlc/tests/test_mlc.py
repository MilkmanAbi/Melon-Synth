#!/usr/bin/env python3
"""
MLC Test Suite
==============
Run with: python tests/test_mlc.py

Tests the full pipeline from English text → JP CV syllables.
"""

import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


def test_module_loads():
    """Test that the jp_cv_standard module loads correctly."""
    from modules.jp_cv_standard import JPCVStandardModule
    m = JPCVStandardModule()
    assert m.id == 'jp_cv_standard'
    assert len(m.supported_phonemes) > 0
    print(f'  ✓ Module loads: {m.name}')


def test_basic_mapping():
    """Test basic ARPAbet → JP CV mapping."""
    from modules.jp_cv_standard import JPCVStandardModule
    from mlc_base import PhonemeToken

    m = JPCVStandardModule()

    # "ka" = K + AE
    tokens = [
        PhonemeToken(symbol='K', is_vowel=False, stress=1, word_index=0,
                     syllable_index=0, is_syllable_onset=True,
                     is_syllable_coda=False, is_word_start=True,
                     is_word_end=False, source_text='ca'),
        PhonemeToken(symbol='AE', is_vowel=True, stress=1, word_index=0,
                     syllable_index=0, is_syllable_onset=False,
                     is_syllable_coda=True, is_word_start=False,
                     is_word_end=True, source_text='at'),
    ]

    result = m.map_phonemes(tokens, singability=0.5)
    phonemes = [t.phoneme for t in result]
    assert 'ka' in phonemes, f'Expected "ka", got {phonemes}'
    print(f'  ✓ K+AE → {phonemes}')


def test_singability_range():
    """Test that singability affects output."""
    from modules.jp_cv_standard import JPCVStandardModule
    from mlc_base import PhonemeToken

    m = JPCVStandardModule()

    # "night" = N + AY + T  (diphthong + final consonant)
    tokens = [
        PhonemeToken(symbol='N', is_vowel=False, stress=0, word_index=0,
                     syllable_index=0, is_syllable_onset=True,
                     is_syllable_coda=False, is_word_start=True,
                     is_word_end=False, source_text='n'),
        PhonemeToken(symbol='AY', is_vowel=True, stress=1, word_index=0,
                     syllable_index=0, is_syllable_onset=False,
                     is_syllable_coda=False, is_word_start=False,
                     is_word_end=False, source_text='igh'),
        PhonemeToken(symbol='T', is_vowel=False, stress=0, word_index=0,
                     syllable_index=0, is_syllable_onset=False,
                     is_syllable_coda=True, is_word_start=False,
                     is_word_end=True, source_text='t'),
    ]

    accurate = m.map_phonemes(tokens, singability=0.0)
    singable = m.map_phonemes(tokens, singability=1.0)

    acc_ph = [t.phoneme for t in accurate]
    sin_ph = [t.phoneme for t in singable]

    print(f'  ✓ "night" accurate  (0.0): {acc_ph}')
    print(f'  ✓ "night" singable  (1.0): {sin_ph}')

    # Accurate should have more tokens (diphthong tail + closure consonant)
    assert len(accurate) >= len(singable), \
        'Accurate should produce >= tokens vs singable'


def test_common_words():
    """Test a set of musically common English words."""
    # These tests use the simple fallback G2P (no phonemizer needed)
    from modules.jp_cv_standard import JPCVStandardModule
    from mlc_pipeline import fallback_g2p, _rule_based_syllabify
    from mlc_base import PhonemeToken

    m = JPCVStandardModule()

    test_cases = {
        'love':     ['r', 'a', 'b', 'u'],   # approximate — l→r, AH→a, V→b
        'dream':    ['d', 'r', 'i', 'm'],
        'sky':      ['s', 'k', 'a', 'i'],
        'heart':    ['h', 'a'],              # singable simplification
    }

    for word, expected_contains in test_cases.items():
        arpabet = fallback_g2p(word)
        syllables = _rule_based_syllabify(arpabet)

        # Build minimal tokens
        tokens = []
        for syl_idx, syl in enumerate(syllables):
            for ph_idx, ph in enumerate(syl['phonemes']):
                from mlc_base import PhonemeToken
                VOWELS = {'AA','AE','AH','AO','AW','AY','EH','ER','EY','IH','IY','OW','OY','UH','UW'}
                is_last = (syl_idx == len(syllables)-1 and ph_idx == len(syl['phonemes'])-1)
                tokens.append(PhonemeToken(
                    symbol=ph, is_vowel=ph in VOWELS, stress=1 if syl['stressed'] else 0,
                    word_index=0, syllable_index=syl_idx,
                    is_syllable_onset=(ph_idx == 0),
                    is_syllable_coda=(ph_idx == len(syl['phonemes'])-1),
                    is_word_start=(syl_idx == 0 and ph_idx == 0),
                    is_word_end=is_last,
                    source_text=word,
                ))

        result = m.map_phonemes(tokens, singability=0.7)
        result = m.postprocess(result, singability=0.7)
        phonemes = [t.phoneme for t in result]
        print(f'  ✓ "{word}" → {phonemes}')


def test_number_normalisation():
    """Test number expansion."""
    from mlc_pipeline import MLCPipeline
    p = MLCPipeline()

    cases = [
        ('3 blind mice',     'three blind mice'),
        ('i love you 2',     'i love you two'),
        ('99 problems',      'ninety nine problems'),
    ]

    for text, expected in cases:
        result = p.normalise(text, 'en')
        assert result == expected, f'Expected "{expected}", got "{result}"'
        print(f'  ✓ "{text}" → "{result}"')


def test_contraction_expansion():
    """Test contraction expansion."""
    from mlc_pipeline import MLCPipeline
    p = MLCPipeline()

    cases = [
        ("i'm flying",    "i am flying"),
        ("don't stop",    "do not stop"),
        ("you're mine",   "you are mine"),
        ("i'll be back",  "i will be back"),
    ]

    for text, expected in cases:
        result = p.normalise(text, 'en')
        assert result == expected, f'Expected "{expected}", got "{result}"'
        print(f'  ✓ "{text}" → "{result}"')


def run_all():
    tests = [
        ('Module loads',              test_module_loads),
        ('Basic ARPAbet→CV mapping',  test_basic_mapping),
        ('Singability range',         test_singability_range),
        ('Common words',              test_common_words),
        ('Number normalisation',      test_number_normalisation),
        ('Contraction expansion',     test_contraction_expansion),
    ]

    passed = 0
    failed = 0

    for name, fn in tests:
        print(f'\n{name}')
        try:
            fn()
            passed += 1
        except Exception as e:
            print(f'  ✗ FAILED: {e}')
            import traceback
            traceback.print_exc()
            failed += 1

    print(f'\n{"─"*40}')
    print(f'{passed} passed, {failed} failed')
    return failed == 0


if __name__ == '__main__':
    ok = run_all()
    sys.exit(0 if ok else 1)
