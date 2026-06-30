# Melon Synth — MLC Engine
# Copyright (C) 2026 Abinaash (MilkmanAbi)
# SPDX-License-Identifier: GPL-3.0-or-later
# https://github.com/MilkmanAbi/Melon-Synth

#!/usr/bin/env python3
"""
MLC Engine v2 — Melon Lyric Conversion Engine
==============================================
The IPC server. Electron spawns this once, keeps it running.
Communicates via newline-delimited JSON on stdin/stdout.

New in v2:
  - Core pipeline split into proper modules (core/)
  - Registry with .mlc bundle support + hot-reload
  - G2P cache (SQLite, massive perf improvement)
  - Phrase cache (full result caching)
  - Confidence scoring with per-token indicators
  - Language auto-detection
  - Multiple language support via espeak-ng

Install:
  pip install phonemizer langdetect nltk
  [system] apt install espeak-ng   (or brew/winget equivalent)

Run standalone test:
  echo '{"id":"t1","action":"convert","text":"beautiful dream","module_id":"jp_cv_standard","singability":0.6}' | python mlc_engine_v2.py
"""

import sys
import os
import json
import logging
import traceback
import time
from pathlib import Path

# Render subsystem (lazy-loaded to keep startup fast)
_render_bridge = None
_ust_gen = None
def _get_render():
    global _render_bridge, _ust_gen
    if _render_bridge is None:
        sys.path.insert(0, str(ROOT / 'render'))
        from render_bridge import (
            find_openutau, find_singers_dir, list_installed_voicebanks,
            detect_music_editors, open_in_editor, render as do_render,
        )
        from ust_generator import write_ust_file, generate_ust
        _render_bridge = {
            'find_openutau':           find_openutau,
            'find_singers_dir':        find_singers_dir,
            'list_installed_voicebanks': list_installed_voicebanks,
            'detect_music_editors':    detect_music_editors,
            'open_in_editor':          open_in_editor,
            'render':                  do_render,
            'write_ust_file':          write_ust_file,
            'generate_ust':            generate_ust,
        }

    return _render_bridge

# ── Path setup ────────────────────────────────────────────────────────────

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'core'))

# ── Logging ───────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='[MLC %(levelname)s %(name)s] %(message)s',
    stream=sys.stderr,
)
log = logging.getLogger('mlc')

# ── Config ────────────────────────────────────────────────────────────────

BUILTIN_MODULES_DIR = ROOT / 'modules'
USER_MODULES_DIR    = Path(os.environ.get('MLC_MODULES_DIR', ROOT / 'user_modules'))
CACHE_DIR           = Path(os.environ.get('MLC_CACHE_DIR',  ROOT / '.cache'))

USER_MODULES_DIR.mkdir(exist_ok=True)
CACHE_DIR.mkdir(exist_ok=True)

# ── Lazy globals ──────────────────────────────────────────────────────────

_registry  = None
_g2p       = None
_g2p_cache = None
_p_cache   = None
_scorer    = None


def get_registry():
    global _registry
    if _registry is None:
        # Use AddonRegistry — wraps MLCRegistry and adds WordOverride/Corrector/etc dispatch
        from addon_registry import AddonRegistry
        _registry = AddonRegistry(BUILTIN_MODULES_DIR, USER_MODULES_DIR)
        _registry.discover_all()
        _registry.start_watching()
    return _registry


def get_g2p():
    global _g2p
    if _g2p is None:
        from core.g2p import G2PEngine
        _g2p = G2PEngine()
    return _g2p


def get_g2p_cache():
    global _g2p_cache
    if _g2p_cache is None:
        from core.cache import G2PCache
        _g2p_cache = G2PCache(CACHE_DIR / 'g2p.db')
    return _g2p_cache


def get_phrase_cache():
    global _p_cache
    if _p_cache is None:
        from core.cache import PhraseCache
        _p_cache = PhraseCache(CACHE_DIR / 'phrases.db')
    return _p_cache


def get_scorer():
    global _scorer
    if _scorer is None:
        from core.confidence import ConfidenceScorer
        _scorer = ConfidenceScorer()
    return _scorer


