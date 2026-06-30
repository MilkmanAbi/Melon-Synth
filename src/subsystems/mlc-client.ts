/**
 * MLC Client
 * ==========
 * Thin wrapper around window.mlc (Electron) with a browser fallback
 * that uses a basic rule-based phonemizer so the app is testable
 * without Python running.
 *
 * All components call this, never window.mlc directly.
 */

export interface ConversionToken {
  phoneme:       string;
  display:       string;
  duration_hint: number;
  is_vowel:      boolean;
  stressed:      boolean;
  word_index:    number;
  mlc_confidence: number;
  g2p_source:    string;
  note:          string;
}

export interface ConversionResult {
  tokens:           ConversionToken[];
  words:            string[];
  language:         string;
  module_id:        string;
  singability:      number;
  confidence_score: number;
  warnings:         string[];
  processing_ms:    number;
  from_cache:       boolean;
}

export interface ModuleInfo {
  id:          string;
  name:        string;
  description: string;
  language:    string;
  version:     string;
  from_bundle: boolean;
}

// ── Fallback rule-based phonemizer ───────────────────────────────────────────
// Works for Japanese (hiragana/katakana) and basic English when MLC Python isn't available.
// Good enough for UI testing. Real conversion uses the Python engine.

// Detect if text is predominantly Japanese
function detectLang(text: string): 'ja' | 'en' {
  const ja = (text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g) || []).length;
  const en = (text.match(/[a-zA-Z]/g) || []).length;
  return ja > en ? 'ja' : 'en';
}

// Japanese hiragana to syllables - each character is roughly one mora
const HIRAGANA_MAP: Record<string, string> = {
  'あ':'a','い':'i','う':'u','え':'e','お':'o',
  'か':'ka','き':'ki','く':'ku','け':'ke','こ':'ko',
  'さ':'sa','し':'shi','す':'su','せ':'se','そ':'so',
  'た':'ta','ち':'chi','つ':'tsu','て':'te','と':'to',
  'な':'na','に':'ni','ぬ':'nu','ね':'ne','の':'no',
  'は':'ha','ひ':'hi','ふ':'fu','へ':'he','ほ':'ho',
  'ま':'ma','み':'mi','む':'mu','め':'me','も':'mo',
  'や':'ya','ゆ':'yu','よ':'yo',
  'ら':'ra','り':'ri','る':'ru','れ':'re','ろ':'ro',
  'わ':'wa','を':'wo','ん':'n',
  'が':'ga','ぎ':'gi','ぐ':'gu','げ':'ge','ご':'go',
  'ざ':'za','じ':'ji','ず':'zu','ぜ':'ze','ぞ':'zo',
  'だ':'da','ぢ':'di','づ':'du','で':'de','ど':'do',
  'ば':'ba','び':'bi','ぶ':'bu','べ':'be','ぼ':'bo',
  'ぱ':'pa','ぴ':'pi','ぷ':'pu','ぺ':'pe','ぽ':'po',
  'きゃ':'kya','きゅ':'kyu','きょ':'kyo',
  'しゃ':'sha','しゅ':'shu','しょ':'sho',
  'ちゃ':'cha','ちゅ':'chu','ちょ':'cho',
  'にゃ':'nya','にゅ':'nyu','にょ':'nyo',
  'ひゃ':'hya','ひゅ':'hyu','ひょ':'hyo',
  'みゃ':'mya','みゅ':'myu','みょ':'myo',
  'りゃ':'rya','りゅ':'ryu','りょ':'ryo',
  'ぎゃ':'gya','ぎゅ':'gyu','ぎょ':'gyo',
  'じゃ':'ja','じゅ':'ju','じょ':'jo',
  'びゃ':'bya','びゅ':'byu','びょ':'byo',
  'ぴゃ':'pya','ぴゅ':'pyu','ぴょ':'pyo',
  'っ':'q', // small tsu = glottal stop
  'ー':'-', // long vowel mark
};

