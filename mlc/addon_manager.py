# Melon Synth — MLC Engine
# Copyright (C) 2026 Abinaash (MilkmanAbi)
# SPDX-License-Identifier: GPL-3.0-or-later
"""
MLC Addon Manager
=================
Handles the full lifecycle of .mlc addons:
  - install from .mlc file
  - remove by id
  - list all with metadata
  - check for updates (fetches update_url JSON)
  - apply updates (download + reinstall)
  - dependency resolution
  - version compatibility checking

Used by mlc_engine_v2.py to handle IPC actions:
  install_addon, remove_addon, list_addons,
  check_updates, apply_update
"""
from __future__ import annotations

import json
import shutil
import hashlib
import logging
import zipfile
import urllib.request
import urllib.error
import threading
import time
from pathlib import Path
from typing import Optional

log = logging.getLogger('mlc.addon_manager')

MLC_API_VERSION = '2.0.0'


def _semver_parse(v: str) -> tuple:
    try:
        parts = v.lstrip('v').split('.')[:3]
        return tuple(int(x) for x in parts)
    except Exception:
        return (0, 0, 0)


def _semver_gte(a: str, b: str) -> bool:
    """Return True if a >= b."""
    return _semver_parse(a) >= _semver_parse(b)


def _semver_lte(a: str, b: str) -> bool:
    return _semver_parse(a) <= _semver_parse(b)


def _read_manifest(mlc_path: Path) -> Optional[dict]:
    """Read manifest.json from a .mlc bundle."""
    try:
        with zipfile.ZipFile(mlc_path, 'r') as zf:
            names = zf.namelist()
            # Support manifest.json at root or nested one level
            candidates = [n for n in names if n.endswith('manifest.json')]
            if not candidates:
                return None
            with zf.open(candidates[0]) as f:
                return json.load(f)
    except Exception as e:
        log.warning(f'Cannot read manifest from {mlc_path}: {e}')
        return None


def _hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()[:16]