# ── Action handlers ───────────────────────────────────────────────────────

def handle_ping(_msg: dict):
    return {
        'status':  'ok',
        'version': '2.0.0',
        'api':     '1.0.0',
        'modules': len(get_registry()._vb_registry._modules),
        'cache':   get_g2p_cache().stats(),
    }


def handle_list_modules(_msg: dict):
    return get_registry().list_all().get('voicebank_mappers', [])


def handle_detect_lang(msg: dict):
    text = msg.get('text', '').strip()
    if not text:
        return {'lang': 'en', 'confidence': 0.0}
    try:
        from langdetect import detect_langs
        results = detect_langs(text)
        if results:
            return {
                'lang':       results[0].lang,
                'confidence': round(results[0].prob, 3),
                'all':        [{'lang': r.lang, 'prob': round(r.prob, 3)} for r in results],
            }
    except Exception:
        pass
    return {'lang': 'en', 'confidence': 0.5}


def handle_install_module(msg: dict):
    """Install a .mlc bundle from a file path."""
    path_str = msg.get('path', '')
    if not path_str:
        raise ValueError('path is required')
    path = Path(path_str)
    if not path.exists():
        raise FileNotFoundError(f'File not found: {path}')
    if path.suffix.lower() != '.mlc':
        raise ValueError(f'Not a .mlc file: {path.name}')
    result = get_registry().install_bundle(path)
    return {'status': result, 'path': str(path)}


def handle_list_all_addons(_msg: dict):
    """List all addon types from the unified AddonRegistry."""
    return get_registry().list_all()


def handle_reload_module(msg: dict):
    module_id = msg.get('module_id', '')
    if not module_id:
        raise ValueError('module_id is required')
    result = get_registry().reload(module_id)
    return {'status': result, 'module_id': module_id}


def handle_cache_stats(_msg: dict):
    return {
        'g2p':    get_g2p_cache().stats(),
        'phrase': get_phrase_cache().stats(),
    }


def handle_cache_clear(msg: dict):
    target = msg.get('target', 'all')  # 'g2p', 'phrase', 'all'
    lang   = msg.get('lang', None)
    if target in ('g2p', 'all'):
        get_g2p_cache().clear(lang)
    if target in ('phrase', 'all'):
        get_phrase_cache().clear()
    return {'cleared': target}


