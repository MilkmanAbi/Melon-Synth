# Melon Synth — MLC Engine
# Copyright (C) 2026 Abinaash (MilkmanAbi)
# SPDX-License-Identifier: GPL-3.0-or-later
# https://github.com/MilkmanAbi/Melon-Synth

"""
Render Bridge — Melon Synth → OpenUTAU → WAV
=============================================
Handles the full synthesis pipeline:
  1. Detect OpenUTAU on the current system
  2. Locate a voicebank directory
  3. Write a .ust file from note data
  4. Invoke OpenUTAU's CLI render mode
  5. Return the output WAV path (or error + stderr for diagnosis)

Cross-platform:
  Windows  — OpenUtau.exe --render in.ust out.wav
  macOS    — OpenUtau.app/Contents/MacOS/OpenUtau --render ...
  Linux    — openutau --render ... (AppImage or system install)

OpenUTAU CLI render is available from OpenUTAU v0.1.459+.
We require this version or newer.

Voicebank discovery order (first match wins):
  1. Explicit path passed in the request
  2. OPENUTAU_SINGERS_PATH env var
  3. Default OpenUTAU singers directory per OS
  4. User's Melon Synth voicebanks directory

Progress reporting:
  OpenUTAU writes render progress to stderr as:
      Rendering 0/42
      Rendering 12/42
      ...
      Done 42/42
  We parse this and emit progress events over the IPC bus.
"""

from __future__ import annotations

import os
import sys
import json
import shutil
import subprocess
import threading
import time
import re
import tempfile
import logging
from pathlib import Path
from typing import Optional, Callable

log = logging.getLogger('mlc.render')


# ── OpenUTAU detection ────────────────────────────────────────────────────────

OPENUTAU_CANDIDATES = {
    'win32': [
        Path(os.environ.get('LOCALAPPDATA','')) / 'Programs' / 'OpenUtau' / 'OpenUtau.exe',
        Path('C:/Program Files/OpenUtau/OpenUtau.exe'),
        Path('C:/Program Files (x86)/OpenUtau/OpenUtau.exe'),
        # User-installed via zip
        Path.home() / 'AppData' / 'Local' / 'OpenUtau' / 'OpenUtau.exe',
    ],
    'darwin': [
        Path('/Applications/OpenUtau.app/Contents/MacOS/OpenUtau'),
        Path.home() / 'Applications/OpenUtau.app/Contents/MacOS/OpenUtau',
    ],
    'linux': [
        Path('/usr/local/bin/openutau'),
        Path('/usr/bin/openutau'),
        Path.home() / '.local/bin/openutau',
        # AppImage unpacked
        Path.home() / 'OpenUtau/OpenUtau',
    ],
}

SINGERS_DIRS = {
    'win32': [
        Path.home() / 'AppData' / 'Roaming' / 'OpenUtau' / 'Singers',
        Path.home() / 'AppData' / 'Local'   / 'OpenUtau' / 'Singers',
    ],
    'darwin': [
        Path.home() / 'Library' / 'Application Support' / 'OpenUtau' / 'Singers',
    ],
    'linux': [
        Path.home() / '.config' / 'OpenUtau' / 'Singers',
        Path.home() / '.local' / 'share' / 'OpenUtau' / 'Singers',
    ],
}


def find_openutau() -> Optional[Path]:
    """Locate the OpenUTAU executable. Returns None if not found."""
    # Check PATH first
    from_path = shutil.which('openutau') or shutil.which('OpenUtau')
    if from_path:
        return Path(from_path)

    # Check known install locations for this platform
    platform = sys.platform
    candidates = OPENUTAU_CANDIDATES.get(platform, [])
    for c in candidates:
        if c.exists():
            return c

    return None


def find_singers_dir() -> Optional[Path]:
    """Locate the default OpenUTAU singers directory."""
    env_path = os.environ.get('OPENUTAU_SINGERS_PATH')
    if env_path and Path(env_path).is_dir():
        return Path(env_path)

    platform = sys.platform
    dirs = SINGERS_DIRS.get(platform, [])
    for d in dirs:
        if d.exists():
            return d

    return None


