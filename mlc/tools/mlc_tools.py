#!/usr/bin/env python3
"""
MLC Tools — Command-line utilities
====================================
Usage:
  python tools/mlc_tools.py convert "beautiful dream" --module jp_cv_standard --singability 0.65
  python tools/mlc_tools.py preview "fly me to the moon"
  python tools/mlc_tools.py modules
  python tools/mlc_tools.py cache stats
  python tools/mlc_tools.py cache clear
  python tools/mlc_tools.py bundle create ./my_module/
  python tools/mlc_tools.py bundle validate ./my_module.mlc
  python tools/mlc_tools.py benchmark "never gonna give you up"
"""

import sys
import json
import time
import argparse
import zipfile
import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'core'))


def cmd_convert(args):
    """Convert lyrics to phonemes and print the result."""
    from registry import MLCRegistry
    from core.g2p import G2PEngine
    from core.confidence import ConfidenceScorer

    registry = MLCRegistry(ROOT / 'modules', ROOT / 'user_modules')
    registry.discover_all()

    module = registry.get(args.module)
    if not module:
        print(f'Error: module "{args.module}" not found')
        print(f'Available: {[m["id"] for m in registry.list_all()]}')
        sys.exit(1)

    g2p = G2PEngine()

    # Detect language
    lang = args.lang
    if not lang:
        try:
            from langdetect import detect
            lang = detect(args.text)
        except Exception:
            lang = 'en'

    t_start = time.time()
    ipf, words, normalised = g2p.process(args.text, lang)
    synth = module.map_phonemes(ipf, args.singability)
    synth = module.postprocess(synth, args.singability)

    scorer = ConfidenceScorer()
    synth, warnings, conf = scorer.score(synth, module.supported_phonemes, lang, module.phoneme_set)
    elapsed = int((time.time() - t_start) * 1000)

    print(f'\n{"─"*60}')
    print(f'  Input:       {args.text}')
    print(f'  Language:    {lang}')
    print(f'  Module:      {module.name} v{module.version}')
    print(f'  Singability: {args.singability}')
    print(f'  Confidence:  {conf:.0%}')
    print(f'  Time:        {elapsed}ms')
    print(f'{"─"*60}')

    # Display tokens grouped by word
    current_word = -1
    line = ''
    for tok in synth:
        if tok.word_index != current_word:
            if line:
                print(f'  {words[current_word]:15s}  →  {line}')
            line = ''
            current_word = tok.word_index
        conf_marker = '' if tok.confidence.value in ('high','medium') else ' ⚠'
        line += f'{tok.display}{conf_marker} '
    if line:
        print(f'  {words[current_word]:15s}  →  {line}')

    print(f'{"─"*60}')
    print(f'  Full sequence: {" · ".join(t.display for t in synth)}')

    if warnings:
        print(f'\n  Warnings:')
        for w in warnings:
            print(f'    [{w.level.value.upper()}] {w.message}')
            if w.suggestion:
                print(f'           → {w.suggestion}')

    if args.json:
        from core.mlc_types import ConversionOutput
        out = ConversionOutput(
            tokens=synth, words=words, word_boundaries=[],
            phrase_breaks=[], language=lang, module_id=module.id,
            singability=args.singability, confidence_score=conf,
            warnings=warnings, processing_ms=elapsed,
        )
        print(f'\nJSON output:')
        print(json.dumps(out.to_dict(), indent=2))


def cmd_modules(args):
    """List all available modules."""
    from registry import MLCRegistry
    registry = MLCRegistry(ROOT / 'modules', ROOT / 'user_modules')
    results = registry.discover_all()

    print(f'\n{"─"*70}')
    print(f'  {"ID":<25} {"Name":<30} {"Lang":<6} {"Ver":<8}')
    print(f'{"─"*70}')
    for m in registry.list_all():
        src = '📦' if m['from_bundle'] else '🐍'
        print(f'  {src} {m["id"]:<23} {m["name"]:<30} {m["language"]:<6} {m["version"]:<8}')
    print(f'{"─"*70}')
    print(f'  {len(registry.list_all())} modules loaded\n')