def _run_pipeline(text: str, module_id: str, singability: float,
                  lang: str, use_cache: bool = False, trace: bool = False):
    """
    Core MLC pipeline. Called by handle_convert and handle_get_pipeline_trace.
    Returns (result_dict, pipeline_trace_list).
    """
    registry = get_registry()
    module   = registry.get(module_id)
    if module is None:
        available = [m['id'] for m in registry.list_all()['voicebank_mappers']]
        raise ValueError(f'Module "{module_id}" not found. Available: {available}')

    t_start = time.time()
    pipeline_trace = []

    # Stage 0: Language detection
    if not lang:
        try:
            from langdetect import detect
            lang = detect(text)
        except ImportError:
            # langdetect not installed — detect by Unicode script as best-effort
            if any('가' <= ch <= '힣' for ch in text):
                lang = 'ko'   # Hangul
            elif any('぀' <= ch <= 'ヿ' or '一' <= ch <= '鿿' for ch in text):
                lang = 'ja'   # Japanese/CJK
            elif any('一' <= ch <= '鿿' for ch in text):
                lang = 'zh'
            else:
                lang = 'en'
        except Exception:
            lang = 'en'
    if trace: pipeline_trace.append({'stage': 'language_detected', 'lang': lang})

    # Stage 1: WordOverride check (BEFORE G2P — highest priority)
    word_overrides = registry.get_word_overrides(module_id, lang)
    if trace:
        pipeline_trace.append({
            'stage': 'word_override_check',
            'active': [w.id for w in word_overrides],
        })

    # Stage 2: G2P — check for CustomG2P first
    g2p = get_g2p()
    custom_g2p = registry.get_custom_g2p(lang)

    words_raw = text.strip().split()
    overridden_words = []

    # G2P priority: CustomG2P > LanguagePack > built-in espeak
    lang_pack  = registry.get_language_pack(lang)

    if custom_g2p:
        if trace: pipeline_trace.append({'stage': 'g2p', 'backend': f'custom:{custom_g2p.id}'})
        try:
            from api.mlc_api_types import G2POptions, MLCContext
            opts = G2POptions(singability=singability, target_module_id=module_id)
            g2p_result = custom_g2p.transcribe(text, lang, opts)
            ipf_phonemes = g2p_result.phonemes
            words = g2p_result.words
            normalised = text
        except Exception as e:
            log.warning(f'CustomG2P {custom_g2p.id} failed, falling back: {e}')
            ipf_phonemes, words, normalised = g2p.process(text, lang)

    elif lang_pack:
        # LanguagePack: text_to_phonemes() returns list[list[str]] — one inner list per word
        if trace: pipeline_trace.append({'stage': 'g2p', 'backend': f'langpack:{lang_pack.id}'})
        try:
            import types as _lp_t
            _ctx = _lp_t.SimpleNamespace(
                module_id=module_id, language=lang, singability=singability,
                voicebank_name='', session_id='', extra={},
            )
            normalised_text = lang_pack.normalise(text, lang) if hasattr(lang_pack, 'normalise') else text
            # Support both new API (text_to_phonemes) and old API (decompose)
            if hasattr(lang_pack, 'text_to_phonemes'):
                phoneme_groups = lang_pack.text_to_phonemes(normalised_text, lang, _ctx)
            elif hasattr(lang_pack, 'decompose'):
                phoneme_groups = lang_pack.decompose(normalised_text, lang)
            else:
                raise AttributeError(f'{lang_pack.__class__.__name__} has no text_to_phonemes or decompose method')
            words = normalised_text.strip().split()

            # Convert raw string groups → IPFPhoneme-like objects the voicebank module can map
            # We create minimal IPFPhoneme stubs so map_phonemes works
            from core.mlc_types import IPFPhoneme, PhonemeClass, StressLevel, G2PSource
            JP_VOWELS = frozenset([
                'a','i','u','e','o','ya','yu','yo','wa','wi','we','wo',
                'ae','ai','au','oi','ui','ou',
                'AA','AE','AH','AO','AW','AY','EH','ER','EY','IH','IY','OW','OY','UH','UW'
            ])
            ipf_phonemes = []
            global_i = 0
            for wi, (word, phs) in enumerate(zip(words, phoneme_groups)):
                n = len(phs)
                for si, ph_str in enumerate(phs):
                    is_v = ph_str.lower() in JP_VOWELS or ph_str in JP_VOWELS
                    ipf_phonemes.append(IPFPhoneme(
                        symbol=ph_str,
                        phon_class=PhonemeClass.VOWEL if is_v else PhonemeClass.UNKNOWN,
                        word_index=wi,
                        syllable_index=si,
                        phoneme_index=si,
                        global_index=global_i,
                        stress=StressLevel.NONE,
                        beat_weight=1.0 if is_v else 0.5,
                        duration_hint=0.45 if is_v else 0.18,
                        is_onset=(si == 0),
                        is_nucleus=is_v,
                        is_coda=(si == n - 1 and not is_v),
                        is_word_start=(si == 0),
                        is_word_end=(si == n - 1),
                        is_vowel=is_v,
                        source_grapheme=ph_str,
                        source_word=word,
                        g2p_source=G2PSource.RULES,
                    ))
                    global_i += 1
            normalised = normalised_text
        except Exception as e:
            log.warning(f'LanguagePack {lang_pack.id} failed, falling back to builtin: {e}')
            import traceback; traceback.print_exc()
            ipf_phonemes, words, normalised = g2p.process(text, lang)

    else:
        ipf_phonemes, words, normalised = g2p.process(text, lang)
        if trace: pipeline_trace.append({'stage': 'g2p', 'backend': 'builtin'})

    # Apply WordOverrides per word
    if word_overrides:
        for i, (ph, word) in enumerate(zip(ipf_phonemes, words)):
            for wo in word_overrides:
                import types as _t
                _ctx = _t.SimpleNamespace(
                    module_id=module_id, language=lang, singability=singability,
                    word_index=i, total_words=len(words),
                    prev_word=words[i-1] if i > 0 else '',
                    next_word=words[i+1] if i < len(words)-1 else '',
                )
                override = wo.get_override(word.lower(), _ctx)
                if override is not None:
                    overridden_words.append(word)
                    break  # word is overridden, stop checking
        if trace and overridden_words:
            pipeline_trace.append({'stage': 'word_overrides_applied', 'words': overridden_words})

    # Stage 3: PhonemeCorrector pass (after G2P, before mapping)
    correctors = registry.get_correctors(module_id, lang)
    for corrector in correctors:
        try:
            ipf_phonemes = corrector.correct(ipf_phonemes, words, lang, module_id)
            if trace: pipeline_trace.append({'stage': 'phoneme_corrector', 'id': corrector.id})
        except Exception as e:
            log.warning(f'PhonemeCorrector {corrector.id} failed: {e}')

    # Stage 4: Voicebank module mapping
    if trace: pipeline_trace.append({'stage': 'voicebank_map', 'module': module_id})
    import types as _vb_t
    _vb_ctx = _vb_t.SimpleNamespace(
        module_id=module_id, language=lang, singability=singability,
        bpm=120.0, session_id='', extra={},
    )
    # Support both old (2-arg) and new (3-arg) map_phonemes signatures
    try:
        synth_tokens = module.map_phonemes(ipf_phonemes, singability, _vb_ctx)
    except TypeError:
        synth_tokens = module.map_phonemes(ipf_phonemes, singability)
    # Same for postprocess
    try:
        synth_tokens = module.postprocess(synth_tokens, singability, _vb_ctx)
    except TypeError:
        synth_tokens = module.postprocess(synth_tokens, singability)

    # Stage 5: OutputPostprocessor addons (after module's own postprocess)
    postprocessors = registry.get_postprocessors(module_id, lang)
    for pp in postprocessors:
        try:
            from api.mlc_api_types import PostprocessContext
            ctx = PostprocessContext(
                module_id=module_id, language=lang,
                singability=singability, original_words=words,
            )
            synth_tokens = pp.postprocess(synth_tokens, ctx)
            if trace: pipeline_trace.append({'stage': 'output_postprocessor', 'id': pp.id})
        except Exception as e:
            log.warning(f'OutputPostprocessor {pp.id} failed: {e}')

    return synth_tokens, words, normalised, lang, t_start, pipeline_trace


