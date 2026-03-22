/**
 * MLC — Melon Lyric Conversion Engine
 * Phoneme Data Layer
 *
 * ARPAbet phoneme set → JP-style voicebank phoneme mappings
 * Covers: Kasane Teto, Defoko/Utane Uta, Miku-style CVVC, standard hiragana UTAU
 *
 * Accuracy slider (0.0–1.0):
 *   0.0 = maximum singability  (aggressive simplification, closest Japanese syllable)
 *   1.0 = maximum accuracy     (preserves consonant clusters, diphthongs, etc.)
 */

// ── Voicebank phoneme sets ─────────────────────────────────────────────────

export type VoicebankType = 'jp_cv' | 'jp_cvvc' | 'arpabet' | 'xsampa';

export interface VoicebankProfile {
  id: VoicebankType;
  name: string;
  /** Available phonemes in this bank */
  phonemes: Set<string>;
  /** Syllable structure: CV only, or CVVC with transitions */
  structure: 'cv' | 'cvvc';
}

export const VOICEBANK_PROFILES: Record<VoicebankType, VoicebankProfile> = {
  jp_cv: {
    id: 'jp_cv',
    name: 'Japanese CV (Teto, Defoko, standard UTAU)',
    structure: 'cv',
    phonemes: new Set([
      // Vowels
      'a','i','u','e','o',
      // CV syllables
      'ka','ki','ku','ke','ko',
      'sa','si','su','se','so',  // si = shi in practice
      'ta','ti','tu','te','to',  // ti=chi, tu=tsu
      'na','ni','nu','ne','no',
      'ha','hi','hu','he','ho',  // hu = fu
      'ma','mi','mu','me','mo',
      'ya','yu','yo',
      'ra','ri','ru','re','ro',
      'wa','wi','we','wo',
      'ga','gi','gu','ge','go',
      'za','zi','zu','ze','zo',
      'da','di','du','de','do',
      'ba','bi','bu','be','bo',
      'pa','pi','pu','pe','po',
      // Extended
      'sha','shi','shu','she','sho',
      'cha','chi','chu','che','cho',
      'tsa','tsu',
      'fa','fi','fu','fe','fo',
      'va','vi','vu','ve','vo',
      'kya','kyu','kyo',
      'nya','nyu','nyo',
      'hya','hyu','hyo',
      'mya','myu','myo',
      'rya','ryu','ryo',
      'gya','gyu','gyo',
      'bya','byu','byo',
      'pya','pyu','pyo',
      // Coda / special
      'n','N',  // nasal coda
      'q',      // glottal/double consonant marker
      '-',      // breath / pause
    ]),
  },
  jp_cvvc: {
    id: 'jp_cvvc',
    name: 'Japanese CVVC (Miku-style, Kasane V4+)',
    structure: 'cvvc',
    phonemes: new Set([
      // All CV phonemes plus VC transitions
      'a','i','u','e','o',
      'a k','a s','a t','a n','a h','a m','a r','a w','a g','a z','a d','a b','a p',
      'i k','i s','i t','i n','i h','i m','i r','i g','i z','i d','i b','i p',
      'u k','u s','u t','u n','u h','u m','u r','u g','u z','u d','u b','u p',
      'e k','e s','e t','e n','e h','e m','e r','e g','e z','e d','e b','e p',
      'o k','o s','o t','o n','o h','o m','o r','o g','o z','o d','o b','o p',
      // Plus all jp_cv phonemes
      'ka','ki','ku','ke','ko','sa','si','su','se','so','ta','ti','tu','te','to',
      'na','ni','nu','ne','no','ha','hi','hu','he','ho','ma','mi','mu','me','mo',
      'ya','yu','yo','ra','ri','ru','re','ro','wa','wo',
      'ga','gi','gu','ge','go','za','zi','zu','ze','zo','da','di','du','de','do',
      'ba','bi','bu','be','bo','pa','pi','pu','pe','po',
      'sha','shi','shu','sho','cha','chi','chu','cho','tsu','fu',
      'n','N','q','-',
    ]),
  },
  arpabet: {
    id: 'arpabet',
    name: 'ARPAbet (Western VCCV/VCV)',
    structure: 'cvvc',
    phonemes: new Set([
      'AA','AE','AH','AO','AW','AY','B','CH','D','DH','EH','ER','EY',
      'F','G','HH','IH','IY','JH','K','L','M','N','NG','OW','OY',
      'P','R','S','SH','T','TH','UH','UW','V','W','Y','Z','ZH',
    ]),
  },
  xsampa: {
    id: 'xsampa',
    name: 'X-SAMPA',
    structure: 'cvvc',
    phonemes: new Set([]), // expanded separately
  },
};

