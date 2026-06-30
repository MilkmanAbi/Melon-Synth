"""
MLC Pipeline
============
Orchestrates the full conversion from raw text to SynthTokens.

Stages:
  1. Language detection
  2. Text normalisation       (contractions, numbers, abbreviations)
  3. G2P via phonemizer       (espeak-ng under the hood)
  4. Syllabification + stress
  5. PhonemeToken construction
  6. Voicebank module mapping
  7. Postprocessing + validation
"""

import re
import logging
from typing import Optional

from mlc_base import VoicebankModule, PhonemeToken, SynthToken, ConversionResult

log = logging.getLogger('mlc.pipeline')

# ── Text normalisation rules ───────────────────────────────────────────────

CONTRACTIONS = {
    "i'm":      "i am",
    "i'll":     "i will",
    "i've":     "i have",
    "i'd":      "i would",
    "you're":   "you are",
    "you'll":   "you will",
    "you've":   "you have",
    "you'd":    "you would",
    "he's":     "he is",
    "she's":    "she is",
    "it's":     "it is",
    "we're":    "we are",
    "we'll":    "we will",
    "we've":    "we have",
    "we'd":     "we would",
    "they're":  "they are",
    "they'll":  "they will",
    "they've":  "they have",
    "they'd":   "they would",
    "that's":   "that is",
    "there's":  "there is",
    "here's":   "here is",
    "who's":    "who is",
    "what's":   "what is",
    "don't":    "do not",
    "doesn't":  "does not",
    "didn't":   "did not",
    "can't":    "cannot",
    "couldn't": "could not",
    "wouldn't": "would not",
    "shouldn't":"should not",
    "won't":    "will not",
    "isn't":    "is not",
    "aren't":   "are not",
    "wasn't":   "was not",
    "weren't":  "were not",
    "haven't":  "have not",
    "hasn't":   "has not",
    "hadn't":   "had not",
    "let's":    "let us",
    "that'll":  "that will",
}

# ── ARPAbet vowels ─────────────────────────────────────────────────────────

ARPABET_VOWELS = {
    'AA','AE','AH','AO','AW','AY',
    'EH','ER','EY',
    'IH','IY',
    'OW','OY',
    'UH','UW',
}