// Katakana to hiragana conversion offset
function katakanaToHiragana(char: string): string {
  const code = char.charCodeAt(0);
  if (code >= 0x30A1 && code <= 0x30F6) {
    return String.fromCharCode(code - 0x60);
  }
  return char;
}

function parseJapanese(word: string): string[] {
  const syllables: string[] = [];
  let i = 0;
  const chars = [...word].map(c => katakanaToHiragana(c));
  
  while (i < chars.length) {
    // Try 2-char combinations first (small kana combinations)
    if (i + 1 < chars.length) {
      const two = chars[i] + chars[i+1];
      if (HIRAGANA_MAP[two]) {
        syllables.push(HIRAGANA_MAP[two]);
        i += 2;
        continue;
      }
    }
    // Single char
    const one = chars[i];
    if (HIRAGANA_MAP[one]) {
      syllables.push(HIRAGANA_MAP[one]);
    } else if (/[\u4E00-\u9FAF]/.test(one)) {
      // Kanji - just use as-is (can't romanize without dictionary)
      syllables.push(one);
    } else if (one.trim()) {
      syllables.push(one);
    }
    i++;
  }
  return syllables.length ? syllables : ['-'];
}

const ENGLISH_SYLLABLE_RULES: [RegExp, string][] = [
  [/tion/gi,  'sho'],  [/sion/gi, 'sho'],
  [/ture/gi,  'cha'],  [/ous/gi,  'a'],
  [/ight/gi,  'i'],    [/ough/gi, 'o'],
  [/tion/gi,  'sho'],  [/ly/gi,   'ri'],
  [/ing/gi,   'ingu'], [/ed$/gi,  'do'],
  [/er$/gi,   'a'],    [/est$/gi, 'sto'],
  [/ful$/gi,  'fu'],   [/ness$/gi,'ne'],
  [/less$/gi, 're'],   [/ment$/gi,'me'],
  [/tion$/gi, 'sho'],  [/al$/gi,  'a'],
  [/[aeiou]+/gi, (m: string) => {
    const map: Record<string,string> = {a:'a',e:'e',i:'i',o:'o',u:'u',ae:'e',ai:'a',
      ao:'a',au:'o',ea:'i',ee:'i',ei:'e',eo:'e',eu:'yu',ia:'i',ie:'i',io:'i',
      iu:'yu',oa:'o',oe:'o',oi:'o',ou:'u',ua:'a',ue:'e',ui:'i',uo:'o'};
    return map[m.toLowerCase()] ?? m[0];
  }],
];

function fallbackEnToJP(word: string): string[] {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return ['-'];

  const syllables: string[] = [];
  let i = 0;
  while (i < w.length) {
    const rest = w.slice(i);
    const CONSONANT_MAP: Record<string,string> = {
      'sh':'sha','ch':'cha','ts':'tsu','ph':'fa',
      'wh':'wa', 'th':'sa', 'qu':'ku',
      'b':'ba','c':'ka','d':'da','f':'fa','g':'ga',
      'h':'ha','j':'ji','k':'ka','l':'ra','m':'ma',
      'n':'na','p':'pa','q':'ku','r':'ra','s':'sa',
      't':'ta','v':'ba','w':'wa','x':'ku','y':'ya','z':'za',
    };

    let matched = false;
    for (const [cons, base] of Object.entries(CONSONANT_MAP).sort((a,b) => b[0].length - a[0].length)) {
      if (rest.startsWith(cons)) {
        const after = rest.slice(cons.length);
        const vowel = after.match(/^[aeiou]/)?.[0];
        if (vowel) {
          const VOWEL_MAP: Record<string,string> = {a:'a',e:'e',i:'i',o:'o',u:'u'};
          const cv = base.slice(0,-1) + VOWEL_MAP[vowel];
          syllables.push(cv);
          i += cons.length + 1;
        } else {
          syllables.push(base);
          i += cons.length;
        }
        matched = true;
        break;
      }
    }
    if (!matched) {
      const vowel = rest.match(/^[aeiou]/)?.[0];
      if (vowel) { syllables.push(vowel); i++; }
      else { i++; }
    }
  }
  return syllables.length ? syllables : [w[0] ?? 'a'];
}