// ── ARPAbet → JP CV mapping ────────────────────────────────────────────────
// Each ARPAbet phoneme maps to:
//   accurate:   string[]  — accurate representation (may use multiple phonemes)
//   singable:   string[]  — simplified, maximally singable version
//
// The slider interpolates between these two

export interface PhonemeMapping {
  accurate: string[];
  singable: string[];
  /** Phoneme class for rhythm weighting */
  class: 'vowel' | 'consonant' | 'liquid' | 'nasal' | 'fricative' | 'stop' | 'affricate';
}

export const ARPABET_TO_JP: Record<string, PhonemeMapping> = {
  // ── Vowels ──
  'AA': { accurate: ['a'],          singable: ['a'],    class: 'vowel' },   // "father"
  'AE': { accurate: ['e','a'],      singable: ['a'],    class: 'vowel' },   // "cat" → between e and a
  'AH': { accurate: ['a'],          singable: ['a'],    class: 'vowel' },   // "but" (reduced)
  'AO': { accurate: ['o'],          singable: ['o'],    class: 'vowel' },   // "thought"
  'AW': { accurate: ['a','u'],      singable: ['a'],    class: 'vowel' },   // "how" (diphthong)
  'AY': { accurate: ['a','i'],      singable: ['a'],    class: 'vowel' },   // "my"
  'EH': { accurate: ['e'],          singable: ['e'],    class: 'vowel' },   // "bed"
  'ER': { accurate: ['a'],          singable: ['a'],    class: 'vowel' },   // "bird" — no R-coloured vowel in JP
  'EY': { accurate: ['e','i'],      singable: ['e'],    class: 'vowel' },   // "say"
  'IH': { accurate: ['i'],          singable: ['i'],    class: 'vowel' },   // "kit"
  'IY': { accurate: ['i'],          singable: ['i'],    class: 'vowel' },   // "fleece"
  'OW': { accurate: ['o','u'],      singable: ['o'],    class: 'vowel' },   // "go"
  'OY': { accurate: ['o','i'],      singable: ['o'],    class: 'vowel' },   // "boy"
  'UH': { accurate: ['u'],          singable: ['u'],    class: 'vowel' },   // "foot"
  'UW': { accurate: ['u'],          singable: ['u'],    class: 'vowel' },   // "goose"

  // ── Stops ──
  'B':  { accurate: ['b'],          singable: ['b'],    class: 'stop' },
  'D':  { accurate: ['d'],          singable: ['d'],    class: 'stop' },
  'G':  { accurate: ['g'],          singable: ['g'],    class: 'stop' },
  'K':  { accurate: ['k'],          singable: ['k'],    class: 'stop' },
  'P':  { accurate: ['p'],          singable: ['p'],    class: 'stop' },
  'T':  { accurate: ['t'],          singable: ['t'],    class: 'stop' },

  // ── Fricatives ──
  'DH': { accurate: ['z'],          singable: ['z'],    class: 'fricative' }, // "the" → z approximation
  'F':  { accurate: ['f'],          singable: ['f'],    class: 'fricative' },
  'HH': { accurate: ['h'],          singable: ['h'],    class: 'fricative' },
  'S':  { accurate: ['s'],          singable: ['s'],    class: 'fricative' },
  'SH': { accurate: ['sh'],         singable: ['sh'],   class: 'fricative' },
  'TH': { accurate: ['s'],          singable: ['s'],    class: 'fricative' }, // "think" → s (no θ in JP)
  'V':  { accurate: ['v'],          singable: ['b'],    class: 'fricative' }, // V→b in singable (no V in JP CV)
  'Z':  { accurate: ['z'],          singable: ['z'],    class: 'fricative' },
  'ZH': { accurate: ['z'],          singable: ['z'],    class: 'fricative' }, // "measure"

  // ── Affricates ──
  'CH': { accurate: ['ch'],         singable: ['ch'],   class: 'affricate' }, // "church"
  'JH': { accurate: ['j'],          singable: ['j'],    class: 'affricate' }, // "judge" — map to za/zi row

  // ── Nasals ──
  'M':  { accurate: ['m'],          singable: ['m'],    class: 'nasal' },
  'N':  { accurate: ['n'],          singable: ['n'],    class: 'nasal' },
  'NG': { accurate: ['N'],          singable: ['n'],    class: 'nasal' },    // "sing" coda nasal

  // ── Liquids / Approximants ──
  'L':  { accurate: ['r'],          singable: ['r'],    class: 'liquid' },   // L→r (no L in JP)
  'R':  { accurate: ['r'],          singable: ['r'],    class: 'liquid' },
  'W':  { accurate: ['w'],          singable: ['w'],    class: 'liquid' },
  'Y':  { accurate: ['y'],          singable: ['y'],    class: 'liquid' },
};