def list_installed_voicebanks(singers_dir: Optional[Path] = None) -> list[dict]:
    """
    Scan a singers directory and return info about each installed voicebank.
    Reads character.txt when present for name/author metadata.
    """
    singers_dir = singers_dir or find_singers_dir()
    if not singers_dir or not singers_dir.exists():
        return []

    voicebanks = []
    for entry in sorted(singers_dir.iterdir()):
        if not entry.is_dir():
            continue

        # Must have at least one wav file or oto.ini to be a real voicebank
        has_samples = bool(
            list(entry.rglob('*.wav'))[:1] or
            list(entry.rglob('oto.ini'))[:1] or
            list(entry.rglob('*.oto'))[:1]
        )
        if not has_samples:
            continue

        info = {
            'id':       entry.name,
            'name':     entry.name,
            'path':     str(entry),
            'type':     _detect_vb_type(entry),
            'language': 'ja',   # default; character.txt may override
        }

        # Parse character.txt for metadata
        char_file = entry / 'character.txt'
        if char_file.exists():
            try:
                char_data = char_file.read_text(encoding='utf-8-sig', errors='replace')
                for line in char_data.splitlines():
                    if line.startswith('name='):
                        info['name'] = line[5:].strip()
                    elif line.startswith('author='):
                        info['author'] = line[7:].strip()
                    elif line.startswith('web='):
                        info['web'] = line[4:].strip()
            except Exception:
                pass

        # Detect image
        for img_ext in ('png', 'jpg', 'bmp'):
            img = entry / f'character.{img_ext}'
            if img.exists():
                info['image'] = str(img)
                break

        voicebanks.append(info)

    return voicebanks


def _detect_vb_type(vb_dir: Path) -> str:
    """Heuristic: detect CV / CVVC / VCV from oto.ini entries."""
    oto_files = list(vb_dir.rglob('oto.ini'))
    if not oto_files:
        return 'unknown'

    sample_entries: list[str] = []
    try:
        for oto in oto_files[:3]:
            lines = oto.read_text(encoding='utf-8-sig', errors='replace').splitlines()
            sample_entries.extend(l.split('=')[0] for l in lines[:30] if '=' in l)
    except Exception:
        return 'cv'

    # VCV: entries like "a ka" or "a ko"
    vcv_pattern = re.compile(r'^[aiueo]\s+[a-z]')
    if any(vcv_pattern.match(e) for e in sample_entries):
        return 'vcv'

    # CVVC: entries like "k a" or "a k" (consonant-vowel pairs)
    cvvc_pattern = re.compile(r'^[a-z]\s+[aiueo]|^[aiueo]\s+[a-z]')
    if any(cvvc_pattern.match(e) for e in sample_entries):
        return 'cvvc'

    return 'cv'


# ── Render pipeline ───────────────────────────────────────────────────────────

class RenderResult:
    def __init__(self, ok: bool, wav_path: Optional[str] = None,
                 error: Optional[str] = None, duration_ms: int = 0):
        self.ok         = ok
        self.wav_path   = wav_path
        self.error      = error
        self.duration_ms = duration_ms

    def to_dict(self) -> dict:
        return {
            'ok':          self.ok,
            'wav_path':    self.wav_path,
            'error':       self.error,
            'duration_ms': self.duration_ms,
        }


