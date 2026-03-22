# Melon Synth — MLC Engine
# Copyright (C) 2026 Abinaash (MilkmanAbi)
# SPDX-License-Identifier: GPL-3.0-or-later
"""
Melon Extension Backend Base Class
===================================
Python base class for .melon app extension backends.
Extensions that need Python processing (audio analysis, ML, etc.)
subclass MelonExtensionBackend here.

The Electron main process spawns a lightweight IPC server per extension
and routes calls from the UI webview to these handlers.

Usage in your extension's backend/main.py:
    from mlc.api.melon_ext import MelonExtensionBackend, register

    class MyBackend(MelonExtensionBackend):
        id = 'my_extension'

        def on_load(self):
            # one-time setup
            pass

        def process_audio(self, audio_data: bytes, sample_rate: int) -> list[dict]:
            # called by UI via: await melon.backend.call('process_audio', {...})
            ...

    register(MyBackend)   # required at module bottom
"""
from __future__ import annotations
import json
import sys
import logging
import threading
from typing import Any, Optional

log = logging.getLogger('mlc.melon_ext')

_registered_backend: Optional[type] = None


def register(backend_class: type):
    """Register the backend class. Call at module bottom."""
    global _registered_backend
    _registered_backend = backend_class


class MelonExtensionBackend:
    """
    Base class for .melon extension Python backends.

    Methods you define here are callable from the UI webview via:
        await melon.backend.call('method_name', { ...args... })

    Any public method (not starting with _) is automatically exposed.
    Args and return values are JSON-serialized automatically.

    Lifecycle:
        on_load()               → called when extension installs
        on_unload()             → called when extension removed
        on_notes_changed(notes) → called when project notes change
        on_bpm_changed(bpm)     → called when BPM changes
        on_playback_started()   → called when playback begins
        on_playback_stopped()   → called when playback stops

    Access MLC from your backend:
        from mlc.api import LanguagePack, VoicebankMapper
        result = self.mlc_convert(text='hello', module_id='jp_cv_standard')
    """

    id:          str = 'base_backend'
    name:        str = 'Base Backend'
    version:     str = '1.0.0'

    def __init__(self):
        self._log      = logging.getLogger(f'melon.ext.{self.id}')
        self._mlc      = None   # injected by the extension server
        self._lock     = threading.Lock()

    # ── Lifecycle ──────────────────────────────────────────────────────────

    def on_load(self) -> None:
        """Called once when the extension backend is started."""
        pass

    def on_unload(self) -> None:
        """Called when the extension is removed or Melon Synth closes."""
        pass

    # ── Project event hooks ────────────────────────────────────────────────

    def on_notes_changed(self, notes: list[dict]) -> None:
        """Called whenever project notes change."""
        pass

    def on_bpm_changed(self, bpm: float) -> None:
        pass

    def on_track_changed(self, track: dict) -> None:
        pass

    def on_playback_started(self, position: float) -> None:
        pass

    def on_playback_stopped(self, position: float) -> None:
        pass

    # ── MLC access ────────────────────────────────────────────────────────

    def mlc_convert(self, text: str, module_id: str,
                    singability: float = 0.65, language: str = '') -> dict:
        """
        Call the MLC conversion pipeline from your backend.
        Returns the same ConversionResult dict as the IPC 'convert' action.
        """
        if self._mlc is None:
            raise RuntimeError('MLC not injected — backend not fully initialized')
        return self._mlc.convert(text=text, module_id=module_id,
                                  singability=singability, language=language)

    # ── IPC dispatch (internal) ────────────────────────────────────────────

    def _dispatch(self, method: str, args: dict) -> Any:
        """Called by the IPC server to route frontend calls to handler methods."""
        handler = getattr(self, method, None)
        if handler is None or method.startswith('_'):
            raise AttributeError(f'Method "{method}" not found in {self.id} backend')
        if not callable(handler):
            raise TypeError(f'"{method}" is not callable')
        return handler(**args)

    def _get_exposed_methods(self) -> list[str]:
        """Return names of all public callable methods (exposed to frontend)."""
        return [
            name for name in dir(self)
            if not name.startswith('_')
            and callable(getattr(self, name))
            and name not in ('on_load', 'on_unload', 'on_notes_changed',
                             'on_bpm_changed', 'on_track_changed',
                             'on_playback_started', 'on_playback_stopped')
        ]


def run_backend_server(backend_instance: MelonExtensionBackend):
    """
    Run the IPC server for a backend extension.
    Reads JSON from stdin, writes JSON to stdout.
    Called by Electron when spawning the Python backend process.
    """
    import sys, json
    backend_instance.on_load()
    log.info(f'Extension backend {backend_instance.id} ready')

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg    = json.loads(line)
            action = msg.get('action', '')
            msg_id = msg.get('id', '')
            data   = msg.get('data', {})

            if action == 'call':
                method = data.get('method', '')
                args   = data.get('args', {})
                result = backend_instance._dispatch(method, args)
                print(json.dumps({'id': msg_id, 'ok': True, 'data': result}), flush=True)

            elif action == 'event':
                event_type = data.get('type', '')
                event_data = data.get('data', {})
                handler    = getattr(backend_instance, f'on_{event_type}', None)
                if handler:
                    handler(**event_data)
                # No reply needed for events

            elif action == 'list_methods':
                methods = backend_instance._get_exposed_methods()
                print(json.dumps({'id': msg_id, 'ok': True, 'data': {'methods': methods}}), flush=True)

            elif action == 'ping':
                print(json.dumps({'id': msg_id, 'ok': True, 'data': {'status': 'ok'}}), flush=True)

            elif action == 'shutdown':
                backend_instance.on_unload()
                print(json.dumps({'id': msg_id, 'ok': True}), flush=True)
                break

        except Exception as e:
            print(json.dumps({'id': msg.get('id', ''), 'ok': False, 'error': str(e)}), flush=True)
            log.error(f'Backend error: {e}')


if __name__ == '__main__':
    # When spawned by Electron, this runs the registered backend
    if _registered_backend is None:
        print(json.dumps({'ok': False, 'error': 'No backend registered'}), flush=True)
        sys.exit(1)
    backend = _registered_backend()
    run_backend_server(backend)
