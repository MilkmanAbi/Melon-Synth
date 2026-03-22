"""
MLC Bundle Format — .mlc files
================================
A .mlc file is a ZIP archive. Anyone can make one. Community drops it
into their Melon Synth modules folder and it just works.

Archive structure:
─────────────────
  my_module.mlc/
  ├── manifest.json      ← required: module metadata + capabilities
  ├── mapper.py          ← required: the VoicebankModule subclass
  ├── phoneme_table.json ← optional: declarative phoneme mapping
  │                           (replaces or supplements mapper.py logic)
  ├── rules.json         ← optional: declarative rewrite rules
  ├── dictionary.json    ← optional: word-level override dictionary
  │                           { "love": ["ro", "bu"] }
  ├── postprocess.json   ← optional: post-processing rule set
  └── README.md          ← optional: human-readable documentation

manifest.json schema:
─────────────────────
{
  "id":            "jp_cv_teto",          // unique, lowercase, underscores
  "name":          "Kasane Teto CV",      // human-readable
  "version":       "1.0.0",              // semver
  "description":   "...",
  "author":        "yourname",
  "license":       "MIT",
  "mlc_api":       "2.0",                // MLC API version this targets
  "language":      "en",                 // primary INPUT language
  "target_bank":   "Kasane Teto V1",     // which voicebank this targets
  "phoneme_set":   "jp_cv",              // output phoneme set name
  "supported_phonemes": ["a","i","ku",...],
  "capabilities": {
    "languages": ["en","ja","ko","zh"],   // all supported input languages
    "singability_aware": true,            // respects the singability slider
    "stress_aware":      true,            // uses stress for duration hints
    "cvvc":              false,           // CVVC transition support
    "diphthongs":        true,
    "breath_marks":      true
  },
  "tags": ["utau","japanese","teto","beginner-friendly"]
}

This module loader handles discovery, validation, caching, and hot-reload.
"""

from __future__ import annotations

import json
import zipfile
import hashlib
import logging
import importlib.util
import sys
import tempfile
from pathlib import Path
from typing import Optional

log = logging.getLogger('mlc.loader')

MLC_API_VERSION = '2.0'


# ═══════════════════════════════════════════════════════════════════
#  Manifest
# ═══════════════════════════════════════════════════════════════════

class Manifest:
    REQUIRED = ['id', 'name', 'version', 'mlc_api', 'language', 'phoneme_set']

    def __init__(self, data: dict, source_path: Path):
        self._data = data
        self.source_path = source_path

        # Required fields
        self.id:          str  = data['id']
        self.name:        str  = data['name']
        self.version:     str  = data['version']
        self.mlc_api:     str  = data['mlc_api']
        self.language:    str  = data['language']
        self.phoneme_set: str  = data['phoneme_set']

        # Optional
        self.description:  str       = data.get('description', '')
        self.author:       str       = data.get('author', 'unknown')
        self.license:      str       = data.get('license', 'unknown')
        self.target_bank:  str       = data.get('target_bank', '')
        self.supported_phonemes: list[str] = data.get('supported_phonemes', [])
        self.capabilities: dict      = data.get('capabilities', {})
        self.tags:         list[str] = data.get('tags', [])

    @classmethod
    def load(cls, data: dict, source_path: Path) -> 'Manifest':
        missing = [k for k in cls.REQUIRED if k not in data]
        if missing:
            raise ValueError(f'manifest.json missing required fields: {missing}')
        return cls(data, source_path)

    def to_dict(self) -> dict:
        return {
            'id':                 self.id,
            'name':               self.name,
            'version':            self.version,
            'mlc_api':            self.mlc_api,
            'description':        self.description,
            'author':             self.author,
            'license':            self.license,
            'language':           self.language,
            'target_bank':        self.target_bank,
            'phoneme_set':        self.phoneme_set,
            'supported_phonemes': self.supported_phonemes,
            'capabilities':       self.capabilities,
            'tags':               self.tags,
            'source':             str(self.source_path),
        }


# ═══════════════════════════════════════════════════════════════════
#  Loaded module container
# ═══════════════════════════════════════════════════════════════════

