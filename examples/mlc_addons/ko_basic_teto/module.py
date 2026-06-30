"""
Korean Basics for Kasane Teto — example MLC composite addon.
Teaches MLC Korean Hangul → JP CV phonemes, tuned for Teto's voice.

To build:
    cd examples/mlc_addons/ko_basic_teto/
    zip -r ../ko_basic_teto.mlc manifest.json module.py data/
"""
from __future__ import annotations
import sys, logging
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / 'mlc'))

from api.mlc_api_base import CompositeAddon, LanguagePack, VoicebankMapper
from api.mlc_api_types import (
    WordOverrideEntry, VoiceProfileSpec, AddonCapabilities,
)
from core.mlc_types import (
    IPFPhoneme, SynthToken, PhonemeClass, StressLevel,
    G2PSource, TokenFlag, Confidence,
)

log = logging.getLogger('ko_basic_teto')

# ── Korean jamo decomposition tables ─────────────────────────────────────────

# Hangul syllable block: 가 = 0xAC00, systematic decomposition
INITIAL = ['g','gg','n','d','dd','r','m','b','bb','s','ss','','j','jj','ch','k','t','p','h']
MEDIAL  = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','eui','i']
FINAL   = ['','g','gg','gs','n','nj','nh','d','l','lg','lm','lb','ls','lt','lp','lh','m','b','bs','s','ss','ng','j','ch','k','t','p','h']

