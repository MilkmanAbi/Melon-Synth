"""
MLC Registry
============
Discovers, loads, validates, and hot-reloads MLC modules.
Handles both:
  - Raw .py modules in the modules/ directory (developer mode)
  - .mlc bundle files (community distribution format)

.mlc bundle format
------------------
A .mlc file is a ZIP archive with this structure:

  my_module.mlc
  ├── manifest.json      ← required: ModuleManifest fields
  ├── module.py          ← required: VoicebankModule subclass
  ├── data/              ← optional: pronunciation dicts, lookup tables
  │   ├── exceptions.json
  │   └── phoneme_map.json
  └── README.md          ← optional but encouraged

The manifest.json declares:
  - id, name, version, author, license
  - which languages it accepts
  - which voicebank phoneme set it targets
  - which specific voicebanks it's tuned for
  - pip dependencies (auto-installed on first load)
  - minimum MLC API version

Hot-reload
----------
Registry watches the modules directory with a file watcher.
When a .py or .mlc file changes, it reloads that module only.
No engine restart needed.
"""

from __future__ import annotations

import sys
import json
import hashlib
import zipfile
import importlib
import importlib.util
import subprocess
import threading
import logging
import time
from pathlib import Path
from typing import Optional

log = logging.getLogger('mlc.registry')

MLC_API_VERSION = '1.0.0'


# ── Base class (imported by modules, must not create circular imports) ──────

class VoicebankModule:
    """
    Base class every MLC module must subclass.
    See docs/writing-a-module.md for full guide.
    """
    id:           str = 'base'
    name:         str = 'Base Module'
    description:  str = ''
    author:       str = ''
    version:      str = '0.1.0'
    language:     str = 'en'
    languages:    list[str] = ['en']
    phoneme_set:  str = ''
    target_banks: list[str] = []
    supported_phonemes: set[str] = set()

    # Loaded from manifest (set by registry after instantiation)
    manifest: Optional[object] = None
    data_dir: Optional[Path]   = None

    def on_load(self):
        """
        Called once after the module is instantiated.
        Override to load data files, warm up caches, etc.
        self.data_dir points to the module's data/ directory if it exists.
        """
        pass

    def map_phonemes(
        self,
        phonemes: list,    # list[IPFPhoneme]
        singability: float,
    ) -> list:             # list[SynthToken]
        """
        THE core method. Map IPF phonemes to SynthTokens.
        singability: 0.0 = accurate, 1.0 = singable.
        """
        raise NotImplementedError(f'{self.__class__.__name__}.map_phonemes() not implemented')

    def postprocess(self, tokens: list, singability: float) -> list:
        """Optional. Called after map_phonemes(). Default: no-op."""
        return tokens

    def validate_output(self, tokens: list) -> list:
        """Optional. Validate output tokens. Returns list of warning strings."""
        if not self.supported_phonemes:
            return []
        return [
            f'Phoneme "{t.phoneme}" may not be in {self.name}\'s phoneme set'
            for t in tokens if t.phoneme not in self.supported_phonemes
        ]

    def get_info(self) -> dict:
        return {
            'id': self.id, 'name': self.name, 'description': self.description,
            'author': self.author, 'version': self.version,
            'language': self.language, 'languages': self.languages,
            'phoneme_set': self.phoneme_set, 'target_banks': self.target_banks,
        }


# ── Loaded module record ────────────────────────────────────────────────────

class LoadedModule:
    def __init__(
        self,
        instance:    VoicebankModule,
        source_path: Path,
        source_hash: str,
        from_bundle: bool = False,
        extract_dir: Optional[Path] = None,
    ):
        self.instance    = instance
        self.source_path = source_path
        self.source_hash = source_hash
        self.from_bundle = from_bundle
        self.extract_dir = extract_dir   # temp dir for extracted .mlc
        self.loaded_at   = time.time()

    @property
    def id(self) -> str:
        return self.instance.id


# ── Registry ────────────────────────────────────────────────────────────────