class AddonManager:
    """
    Full lifecycle management for .mlc addons.
    Wraps the AddonRegistry and adds install/remove/update/dependency logic.
    """

    def __init__(self, user_dir: Path, registry):
        self.user_dir  = user_dir
        self.registry  = registry   # AddonRegistry instance
        self._lock     = threading.RLock()
        user_dir.mkdir(parents=True, exist_ok=True)

        # Persist install metadata (version, install date, hash, source_url)
        self._meta_path = user_dir / '.addon_meta.json'
        self._meta      = self._load_meta()

    # ── Metadata persistence ───────────────────────────────────────────────

    def _load_meta(self) -> dict:
        if self._meta_path.exists():
            try:
                return json.loads(self._meta_path.read_text())
            except Exception:
                pass
        return {}

    def _save_meta(self):
        self._meta_path.write_text(json.dumps(self._meta, indent=2))

    # ── Install ────────────────────────────────────────────────────────────

    def install(self, source: str | Path, *, allow_overwrite=True) -> dict:
        """
        Install a .mlc addon from:
          - a local file path (str or Path)
          - a URL (str starting with http/https)

        Returns: { ok, id, name, version, error, warnings }
        """
        source = str(source)
        warnings = []

        # Download if URL
        if source.startswith('http://') or source.startswith('https://'):
            try:
                dest = self.user_dir / f'_download_{int(time.time())}.mlc'
                log.info(f'Downloading addon from {source}')
                urllib.request.urlretrieve(source, dest)
                mlc_path = dest
                source_url = source
            except Exception as e:
                return {'ok': False, 'error': f'Download failed: {e}'}
        else:
            mlc_path   = Path(source)
            source_url = ''
            if not mlc_path.exists():
                return {'ok': False, 'error': f'File not found: {mlc_path}'}

        # Read manifest
        manifest = _read_manifest(mlc_path)
        if not manifest:
            return {'ok': False, 'error': 'Invalid .mlc file — missing manifest.json'}

        addon_id = manifest.get('id')
        if not addon_id:
            return {'ok': False, 'error': 'manifest.json missing "id" field'}

        name    = manifest.get('name', addon_id)
        version = manifest.get('version', '0.0.0')

        # API compatibility check
        required_api = manifest.get('mlc_api', '1.0')
        if not _semver_gte(MLC_API_VERSION, required_api):
            return {
                'ok':    False,
                'error': f'{name} requires MLC API {required_api} but this is {MLC_API_VERSION}. '
                         f'Update Melon Synth to install this addon.',
            }

        # Check dependencies
        dep_warnings = self._check_dependencies(manifest.get('requires', []))
        warnings.extend(dep_warnings)

        # Check for existing install
        existing_meta = self._meta.get(addon_id, {})
        if existing_meta and not allow_overwrite:
            pass  # allow_overwrite=True by default, always update

        if existing_meta:
            existing_v = existing_meta.get('version', '0.0.0')
            if _semver_parse(version) < _semver_parse(existing_v):
                warnings.append(
                    f'Downgrading {name} from v{existing_v} to v{version}'
                )

        # Copy to user dir
        dest_name = f'{addon_id}.mlc'
        dest_path = self.user_dir / dest_name
        shutil.copy2(mlc_path, dest_path)

        # Clean up temp download
        if source_url and mlc_path != dest_path:
            try: mlc_path.unlink()
            except Exception: pass

        # Register in registry
        try:
            result_id = self.registry.install_addon(dest_path)
        except Exception as e:
            dest_path.unlink(missing_ok=True)
            return {'ok': False, 'error': f'Failed to load addon: {e}'}

        # Persist metadata
        with self._lock:
            self._meta[addon_id] = {
                'id':           addon_id,
                'name':         name,
                'version':      version,
                'file':         dest_name,
                'hash':         _hash_file(dest_path),
                'installed_at': int(time.time()),
                'source_url':   source_url,
                'update_url':   manifest.get('update_url', ''),
                'changelog_url':manifest.get('changelog_url', ''),
                'author':       manifest.get('author', ''),
                'license':      manifest.get('license', ''),
                'homepage':     manifest.get('homepage', ''),
                'description':  manifest.get('description', ''),
                'tags':         manifest.get('tags', []),
                'addon_type':   manifest.get('addon_type', manifest.get('type', 'unknown')),
            }
            self._save_meta()

        return {
            'ok':       True,
            'id':       addon_id,
            'name':     name,
            'version':  version,
            'warnings': warnings,
        }

    # ── Remove ─────────────────────────────────────────────────────────────

    def remove(self, addon_id: str) -> dict:
        """
        Remove an installed addon by ID.
        Deletes the .mlc file, unregisters from registry, cleans metadata.
        """
        meta = self._meta.get(addon_id)
        if not meta:
            return {'ok': False, 'error': f'Addon "{addon_id}" is not installed'}

        # Check if other addons depend on this
        dependents = self._find_dependents(addon_id)
        if dependents:
            names = ', '.join(dependents)
            return {
                'ok':    False,
                'error': f'Cannot remove — the following addons require {addon_id}: {names}. '
                         f'Remove them first.',
            }

        # Delete file
        mlc_file = self.user_dir / meta['file']
        mlc_file.unlink(missing_ok=True)

        # Clean extracted files
        extract_root = self.user_dir / '.mlc_extracted'
        for d in extract_root.glob(f'{addon_id}_*'):
            shutil.rmtree(d, ignore_errors=True)

        # Remove from metadata
        with self._lock:
            self._meta.pop(addon_id, None)
            self._save_meta()

        # Registry hot-unload (best-effort)
        try:
            self.registry.unload_addon(addon_id)
        except Exception as e:
            log.warning(f'Registry unload warning for {addon_id}: {e}')

        return {'ok': True, 'id': addon_id, 'name': meta.get('name', addon_id)}

    # ── List ───────────────────────────────────────────────────────────────

    def list_installed(self) -> list[dict]:
        """Return metadata for all installed addons."""
        with self._lock:
            return list(self._meta.values())

    def get_addon_meta(self, addon_id: str) -> Optional[dict]:
        return self._meta.get(addon_id)

    # ── Update checking ────────────────────────────────────────────────────

    def check_updates(self, addon_ids: Optional[list[str]] = None,
                      timeout: int = 8) -> list[dict]:
        """
        Check update_url for each installed addon.
        Returns list of { id, name, current_version, latest_version, download_url,
                          changelog, is_breaking } for addons that have updates.

        Runs concurrently (one thread per addon) with timeout.
        """
        targets = addon_ids if addon_ids else list(self._meta.keys())
        results = []
        threads = []
        lock    = threading.Lock()

        def check_one(addon_id: str):
            meta = self._meta.get(addon_id)
            if not meta or not meta.get('update_url'):
                return
            try:
                url = meta['update_url']
                req = urllib.request.urlopen(url, timeout=timeout)
                data = json.loads(req.read())

                latest = data.get('latest_version', '0.0.0')
                current = meta.get('version', '0.0.0')

                if _semver_parse(latest) > _semver_parse(current):
                    # Check API compatibility
                    min_api = data.get('min_mlc_api', '1.0')
                    if not _semver_gte(MLC_API_VERSION, min_api):
                        return  # update requires newer MLC, skip silently

                    with lock:
                        results.append({
                            'id':              addon_id,
                            'name':            meta.get('name', addon_id),
                            'current_version': current,
                            'latest_version':  latest,
                            'download_url':    data.get('download_url', ''),
                            'changelog':       data.get('changelog', ''),
                            'is_breaking':     data.get('is_breaking', False),
                        })
            except Exception as e:
                log.debug(f'Update check failed for {addon_id}: {e}')

        for aid in targets:
            t = threading.Thread(target=check_one, args=(aid,), daemon=True)
            threads.append(t)
            t.start()

        for t in threads:
            t.join(timeout=timeout + 1)

        return results

    def apply_update(self, addon_id: str, download_url: str) -> dict:
        """Download and install the update for an addon."""
        log.info(f'Updating {addon_id} from {download_url}')
        return self.install(download_url, allow_overwrite=True)

    # ── Dependency helpers ────────────────────────────────────────────────

    def _check_dependencies(self, requires: list) -> list[str]:
        """Return warning strings for unmet dependencies (non-blocking)."""
        warnings = []
        for dep in requires:
            if isinstance(dep, dict):
                dep_id      = dep.get('id', '')
                dep_min_ver = dep.get('min_version', '0.0.0')
            else:
                continue
            installed = self._meta.get(dep_id)
            if not installed:
                warnings.append(
                    f'Dependency "{dep_id}" is not installed. '
                    f'Install it first for full functionality.'
                )
            elif not _semver_gte(installed.get('version', '0.0.0'), dep_min_ver):
                warnings.append(
                    f'Dependency "{dep_id}" v{installed.get("version")} is too old '
                    f'(need v{dep_min_ver}+). Update it for full functionality.'
                )
        return warnings

    def _find_dependents(self, addon_id: str) -> list[str]:
        """Return IDs of installed addons that require addon_id."""
        dependents = []
        for aid, meta in self._meta.items():
            if aid == addon_id:
                continue
            mlc_path = self.user_dir / meta.get('file', '')
            if not mlc_path.exists():
                continue
            manifest = _read_manifest(mlc_path)
            if manifest:
                for req in manifest.get('requires', []):
                    if isinstance(req, dict) and req.get('id') == addon_id:
                        dependents.append(aid)
                        break
        return dependents