class MLCPipeline:
    """
    The main conversion pipeline. Instantiated once, reused across requests.
    Heavy imports (phonemizer, nltk) are done lazily on first use.
    """

    def __init__(self):
        self._phonemizer = None
        self._lang_detect = None
        self._nltk_ready  = False

    # ── Lazy initialisation ────────────────────────────────────────────────

    def _ensure_phonemizer(self):
        if self._phonemizer is not None:
            return
        try:
            from phonemizer import phonemize
            from phonemizer.backend import EspeakBackend
            # Warm up the backend
            EspeakBackend.version()
            self._phonemizer = phonemize
            log.info('phonemizer ready (espeak-ng backend)')
        except Exception as e:
            log.error(f'phonemizer init failed: {e}')
            raise RuntimeError(
                'phonemizer or espeak-ng not installed. '
                'Run: pip install phonemizer && apt install espeak-ng'
            ) from e

    def _ensure_nltk(self):
        if self._nltk_ready:
            return
        try:
            import nltk
            # Download required corpora silently
            for corpus in ['cmudict', 'averaged_perceptron_tagger', 'punkt']:
                try:
                    nltk.data.find(f'corpora/{corpus}' if corpus != 'punkt' else f'tokenizers/{corpus}')
                except LookupError:
                    nltk.download(corpus, quiet=True)
            self._nltk_ready = True
            log.info('nltk corpora ready')
        except Exception as e:
            log.warning(f'nltk init partial: {e}')
            self._nltk_ready = True  # proceed without it

    # ── Stage 1: Language detection ────────────────────────────────────────

    def detect_language(self, text: str) -> str:
        try:
            from langdetect import detect
            return detect(text)
        except Exception:
            return 'en'

    # ── Stage 2: Text normalisation ────────────────────────────────────────

    def normalise(self, text: str, lang: str) -> str:
        # Lowercase
        result = text.lower().strip()

        # Expand contractions (English only)
        if lang == 'en':
            for contraction, expanded in CONTRACTIONS.items():
                result = re.sub(
                    r'\b' + re.escape(contraction) + r'\b',
                    expanded,
                    result
                )

        # Convert numbers to words (simple — extend as needed)
        result = re.sub(r'\b(\d+)\b', lambda m: _num_to_words(int(m.group(1))), result)

        # Strip remaining punctuation except hyphens between words
        result = re.sub(r"[,!?;:()[\]{}'\"\.…]+", ' ', result)
        result = re.sub(r'\s+', ' ', result).strip()

        return result

    # ── Stage 3: G2P ──────────────────────────────────────────────────────

    def grapheme_to_phoneme(self, text: str, lang: str) -> list[list[str]]:
        """
        Returns a list of words, each a list of ARPAbet symbols.
        Uses espeak-ng via phonemizer, then converts IPA → ARPAbet.
        """
        self._ensure_phonemizer()

        # Map our lang codes to espeak language codes
        espeak_lang = {
            'en': 'en-us',
            'ja': 'ja',
            'zh': 'cmn',   # Mandarin
            'ko': 'ko',
            'fr': 'fr',
            'de': 'de',
            'es': 'es',
            'it': 'it',
            'pt': 'pt',
            'ru': 'ru',
        }.get(lang, 'en-us')

        words = text.split()
        result = []

        for word in words:
            # Get IPA from phonemizer
            try:
                ipa = self._phonemizer(
                    word,
                    language=espeak_lang,
                    backend='espeak',
                    with_stress=True,
                    strip=True,
                )
                ipa = ipa.strip()
                arpabet = ipa_to_arpabet(ipa)
            except Exception as e:
                log.warning(f'G2P failed for "{word}": {e}, using fallback')
                arpabet = fallback_g2p(word)

            result.append(arpabet)

        return result

    # ── Stage 4: Syllabification and stress ───────────────────────────────

    def syllabify_and_stress(
        self,
        word: str,
        phonemes: list[str],
        lang: str,
    ) -> list[dict]:
        """
        Returns syllable groups: [{'phonemes': [...], 'stressed': bool}]
        Uses CMUdict for English if available, falls back to rule-based.
        """
        self._ensure_nltk()

        # Try CMUdict first for English
        if lang == 'en':
            try:
                from nltk.corpus import cmudict
                entries = cmudict.dict()
                word_lower = word.lower().strip("'")
                if word_lower in entries:
                    cmu_phones = entries[word_lower][0]  # first pronunciation
                    return _cmu_to_syllables(cmu_phones)
            except Exception:
                pass

        # Rule-based fallback
        return _rule_based_syllabify(phonemes)

    # ── Stage 5: Build PhonemeTokens ───────────────────────────────────────

    def build_tokens(
        self,
        words: list[str],
        phoneme_lists: list[list[str]],
        syllable_groups: list[list[dict]],
    ) -> list[PhonemeToken]:
        tokens: list[PhonemeToken] = []

        for word_idx, (word, phonemes, syllables) in enumerate(
            zip(words, phoneme_lists, syllable_groups)
        ):
            # Flatten phonemes with syllable/stress metadata
            flat_phonemes_with_meta: list[tuple[str, int, int, bool]] = []
            # (symbol, syllable_idx, stress, is_vowel)

            for syl_idx, syl in enumerate(syllables):
                stressed = syl.get('stressed', False)
                for ph in syl.get('phonemes', []):
                    flat_phonemes_with_meta.append((
                        ph,
                        syl_idx,
                        1 if stressed else 0,
                        ph in ARPABET_VOWELS,
                    ))

            total = len(flat_phonemes_with_meta)
            for i, (sym, syl_idx, stress, is_vowel) in enumerate(flat_phonemes_with_meta):
                # Determine syllable onset/coda
                syl_phonemes = [p for p in flat_phonemes_with_meta if p[1] == syl_idx]
                is_onset = flat_phonemes_with_meta[i][1] != (flat_phonemes_with_meta[i-1][1] if i > 0 else -1)
                is_coda  = flat_phonemes_with_meta[i][1] != (flat_phonemes_with_meta[i+1][1] if i < total-1 else -1)

                # Find source text (best effort)
                source = word

                tokens.append(PhonemeToken(
                    symbol=sym,
                    is_vowel=is_vowel,
                    stress=stress,
                    word_index=word_idx,
                    syllable_index=syl_idx,
                    is_syllable_onset=is_onset,
                    is_syllable_coda=is_coda,
                    is_word_start=(i == 0),
                    is_word_end=(i == total - 1),
                    source_text=source,
                ))

        return tokens

    # ── Full pipeline ──────────────────────────────────────────────────────

    def convert(
        self,
        text: str,
        module: VoicebankModule,
        singability: float,
        lang: Optional[str] = None,
    ) -> dict:
        """
        Full pipeline: text → ConversionResult dict.
        """
        warnings: list[str] = []

        # 1. Language detection
        detected_lang = lang or self.detect_language(text)

        # 2. Normalisation
        normalised = self.normalise(text, detected_lang)
        words = normalised.split()

        if not words:
            return ConversionResult(
                tokens=[], words=[], word_boundaries=[],
                language_detected=detected_lang,
                module_id=module.id, singability=singability,
                warnings=['Empty input after normalisation'],
            ).to_dict()

        # 3. G2P
        try:
            phoneme_lists = self.grapheme_to_phoneme(normalised, detected_lang)
        except RuntimeError as e:
            return ConversionResult(
                tokens=[], words=words, word_boundaries=[],
                language_detected=detected_lang,
                module_id=module.id, singability=singability,
                warnings=[str(e)],
            ).to_dict()

        # 4. Syllabification + stress
        syllable_groups = []
        for word, phonemes in zip(words, phoneme_lists):
            sg = self.syllabify_and_stress(word, phonemes, detected_lang)
            syllable_groups.append(sg)

        # 5. Build PhonemeTokens
        phoneme_tokens = self.build_tokens(words, phoneme_lists, syllable_groups)

        # 6. Voicebank module mapping
        synth_tokens = module.map_phonemes(phoneme_tokens, singability)

        # 7. Postprocessing
        synth_tokens = module.postprocess(synth_tokens, singability)

        # 8. Validation
        mod_warnings = module.validate(synth_tokens)
        warnings.extend(mod_warnings)

        # 9. Build word boundaries
        word_boundaries: list[tuple[int, int]] = []
        for word_idx in range(len(words)):
            indices = [i for i, t in enumerate(synth_tokens) if t.word_index == word_idx]
            if indices:
                word_boundaries.append((indices[0], indices[-1]))
            else:
                word_boundaries.append((-1, -1))

        return ConversionResult(
            tokens=synth_tokens,
            words=words,
            word_boundaries=word_boundaries,
            language_detected=detected_lang,
            module_id=module.id,
            singability=singability,
            warnings=warnings,
        ).to_dict()