class MLCRegistry:
    """
    Discovers, loads, and manages all MLC voicebank modules.

    Scans two locations:
      1. builtin_dir  — shipped with MLC (always loaded)
      2. user_dir     — user's module folder (hot-reloaded)

    Module formats supported:
      - .py files:  raw Python module, must contain a VoicebankModule subclass
      - .mlc files: ZIP bundle with manifest.json + module.py
    """

    def __init__(self, builtin_dir: Path, user_dir: Path):
        self.builtin_dir  = builtin_dir
        self.user_dir     = user_dir
        self._modules:    dict[str, LoadedModule] = {}
        self._lock        = threading.RLock()
        self._watcher:    Optional[threading.Thread] = None
        self._watching    = False

        # Temp dir for extracted .mlc bundles
        self._extract_root = user_dir / '.mlc_extracted'
        self._extract_root.mkdir(exist_ok=True)

        # Ensure sys.path includes our dirs
        for d in [str(builtin_dir.parent), str(user_dir)]:
            if d not in sys.path:
                sys.path.insert(0, d)

    # ── Discovery ────────────────────────────────────────────────────────────

    def discover_all(self) -> dict[str, str]:
        """
        Scan all module directories and load everything found.
        Returns {module_id: status} for each attempted load.
        """
        results = {}

        for directory, is_builtin in [
            (self.builtin_dir, True),
            (self.user_dir,    False),
        ]:
            if not directory.exists():
                continue

            # Raw .py modules
            for py_file in sorted(directory.glob('*.py')):
                if py_file.name.startswith('_'):
                    continue
                status = self._load_py(py_file, is_builtin=is_builtin)
                results[py_file.stem] = status

            # .mlc bundles
            for mlc_file in sorted(directory.glob('*.mlc')):
                status = self._load_mlc_bundle(mlc_file)
                results[mlc_file.stem] = status

        log.info(f'Discovery complete: {len(self._modules)} modules loaded')
        return results

    # ── Load a raw .py module ─────────────────────────────────────────────────

    def _load_py(self, path: Path, is_builtin: bool = False) -> str:
        file_hash = _hash_file(path)

        # Check if already loaded and unchanged
        for mid, loaded in self._modules.items():
            if loaded.source_path == path and loaded.source_hash == file_hash:
                return 'unchanged'

        try:
            spec   = importlib.util.spec_from_file_location(f'mlc_mod_{path.stem}', path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)

            instances = _find_module_instances(module, VoicebankModule)
            if not instances:
                return f'no VoicebankModule subclass found in {path.name}'

            for inst in instances:
                inst.data_dir = path.parent / 'data' / inst.id
                inst.on_load()
                loaded = LoadedModule(inst, path, file_hash, from_bundle=False)
                with self._lock:
                    self._modules[inst.id] = loaded
                log.info(f'Loaded: {inst.id} ({inst.name}) from {path.name}')

            return 'ok'

        except Exception as e:
            log.error(f'Failed to load {path.name}: {e}')
            return f'error: {e}'

    # ── Load a .mlc bundle ────────────────────────────────────────────────────

    def _load_mlc_bundle(self, path: Path) -> str:
        """
        Load a .mlc bundle file.

        Steps:
          1. Validate it's a well-formed ZIP
          2. Parse and validate manifest.json
          3. Check MLC API version compatibility
          4. Install any missing pip dependencies
          5. Extract to a temp directory
          6. Load the entry point module
        """
        if not zipfile.is_zipfile(path):
            return f'error: {path.name} is not a valid .mlc bundle (not a ZIP file)'

        file_hash = _hash_file(path)

        try:
            with zipfile.ZipFile(path, 'r') as zf:
                names = zf.namelist()

                # Validate manifest exists
                if 'manifest.json' not in names:
                    return f'error: {path.name} missing manifest.json'

                # Parse manifest
                raw_manifest = json.loads(zf.read('manifest.json').decode('utf-8'))
                try:
                    manifest = _validate_manifest(raw_manifest)
                except ValueError as e:
                    return f'error: invalid manifest in {path.name}: {e}'

                # Check MLC API compatibility
                compat_err = _check_api_version(manifest.get('mlc_api_version','0.0.0'))
                if compat_err:
                    return f'error: {compat_err}'

                # Check entry point exists in bundle
                entry = manifest.get('entry_point', 'module.py')
                if entry not in names:
                    return f'error: entry point "{entry}" not found in bundle'

                # Extract to temp dir (keyed by hash so updates re-extract)
                extract_dir = self._extract_root / f'{path.stem}_{file_hash[:8]}'
                if not extract_dir.exists():
                    extract_dir.mkdir(parents=True)
                    zf.extractall(extract_dir)
                    log.info(f'Extracted {path.name} → {extract_dir}')

            # Install dependencies
            deps = manifest.get('dependencies', [])
            if deps:
                _install_dependencies(deps, path.name)

            # Load the entry point
            entry_path = extract_dir / entry
            if not entry_path.exists():
                return f'error: entry point {entry} not found after extraction'

            # Add extract dir to path so relative imports work
            if str(extract_dir) not in sys.path:
                sys.path.insert(0, str(extract_dir))

            spec   = importlib.util.spec_from_file_location(
                f'mlc_bundle_{path.stem}', entry_path
            )
            pymod  = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(pymod)

            instances = _find_module_instances(pymod, VoicebankModule)
            if not instances:
                return f'no VoicebankModule subclass found in {entry}'

            for inst in instances:
                inst.data_dir = extract_dir / 'data'
                inst.on_load()
                loaded = LoadedModule(
                    inst, path, file_hash,
                    from_bundle=True, extract_dir=extract_dir
                )
                with self._lock:
                    self._modules[inst.id] = loaded
                log.info(f'Loaded bundle: {inst.id} ({inst.name}) from {path.name}')

            return 'ok'

        except Exception as e:
            log.error(f'Failed to load bundle {path.name}: {e}')
            import traceback; traceback.print_exc()
            return f'error: {e}'

    # ── Public API ─────────────────────────────────────────────────────────────

    def get(self, module_id: str) -> Optional[VoicebankModule]:
        with self._lock:
            loaded = self._modules.get(module_id)
            return loaded.instance if loaded else None

    def list_all(self) -> list[dict]:
        with self._lock:
            return [
                {**m.instance.get_info(), 'from_bundle': m.from_bundle,
                 'source': m.source_path.name}
                for m in self._modules.values()
            ]

    def unload(self, module_id: str) -> None:
        """Remove a module from the registry."""
        self._modules.pop(module_id, None)
        self._hashes.pop(module_id, None)

    def has(self, module_id: str) -> bool:
        return module_id in self._modules

    def reload(self, module_id: str) -> str:
        """Hot-reload a single module."""
        with self._lock:
            loaded = self._modules.get(module_id)
            if not loaded:
                return f'module {module_id} not found'
            path = loaded.source_path

        if loaded.from_bundle:
            return self._load_mlc_bundle(path)
        else:
            return self._load_py(path)

    def install_bundle(self, mlc_path: Path) -> str:
        """
        Install a .mlc bundle into the user modules directory.
        Copies the file then loads it.
        """
        dest = self.user_dir / mlc_path.name
        import shutil
        shutil.copy2(mlc_path, dest)
        log.info(f'Installed bundle: {dest}')
        return self._load_mlc_bundle(dest)

    # ── File watcher (hot-reload) ─────────────────────────────────────────────

    def start_watching(self):
        """Start background thread that watches user_dir for changes."""
        self._watching = True
        self._watcher  = threading.Thread(target=self._watch_loop, daemon=True)
        self._watcher.start()
        log.info('Hot-reload watcher started')

    def stop_watching(self):
        self._watching = False

    def _watch_loop(self):
        known_mtimes: dict[Path, float] = {}
        while self._watching:
            time.sleep(1.5)
            if not self.user_dir.exists():
                continue
            for f in list(self.user_dir.glob('*.py')) + list(self.user_dir.glob('*.mlc')):
                try:
                    mtime = f.stat().st_mtime
                    if known_mtimes.get(f) != mtime:
                        known_mtimes[f] = mtime
                        log.info(f'Change detected: {f.name} — reloading')
                        if f.suffix == '.mlc':
                            self._load_mlc_bundle(f)
                        else:
                            self._load_py(f)
                except Exception as e:
                    log.warning(f'Watch error for {f.name}: {e}')