def handle_convert(msg: dict):
    text        = msg.get('text', '').strip()
    module_id   = msg.get('module_id', 'jp_cv_standard')
    singability = float(msg.get('singability', 0.5))
    lang        = msg.get('lang', None)
    use_cache   = bool(msg.get('cache', True))

    if not text:
        raise ValueError('text is required')
    if not (0.0 <= singability <= 1.0):
        raise ValueError('singability must be in [0.0, 1.0]')

    # Check phrase cache first
    registry = get_registry()
    module   = registry.get(module_id)
    if module is None:
        available = [m['id'] for m in registry.list_all().get('voicebank_mappers', [])]
        raise ValueError(f'Module "{module_id}" not found. Available: {available}')

    t_start = time.time()
    if use_cache:
        cached = get_phrase_cache().get(text, lang or '', module_id, module.version, singability)
        if cached:
            cached['from_cache'] = True
            cached['processing_ms'] = int((time.time() - t_start) * 1000)
            return cached

    synth_tokens, words, normalised, lang, t_start, _ = \
        _run_pipeline(text, module_id, singability, lang, use_cache=False, trace=False)

    # Confidence scoring
    scorer = get_scorer()
    synth_tokens, warnings, overall_conf = scorer.score(
        synth_tokens,
        module.supported_phonemes,
        lang,
        module.phoneme_set,
    )

    # Build word boundaries
    word_boundaries: list[tuple[int, int]] = []
    for word_idx in range(len(words)):
        indices = [i for i, t in enumerate(synth_tokens) if t.word_index == word_idx]
        word_boundaries.append((indices[0], indices[-1]) if indices else (-1, -1))

    # Build phrase breaks (at punctuation gaps or long pauses in original)
    phrase_breaks: list[int] = []
    for i, w in enumerate(words):
        if i > 0 and i < len(words) - 1:
            if len(words[i-1]) > 4 and len(words[i]) > 4:  # simple heuristic
                pass  # real impl: use punctuation in original text

    from core.mlc_types import ConversionOutput
    output = ConversionOutput(
        tokens=synth_tokens,
        words=words,
        word_boundaries=word_boundaries,
        phrase_breaks=phrase_breaks,
        language=lang,
        module_id=module_id,
        singability=singability,
        confidence_score=overall_conf,
        warnings=warnings,
        processing_ms=int((time.time() - t_start) * 1000),
    )
    result = output.to_dict()
    result['from_cache'] = False

    # Store in phrase cache
    if use_cache:
        get_phrase_cache().put(text, lang, module_id, module.version, singability, result)

    return result