# ── IPA → ARPAbet conversion ──────────────────────────────────────────────
# espeak-ng outputs IPA; we convert to ARPAbet-style symbols for
# consistency across the pipeline. Modules then map from ARPAbet.

IPA_TO_ARPABET: dict[str, str] = {
    # Vowels
    'æ': 'AE', 'ɑ': 'AA', 'ɔ': 'AO', 'ə': 'AH', 'ɛ': 'EH',
    'ɪ': 'IH', 'i': 'IY', 'ɨ': 'IH', 'ʊ': 'UH', 'u': 'UW',
    'ʌ': 'AH', 'e': 'EY', 'o': 'OW',
    # Diphthongs
    'aɪ': 'AY', 'aʊ': 'AW', 'ɔɪ': 'OY', 'eɪ': 'EY', 'oʊ': 'OW',
    'ɪə': 'IH', 'ʊə': 'UH', 'eə': 'EH',
    # R-coloured
    'ɚ': 'ER', 'ɝ': 'ER', 'ɑr': 'AA R', 'ɔr': 'AO R',
    # Consonants
    'p': 'P', 'b': 'B', 't': 'T', 'd': 'D', 'k': 'K', 'g': 'G',
    'f': 'F', 'v': 'V', 'θ': 'TH', 'ð': 'DH', 's': 'S', 'z': 'Z',
    'ʃ': 'SH', 'ʒ': 'ZH', 'h': 'HH', 'tʃ': 'CH', 'dʒ': 'JH',
    'm': 'M', 'n': 'N', 'ŋ': 'NG', 'l': 'L', 'r': 'R', 'w': 'W',
    'j': 'Y',
    # Stress markers (espeak uses ˈ and ˌ)
    'ˈ': '__PRIMARY_STRESS__',
    'ˌ': '__SECONDARY_STRESS__',
}