# ── Helpers ──────────────────────────────────────────────────────────────────

def _hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


def _find_module_instances(pymod, base_class) -> list[VoicebankModule]:
    """Find all non-base VoicebankModule subclasses in a Python module."""
    instances = []
    for name in dir(pymod):
        obj = getattr(pymod, name)
        if (
            isinstance(obj, type)
            and issubclass(obj, base_class)
            and obj is not base_class
            and obj.__module__ == pymod.__name__  # defined in THIS module, not imported
        ):
            try:
                instances.append(obj())
            except Exception as e:
                log.warning(f'Could not instantiate {name}: {e}')
    return instances


REQUIRED_MANIFEST_FIELDS = {'id', 'name', 'version', 'language', 'phoneme_set'}

def _validate_manifest(raw: dict) -> dict:
    missing = REQUIRED_MANIFEST_FIELDS - set(raw.keys())
    if missing:
        raise ValueError(f'Missing required fields: {missing}')
    if not raw['id'].replace('_', '').replace('-', '').isalnum():
        raise ValueError(f'Module id must be alphanumeric (with _ or -): {raw["id"]}')
    return raw


def _check_api_version(required: str) -> Optional[str]:
    """Return error string if incompatible, None if ok."""
    try:
        def parse(v): return tuple(int(x) for x in v.split('.')[:3])
        req = parse(required)
        cur = parse(MLC_API_VERSION)
        if req[0] > cur[0]:  # major version mismatch
            return (f'Module requires MLC API v{required}, '
                    f'but this is MLC API v{MLC_API_VERSION}. '
                    f'Please update Melon Synth.')
        return None
    except Exception:
        return None  # don't block on unparseable version strings


def _install_dependencies(deps: list[str], source_name: str):
    """Auto-install missing pip dependencies."""
    if not deps:
        return
    for dep in deps:
        pkg_name = dep.split('>=')[0].split('==')[0].split('[')[0].strip()
        try:
            importlib.import_module(pkg_name.replace('-', '_'))
        except ImportError:
            log.info(f'Installing dependency for {source_name}: {dep}')
            try:
                subprocess.check_call(
                    [sys.executable, '-m', 'pip', 'install', dep, '-q'],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                log.info(f'Installed: {dep}')
            except subprocess.CalledProcessError as e:
                log.warning(f'Failed to auto-install {dep}: {e}')