def handle_preview(msg: dict):
    """
    Quick preview: convert just the first 10 words.
    Used by the UI for live preview as the user types.
    """
    text = msg.get('text', '').strip()
    words = text.split()[:10]
    msg['text'] = ' '.join(words)
    msg['cache'] = True
    return handle_convert(msg)


def handle_suggest_singability(msg: dict):
    """
    Analyse the text and suggest a good starting singability value.
    Returns {'suggested': float, 'reason': str}
    """
    text = msg.get('text', '').strip()
    lang = msg.get('lang', 'en')
    module_id = msg.get('module_id', 'jp_cv_standard')

    # Heuristics:
    # - Many consonant clusters → lower singability (need accuracy)
    # - Short words, lots of vowels → higher singability (can simplify)
    # - JP target → 0.65 is usually right for pop

    words = text.lower().split()
    if not words:
        return {'suggested': 0.5, 'reason': 'Default'}

    avg_len = sum(len(w) for w in words) / len(words)
    vowel_ratio = sum(1 for c in text.lower() if c in 'aeiou') / max(len(text), 1)

    if module_id.startswith('jp'):
        if avg_len > 6 and vowel_ratio < 0.3:
            return {'suggested': 0.45, 'reason': 'Long words with few vowels — keeping more detail'}
        elif avg_len <= 4 or vowel_ratio > 0.45:
            return {'suggested': 0.75, 'reason': 'Short words / vowel-heavy — simplified will flow naturally'}
        else:
            return {'suggested': 0.65, 'reason': 'Standard J-pop setting'}
    else:
        return {'suggested': 0.5, 'reason': 'Balanced default'}



def handle_detect_system(_msg: dict):
    """Detect OpenUTAU, voicebanks, and music editors on this machine."""
    r = _get_render()
    ou_path     = r['find_openutau']()
    singers_dir = r['find_singers_dir']()
    voicebanks  = r['list_installed_voicebanks'](singers_dir) if singers_dir else []
    editors     = r['detect_music_editors']()
    return {
        'openutau': {
            'path':      str(ou_path) if ou_path else None,
            'found':     ou_path is not None,
        },
        'singers_dir': str(singers_dir) if singers_dir else None,
        'voicebanks': voicebanks,
        'editors':    editors,
    }


def handle_list_voicebanks(msg: dict):
    r = _get_render()
    custom_dir = msg.get('singers_dir')
    singers_dir = Path(custom_dir) if custom_dir else r['find_singers_dir']()
    return r['list_installed_voicebanks'](singers_dir)


def handle_detect_editors(_msg: dict):
    return _get_render()['detect_music_editors']()