def cmd_cache(args):
    """Cache management."""
    from core.cache import G2PCache, PhraseCache
    g2p_cache = G2PCache(ROOT / '.cache' / 'g2p.db')
    p_cache   = PhraseCache(ROOT / '.cache' / 'phrases.db')

    if args.cache_cmd == 'stats':
        g = g2p_cache.stats()
        p = p_cache.stats()
        print(f'\n  G2P cache:    {g["total_entries"]} entries  ({g["languages"]} languages)')
        print(f'  Phrase cache: {p.get("total_entries",0)} entries  ({p.get("total_hits",0)} total hits)\n')

    elif args.cache_cmd == 'clear':
        target = getattr(args, 'target', 'all')
        lang   = getattr(args, 'lang', None)
        if target in ('g2p', 'all'):
            g2p_cache.clear(lang)
            print(f'  G2P cache cleared.')
        if target in ('phrase', 'all'):
            p_cache.clear()
            print(f'  Phrase cache cleared.')


def cmd_bundle_create(args):
    """Package a module directory into a .mlc bundle."""
    src_dir  = Path(args.source)
    out_path = Path(args.output) if args.output else src_dir.parent / f'{src_dir.name}.mlc'

    if not src_dir.is_dir():
        print(f'Error: {src_dir} is not a directory')
        sys.exit(1)

    manifest_path = src_dir / 'manifest.json'
    if not manifest_path.exists():
        print(f'Error: {src_dir}/manifest.json not found')
        print('Create a manifest.json first. See docs/example_manifest.json for reference.')
        sys.exit(1)

    # Validate manifest
    with open(manifest_path) as f:
        manifest = json.load(f)
    required = {'id', 'name', 'version', 'language', 'phoneme_set', 'entry_point'}
    missing  = required - set(manifest.keys())
    if missing:
        print(f'Error: manifest.json missing fields: {missing}')
        sys.exit(1)

    entry = src_dir / manifest['entry_point']
    if not entry.exists():
        print(f'Error: entry point "{manifest["entry_point"]}" not found in {src_dir}')
        sys.exit(1)

    # Create ZIP
    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for f in src_dir.rglob('*'):
            if f.is_file() and not any(p.startswith('.') or p == '__pycache__'
                                        for p in f.parts):
                arcname = f.relative_to(src_dir)
                zf.write(f, arcname)

    size_kb = out_path.stat().st_size // 1024
    print(f'\n  ✓ Created: {out_path}  ({size_kb} KB)')
    print(f'    Module:  {manifest["name"]} v{manifest["version"]}')
    print(f'    ID:      {manifest["id"]}')
    print(f'\n  Install with:')
    print(f'    python tools/mlc_tools.py bundle install {out_path}\n')


def cmd_bundle_validate(args):
    """Validate a .mlc bundle."""
    path = Path(args.path)
    if not path.exists():
        print(f'Error: file not found: {path}')
        sys.exit(1)

    print(f'\n  Validating: {path.name}')
    errors   = []
    warnings = []

    if not zipfile.is_zipfile(path):
        errors.append('Not a valid ZIP file')
    else:
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()

            if 'manifest.json' not in names:
                errors.append('Missing manifest.json')
            else:
                try:
                    manifest = json.loads(zf.read('manifest.json'))
                    required = {'id','name','version','language','phoneme_set','entry_point','mlc_api_version'}
                    missing  = required - set(manifest.keys())
                    if missing:
                        errors.append(f'manifest.json missing fields: {missing}')
                    else:
                        entry = manifest['entry_point']
                        if entry not in names:
                            errors.append(f'entry_point "{entry}" not in bundle')
                        if not manifest.get('description'):
                            warnings.append('No description provided')
                        if not manifest.get('author'):
                            warnings.append('No author provided')
                        if not manifest.get('target_banks'):
                            warnings.append('No target_banks listed')
                except json.JSONDecodeError as e:
                    errors.append(f'Invalid JSON in manifest.json: {e}')

            if 'README.md' not in names:
                warnings.append('No README.md — community users will appreciate documentation')

    if errors:
        for e in errors:
            print(f'  ✗ ERROR:   {e}')
    if warnings:
        for w in warnings:
            print(f'  ⚠ WARNING: {w}')
    if not errors and not warnings:
        print(f'  ✓ Valid — ready to distribute')
    elif not errors:
        print(f'  ✓ Valid with warnings')
    print()


def cmd_bundle_install(args):
    """Install a .mlc bundle into the user modules directory."""
    from registry import MLCRegistry
    registry = MLCRegistry(ROOT / 'modules', ROOT / 'user_modules')
    path     = Path(args.path)
    result   = registry.install_bundle(path)
    print(f'  {result}')


