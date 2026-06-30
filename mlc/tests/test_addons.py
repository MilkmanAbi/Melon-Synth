#!/usr/bin/env python3
"""
MLC Addon System Test
======================
Tests language packs, pipeline plugins, and voicebank mappers.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'core'))
sys.path.insert(0, str(ROOT / 'addons'))
sys.path.insert(0, str(ROOT / 'addons' / 'language_packs'))
sys.path.insert(0, str(ROOT / 'addons' / 'pipeline_plugins'))
sys.path.insert(0, str(ROOT / 'addons' / 'voicebank_mappers'))

PASS = '✓'; FAIL = '✗'

def run(name, fn):
    try:
        fn()
        print(f'  {PASS}  {name}')
        return True
    except Exception as e:
        print(f'  {FAIL}  {name}')
        print(f'       {e}')
        import traceback; traceback.print_exc()
        return False

# ── Mandarin tests ────────────────────────────────────────────────────────

def test_mandarin_loads():
    from zh_mandarin import MandarinLanguagePack
    m = MandarinLanguagePack()
    assert 'zh' in m.handles
    assert m.has_tone

def test_mandarin_pinyin_numbered():
    from zh_mandarin import MandarinLanguagePack
    m = MandarinLanguagePack()
    result = m.decompose('wo3 ai4 ni3', 'zh')
    assert len(result) == 3
    # wo3 → W + UW phonemes
    assert 'UW' in result[0] or 'W' in result[0]
    print(f'\n       wo3 ai4 ni3 → {result}')

def test_mandarin_tone_marks():
    from zh_mandarin import strip_tone_marks, TONE_SHAPES
    base, tone = strip_tone_marks('wǒ')
    assert base == 'wo'
    assert tone == 3
    shape = TONE_SHAPES[3]
    assert shape.pitch_shape == 'dip'

def test_mandarin_tone_sandhi():
    from zh_mandarin import apply_tone_sandhi
    # Tone 3 + Tone 3 → Tone 2 + Tone 3
    result = apply_tone_sandhi([3, 3, 1])
    assert result[0] == 2, f'Expected 2, got {result[0]}'
    assert result[1] == 3
    assert result[2] == 1

def test_mandarin_all_tones():
    from zh_mandarin import decompose_pinyin_syllable, TONE_SHAPES
    test_cases = [
        ('ma1', 1, 'flat'),
        ('ma2', 2, 'rise'),
        ('ma3', 3, 'dip'),
        ('ma4', 4, 'fall'),
        ('ma5', 0, 'flat'),
    ]
    for pinyin, tone_num, expected_shape in test_cases:
        phonemes, tone = decompose_pinyin_syllable(pinyin)
        shape = TONE_SHAPES.get(tone, TONE_SHAPES[0])
        assert shape.pitch_shape == expected_shape, f'{pinyin}: expected {expected_shape}, got {shape.pitch_shape}'
    print(f'\n       All 5 tones: ✓')

# ── Korean tests ──────────────────────────────────────────────────────────

def test_korean_loads():
    from ko_hangul import KoreanLanguagePack
    k = KoreanLanguagePack()
    assert 'ko' in k.handles
    assert not k.has_tone   # Korean has no tone

def test_korean_hangul_decomp():
    from ko_hangul import decompose_hangul, INITIAL_TO_ARPABET, VOWEL_TO_ARPABET, FINAL_TO_ARPABET
    # 가 = ㄱ + ㅏ + (no final)
    i, v, f = decompose_hangul('가')
    assert i == 'ㄱ'
    assert v == 'ㅏ'
    assert f == ''
    assert INITIAL_TO_ARPABET[i] == 'K'
    assert VOWEL_TO_ARPABET[v] == ['AA']

def test_korean_word():
    from ko_hangul import KoreanLanguagePack
    k = KoreanLanguagePack()
    result = k.decompose('사랑해', 'ko')
    # 사랑해 = sa-rang-hae = S+AA + R+AA+NG + HH+AE
    flat = [ph for word in result for ph in word]
    assert 'AA' in flat
    assert 'N' in flat or 'NG' in flat
    print(f'\n       사랑해 → {result}')

def test_korean_syllabify():
    from ko_hangul import KoreanLanguagePack
    k = KoreanLanguagePack()
    result = k.syllabify('안녕하세요', [], 'ko')
    assert len(result) == 5, f'Expected 5 syllables, got {len(result)}'
    assert result[0]['stressed'] == True  # first syllable stressed
    print(f'\n       안녕하세요 → {len(result)} syllables ✓')

# ── Japanese tests ────────────────────────────────────────────────────────

def test_japanese_loads():
    from ja_native import JapaneseLanguagePack
    j = JapaneseLanguagePack()
    assert 'ja' in j.handles
    assert not j.has_tone

def test_japanese_hiragana():
    from ja_native import JapaneseLanguagePack
    j = JapaneseLanguagePack()
    result = j.decompose('くもの', 'ja')
    flat = [ph for word in result for ph in word]
    # く=ku, も=mo, の=no
    assert 'K' in flat or 'UW' in flat
    print(f'\n       くもの → {result}')

def test_japanese_katakana():
    from ja_native import JapaneseLanguagePack, katakana_to_hiragana
    j = JapaneseLanguagePack()
    # サクラ = sakura
    result = j.decompose('サクラ', 'ja')
    flat = [ph for word in result for ph in word]
    assert 'AA' in flat  # a vowel
    print(f'\n       サクラ → {result}')

def test_japanese_geminate():
    from ja_native import kana_to_romaji
    # っか = geminate k
    result = kana_to_romaji('っか')
    assert 'q' in result or 'ka' in result
    print(f'\n       っか → {result}')

def test_japanese_nasal():
    from ja_native import JapaneseLanguagePack, ROMAJI_TO_ARPABET
    assert 'N' in ROMAJI_TO_ARPABET.get('n', [])

# ── Pipeline plugin tests ─────────────────────────────────────────────────

def test_tone_plugin_loads():
    from tone_and_rhythm import ToneAwarePitchPlugin
    p = ToneAwarePitchPlugin()
    from core.mlc_types import PipelineHook
    assert PipelineHook.TONE in p.hooks

def test_auto_breath_plugin():
    from tone_and_rhythm import AutoBreathPlugin
    from core.mlc_types import SynthToken, PhonemeClass, G2PSource, Confidence
    p = AutoBreathPlugin()
    p.max_tokens_before_breath = 3  # force breath every 3 tokens for test

    # Make 6 tokens across 3 words
    tokens = []
    for word_i in range(3):
        for syl_i in range(2):
            tokens.append(SynthToken(
                phoneme='a', display='a',
                duration_hint=1.0, beat_weight=0.7,
                is_vowel=True, stressed=(syl_i==0),
                phon_class=PhonemeClass.VOWEL,
                word_index=word_i, syllable_index=syl_i,
                source_phoneme='AA', source_word=f'word{word_i}',
            ))

    result = p.on_post_process(tokens, singability=0.5)
    breath_tokens = [t for t in result if t.phoneme == '-']
    assert len(breath_tokens) > 0, 'No breath marks inserted'
    print(f'\n       Auto-breath: {len(breath_tokens)} breath marks in {len(result)} tokens')

# ── ARPAbet passthrough tests ──────────────────────────────────────────────

def test_arpabet_loads():
    from en_arpabet import EnglishARPAbetModule
    m = EnglishARPAbetModule()
    assert m.phoneme_set == 'arpabet'
    assert 'AA' in m.supported_phonemes

def test_arpabet_passthrough():
    from en_arpabet import EnglishARPAbetModule
    from core.g2p import G2PEngineV2
    g2p = G2PEngineV2()
    m   = EnglishARPAbetModule()
    ipf, words, _, _ = g2p.process_full('I love you', 'en')
    tokens = m.map_phonemes(ipf, singability=0.3)
    # Should have ARPAbet phonemes, not JP syllables
    phonemes = [t.phoneme for t in tokens]
    # There should be vowels like 'AY' (I), 'AH' (love), 'UW' (you)
    has_arpabet = any(ph in ('AA','AE','AH','AY','IY','UW','EH','OW') for ph in phonemes)
    assert has_arpabet, f'Expected ARPAbet vowels, got: {phonemes}'
    print(f'\n       "I love you" → {phonemes}')

# ── Addon registry test ───────────────────────────────────────────────────

def test_addon_registry():
    from addon_registry import AddonRegistry
    registry = AddonRegistry(ROOT / 'modules', ROOT / 'user_modules')
    results  = registry.discover_all()
    info     = registry.list_all()
    # Should have at least the built-in modules + language packs + plugins
    assert len(info['voicebank_mappers']) > 0
    print(f"\n       Registry: {len(info['voicebank_mappers'])} mappers, "
          f"{len(info['language_packs'])} lang packs, "
          f"{len(info['pipeline_plugins'])} plugins")


def main():
    suites = [
        ('Mandarin language pack', [
            test_mandarin_loads,
            test_mandarin_pinyin_numbered,
            test_mandarin_tone_marks,
            test_mandarin_tone_sandhi,
            test_mandarin_all_tones,
        ]),
        ('Korean language pack', [
            test_korean_loads,
            test_korean_hangul_decomp,
            test_korean_word,
            test_korean_syllabify,
        ]),
        ('Japanese language pack', [
            test_japanese_loads,
            test_japanese_hiragana,
            test_japanese_katakana,
            test_japanese_geminate,
            test_japanese_nasal,
        ]),
        ('Pipeline plugins', [
            test_tone_plugin_loads,
            test_auto_breath_plugin,
        ]),
        ('ARPAbet passthrough', [
            test_arpabet_loads,
            test_arpabet_passthrough,
        ]),
        ('Addon registry', [
            test_addon_registry,
        ]),
    ]

    passed = failed = 0
    for suite_name, tests in suites:
        print(f'\n{suite_name}')
        for t in tests:
            if run(t.__name__.replace('test_', ''), t):
                passed += 1
            else:
                failed += 1

    print(f'\n{"─"*50}')
    print(f'{passed} passed, {failed} failed')
    return failed == 0


if __name__ == '__main__':
    import sys
    ok = main()
    sys.exit(0 if ok else 1)