def handle_generate_ust(msg: dict):
    """Generate a .ust file with full expression + flag support."""
    r = _get_render()
    notes        = msg.get('notes', [])
    bpm          = float(msg.get('tempo', 120.0))
    voice_dir    = msg.get('voice_dir')
    project_name = msg.get('project_name', 'melon_project')
    out_wav      = msg.get('out_wav')
    ust_path     = msg.get('save_path') or msg.get('ust_path')
    track_params = msg.get('track_params', {})
    pitch_points = msg.get('pitch_points', [])

    ust_text = r['generate_ust'](
        notes=notes, bpm=bpm, voice_dir=voice_dir,
        project_name=project_name, track_params=track_params,
        pitch_points=pitch_points, out_wav=out_wav,
    )

    saved_to = None
    if ust_path:
        Path(ust_path).parent.mkdir(parents=True, exist_ok=True)
        Path(ust_path).write_text(ust_text, encoding='utf-8-sig')
        saved_to = ust_path

    return {'ust': ust_text, 'saved_to': saved_to}


def handle_render(msg: dict):
    """Full render pipeline: notes → UST → OpenUTAU → WAV."""
    import tempfile, os
    r = _get_render()

    tmp_dir  = Path(tempfile.mkdtemp(prefix='melon_render_'))
    ust_path = tmp_dir / 'project.ust'
    wav_path = msg.get('out_wav', str(tmp_dir / 'render.wav'))

    # Generate UST with full expression support
    ust_text = r['generate_ust'](
        notes        = msg.get('notes', []),
        bpm          = float(msg.get('tempo', 120.0)),
        voice_dir    = msg.get('voice_dir') or msg.get('voicebank_path'),
        project_name = msg.get('project_name', 'melon_project'),
        track_params = msg.get('track_params', {}),
        pitch_points = msg.get('pitch_points', []),
        out_wav      = wav_path,
    )
    ust_path.write_text(ust_text, encoding='utf-8-sig')

    result = r['render'](
        ust_path       = str(ust_path),
        wav_out_path   = wav_path,
        voicebank_path = msg.get('voicebank_path') or msg.get('voice_dir'),
        openutau_path  = msg.get('openutau_path'),
        timeout_s      = int(msg.get('timeout_s', 300)),
    )
    res = result.to_dict()
    res['ust_path'] = str(ust_path)
    return res


def handle_get_pipeline_trace(msg: dict):
    """
    Run the full pipeline with tracing enabled.
    Returns step-by-step trace of which stage/addon processed at each point.
    Used by the Extensions > Debug tab in the UI.
    """
    text        = msg.get('text', '').strip()
    module_id   = msg.get('module_id', 'jp_cv_standard')
    singability = float(msg.get('singability', 0.65))
    lang        = msg.get('lang', None)
    if not text:
        return {'trace': [], 'error': 'text is required'}
    try:
        synth_tokens, words, normalised, lang, t_start, trace = \
            _run_pipeline(text, module_id, singability, lang, use_cache=False, trace=True)
        return {
            'trace': trace,
            'token_count': len(synth_tokens),
            'word_count': len(words),
            'language': lang,
        }
    except Exception as e:
        return {'trace': [], 'error': str(e)}


def handle_open_editor(msg: dict):
    r = _get_render()
    return r['open_in_editor'](
        editor_id   = msg.get('editor_id', 'ardour'),
        wav_path    = msg.get('wav_path', ''),
        editor_path = msg.get('editor_path'),
    )


# ── Addon manager ────────────────────────────────────────────────────────────

_addon_manager = None

def _get_manager():
    global _addon_manager
    if _addon_manager is None:
        from addon_manager import AddonManager
        registry = get_registry()
        _addon_manager = AddonManager(user_dir=USER_MODULES_DIR, registry=registry)
    return _addon_manager


# ── Dispatch table ────────────────────────────────────────────────────────

def handle_install_addon(msg: dict):
    # Clear phrase cache after install — cached results may be wrong now
    _clear_phrase_cache = True
    """Install a .mlc addon from file path or URL."""
    mgr = _get_manager()
    source = msg.get('source') or msg.get('path') or msg.get('url', '')
    result = mgr.install(source)
    # Clear phrase cache — newly installed addon may change future conversions
    if isinstance(result, dict) and result.get('ok'):
        try: get_phrase_cache().clear('all')
        except Exception: pass
    return result