// ── Consonant + Vowel → JP syllable resolution ────────────────────────────
// When we have C+V pairs, resolve to canonical JP syllable

export const CV_TO_SYLLABLE: Record<string, string> = {
  // K row
  'ka':'ka','ki':'ki','ku':'ku','ke':'ke','ko':'ko',
  // S row
  'sa':'sa','si':'shi','su':'su','se':'se','so':'so',
  'sha':'sha','shi':'shi','shu':'shu','she':'she','sho':'sho',
  // T row
  'ta':'ta','ti':'chi','tu':'tsu','te':'te','to':'to',
  'cha':'cha','chi':'chi','chu':'chu','che':'che','cho':'cho',
  'tsa':'tsa','tsu':'tsu',
  // N row
  'na':'na','ni':'ni','nu':'nu','ne':'ne','no':'no',
  // H row
  'ha':'ha','hi':'hi','hu':'fu','he':'he','ho':'ho',
  'fa':'fa','fi':'fi','fu':'fu','fe':'fe','fo':'fo',
  // M row
  'ma':'ma','mi':'mi','mu':'mu','me':'me','mo':'mo',
  // Y row
  'ya':'ya','yi':'i','yu':'yu','ye':'e','yo':'yo',
  // R row
  'ra':'ra','ri':'ri','ru':'ru','re':'re','ro':'ro',
  // W row
  'wa':'wa','wi':'i','wu':'u','we':'e','wo':'wo',
  // G row
  'ga':'ga','gi':'gi','gu':'gu','ge':'ge','go':'go',
  // Z row
  'za':'za','zi':'ji','zu':'zu','ze':'ze','zo':'zo',
  'ja':'ja','ji':'ji','ju':'ju','je':'je','jo':'jo',
  // D row
  'da':'da','di':'di','du':'du','de':'de','do':'do',
  // B row
  'ba':'ba','bi':'bi','bu':'bu','be':'be','bo':'bo',
  // P row
  'pa':'pa','pi':'pi','pu':'pu','pe':'pe','po':'po',
  // V row (singable: map to B)
  'va':'ba','vi':'bi','vu':'bu','ve':'be','vo':'bo',
};

// ── Exception dictionary ───────────────────────────────────────────────────
// Hand-tuned entries for common English words that G2P gets wrong
// or that have better singable forms
// Format: word (lowercase) → ARPAbet phoneme string

