#!/usr/bin/env python3
"""
MLC — Melon Lyric Conversion Engine
====================================
Version: 0.1.0
Language: Python 3.9+

Standalone service. Electron spawns this process once and communicates
via JSON messages over stdin/stdout (newline-delimited).

Every request:  { "id": str, "action": str, ...params }
Every response: { "id": str, "ok": bool, "data": any, "error": str|null }

Actions:
  convert     — main conversion: text → phoneme sequence
  detect_lang — detect language of input text
  list_modules — list available voicebank modules
  ping        — health check

Install dependencies:
  pip install phonemizer langdetect nltk

System dependency (install via package manager):
  espeak-ng   (apt install espeak-ng / brew install espeak / etc.)
"""

import sys
import json
import logging
import importlib
import traceback
from pathlib import Path
from typing import Any

# ── Bootstrap ──────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.WARNING,
    format='[MLC %(levelname)s] %(message)s',
    stream=sys.stderr,   # never touch stdout — that's our IPC channel
)
log = logging.getLogger('mlc')

# ── Pipeline import (lazy, so startup is fast) ─────────────────────────────

_pipeline = None

def get_pipeline():
    global _pipeline
    if _pipeline is None:
        from mlc_pipeline import MLCPipeline
        _pipeline = MLCPipeline()
    return _pipeline

# ── Module registry ────────────────────────────────────────────────────────

MODULES_DIR = Path(__file__).parent / 'modules'
_module_registry: dict[str, Any] = {}

def discover_modules() -> dict[str, Any]:
    """Scan the modules/ directory and load all VoicebankModule subclasses."""
    global _module_registry
    _module_registry = {}

    if not MODULES_DIR.exists():
        return _module_registry

    sys.path.insert(0, str(MODULES_DIR.parent))

    for py_file in sorted(MODULES_DIR.glob('*.py')):
        if py_file.name.startswith('_'):
            continue
        module_name = f'modules.{py_file.stem}'
        try:
            mod = importlib.import_module(module_name)
            # Find all VoicebankModule subclasses defined in this file
            from mlc_base import VoicebankModule
            for attr_name in dir(mod):
                attr = getattr(mod, attr_name)
                if (
                    isinstance(attr, type)
                    and issubclass(attr, VoicebankModule)
                    and attr is not VoicebankModule
                ):
                    instance = attr()
                    _module_registry[instance.id] = instance
                    log.info(f'Loaded module: {instance.id} ({instance.name})')
        except Exception as e:
            log.warning(f'Failed to load module {py_file.name}: {e}')

    return _pipeline

# ── IPC message loop ────────────────────────────────────────────────────────

def respond(msg_id: str, data: Any = None, error: str | None = None):
    """Write a JSON response to stdout."""
    payload = {
        'id': msg_id,
        'ok': error is None,
        'data': data,
        'error': error,
    }
    sys.stdout.write(json.dumps(payload) + '\n')
    sys.stdout.flush()


def handle(msg: dict) -> tuple[Any, str | None]:
    """Dispatch a message to the correct handler. Returns (data, error)."""
    action = msg.get('action', '')

    if action == 'ping':
        return {'status': 'ok', 'version': '0.1.0'}, None

    if action == 'list_modules':
        discover_modules()
        result = []
        for mid, mod in _module_registry.items():
            result.append({
                'id': mid,
                'name': mod.name,
                'description': mod.description,
                'language': mod.language,
                'phoneme_set': mod.phoneme_set,
                'version': mod.version,
            })
        return result, None

    if action == 'detect_lang':
        text = msg.get('text', '')
        if not text.strip():
            return None, 'text is required'
        try:
            from langdetect import detect
            lang = detect(text)
            return {'lang': lang}, None
        except Exception as e:
            return {'lang': 'en'}, None   # default to English on failure

    if action == 'convert':
        text        = msg.get('text', '').strip()
        module_id   = msg.get('module_id', 'jp_cv_standard')
        singability = float(msg.get('singability', 0.5))  # 0.0=accurate, 1.0=singable
        lang        = msg.get('lang', None)  # if None, auto-detect

        if not text:
            return None, 'text is required'
        if not (0.0 <= singability <= 1.0):
            return None, 'singability must be between 0.0 and 1.0'

        discover_modules()

        if module_id not in _module_registry:
            available = list(_module_registry.keys())
            return None, f'module "{module_id}" not found. Available: {available}'

        pipeline = get_pipeline()
        module   = _module_registry[module_id]

        result = pipeline.convert(
            text=text,
            module=module,
            singability=singability,
            lang=lang,
        )
        return result, None

    return None, f'unknown action: {action}'


def main():
    """Main IPC loop. Reads newline-delimited JSON from stdin."""
    log.info('MLC engine starting')

    # Eagerly discover modules so first convert call is fast
    discover_modules()

    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue

        try:
            msg = json.loads(raw_line)
        except json.JSONDecodeError as e:
            # Can't respond without an id — write a generic error
            sys.stdout.write(json.dumps({
                'id': None, 'ok': False, 'data': None,
                'error': f'invalid JSON: {e}'
            }) + '\n')
            sys.stdout.flush()
            continue

        msg_id = msg.get('id', 'unknown')

        try:
            data, error = handle(msg)
            respond(msg_id, data, error)
        except Exception as e:
            tb = traceback.format_exc()
            log.error(f'Unhandled error processing {msg_id}:\n{tb}')
            respond(msg_id, None, f'internal error: {e}')


if __name__ == '__main__':
    main()