def decompose_hangul(char: str) -> tuple[str,str,str]:
    """Decompose a Hangul syllable block into (initial, medial, final) jamo."""
    code = ord(char) - 0xAC00
    if code < 0 or code > 11171:
        return ('', char, '')
    final_idx  = code % 28
    medial_idx = (code // 28) % 21
    initial_idx = code // 28 // 21
    return INITIAL[initial_idx], MEDIAL[medial_idx], FINAL[final_idx]

# Map Korean jamo → approximate Japanese CV phonemes for Teto
# This is a simplified mapping — a real pack would be more nuanced
JAMO_TO_JP = {
    # Initials → consonant to combine with next vowel
    'g': 'k', 'gg': 'kk', 'n': 'n', 'd': 't', 'dd': 'tt',
    'r': 'r', 'm': 'm', 'b': 'p', 'bb': 'pp', 's': 's', 'ss': 'ss',
    'j': 'ch', 'jj': 'jj', 'ch': 'ch', 'k': 'k', 't': 't',
    'p': 'p', 'h': 'h', '': '',
    # Medials → vowels
    'a': 'a', 'ae': 'e', 'ya': 'ya', 'yae': 'ye', 'eo': 'e',
    'e': 'e', 'yeo': 'yo', 'ye': 'ye', 'o': 'o', 'wa': 'wa',
    'wae': 'e', 'oe': 'e', 'yo': 'yo', 'u': 'u', 'wo': 'o',
    'we': 'e', 'wi': 'i', 'yu': 'yu', 'eu': 'u', 'eui': 'i', 'i': 'i',
    # Finals → coda consonant (often silent or becomes next initial)
    '': '', 'g': '', 'n': 'n', 'd': '', 'l': 'ru', 'm': 'm',
    'b': '', 's': '', 'ng': 'ng', 'j': '', 'ch': '', 'k': '',
    't': '', 'p': '', 'h': '',
}

JP_CV_MAP = {
    # consonant + vowel → JP CV phoneme
    ('k','a'):'ka',('k','i'):'ki',('k','u'):'ku',('k','e'):'ke',('k','o'):'ko',
    ('s','a'):'sa',('s','i'):'shi',('s','u'):'su',('s','e'):'se',('s','o'):'so',
    ('t','a'):'ta',('t','i'):'chi',('t','u'):'tsu',('t','e'):'te',('t','o'):'to',
    ('n','a'):'na',('n','i'):'ni',('n','u'):'nu',('n','e'):'ne',('n','o'):'no',
    ('h','a'):'ha',('h','i'):'hi',('h','u'):'fu',('h','e'):'he',('h','o'):'ho',
    ('m','a'):'ma',('m','i'):'mi',('m','u'):'mu',('m','e'):'me',('m','o'):'mo',
    ('y','a'):'ya',('y','u'):'yu',('y','o'):'yo',
    ('r','a'):'ra',('r','i'):'ri',('r','u'):'ru',('r','e'):'re',('r','o'):'ro',
    ('w','a'):'wa',
    ('g','a'):'ga',('g','i'):'gi',('g','u'):'gu',('g','e'):'ge',('g','o'):'go',
    ('z','a'):'za',('z','i'):'ji',('z','u'):'zu',('z','e'):'ze',('z','o'):'zo',
    ('d','a'):'da',('d','i'):'di',('d','u'):'du',('d','e'):'de',('d','o'):'do',
    ('b','a'):'ba',('b','i'):'bi',('b','u'):'bu',('b','e'):'be',('b','o'):'bo',
    ('p','a'):'pa',('p','i'):'pi',('p','u'):'pu',('p','e'):'pe',('p','o'):'po',
    ('ch','a'):'cha',('ch','i'):'chi',('ch','u'):'chu',('ch','e'):'che',('ch','o'):'cho',
    # vowel only
    ('','a'):'a',('','i'):'i',('','u'):'u',('','e'):'e',('','o'):'o',
    ('','ya'):'ya',('','yu'):'yu',('','yo'):'yo',('','wa'):'wa',
}


def hangul_to_jp_cv(text: str) -> list[str]:
    """Convert a Korean word to a sequence of JP CV phonemes for Teto."""
    phonemes = []
    for char in text:
        if '\uAC00' <= char <= '\uD7A3':
            ini, med, fin = decompose_hangul(char)
            cons = JAMO_TO_JP.get(ini, '')
            vowel = JAMO_TO_JP.get(med, med)
            # Build CV syllable
            cv = JP_CV_MAP.get((cons, vowel)) or JP_CV_MAP.get(('', vowel), vowel)
            if cv:
                phonemes.append(cv)
            # Handle coda
            coda = JAMO_TO_JP.get(fin, '')
            if coda and coda not in ('', 'm', 'n', 'ng', 'ru'):
                pass  # coda becomes next initial in Korean, skip for now
            elif coda in ('m', 'n', 'ng'):
                phonemes.append(coda)
            elif coda == 'ru':
                phonemes.append('ru')
        elif char.strip():
            phonemes.append(char)  # passthrough non-Hangul
    return phonemes if phonemes else ['-']


# ─────────────────────────────────────────────────────────────────────────────

class KoreanForTetoAddon(CompositeAddon):
    id          = 'ko_basic_teto'
    name        = 'Korean Basics for Kasane Teto'
    description = 'Korean Hangul → JP CV phonemes for Teto voice banks.'
    author      = 'MilkmanAbi'
    version     = '1.0.0'
    license     = 'MIT'

    # ── Inner: LanguagePack ───────────────────────────────────────────────

    class KoreanPack(LanguagePack):
        id      = 'ko_basic_teto__lang'
        handles = ['ko']

        def text_to_phonemes(self, text, lang, context):
            words   = text.strip().split()
            result  = []
            for word in words:
                phonemes = hangul_to_jp_cv(word)
                result.append(phonemes)
            return result

        def get_word_overrides(self):
            # Common Korean words with hand-tuned Teto phonemes
            return [
                WordOverrideEntry('사랑', ['sa', 'ra', 'ng'],
                    language='ko', note='Love — sounds natural on Teto'),
                WordOverrideEntry('하늘', ['ha', 'neu', 'ru'],
                    language='ko', note='Sky'),
                WordOverrideEntry('바람', ['ba', 'ra', 'mu'],
                    language='ko', note='Wind'),
                WordOverrideEntry('꿈', ['kku', 'mu'],
                    language='ko', note='Dream'),
                WordOverrideEntry('별', ['byo', 'ru'],
                    language='ko', note='Star'),
                WordOverrideEntry('마음', ['ma', 'e', 'mu'],
                    language='ko', note='Heart/Mind'),
            ]

    # ── Inner: VoicebankMapper ────────────────────────────────────────────

    class TetoMapper(VoicebankMapper):
        id           = 'ko_basic_teto__mapper'
        phoneme_set  = 'jp_cv'
        target_banks = ['Kasane Teto', 'Kasane Teto V1.0', 'Kasane Teto SV']

        # All supported Teto CV phonemes
        supported_phonemes = {
            'a','i','u','e','o',
            'ka','ki','ku','ke','ko',
            'sa','shi','su','se','so',
            'ta','chi','tsu','te','to',
            'na','ni','nu','ne','no',
            'ha','hi','fu','he','ho',
            'ma','mi','mu','me','mo',
            'ya','yu','yo',
            'ra','ri','ru','re','ro',
            'wa','wi','we','wo','n',
            'ga','gi','gu','ge','go',
            'za','ji','zu','ze','zo',
            'da','di','du','de','do',
            'ba','bi','bu','be','bo',
            'pa','pi','pu','pe','po',
            'cha','chi','chu','che','cho',
            'br',  # breath
        }

        def map_phonemes(self, phonemes, singability, context=None):
            tokens = []
            for i, ph in enumerate(phonemes):
                sym = ph.symbol
                is_vowel = ph.phon_class == PhonemeClass.VOWEL
                tokens.append(SynthToken(
                    phoneme=sym,
                    display=sym,
                    duration_hint=0.45 if is_vowel else 0.18,
                    beat_weight=1.0 if is_vowel else 0.5,
                    is_vowel=is_vowel,
                    stressed=ph.stress == StressLevel.PRIMARY,
                    phon_class=ph.phon_class,
                    word_index=ph.word_index,
                    syllable_index=ph.syllable_index,
                    mlc_confidence=0.72,
                    g2p_source=ph.g2p_source,
                    source_phoneme=ph.symbol,
                    source_word=ph.source_word,
                    note='ko_teto',
                ))
            return tokens

        def get_voice_profile(self):
            return VoiceProfileSpec(
                voicebank_id='kasane_teto',
                voicebank_name='Kasane Teto',
                optimal_breathiness=28,
                optimal_tension=60,
                optimal_gender=20,  # Teto is feminine
                optimal_singability=0.68,
                notes=(
                    'Teto has a bright, slightly nasal quality. '
                    'Keep tension at 60 for Korean lyrics — higher causes harshness on velar stops. '
                    'Her \'r\' phoneme maps naturally to Korean \'r/l\' sounds.'
                ),
                recommended_module='jp_cv_standard',
            )

    # ── CompositeAddon.get_components ─────────────────────────────────────

    def get_components(self):
        lang   = self.KoreanPack()
        mapper = self.TetoMapper()
        lang.data_dir   = self.data_dir
        mapper.data_dir = self.data_dir
        return [lang, mapper]
