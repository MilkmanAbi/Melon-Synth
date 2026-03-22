"""
MLC Addon Registry
==================
Extends the core registry to handle all add-on types:
  - LanguagePack       (handles source language G2P)
  - PipelinePlugin     (hooks into pipeline stages)
  - VoicebankModule    (maps IPF → bank phonemes, from registry.py)

All three load from the same .mlc bundle format.
The manifest `type` or `types` field tells the loader what to look for.

Routing:
  pipeline.convert("안녕하세요", lang="ko")
    → AddonRegistry.get_language_pack("ko")  → KoreanLanguagePack
    → pipeline processes with Korean G2P
    → plugins at POST_G2P hook run
    → AddonRegistry.get_voicebank_module("jp_cv_standard") maps output
    → plugins at POST_MAP hook run
    → plugins at TONE hook run (if language has tone)
    → result

This is what makes "Korean lyrics → Teto sings them" work.
"""
from __future__ import annotations

import sys
import logging
import importlib.util
import zipfile
import json
import hashlib
import subprocess
import threading
import time
from pathlib import Path
from typing import Optional

log = logging.getLogger('mlc.addon_registry')

MLC_API_VERSION = '1.0.0'
BUILTIN_ADDONS_DIR = Path(__file__).parent / 'addons'
sys.path.insert(0, str(Path(__file__).parent))

from addon_base import LanguagePack, PipelinePlugin
sys.path.insert(0, str(Path(__file__).parent / 'api'))
try:
    from mlc_api_base import (
        WordOverride, PhonemeCorrector, OutputPostprocessor,
        CustomG2P, Analyzer, CompositeAddon,
        LanguagePack as NewLanguagePack,
        VoicebankMapper,
    )
except ImportError:
    WordOverride = PhonemeCorrector = OutputPostprocessor = None
    CustomG2P = Analyzer = CompositeAddon = None
    NewLanguagePack = VoicebankMapper = None
from registry import VoicebankModule, MLCRegistry, _hash_file, _install_dependencies
from core.mlc_types import AddonType, PipelineHook