def handle_remove_addon(msg: dict):
    """Remove an installed addon by ID."""
    mgr = _get_manager()
    addon_id = msg.get('addon_id') or msg.get('id', '')
    return mgr.remove(addon_id)


def handle_list_addons_full(msg: dict):
    """List all installed addons with full metadata."""
    mgr = _get_manager()
    return {'addons': mgr.list_installed()}


def handle_check_updates(msg: dict):
    """Check for addon updates from update_url fields."""
    mgr = _get_manager()
    addon_ids = msg.get('addon_ids')  # None = check all
    updates = mgr.check_updates(addon_ids=addon_ids, timeout=msg.get('timeout', 8))
    return {'updates': updates, 'count': len(updates)}


def handle_apply_update(msg: dict):
    """Download and install an addon update."""
    mgr = _get_manager()
    addon_id     = msg.get('addon_id', '')
    download_url = msg.get('download_url', '')
    return mgr.apply_update(addon_id, download_url)


def handle_get_addon_info(msg: dict):
    """Get metadata for one addon."""
    mgr = _get_manager()
    addon_id = msg.get('addon_id') or msg.get('id', '')
    meta = mgr.get_addon_meta(addon_id)
    if meta:
        return {'ok': True, 'addon': meta}
    return {'ok': False, 'error': f'Addon "{addon_id}" not installed'}


HANDLERS = {
    'ping':               handle_ping,
    'list_modules':       handle_list_modules,
    'detect_lang':        handle_detect_lang,
    'convert':            handle_convert,
    'preview':            handle_preview,
    'install_module':     handle_install_module,
    'install_addon':      handle_install_addon,
    'remove_addon':       handle_remove_addon,
    'list_addons_full':   handle_list_addons_full,
    'check_updates':      handle_check_updates,
    'apply_update':       handle_apply_update,
    'get_addon_info':      handle_get_addon_info,
    'get_pipeline_trace':  handle_get_pipeline_trace,
    'reload_module':      handle_reload_module,
    'cache_stats':        handle_cache_stats,
    'cache_clear':        handle_cache_clear,
    'suggest_singability':handle_suggest_singability,
    'list_all_addons':    handle_list_all_addons,
    'detect_system':      handle_detect_system,
    'list_voicebanks':    handle_list_voicebanks,
    'detect_editors':     handle_detect_editors,
    'generate_ust':       handle_generate_ust,
    'render':             handle_render,
    'open_editor':        handle_open_editor,
}


# ── IPC loop ──────────────────────────────────────────────────────────────

def respond(msg_id: str, data=None, error: str = None):
    payload = {'id': msg_id, 'ok': error is None, 'data': data, 'error': error}
    sys.stdout.write(json.dumps(payload) + '\n')
    sys.stdout.flush()


def main():
    log.info('MLC v2 starting')

    # Eagerly init on startup (so first request is fast)
    try:
        get_registry()
        get_g2p_cache()
        get_phrase_cache()
        log.info('MLC v2 ready')
    except Exception as e:
        log.warning(f'Startup init partial: {e}')

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue

        try:
            msg = json.loads(raw)
        except json.JSONDecodeError as e:
            sys.stdout.write(json.dumps({'id':None,'ok':False,'data':None,'error':f'invalid JSON: {e}'})+'\n')
            sys.stdout.flush()
            continue

        msg_id = msg.get('id', 'unknown')
        action = msg.get('action', '')

        try:
            handler = HANDLERS.get(action)
            if not handler:
                respond(msg_id, None, f'Unknown action: "{action}". Available: {list(HANDLERS)}')
                continue
            data = handler(msg)
            respond(msg_id, data)
        except Exception as e:
            tb = traceback.format_exc()
            log.error(f'Error handling {action} ({msg_id}):\n{tb}')
            respond(msg_id, None, str(e))


if __name__ == '__main__':
    main()