export const EXCEPTION_DICT: Record<string, string[]> = {
  // Irregular pronunciations
  'the':       ['DH','AH'],
  'a':         ['AH'],
  'an':        ['AE','N'],
  'are':       ['AA','R'],
  'were':      ['W','ER'],
  'was':       ['W','AH','Z'],
  'have':      ['HH','AE','V'],
  'has':       ['HH','AE','Z'],
  'had':       ['HH','AE','D'],
  'do':        ['D','UW'],
  'does':      ['D','AH','Z'],
  'done':      ['D','AH','N'],
  'gone':      ['G','AO','N'],
  'come':      ['K','AH','M'],
  'some':      ['S','AH','M'],
  'love':      ['L','AH','V'],
  'above':     ['AH','B','AH','V'],
  'of':        ['AH','V'],
  'off':       ['AO','F'],
  'one':       ['W','AH','N'],
  'once':      ['W','AH','N','S'],
  'two':       ['T','UW'],
  'who':       ['HH','UW'],
  'you':       ['Y','UW'],
  'your':      ['Y','AO','R'],
  'i':         ['AY'],
  "i'm":       ['AY','M'],
  "i'll":      ['AY','L'],
  "i've":      ['AY','V'],
  "i'd":       ['AY','D'],
  "you're":    ['Y','UW','R'],
  "you'll":    ['Y','UW','L'],
  "we're":     ['W','IY','R'],
  "they're":   ['DH','EH','R'],
  "it's":      ['IH','T','S'],
  "that's":    ['DH','AE','T','S'],
  "don't":     ['D','OW','N','T'],
  "can't":     ['K','AE','N','T'],
  "won't":     ['W','OW','N','T'],
  "wouldn't":  ['W','UH','D','AH','N','T'],
  "couldn't":  ['K','UH','D','AH','N','T'],
  "shouldn't": ['SH','UH','D','AH','N','T'],
  // Music-relevant words
  'heart':     ['HH','AA','R','T'],
  'dream':     ['D','R','IY','M'],
  'night':     ['N','AY','T'],
  'light':     ['L','AY','T'],
  'bright':    ['B','R','AY','T'],
  'sky':       ['S','K','AY'],
  'fly':       ['F','L','AY'],
  'cry':       ['K','R','AY'],
  'try':       ['T','R','AY'],
  'eyes':      ['AY','Z'],
  'time':      ['T','AY','M'],
  'mine':      ['M','AY','N'],
  'shine':     ['SH','AY','N'],
  'fire':      ['F','AY','ER'],
  'higher':    ['HH','AY','ER'],
  'flower':    ['F','L','AW','ER'],
  'power':     ['P','AW','ER'],
  'forever':   ['F','ER','EH','V','ER'],
  'together':  ['T','AH','G','EH','DH','ER'],
  'beautiful': ['B','Y','UW','T','AH','F','AH','L'],
  'wonderful': ['W','AH','N','D','ER','F','AH','L'],
  'lonely':    ['L','OW','N','L','IY'],
  'only':      ['OW','N','L','IY'],
  'every':     ['EH','V','R','IY'],
  'never':     ['N','EH','V','ER'],
  'always':    ['AO','L','W','EY','Z'],
  'someday':   ['S','AH','M','D','EY'],
  'tomorrow':  ['T','AH','M','AO','R','OW'],
  'yesterday': ['Y','EH','S','T','ER','D','EY'],
  'memory':    ['M','EH','M','ER','IY'],
  'melody':    ['M','EH','L','AH','D','IY'],
  'harmony':   ['HH','AA','R','M','AH','N','IY'],
  'symphony':  ['S','IH','M','F','AH','N','IY'],
  'voice':     ['V','OY','S'],
  'choice':    ['CH','OY','S'],
  'noise':     ['N','OY','Z'],
  'breath':    ['B','R','EH','TH'],
  'death':     ['D','EH','TH'],
  'earth':     ['ER','TH'],
  'worth':     ['W','ER','TH'],
  'truth':     ['T','R','UW','TH'],
  'youth':     ['Y','UW','TH'],
};

// ── Stress patterns by syllable count ─────────────────────────────────────
// Default stress positions (0-indexed) for words with N syllables
// Used when CMUdict doesn't have the word

export const DEFAULT_STRESS: Record<number, number[]> = {
  1: [0],
  2: [0],       // PENcil, MUsic
  3: [0],       // BEAUtiful, WONderful
  4: [1],       // imPORtant, toGEther
  5: [1],       // reMEMber that
  6: [2],       // underSTANding
};