class AddonRegistry:
    """
    Unified registry for all MLC add-on types.
    Wraps and extends the core VoicebankModule registry.
    """

    def __init__(self, builtin_dir: Path, user_dir: Path):
        # Core voicebank module registry
        self._vb_registry = MLCRegistry(builtin_dir, user_dir)

        # Language packs: lang_code → LanguagePack
        self._lang_packs:  dict[str, LanguagePack]  = {}

        # Pipeline plugins: hook → sorted list of PipelinePlugin
        self._plugins:     dict[PipelineHook, list[PipelinePlugin]] = {
            h: [] for h in PipelineHook
        }
        # New first-class addon types
        self._word_overrides:  list = []   # WordOverride, sorted by priority
        self._correctors:      list = []   # PhonemeCorrector
        self._postprocessors:  list = []   # OutputPostprocessor
        self._custom_g2ps:     dict = {}   # lang_code → CustomG2P (highest priority wins)
        self._analyzers:       list = []   # Analyzer

        self._lock         = threading.RLock()
        self._extract_root = user_dir / '.mlc_extracted'
        self._extract_root.mkdir(parents=True, exist_ok=True)

        self.user_dir = user_dir

        # Make sure addon dirs are on path
        for d in [str(builtin_dir), str(user_dir), str(builtin_dir.parent)]:
            if d not in sys.path:
                sys.path.insert(0, d)

    # ── Discovery ─────────────────────────────────────────────────────────

    def discover_all(self) -> dict[str, str]:
        """Scan all directories and load everything."""
        results = {}

        # First: load built-in voicebank modules
        results.update(self._vb_registry.discover_all())

        # Then: scan addon directories
        for directory in [BUILTIN_ADDONS_DIR, self.user_dir]:
            if not directory.exists():
                continue

            for py_file in sorted(directory.rglob('*.py')):
                if py_file.name.startswith('_'):
                    continue
                # Skip files already loaded as voicebank modules
                if directory == self._vb_registry.builtin_dir:
                    continue
                status = self._load_py_addon(py_file)
                results[py_file.stem] = status

            for mlc_file in sorted(directory.glob('*.mlc')):
                status = self._load_mlc_addon(mlc_file)
                results[mlc_file.stem] = status

        log.info(
            f'Addon discovery complete: '
            f'{len(self._vb_registry._modules)} mappers, '
            f'{len(self._lang_packs)} language packs, '
            f'{sum(len(v) for v in self._plugins.values())} plugins'
        )
        return results

    # ── Load a .py addon file ─────────────────────────────────────────────

    def _load_py_addon(self, path: Path) -> str:
        try:
            spec   = importlib.util.spec_from_file_location(f'mlc_addon_{path.stem}', path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return self._register_from_module(module, path)
        except Exception as e:
            log.error(f'Failed to load addon {path.name}: {e}')
            return f'error: {e}'

    # ── Load a .mlc bundle addon ──────────────────────────────────────────

    def _load_mlc_addon(self, path: Path) -> str:
        if not zipfile.is_zipfile(path):
            return f'error: {path.name} is not a valid .mlc bundle'

        file_hash = _hash_file(path)

        try:
            with zipfile.ZipFile(path, 'r') as zf:
                names = zf.namelist()

                if 'manifest.json' not in names:
                    return f'error: missing manifest.json in {path.name}'

                manifest = json.loads(zf.read('manifest.json').decode('utf-8'))
                addon_types = _parse_addon_types(manifest)

                # Check API version
                req_api = manifest.get('mlc_api_version', '0.0.0')
                if not _api_compat(req_api):
                    return (f'error: requires MLC API v{req_api}, '
                            f'this is v{MLC_API_VERSION}')

                raw_entry = manifest.get('entry_point', 'module.py')
                # Support "module.ClassName" format — extract just the filename
                if '.' in raw_entry and not raw_entry.endswith('.py'):
                    entry = raw_entry.split('.')[0] + '.py'
                else:
                    entry = raw_entry
                if entry not in names:
                    return f'error: entry_point "{entry}" not in bundle'

                # Extract
                extract_dir = self._extract_root / f'{path.stem}_{file_hash[:8]}'
                if not extract_dir.exists():
                    extract_dir.mkdir(parents=True)
                    zf.extractall(extract_dir)

            # Install dependencies
            _install_dependencies(manifest.get('dependencies', []), path.name)

            # Add to path
            if str(extract_dir) not in sys.path:
                sys.path.insert(0, str(extract_dir))

            entry_path = extract_dir / entry
            spec   = importlib.util.spec_from_file_location(f'mlc_bundle_{path.stem}', entry_path)
            pymod  = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(pymod)

            status = self._register_from_module(pymod, path, extract_dir, manifest)
            return status

        except Exception as e:
            log.error(f'Failed to load bundle {path.name}: {e}')
            import traceback; traceback.print_exc()
            return f'error: {e}'

    # ── Register classes from a loaded Python module ───────────────────────

    def _register_from_module(
        self,
        pymod,
        source_path: Path,
        data_dir: Optional[Path] = None,
        manifest: Optional[dict] = None,
    ) -> str:
        registered = []

        for attr_name in dir(pymod):
            attr = getattr(pymod, attr_name)
            if not isinstance(attr, type):
                continue
            # Skip base classes themselves (both old and new API)
            _skip = {VoicebankModule, LanguagePack, PipelinePlugin}
            if NewLanguagePack: _skip.add(NewLanguagePack)
            if VoicebankMapper:  _skip.add(VoicebankMapper)
            if CompositeAddon:   _skip.add(CompositeAddon)
            if WordOverride:     _skip.add(WordOverride)
            if PhonemeCorrector: _skip.add(PhonemeCorrector)
            if OutputPostprocessor: _skip.add(OutputPostprocessor)
            if CustomG2P:        _skip.add(CustomG2P)
            if Analyzer:         _skip.add(Analyzer)
            if attr in _skip:
                continue
            # Skip if this class was imported from a well-known shared module
            # (not from the addon bundle itself)
            attr_module = getattr(attr, '__module__', '')
            shared_prefixes = ('mlc_api', 'api.', 'addon_base', 'core.', 'registry',
                               'mlc_pipeline', 'mlc_base', 'mlc_types', 'pathlib',
                               'enum', 'abc', 'builtins')
            if any(attr_module.startswith(p) or attr_module == p.rstrip('.')
                   for p in shared_prefixes):
                continue

            try:
                if _is_kind(attr, 'LanguagePack') and attr.__name__ != 'LanguagePack':
                    inst = attr()
                    inst.data_dir = data_dir
                    inst.on_load()
                    with self._lock:
                        for lang in inst.handles + inst.handles_also:
                            self._lang_packs[lang] = inst
                    log.info(f'Language pack: {inst.id} → handles {inst.handles}')
                    registered.append(inst.id)

                elif _is_kind(attr, 'PipelinePlugin') and attr.__name__ != 'PipelinePlugin':
                    inst = attr()
                    inst.data_dir = data_dir
                    inst.on_load()
                    with self._lock:
                        for hook in inst.hooks:
                            self._plugins[hook].append(inst)
                            self._plugins[hook].sort(key=lambda p: p.priority)
                    log.info(f'Pipeline plugin: {inst.id} → hooks {[h.value for h in inst.hooks]}')
                    registered.append(inst.id)

                # ── CompositeAddon: unpack components and register each ──────────
                elif _is_kind(attr, 'CompositeAddon'):
                    outer = attr()
                    outer.data_dir = data_dir
                    outer.on_load()
                    for comp in outer.get_components():
                        comp.data_dir = data_dir
                        comp.on_load()
                        self._register_component(comp, source_path, data_dir)
                        registered.append(f'{attr.__name__}:{comp.id}')
                    log.info(f'Composite addon: {outer.id} → {len(outer.get_components())} components')

                # ── New API: VoicebankMapper ─────────────────────────────────────────
                elif _is_kind(attr, 'VoicebankMapper') and attr.__name__ != 'VoicebankMapper':
                    inst = attr()
                    inst.data_dir = data_dir
                    inst.on_load()
                    from registry import LoadedModule, _hash_file
                    h = _hash_file(source_path) if source_path.exists() else 'unknown'
                    loaded = LoadedModule(inst, source_path, h, from_bundle=(data_dir is not None))
                    with self._lock:
                        self._vb_registry._modules[inst.id] = loaded
                    log.info(f'Voicebank mapper (new API): {inst.id}')
                    registered.append(inst.id)

                # ── New API: LanguagePack ────────────────────────────────────────────
                elif _is_kind(attr, 'LanguagePack') and attr.__name__ != 'LanguagePack':
                    inst = attr()
                    inst.data_dir = data_dir
                    inst.on_load()
                    with self._lock:
                        for lang in inst.handles + getattr(inst, 'handles_also', []):
                            self._lang_packs[lang] = inst
                    log.info(f'Language pack (new API): {inst.id} → {inst.handles}')
                    registered.append(inst.id)

                elif _is_kind(attr, 'VoicebankModule') and attr.__name__ != 'VoicebankModule':
                    inst = attr()
                    if data_dir:
                        inst.data_dir = data_dir / 'data'
                    inst.on_load()
                    from registry import LoadedModule, _hash_file
                    h = _hash_file(source_path) if source_path.exists() else 'unknown'
                    loaded = LoadedModule(inst, source_path, h, from_bundle=(data_dir is not None))
                    with self._lock:
                        self._vb_registry._modules[inst.id] = loaded
                    log.info(f'Voicebank mapper: {inst.id}')
                    registered.append(inst.id)

            except Exception as e:
                log.warning(f'Could not register {attr_name}: {e}')

        if not registered:
            return f'warning: no registerable classes found in {source_path.name}'
        return f'ok: {", ".join(registered)}'

    def _register_component(self, comp, source_path, data_dir):
        """Register a single component from a CompositeAddon."""
        try:
            if _is_kind(type(comp), 'VoicebankMapper'):
                from registry import LoadedModule, _hash_file
                h = _hash_file(source_path) if source_path.exists() else 'unknown'
                loaded = LoadedModule(comp, source_path, h, from_bundle=True)
                with self._lock:
                    self._vb_registry._modules[comp.id] = loaded
                log.info(f'  Component mapper: {comp.id}')
            elif _is_kind(type(comp), 'LanguagePack'):
                with self._lock:
                    for lang in comp.handles + getattr(comp, 'handles_also', []):
                        self._lang_packs[lang] = comp
                log.info(f'  Component langpack: {comp.id} → {comp.handles}')
            elif _is_kind(type(comp), 'LanguagePack'):
                with self._lock:
                    for lang in comp.handles + getattr(comp, 'handles_also', []):
                        self._lang_packs[lang] = comp
                log.info(f'  Component langpack (old): {comp.id} → {comp.handles}')
            elif WordOverride and isinstance(comp, WordOverride):
                with self._lock:
                    self._word_overrides.append(comp)
                    self._word_overrides.sort(key=lambda x: x.priority)
            elif _is_kind(type(comp), 'PhonemeCorrector'):
                with self._lock:
                    self._correctors.append(comp)
            elif _is_kind(type(comp), 'OutputPostprocessor'):
                with self._lock:
                    self._postprocessors.append(comp)
        except Exception as e:
            log.warning(f'  Component registration failed: {e}')

    # ── Public API ────────────────────────────────────────────────────────

    def get_language_pack(self, lang: str) -> Optional[LanguagePack]:
        """Get the language pack for a language code. Returns None if not found."""
        with self._lock:
            # Try exact match first, then prefix (e.g. 'zh' matches 'zh-cmn')
            if lang in self._lang_packs:
                return self._lang_packs[lang]
            prefix = lang.split('-')[0]
            return self._lang_packs.get(prefix)

    def get_voicebank_module(self, module_id: str) -> Optional[VoicebankModule]:
        return self._vb_registry.get(module_id)

    def get(self, module_id: str) -> Optional[VoicebankModule]:
        """Alias for get_voicebank_module() — compatibility with engine code."""
        return self._vb_registry.get(module_id)

    def get_plugins(self, hook: PipelineHook, lang: str = '', module_id: str = '') -> list[PipelinePlugin]:
        """Get all plugins for a hook, filtered by language/module if relevant."""
        with self._lock:
            plugins = self._plugins.get(hook, [])
            return [
                p for p in plugins
                if (not p.languages or not lang or lang in p.languages or lang.split('-')[0] in p.languages)
                and (not p.modules or not module_id or module_id in p.modules)
            ]

    def run_hook(
        self,
        hook: PipelineHook,
        lang: str,
        module_id: str,
        *args,
        **kwargs,
    ):
        """
        Run all plugins registered for a hook in order.
        Each plugin receives the output of the previous one.
        Returns the final transformed data (first positional arg).
        """
        plugins = self.get_plugins(hook, lang, module_id)
        if not plugins:
            return args[0] if args else None

        data = args[0]
        rest = args[1:]

        for plugin in plugins:
            try:
                method_name = f'on_{hook.value}'
                method = getattr(plugin, method_name, None)
                if method:
                    data = method(data, *rest, **kwargs)
            except Exception as e:
                log.error(f'Plugin {plugin.id} failed at hook {hook.value}: {e}')
                # Don't let a plugin crash the pipeline — continue with previous data

        return data

    # ── New dispatch methods ──────────────────────────────────────────────

    def get_word_overrides(self, module_id: str = '', lang: str = '') -> list:
        """Return WordOverride addons that apply to this module/language, priority order."""
        return [w for w in self._word_overrides if w.matches(module_id, lang)]

    def get_correctors(self, module_id: str = '', lang: str = '') -> list:
        """Return PhonemeCorrector addons that apply, priority order."""
        return [c for c in self._correctors if c.matches(module_id, lang)]

    def get_postprocessors(self, module_id: str = '', lang: str = '') -> list:
        """Return OutputPostprocessor addons that apply, priority order."""
        return [p for p in self._postprocessors if p.matches(module_id, lang)]

    def get_custom_g2p(self, lang: str):
        """Return the highest-priority CustomG2P for this language, or None."""
        return self._custom_g2ps.get(lang)

    def get_analyzers(self, module_id: str = '', lang: str = '') -> list:
        """Return all Analyzer addons."""
        return [a for a in self._analyzers
                if (not a.for_modules or module_id in a.for_modules)
                and (not a.for_languages or lang in a.for_languages)]

    def list_all(self) -> dict:
        """List everything in the registry including new types."""
        with self._lock:
            return {
                'voicebank_mappers':   self._vb_registry.list_all(),
                'language_packs':      [p.get_info() for p in set(self._lang_packs.values())],
                'pipeline_plugins':    [p.get_info() for plugins in self._plugins.values() for p in plugins],
                'word_overrides':      [w.get_info() for w in self._word_overrides],
                'phoneme_correctors':  [c.get_info() for c in self._correctors],
                'output_postprocessors':[p.get_info() for p in self._postprocessors],
                'custom_g2ps':         [g.get_info() for g in self._custom_g2ps.values()],
                'analyzers':           [a.get_info() for a in self._analyzers],
            }

    def start_watching(self):
        self._vb_registry.start_watching()

    def stop_watching(self):
        self._vb_registry.stop_watching()

    def unload_addon(self, addon_id: str) -> None:
        """Best-effort unload — removes from registry dicts."""
        with self._lock:
            # Remove from language packs
            to_del = [lang for lang, pack in self._lang_packs.items() if pack.id == addon_id]
            for lang in to_del:
                del self._lang_packs[lang]

            # Remove from plugins
            for hook in list(self._plugins.keys()):
                self._plugins[hook] = [p for p in self._plugins[hook] if p.id != addon_id]

            # Remove from voicebank registry
            try:
                self._vb_registry.unload(addon_id)
            except Exception:
                pass

        log.info(f'Unloaded addon: {addon_id}')

    def install_addon(self, mlc_path: Path) -> str:
        """Install a .mlc addon from a file path into the user dir."""
        import shutil
        dest = self.user_dir / mlc_path.name
        try:
            if mlc_path.resolve() != dest.resolve():
                shutil.copy2(mlc_path, dest)
            # If same file, just (re)load it from where it is
        except shutil.SameFileError:
            pass  # already in place
        return self._load_mlc_addon(dest)


# ── Helpers ────────────────────────────────────────────────────────────────



def _is_kind(cls, *type_names: str) -> bool:
    """Check MRO by class name - avoids sys.path import identity issues."""
    mro_names = {c.__name__ for c in cls.__mro__}
    return bool(mro_names & set(type_names))

def _parse_addon_types(manifest: dict) -> list[AddonType]:
    raw = manifest.get('types', manifest.get('type', 'voicebank_mapper'))
    if isinstance(raw, str):
        raw = [raw]
    result = []
    for t in raw:
        try:
            result.append(AddonType(t))
        except ValueError:
            log.warning(f'Unknown addon type: {t}')
    return result or [AddonType.VOICEBANK_MAPPER]


def _api_compat(required: str) -> bool:
    try:
        def parse(v):
            return tuple(int(x) for x in v.split('.')[:3])
        return parse(required)[0] <= parse(MLC_API_VERSION)[0]
    except Exception:
        return True