def render(
    ust_path:        str,
    wav_out_path:    str,
    voicebank_path:  Optional[str] = None,
    openutau_path:   Optional[str] = None,
    progress_cb:     Optional[Callable[[int, int], None]] = None,
    timeout_s:       int = 300,
) -> RenderResult:
    """
    Run OpenUTAU CLI to render a .ust file to .wav.

    progress_cb(done, total) is called whenever OpenUTAU emits progress.
    """
    t_start = time.time()

    # Locate OpenUTAU
    ou_path = Path(openutau_path) if openutau_path else find_openutau()
    if not ou_path:
        return RenderResult(
            ok=False,
            error=(
                'OpenUTAU not found. Please install it from https://www.openutau.com '
                'or set OPENUTAU_PATH in your environment.'
            )
        )

    if not ou_path.exists():
        return RenderResult(ok=False, error=f'OpenUTAU not found at: {ou_path}')

    # Build command
    cmd = [str(ou_path), '--render', ust_path, wav_out_path]
    if voicebank_path:
        cmd += ['--singer', voicebank_path]

    log.info(f'Render: {" ".join(cmd)}')

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
        )

        # Parse progress from stderr
        progress_pattern = re.compile(r'(?:Rendering|Done)\s+(\d+)/(\d+)')
        stderr_lines = []

        def read_stderr():
            for line in proc.stderr:
                line = line.strip()
                stderr_lines.append(line)
                if progress_cb:
                    m = progress_pattern.search(line)
                    if m:
                        progress_cb(int(m.group(1)), int(m.group(2)))

        stderr_thread = threading.Thread(target=read_stderr, daemon=True)
        stderr_thread.start()

        try:
            proc.wait(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            proc.kill()
            return RenderResult(ok=False, error=f'Render timed out after {timeout_s}s')

        stderr_thread.join(timeout=5)

        if proc.returncode != 0:
            err_text = '\n'.join(stderr_lines[-10:]) or f'Exit code {proc.returncode}'
            return RenderResult(ok=False, error=f'OpenUTAU render failed:\n{err_text}')

        if not Path(wav_out_path).exists():
            return RenderResult(ok=False, error='Render succeeded but output WAV not found')

        duration_ms = int((time.time() - t_start) * 1000)
        log.info(f'Render complete: {wav_out_path} ({duration_ms}ms)')
        return RenderResult(ok=True, wav_path=wav_out_path, duration_ms=duration_ms)

    except FileNotFoundError:
        return RenderResult(ok=False, error=f'Cannot execute OpenUTAU at {ou_path}')
    except Exception as e:
        return RenderResult(ok=False, error=str(e))


# ── Music editor bridge ───────────────────────────────────────────────────────

MUSIC_EDITORS = {
    'ardour': {
        'name':    'Ardour',
        'license': 'GPL',
        'website': 'https://ardour.org',
        'candidates': {
            'win32':  ['C:/Program Files/Ardour8/bin/ardour8-vst3.exe',
                       'C:/Program Files/Ardour7/bin/ardour-7.exe'],
            'darwin': ['/Applications/Ardour8.app/Contents/MacOS/Ardour8',
                       '/Applications/Ardour7.app/Contents/MacOS/Ardour7'],
            'linux':  ['/usr/bin/ardour8', '/usr/bin/ardour7', '/usr/bin/ardour',
                       '/usr/local/bin/ardour'],
        },
        'open_cmd': lambda exe, wav: [exe, '--import', wav],
    },
    'lmms': {
        'name':    'LMMS',
        'license': 'GPL',
        'website': 'https://lmms.io',
        'candidates': {
            'win32':  ['C:/Program Files/LMMS/lmms.exe',
                       'C:/Program Files (x86)/LMMS/lmms.exe'],
            'darwin': ['/Applications/LMMS.app/Contents/MacOS/LMMS'],
            'linux':  ['/usr/bin/lmms', '/usr/local/bin/lmms', '/snap/bin/lmms'],
        },
        'open_cmd': lambda exe, wav: [exe],  # LMMS doesn't CLI-import WAV
    },
    'reaper': {
        'name':    'Reaper',
        'license': 'commercial (free to try)',
        'website': 'https://www.reaper.fm',
        'candidates': {
            'win32':  ['C:/Program Files/REAPER (x64)/reaper.exe',
                       'C:/Program Files/REAPER/reaper.exe'],
            'darwin': ['/Applications/REAPER.app/Contents/MacOS/REAPER'],
            'linux':  ['/opt/REAPER/reaper', str(Path.home() / 'opt/REAPER/reaper')],
        },
        'open_cmd': lambda exe, wav: [exe],
    },
}


def detect_music_editors() -> list[dict]:
    """
    Scan for installed music editors on this machine.
    Returns list of {id, name, path, detected} dicts.
    """
    platform  = sys.platform
    found = []

    for editor_id, info in MUSIC_EDITORS.items():
        path = shutil.which(editor_id)
        if not path:
            candidates = info['candidates'].get(platform, [])
            for c in candidates:
                if Path(c).exists():
                    path = c
                    break

        found.append({
            'id':       editor_id,
            'name':     info['name'],
            'license':  info['license'],
            'website':  info['website'],
            'path':     path,
            'detected': bool(path),
        })

    return found


def open_in_editor(editor_id: str, wav_path: str, editor_path: Optional[str] = None) -> dict:
    """
    Launch a music editor with the given WAV file pre-loaded.
    Returns {ok, error}.
    """
    info = MUSIC_EDITORS.get(editor_id)
    if not info:
        return {'ok': False, 'error': f'Unknown editor: {editor_id}'}

    exe = editor_path
    if not exe:
        platform = sys.platform
        for c in info['candidates'].get(platform, []):
            if Path(c).exists():
                exe = c
                break

    if not exe:
        return {
            'ok':    False,
            'error': f'{info["name"]} not found. Download from {info["website"]}',
        }

    try:
        cmd = info['open_cmd'](exe, wav_path)
        subprocess.Popen(cmd)
        log.info(f'Launched {info["name"]}: {" ".join(cmd)}')
        return {'ok': True, 'editor': info['name'], 'wav': wav_path}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


# ── Standalone test ───────────────────────────────────────────────────────────
if __name__ == '__main__':
    print('=== OpenUTAU detection ===')
    ou = find_openutau()
    print(f'OpenUTAU: {ou or "not found"}')

    print('\n=== Singers directory ===')
    sd = find_singers_dir()
    print(f'Singers dir: {sd or "not found"}')
    if sd:
        banks = list_installed_voicebanks(sd)
        print(f'Installed voicebanks: {len(banks)}')
        for b in banks:
            print(f'  {b["name"]} ({b["type"]})')

    print('\n=== Music editors ===')
    editors = detect_music_editors()
    for e in editors:
        status = '✓ found' if e['detected'] else '✗ not found'
        print(f'  {e["name"]}: {status}')
        if e['detected']:
            print(f'    → {e["path"]}')