function fallbackConvert(text: string, moduleId: string): ConversionResult {
  const lang = detectLang(text);
  const words = text.trim().split(/\s+/).filter(Boolean);
  const tokens: ConversionToken[] = [];
  let wordIdx = 0;
  let totalConf = 0;
  let tokenCount = 0;

  for (const word of words) {
    const syllables = lang === 'ja' ? parseJapanese(word) : fallbackEnToJP(word);
    syllables.forEach((syl, si) => {
      // Higher confidence for Japanese (direct mapping) vs English (approximation)
      const conf = lang === 'ja' ? 0.85 : 0.55;
      totalConf += conf;
      tokenCount++;
      
      tokens.push({
        phoneme:        syl,
        display:        syl,
        duration_hint:  0.4,
        is_vowel:       /[aeiou]$/.test(syl),
        stressed:       si === 0,
        word_index:     wordIdx,
        mlc_confidence: conf,
        g2p_source:     'fallback-rules',
        note:           '',
      });
    });
    wordIdx++;
  }

  const avgConf = tokenCount > 0 ? totalConf / tokenCount : 0.5;

  return {
    tokens,
    words,
    language:        lang,
    module_id:       moduleId,
    singability:     0.65,
    confidence_score: avgConf,
    warnings:        ['Using built-in rule engine — install Python + MLC for better accuracy'],
    processing_ms:   1,
    from_cache:      false,
  };
}

// ── Main client API ──────────────────────────────────────────────────────────

const hasMLCBridge = (): boolean =>
  typeof window !== 'undefined' && typeof (window as any).mlc?.convert === 'function';

let _modules: ModuleInfo[] | null = null;

export const mlcClient = {
  async convert(params: {
    text:        string;
    moduleId?:   string;
    singability?: number;
    lang?:       string;
  }): Promise<ConversionResult> {
    if (hasMLCBridge()) {
      return (window as any).mlc.convert(params);
    }
    // Small artificial delay so UI feedback feels real
    await new Promise(r => setTimeout(r, 80));
    return fallbackConvert(params.text, params.moduleId ?? 'jp_cv_standard');
  },

  async preview(params: { text:string; moduleId?:string; singability?:number }): Promise<ConversionResult> {
    if (hasMLCBridge()) {
      try {
        return await (window as any).mlc.preview(params);
      } catch (e: any) {
        // Older engine versions don't have 'preview' action — fall back to convert
        if (e.message?.includes('unknown action')) {
          return (window as any).mlc.convert(params);
        }
        throw e;
      }
    }
    return fallbackConvert(params.text, params.moduleId ?? 'jp_cv_standard');
  },

  async listModules(): Promise<ModuleInfo[]> {
    if (_modules) return _modules;
    if (hasMLCBridge()) {
      _modules = await (window as any).mlc.listModules();
      return _modules!;
    }
    return [
      { id:'jp_cv_standard', name:'JP CV Standard',  description:'Kasane Teto, Defoko', language:'ja', version:'1.0.0', from_bundle:false },
      { id:'jp_cvvc_miku',   name:'JP CVVC (Miku)',   description:'Hatsune Miku CVVC',   language:'ja', version:'1.0.0', from_bundle:false },
      { id:'en_arpabet',     name:'English ARPAbet',  description:'VCCV / CVVC passthrough', language:'en', version:'1.0.0', from_bundle:false },
    ];
  },

  async detectLanguage(text: string): Promise<string> {
    if (hasMLCBridge()) {
      const r = await (window as any).mlc.detectLanguage(text);
      return r.lang;
    }
    return detectLang(text);
  },

  async suggestSingability(text: string, moduleId: string): Promise<{ suggested: number; reason: string }> {
    if (hasMLCBridge()) {
      return (window as any).mlc.suggestSingability({ text, moduleId });
    }
    return { suggested: 0.65, reason: 'Standard setting' };
  },

  get isLive(): boolean { return hasMLCBridge(); },
};