class LoadedModule:
    """
    A fully loaded .mlc bundle, ready to use.
    Wraps the manifest + the VoicebankModule instance.
    """
    def __init__(
        self,
        manifest: Manifest,
        mapper,               # VoicebankModule instance
        phoneme_table: Optional[dict] = None,
        rules: Optional[list] = None,
        dictionary: Optional[dict] = None,
        postprocess_rules: Optional[list] = None,
    ):
        self.manifest          = manifest
        self.mapper            = mapper
        self.phoneme_table     = phoneme_table or {}
        self.rules             = rules or []
        self.dictionary        = dictionary or {}
        self.postprocess_rules = postprocess_rules or []

        # Inject optional tables into mapper so it can use them
        if hasattr(mapper, '_inject_tables'):
            mapper._inject_tables(
                phoneme_table=self.phoneme_table,
                rules=self.rules,
                dictionary=self.dictionary,
                postprocess_rules=self.postprocess_rules,
            )

    @property
    def id(self) -> str:
        return self.manifest.id


# ═══════════════════════════════════════════════════════════════════
#  Module loader
# ═══════════════════════════════════════════════════════════════════

class MLCModuleLoader:
    """
    Discovers and loads .mlc bundles and plain Python modules from a directory.
    Supports hot-reload: call reload() to pick up new/changed files.
    """

    def __init__(self, modules_dir: Path):
        self.modules_dir = Path(modules_dir)
        self._loaded:  dict[str, LoadedModule] = {}
        self._hashes:  dict[str, str] = {}   # path → file hash for change detection

    # ── Discovery ────────────────────────────────────────────────────────────

    def discover(self) -> dict[str, LoadedModule]:
        """Scan the modules directory and load everything found."""
        if not self.modules_dir.exists():
            log.warning(f'Modules directory does not exist: {self.modules_dir}')
            return self._loaded

        # .mlc bundles
        for mlc_file in sorted(self.modules_dir.glob('*.mlc')):
            self._load_mlc_bundle(mlc_file)

        # Plain .py modules (legacy / development)
        for py_file in sorted(self.modules_dir.glob('*.py')):
            if not py_file.name.startswith('_'):
                self._load_py_module(py_file)

        log.info(f'Loaded {len(self._loaded)} MLC module(s)')
        return self._loaded

    def reload(self) -> dict[str, str]:
        """
        Check for new/changed modules. Returns dict of {id: 'loaded'|'updated'|'failed'}.
        Does not unload modules that are no longer present (would break active projects).
        """
        changes = {}

        for mlc_file in sorted(self.modules_dir.glob('*.mlc')):
            current_hash = self._file_hash(mlc_file)
            path_str = str(mlc_file)
            if path_str not in self._hashes or self._hashes[path_str] != current_hash:
                try:
                    module = self._load_mlc_bundle(mlc_file)
                    changes[module.id] = 'updated' if path_str in self._hashes else 'loaded'
                except Exception as e:
                    changes[str(mlc_file.stem)] = 'failed'
                    log.error(f'Failed to reload {mlc_file.name}: {e}')

        return changes

    def get(self, module_id: str) -> Optional[LoadedModule]:
        return self._loaded.get(module_id)

    def list(self) -> list[dict]:
        return [m.manifest.to_dict() for m in self._loaded.values()]

    # ── .mlc bundle loading ───────────────────────────────────────────────────

    def _load_mlc_bundle(self, path: Path) -> LoadedModule:
        """Extract a .mlc zip and load its contents."""
        log.debug(f'Loading .mlc bundle: {path.name}')

        if not zipfile.is_zipfile(path):
            raise ValueError(f'{path.name} is not a valid .mlc file (not a ZIP archive)')

        with zipfile.ZipFile(path, 'r') as zf:
            names = zf.namelist()

            # 1. Load manifest
            if 'manifest.json' not in names:
                raise ValueError(f'{path.name} is missing manifest.json')
            manifest = Manifest.load(
                json.loads(zf.read('manifest.json')),
                source_path=path,
            )

            # 2. API version check
            if manifest.mlc_api != MLC_API_VERSION:
                log.warning(
                    f'{path.name} targets MLC API {manifest.mlc_api}, '
                    f'current is {MLC_API_VERSION}. May work, proceeding.'
                )

            # 3. Load mapper.py into a temp file and import it
            if 'mapper.py' not in names:
                raise ValueError(f'{path.name} is missing mapper.py')

            mapper_source = zf.read('mapper.py').decode('utf-8')
            mapper_instance = self._import_mapper(
                source=mapper_source,
                module_name=f'mlc_bundle_{manifest.id}',
                manifest=manifest,
            )

            # 4. Load optional data files
            phoneme_table = (
                json.loads(zf.read('phoneme_table.json'))
                if 'phoneme_table.json' in names else {}
            )
            rules = (
                json.loads(zf.read('rules.json'))
                if 'rules.json' in names else []
            )
            dictionary = (
                json.loads(zf.read('dictionary.json'))
                if 'dictionary.json' in names else {}
            )
            postprocess_rules = (
                json.loads(zf.read('postprocess.json'))
                if 'postprocess.json' in names else []
            )

        loaded = LoadedModule(
            manifest=manifest,
            mapper=mapper_instance,
            phoneme_table=phoneme_table,
            rules=rules,
            dictionary=dictionary,
            postprocess_rules=postprocess_rules,
        )
        self._loaded[manifest.id] = loaded
        self._hashes[str(path)] = self._file_hash(path)
        log.info(f'Loaded: {manifest.id} v{manifest.version} ({manifest.name})')
        return loaded

    def _import_mapper(self, source: str, module_name: str, manifest: Manifest):
        """Dynamically import mapper.py source and return a module instance."""
        from mlc_base import VoicebankModule

        # Write to a temp file (importlib needs a real path for some edge cases)
        import tempfile, os
        with tempfile.NamedTemporaryFile(
            mode='w', suffix='.py', delete=False, prefix=f'mlc_{manifest.id}_'
        ) as f:
            f.write(source)
            tmp_path = f.name

        try:
            spec = importlib.util.spec_from_file_location(module_name, tmp_path)
            mod  = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = mod
            spec.loader.exec_module(mod)
        finally:
            import os
            try: os.unlink(tmp_path)
            except: pass

        # Find the VoicebankModule subclass
        for attr_name in dir(mod):
            attr = getattr(mod, attr_name)
            if (
                isinstance(attr, type)
                and issubclass(attr, VoicebankModule)
                and attr is not VoicebankModule
            ):
                instance = attr()
                # Validate id matches manifest
                if instance.id != manifest.id:
                    log.warning(
                        f'mapper.py class id "{instance.id}" != '
                        f'manifest id "{manifest.id}" — using manifest id'
                    )
                    instance.id = manifest.id
                return instance

        raise ValueError(
            f'mapper.py in {manifest.id}.mlc has no VoicebankModule subclass'
        )

    # ── Plain Python module loading (dev convenience) ─────────────────────────

    def _load_py_module(self, path: Path):
        """Load a plain .py file as a module (no manifest required)."""
        from mlc_base import VoicebankModule

        module_name = f'mlc_py_{path.stem}'
        spec = importlib.util.spec_from_file_location(module_name, path)
        mod  = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = mod

        try:
            spec.loader.exec_module(mod)
        except Exception as e:
            log.warning(f'Failed to load {path.name}: {e}')
            return

        for attr_name in dir(mod):
            attr = getattr(mod, attr_name)
            if (
                isinstance(attr, type)
                and issubclass(attr, VoicebankModule)
                and attr is not VoicebankModule
            ):
                instance = attr()
                if instance.id in self._loaded:
                    continue  # .mlc takes priority over .py
                # Wrap in a minimal LoadedModule with a generated manifest
                manifest = Manifest(
                    {
                        'id': instance.id, 'name': instance.name,
                        'version': instance.version, 'mlc_api': MLC_API_VERSION,
                        'language': instance.language, 'phoneme_set': instance.phoneme_set,
                        'description': instance.description,
                    },
                    source_path=path,
                )
                self._loaded[instance.id] = LoadedModule(manifest=manifest, mapper=instance)
                log.debug(f'Loaded .py module: {instance.id}')

    # ── Utilities ─────────────────────────────────────────────────────────────

    @staticmethod
    def _file_hash(path: Path) -> str:
        h = hashlib.sha256()
        h.update(path.read_bytes())
        return h.hexdigest()