def cmd_benchmark(args):
    """Benchmark conversion performance."""
    from registry import MLCRegistry
    from core.g2p import G2PEngine
    from core.cache import G2PCache, PhraseCache

    registry  = MLCRegistry(ROOT / 'modules', ROOT / 'user_modules')
    registry.discover_all()
    module    = registry.get(args.module)
    g2p       = G2PEngine()
    g2p_cache = G2PCache(ROOT / '.cache' / 'g2p.db')
    p_cache   = PhraseCache(ROOT / '.cache' / 'phrases.db')

    try:
        from langdetect import detect
        lang = detect(args.text)
    except Exception:
        lang = 'en'

    print(f'\n  Benchmarking: "{args.text}"')
    print(f'  Module: {module.name}  |  Singability: {args.singability}')
    print()

    # Cold run (no cache)
    p_cache.clear()
    t0 = time.time()
    ipf, words, _ = g2p.process(args.text, lang)
    synth = module.map_phonemes(ipf, args.singability)
    cold_ms = int((time.time() - t0) * 1000)

    # Warm run (phrase cache)
    cached_result = p_cache.get(args.text, lang, module.id, module.version, args.singability)
    warm_runs = []
    for _ in range(5):
        t0 = time.time()
        _ = p_cache.get(args.text, lang, module.id, module.version, args.singability)
        warm_runs.append(int((time.time() - t0) * 1000))
    warm_avg = sum(warm_runs) // len(warm_runs)

    print(f'  Cold (first run):   {cold_ms}ms')
    print(f'  Warm (cache hit):   {warm_avg}ms  (avg of 5)')
    print(f'  Speedup:            {cold_ms // max(warm_avg, 1)}x')
    print(f'  Tokens produced:    {len(synth)}')
    print()


def main():
    parser = argparse.ArgumentParser(
        description='MLC Tools — Melon Lyric Conversion Engine CLI',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest='cmd')

    # convert
    p_conv = sub.add_parser('convert', help='Convert lyrics to phonemes')
    p_conv.add_argument('text')
    p_conv.add_argument('--module', '-m', default='jp_cv_standard')
    p_conv.add_argument('--singability', '-s', type=float, default=0.65)
    p_conv.add_argument('--lang', '-l', default=None)
    p_conv.add_argument('--json', action='store_true')

    # preview (first 10 words)
    p_prev = sub.add_parser('preview', help='Quick preview (first 10 words)')
    p_prev.add_argument('text')
    p_prev.add_argument('--module', '-m', default='jp_cv_standard')
    p_prev.add_argument('--singability', '-s', type=float, default=0.65)

    # modules
    sub.add_parser('modules', help='List available modules')

    # cache
    p_cache = sub.add_parser('cache', help='Cache management')
    p_cache_sub = p_cache.add_subparsers(dest='cache_cmd')
    p_cache_sub.add_parser('stats')
    p_cache_clr = p_cache_sub.add_parser('clear')
    p_cache_clr.add_argument('--target', default='all', choices=['g2p','phrase','all'])
    p_cache_clr.add_argument('--lang', default=None)

    # bundle
    p_bundle = sub.add_parser('bundle', help='.mlc bundle tools')
    p_bundle_sub = p_bundle.add_subparsers(dest='bundle_cmd')

    p_create = p_bundle_sub.add_parser('create', help='Create a .mlc bundle from a directory')
    p_create.add_argument('source', help='Module directory')
    p_create.add_argument('--output', '-o', default=None, help='Output .mlc path')

    p_val = p_bundle_sub.add_parser('validate', help='Validate a .mlc bundle')
    p_val.add_argument('path')

    p_inst = p_bundle_sub.add_parser('install', help='Install a .mlc bundle')
    p_inst.add_argument('path')

    # benchmark
    p_bench = sub.add_parser('benchmark', help='Benchmark conversion performance')
    p_bench.add_argument('text')
    p_bench.add_argument('--module', '-m', default='jp_cv_standard')
    p_bench.add_argument('--singability', '-s', type=float, default=0.65)

    args = parser.parse_args()

    if args.cmd == 'convert':
        cmd_convert(args)
    elif args.cmd == 'preview':
        args.json = False; args.lang = None
        cmd_convert(args)
    elif args.cmd == 'modules':
        cmd_modules(args)
    elif args.cmd == 'cache':
        cmd_cache(args)
    elif args.cmd == 'bundle':
        if args.bundle_cmd == 'create':    cmd_bundle_create(args)
        elif args.bundle_cmd == 'validate': cmd_bundle_validate(args)
        elif args.bundle_cmd == 'install':  cmd_bundle_install(args)
        else: p_bundle.print_help()
    elif args.cmd == 'benchmark':
        cmd_benchmark(args)
    else:
        parser.print_help()


if __name__ == '__main__':
    main()
