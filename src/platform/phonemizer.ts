/**
 * Melon Synth - browser phonemizer (g2p).
 *
 * Backs window.mlc when there is no Python engine (the web build). It converts
 * lyric text into singable phoneme tokens: Japanese kana is split into morae
 * and kept as kana (so it matches the aliases in typical JP UTAU banks
 * directly), and basic Latin text is approximated into CV syllables. This is
 * the same class of rule engine the app already shipped as an Electron
 * fallback, lifted into a reusable module. Pyodide + the real MLC can be
 * dropped in later behind the same window.mlc shape.
 */

export interface MlcToken {
  phoneme: string; display: string; duration_hint: number;
  is_vowel: boolean; stressed: boolean; word_index: number;
  syllable_index: number; mlc_confidence: number; g2p_source: string;
  source_phoneme: string; source_word: string; note: string; phon_class: string;
}
export interface MlcResult {
  tokens: MlcToken[]; words: string[]; word_boundaries: [number, number][];
  language: string; module_id: string; singability: number;
  confidence_score: number; warnings: string[]; processing_ms: number;
  from_cache: boolean; token_count: number;
}

const KANA = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;

function katToHira(ch: string): string {
  const c = ch.charCodeAt(0);
  return c >= 0x30a1 && c <= 0x30f6 ? String.fromCharCode(c - 0x60) : ch;
}

const SMALL = new Set(['ゃ', 'ゅ', 'ょ', 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ']);
const VOWELS_KANA = new Set(['あ', 'い', 'う', 'え', 'お', 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ']);

/** Split Japanese into mora-sized kana units (keeps kana, merges small kana). */
function splitJapanese(word: string): string[] {
  const chars = [...word].map(katToHira);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i], nxt = chars[i + 1];
    if (nxt && SMALL.has(nxt)) { out.push(c + nxt); i++; }
    else out.push(c);
  }
  return out.filter(Boolean);
}

const EN_CONS: Record<string, string> = {
  sh: 'sha', ch: 'cha', ts: 'tsu', th: 'sa', ph: 'fa', wh: 'wa', qu: 'ku',
  b: 'ba', c: 'ka', d: 'da', f: 'fa', g: 'ga', h: 'ha', j: 'ja', k: 'ka',
  l: 'ra', m: 'ma', n: 'na', p: 'pa', q: 'ku', r: 'ra', s: 'sa', t: 'ta',
  v: 'ba', w: 'wa', x: 'ku', y: 'ya', z: 'za',
};
const VOWEL_MAP: Record<string, string> = { a: 'a', e: 'e', i: 'i', o: 'o', u: 'u' };

/** Approximate a Latin word into CV romaji syllables. */
function splitEnglish(word: string): string[] {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return [];
  const out: string[] = [];
  let i = 0;
  while (i < w.length) {
    const rest = w.slice(i);
    let matched = false;
    for (const cons of Object.keys(EN_CONS).sort((a, b) => b.length - a.length)) {
      if (rest.startsWith(cons)) {
        const after = rest.slice(cons.length);
        const v = after.match(/^[aeiou]/)?.[0];
        if (v) { out.push(EN_CONS[cons].slice(0, -1) + VOWEL_MAP[v]); i += cons.length + 1; }
        else { out.push(EN_CONS[cons]); i += cons.length; }
        matched = true; break;
      }
    }
    if (!matched) {
      const v = rest.match(/^[aeiou]/)?.[0];
      if (v) { out.push(v); i++; } else i++;
    }
  }
  return out.length ? out : [w[0] ?? 'a'];
}

export function detectLang(text: string): 'ja' | 'en' {
  const ja = (text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g) || []).length;
  const en = (text.match(/[a-zA-Z]/g) || []).length;
  return ja >= en ? 'ja' : 'en';
}

const isVowelToken = (t: string) => VOWELS_KANA.has(t) || /[aiueo]$/.test(t);

export function phonemize(text: string, moduleId = 'jp_cv_standard'): MlcResult {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const lang = detectLang(text);
  const words = text.trim().split(/\s+/).filter(Boolean);
  const tokens: MlcToken[] = [];
  const boundaries: [number, number][] = [];
  let conf = 0, n = 0;

  words.forEach((word, wi) => {
    const isJa = KANA.test(word) || lang === 'ja';
    const sylls = isJa ? splitJapanese(word) : splitEnglish(word);
    const startTok = tokens.length;
    sylls.forEach((syl, si) => {
      const c = isJa && KANA.test(syl) ? 0.85 : 0.55;
      conf += c; n++;
      tokens.push({
        phoneme: syl, display: syl, duration_hint: 0.4,
        is_vowel: isVowelToken(syl), stressed: si === 0, word_index: wi,
        syllable_index: si, mlc_confidence: c, g2p_source: 'browser-rules',
        source_phoneme: syl, source_word: word, note: '', phon_class: isVowelToken(syl) ? 'vowel' : 'consonant',
      });
    });
    boundaries.push([startTok, tokens.length]);
  });

  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  return {
    tokens, words, word_boundaries: boundaries,
    language: lang, module_id: moduleId,
    singability: 0.65, confidence_score: n ? conf / n : 0.5,
    warnings: n ? [] : ['No singable text'], processing_ms: Math.max(1, Math.round(t1 - t0)),
    from_cache: false, token_count: tokens.length,
  };
}

export const BUILTIN_MODULES = [
  { id: 'jp_cv_standard', name: 'JP CV Standard', description: 'Kasane Teto, Defoko style', author: 'Melon', version: '1.0.0', language: 'ja', languages: ['ja'], phoneme_set: 'jp_cv', target_banks: ['cv'], from_bundle: true, source: 'builtin' },
  { id: 'jp_cvvc_miku', name: 'JP CVVC', description: 'CVVC Japanese', author: 'Melon', version: '1.0.0', language: 'ja', languages: ['ja'], phoneme_set: 'jp_cvvc', target_banks: ['cvvc'], from_bundle: true, source: 'builtin' },
  { id: 'en_arpabet', name: 'English (basic)', description: 'Latin to CV approximation', author: 'Melon', version: '1.0.0', language: 'en', languages: ['en'], phoneme_set: 'romaji_cv', target_banks: ['cv', 'cvvc'], from_bundle: true, source: 'builtin' },
];