def ipa_to_arpabet(ipa: str) -> list[str]:
    """Convert an IPA string to a list of ARPAbet symbols."""
    result: list[str] = []
    i = 0
    # Strip stress markers for now — they'll be re-inserted via CMUdict
    ipa = ipa.replace('ˈ', '').replace('ˌ', '').replace('ː', '')

    while i < len(ipa):
        # Try 2-char match first
        two = ipa[i:i+2]
        if two in IPA_TO_ARPABET:
            mapped = IPA_TO_ARPABET[two]
            if mapped:
                result.extend(mapped.split())
            i += 2
            continue
        # Then 1-char
        one = ipa[i]
        if one in IPA_TO_ARPABET:
            mapped = IPA_TO_ARPABET[one]
            if mapped:
                result.extend(mapped.split())
        elif one not in ' .,-':
            log.debug(f'Unknown IPA symbol: {repr(one)}')
        i += 1

    return result


def fallback_g2p(word: str) -> list[str]:
    """Very simple fallback G2P for when phonemizer isn't available."""
    # Just return the word as a sequence of rough ARPAbet guesses
    vowel_map = {'a':'AE','e':'EH','i':'IH','o':'AO','u':'AH','y':'IY'}
    consonant_map = {
        'b':'B','c':'K','d':'D','f':'F','g':'G','h':'HH','j':'JH',
        'k':'K','l':'L','m':'M','n':'N','p':'P','q':'K','r':'R',
        's':'S','t':'T','v':'V','w':'W','x':'K','z':'Z',
    }
    result = []
    for ch in word.lower():
        if ch in vowel_map:
            result.append(vowel_map[ch])
        elif ch in consonant_map:
            result.append(consonant_map[ch])
    return result or ['AH']


def _cmu_to_syllables(cmu_phones: list[str]) -> list[dict]:
    """Convert CMUdict phoneme list (with stress digits) to syllable groups."""
    syllables: list[dict] = []
    current_phonemes: list[str] = []
    current_stressed = False

    for phone in cmu_phones:
        # CMUdict format: 'AE1' (vowel+stress), 'K' (consonant)
        stress = None
        if phone[-1].isdigit():
            stress = int(phone[-1])
            symbol = phone[:-1]
        else:
            symbol = phone

        is_vowel = symbol in ARPABET_VOWELS

        if is_vowel and current_phonemes:
            # Start new syllable at each vowel (simplified: vowel = nucleus)
            if not any(p in ARPABET_VOWELS for p in current_phonemes):
                # Onset consonants belong to this vowel's syllable
                current_phonemes.append(symbol)
                current_stressed = (stress == 1)
            else:
                syllables.append({'phonemes': current_phonemes, 'stressed': current_stressed})
                current_phonemes = [symbol]
                current_stressed = (stress == 1)
        else:
            current_phonemes.append(symbol)
            if is_vowel:
                current_stressed = (stress == 1)

    if current_phonemes:
        syllables.append({'phonemes': current_phonemes, 'stressed': current_stressed})

    return syllables or [{'phonemes': cmu_phones, 'stressed': False}]


def _rule_based_syllabify(phonemes: list[str]) -> list[dict]:
    """Fallback syllabifier: one syllable per vowel."""
    if not phonemes:
        return [{'phonemes': [], 'stressed': False}]

    syllables: list[dict] = []
    current: list[str] = []
    found_vowel = False

    for ph in phonemes:
        is_vowel = ph in ARPABET_VOWELS
        if is_vowel and found_vowel:
            syllables.append({'phonemes': current, 'stressed': False})
            current = [ph]
        else:
            current.append(ph)
            if is_vowel:
                found_vowel = True

    if current:
        syllables.append({'phonemes': current, 'stressed': False})

    # Mark first syllable as stressed if none are
    if syllables and not any(s['stressed'] for s in syllables):
        syllables[0]['stressed'] = True

    return syllables


# ── Number to words (simple English) ──────────────────────────────────────

_ONES = ['','one','two','three','four','five','six','seven','eight','nine',
         'ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen',
         'seventeen','eighteen','nineteen']
_TENS = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety']

def _num_to_words(n: int) -> str:
    if n == 0: return 'zero'
    if n < 0:  return 'negative ' + _num_to_words(-n)
    if n < 20: return _ONES[n]
    if n < 100:
        return _TENS[n//10] + ('' if n%10==0 else ' ' + _ONES[n%10])
    if n < 1000:
        return _ONES[n//100] + ' hundred' + ('' if n%100==0 else ' ' + _num_to_words(n%100))
    return str(n)  # give up for large numbers
