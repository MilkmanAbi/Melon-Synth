"""
MLC Cache
=========
Caches G2P conversion results to disk.
G2P is the most expensive step — espeak-ng takes ~50ms per word.
A 4-minute song has maybe 200 words. First run ~10s. With cache: ~0.2s.

Cache format: SQLite (single file, zero dependencies beyond stdlib)
Cache key:    SHA256(word + lang + mlc_version)
Cache value:  JSON-encoded list of ARPAbet symbols + confidence + backend

The cache is write-through and never evicted (it's G2P results —
they don't change unless espeak changes). Users can clear it manually
or via `mlc cache clear`.
"""

import sqlite3
import hashlib
import json
import logging
import threading
import time
from pathlib import Path
from typing import Optional

log = logging.getLogger('mlc.cache')

MLC_VERSION = '1.0.0'


class G2PCache:
    """
    SQLite-backed cache for G2P results.
    Thread-safe. One connection per thread.
    """

    def __init__(self, cache_path: Path):
        self.path = cache_path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        if not hasattr(self._local, 'conn') or self._local.conn is None:
            conn = sqlite3.connect(str(self.path), check_same_thread=False)
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('PRAGMA synchronous=NORMAL')
            self._local.conn = conn
        return self._local.conn

    def _init_db(self):
        conn = self._conn()
        conn.execute('''
            CREATE TABLE IF NOT EXISTS g2p_cache (
                cache_key   TEXT PRIMARY KEY,
                word        TEXT NOT NULL,
                lang        TEXT NOT NULL,
                arpabet     TEXT NOT NULL,
                confidence  REAL NOT NULL,
                backend     TEXT NOT NULL,
                created_at  INTEGER NOT NULL
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS meta (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        ''')
        conn.execute(
            'INSERT OR IGNORE INTO meta VALUES (?,?)',
            ('schema_version', '1')
        )
        conn.commit()

    def _key(self, word: str, lang: str) -> str:
        raw = f'{word.lower()}:{lang}:{MLC_VERSION}'
        return hashlib.sha256(raw.encode()).hexdigest()

    def get(self, word: str, lang: str) -> Optional[dict]:
        key = self._key(word, lang)
        try:
            row = self._conn().execute(
                'SELECT arpabet, confidence, backend FROM g2p_cache WHERE cache_key=?',
                (key,)
            ).fetchone()
            if row:
                return {
                    'arpabet':    json.loads(row[0]),
                    'confidence': row[1],
                    'backend':    row[2] + '_cached',
                }
        except Exception as e:
            log.warning(f'Cache read error: {e}')
        return None

    def put(self, word: str, lang: str, arpabet: list[str], confidence: float, backend: str):
        key = self._key(word, lang)
        try:
            self._conn().execute(
                '''INSERT OR REPLACE INTO g2p_cache
                   (cache_key, word, lang, arpabet, confidence, backend, created_at)
                   VALUES (?,?,?,?,?,?,?)''',
                (key, word.lower(), lang, json.dumps(arpabet),
                 confidence, backend, int(time.time()))
            )
            self._conn().commit()
        except Exception as e:
            log.warning(f'Cache write error: {e}')

    def stats(self) -> dict:
        try:
            row = self._conn().execute(
                'SELECT COUNT(*), COUNT(DISTINCT lang) FROM g2p_cache'
            ).fetchone()
            return {'total_entries': row[0], 'languages': row[1]}
        except Exception:
            return {'total_entries': 0, 'languages': 0}

    def clear(self, lang: Optional[str] = None):
        try:
            if lang:
                self._conn().execute('DELETE FROM g2p_cache WHERE lang=?', (lang,))
            else:
                self._conn().execute('DELETE FROM g2p_cache')
            self._conn().commit()
            log.info(f'Cache cleared (lang={lang or "all"})')
        except Exception as e:
            log.warning(f'Cache clear error: {e}')


class PhraseCache:
    """
    Caches full phrase conversion results (IPF + module output).
    Key: SHA256(normalised_text + lang + module_id + singability_bucket)

    singability_bucket: round to nearest 0.1 so nearby values share cache entries.
    Invalidated when module file changes (checked via module version string).
    """

    def __init__(self, cache_path: Path):
        self.path = cache_path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        if not hasattr(self._local, 'conn') or self._local.conn is None:
            conn = sqlite3.connect(str(self.path), check_same_thread=False)
            conn.execute('PRAGMA journal_mode=WAL')
            self._local.conn = conn
        return self._local.conn

    def _init_db(self):
        conn = self._conn()
        conn.execute('''
            CREATE TABLE IF NOT EXISTS phrase_cache (
                cache_key      TEXT PRIMARY KEY,
                input_text     TEXT NOT NULL,
                lang           TEXT NOT NULL,
                module_id      TEXT NOT NULL,
                module_version TEXT NOT NULL,
                singability    REAL NOT NULL,
                result_json    TEXT NOT NULL,
                created_at     INTEGER NOT NULL,
                hit_count      INTEGER DEFAULT 0
            )
        ''')
        conn.commit()

    def _key(self, text: str, lang: str, module_id: str,
             module_version: str, singability: float) -> str:
        bucket = round(singability * 10) / 10  # bucket to nearest 0.1
        raw = f'{text.lower().strip()}:{lang}:{module_id}:{module_version}:{bucket:.1f}'
        return hashlib.sha256(raw.encode()).hexdigest()

    def get(self, text: str, lang: str, module_id: str,
            module_version: str, singability: float) -> Optional[dict]:
        key = self._key(text, lang, module_id, module_version, singability)
        try:
            row = self._conn().execute(
                'SELECT result_json FROM phrase_cache WHERE cache_key=?', (key,)
            ).fetchone()
            if row:
                self._conn().execute(
                    'UPDATE phrase_cache SET hit_count=hit_count+1 WHERE cache_key=?', (key,)
                )
                self._conn().commit()
                return json.loads(row[0])
        except Exception as e:
            log.warning(f'Phrase cache read error: {e}')
        return None

    def put(self, text: str, lang: str, module_id: str, module_version: str,
            singability: float, result: dict):
        key = self._key(text, lang, module_id, module_version, singability)
        try:
            self._conn().execute(
                '''INSERT OR REPLACE INTO phrase_cache
                   (cache_key, input_text, lang, module_id, module_version,
                    singability, result_json, created_at)
                   VALUES (?,?,?,?,?,?,?,?)''',
                (key, text.lower().strip(), lang, module_id, module_version,
                 singability, json.dumps(result), int(time.time()))
            )
            self._conn().commit()
        except Exception as e:
            log.warning(f'Phrase cache write error: {e}')

    def stats(self) -> dict:
        try:
            row = self._conn().execute(
                'SELECT COUNT(*), SUM(hit_count) FROM phrase_cache'
            ).fetchone()
            return {'total_entries': row[0] or 0, 'total_hits': row[1] or 0}
        except Exception:
            return {}

    def clear(self):
        try:
            self._conn().execute('DELETE FROM phrase_cache')
            self._conn().commit()
        except Exception as e:
            log.warning(f'Phrase cache clear: {e}')
