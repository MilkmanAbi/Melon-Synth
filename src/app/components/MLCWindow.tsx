/**
 * MLC Window — Dedicated Lyric Conversion Workspace
 * ===================================================
 * Left:   lyrics input + module + singability
 * Right:  word-by-word phoneme breakdown (scrollable)
 * Footer: copy + apply buttons
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Languages, RefreshCw, Loader2, AlertTriangle,
  ArrowRight, Copy, CheckCircle2, Info,
} from 'lucide-react';
import { mlcClient, ConversionResult } from '../../subsystems/mlc-client';
import { useProjectStore } from '../../store/project';
import { withLock } from '../../subsystems/async-lock';

interface Props { onClose: () => void; }

function confColor(c: number) {
  if (c >= 0.85) return 'var(--success)';
  if (c >= 0.60) return 'var(--warning)';
  return 'var(--danger)';
}
function confBg(c: number) {
  if (c >= 0.85) return 'var(--success-subtle)';
  if (c >= 0.60) return 'var(--warning-subtle)';
  return 'var(--danger-subtle)';
}

export function MLCWindow({ onClose }: Props) {
  const { notes, setLyric, notify } = useProjectStore();

  const [text,         setText]         = useState('');
  const [moduleId,     setModuleId]     = useState('jp_cv_standard');
  const [modules,      setModules]      = useState<{ id: string; name: string }[]>([]);
  const [singability,  setSingability]  = useState(0.65);
  const [result,       setResult]       = useState<ConversionResult | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [detectedLang, setDetectedLang] = useState('');
  const [suggestLabel, setSuggestLabel] = useState('');
  const [activeWord,   setActiveWord]   = useState<number | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    mlcClient.listModules().then(mods => setModules(mods.map(m => ({ id: m.id, name: m.name }))));
  }, []);

  // Language detection
  useEffect(() => {
    if (text.trim().length < 4) { setDetectedLang(''); return; }
    const t = setTimeout(async () => {
      const lang = await mlcClient.detectLanguage(text);
      setDetectedLang(lang.toUpperCase());
    }, 600);
    return () => clearTimeout(t);
  }, [text]);

  // Live conversion — debounced 500ms
  useEffect(() => {
    if (!text.trim()) { setResult(null); setError(null); return; }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(doConvert, 500);
    return () => clearTimeout(debounce.current);
  }, [text, moduleId, singability]);

  const doConvert = useCallback(async () => {
    if (!text.trim()) return;
    return withLock('mlc-convert', async () => {
      setLoading(true); setError(null);
      try {
        const r = await mlcClient.convert({ text, moduleId, singability });
        setResult(r);
      } catch (e: any) {
        setError(e.message ?? 'Conversion failed');
      } finally {
        setLoading(false);
      }
    });
  }, [text, moduleId, singability]);

  const handleSuggest = async () => {
    return withLock('mlc-suggest', async () => {
      const s = await mlcClient.suggestSingability(text, moduleId);
      setSingability(s.suggested);
      setSuggestLabel(s.reason);
      setTimeout(() => setSuggestLabel(''), 4000);
    });
  };

  const handleApply = () => {
    if (!result || !result.tokens.length) return;
    const sorted = [...notes].sort((a, b) => a.start - b.start);
    let applied = 0;
    result.tokens.forEach((tok, i) => {
      if (sorted[i]) { setLyric(sorted[i].id, tok.display); applied++; }
    });
    if (applied > 0) {
      notify({ type: 'success', title: `Applied ${applied} phonemes`, body: 'Tokens mapped to notes by start position' });
      onClose();
    } else {
      notify({ type: 'warning', title: 'No notes to map to', body: 'Draw notes in the piano roll first, then apply' });
    }
  };

  // Group tokens by word for the breakdown view
  const wordGroups: { word: string; tokens: typeof result extends null ? never[] : ConversionResult['tokens'] }[] = [];
  if (result) {
    result.tokens.forEach(tok => {
      if (!wordGroups[tok.word_index]) {
        wordGroups[tok.word_index] = { word: result.words[tok.word_index] ?? '', tokens: [] as any };
      }
      (wordGroups[tok.word_index].tokens as any[]).push(tok);
    });
  }

  const overallConf = result?.confidence_score ?? 0;
  const hasTokens   = (result?.tokens.length ?? 0) > 0;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 700,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fadeIn 150ms var(--ease-out) both',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 800,
          height: '82vh',
          maxHeight: 640,
          background: 'var(--bg-surface)',
          border: '0.5px solid var(--border-default)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: '0 16px 56px rgba(0,0,0,0.22)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',           // ← critical: clips children to rounded box
          animation: 'slideDown 180ms var(--ease-out) both',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <div style={{
          height: 52, flexShrink: 0,
          display: 'flex', alignItems: 'center',
          padding: '0 20px', gap: 12,
          borderBottom: '0.5px solid var(--border-subtle)',
        }}>
          <Languages size={16} style={{ color: 'var(--accent)' }}/>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--text-primary)' }}>
              Lyric Conversion (MLC)
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              {mlcClient.isLive ? 'MLC Python engine connected' : 'Built-in rule engine · install Python + MLC for better accuracy'}
              {detectedLang ? ` · Detected: ${detectedLang}` : ''}
            </div>
          </div>

          {result && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '3px 10px',
              background: confBg(overallConf),
              border: `0.5px solid ${confColor(overallConf)}`,
              borderRadius: 'var(--radius-full)',
            }}>
              {overallConf >= 0.85
                ? <CheckCircle2 size={11} style={{ color: confColor(overallConf) }}/>
                : <AlertTriangle size={11} style={{ color: confColor(overallConf) }}/>
              }
              <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: confColor(overallConf) }}>
                {Math.round(overallConf * 100)}%
              </span>
            </div>
          )}

          {loading && <Loader2 size={14} style={{ color: 'var(--text-tertiary)', animation: 'spin 1s linear infinite' }}/>}

          <button onClick={onClose} style={{
            width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 'var(--radius-md)', color: 'var(--text-tertiary)',
            transition: 'all var(--duration-fast)', cursor: 'pointer',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-sunken)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
          >
            <X size={14}/>
          </button>
        </div>

        {/* ── Body: two columns ─────────────────────────────────────────── */}
        {/* IMPORTANT: minHeight:0 on flex children lets overflow:auto work */}
        <div style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          minHeight: 0,               // ← allows grid to shrink below content size
          overflow: 'hidden',
        }}>

          {/* LEFT: input ─────────────────────────────────────────────────── */}
          <div style={{
            display: 'flex', flexDirection: 'column',
            borderRight: '0.5px solid var(--border-subtle)',
            overflow: 'hidden',        // ← clips overflowing content
            minHeight: 0,
          }}>
            {/* Scrollable left content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Lyrics textarea */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-tertiary)',
                               letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
                  Lyrics
                </div>
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder={"Type or paste lyrics here.\nMelon Synth converts them to\nphonemesyour voicebank can sing.\n\nExample:\n  beautiful dream\n→ byu ti fu ru do ri i mu"}
                  style={{
                    width: '100%', height: 200,
                    background: 'var(--bg-sunken)',
                    border: '0.5px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    padding: '10px 12px',
                    fontSize: 'var(--text-sm)', color: 'var(--text-primary)',
                    fontFamily: 'var(--font-ui)', resize: 'vertical',
                    outline: 'none', lineHeight: 1.6,
                    transition: 'border-color var(--duration-fast)',
                    userSelect: 'text',
                    boxSizing: 'border-box',
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onBlur={e  => (e.currentTarget.style.borderColor = 'var(--border-default)')}
                />
              </div>

              {/* Module picker */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-tertiary)',
                               letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
                  Voicebank module
                </div>
                <select value={moduleId} onChange={e => setModuleId(e.target.value)} style={{
                  width: '100%', height: 30,
                  background: 'var(--bg-sunken)',
                  border: '0.5px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0 8px',
                  fontSize: 'var(--text-sm)', color: 'var(--text-primary)',
                  outline: 'none', cursor: 'pointer',
                  boxSizing: 'border-box',
                }}>
                  {modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>

              {/* Singability */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-tertiary)',
                                  letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                    Singability
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 'var(--mono-sm)', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                      {Math.round(singability * 100)}
                    </span>
                    <button onClick={handleSuggest} title="Auto-suggest best singability" style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 18, height: 18,
                      border: '0.5px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-tertiary)', cursor: 'pointer',
                      transition: 'all var(--duration-fast)',
                    }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
                    >
                      <RefreshCw size={9}/>
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>Accurate</span>
                  <input type="range" min={0} max={1} step={0.05} value={singability}
                    onChange={e => setSingability(parseFloat(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>Singable</span>
                </div>
                {suggestLabel && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6,
                                 display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Info size={10}/> {suggestLabel}
                  </div>
                )}
              </div>

              {/* Tip */}
              <div style={{
                padding: '10px 12px',
                background: 'var(--bg-sunken)', borderRadius: 'var(--radius-md)',
                border: '0.5px solid var(--border-subtle)',
                fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5,
              }}>
                <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Tip:</strong>{' '}
                0 = phonetically accurate. 100 = maximally singable.
                For Japanese pop, 65 is a good starting point.
              </div>
            </div>
          </div>

          {/* RIGHT: phoneme output ────────────────────────────────────────── */}
          <div style={{
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden', minHeight: 0,
          }}>
            <div style={{
              padding: '16px 20px 8px',
              flexShrink: 0,
              fontSize: 11, fontWeight: 500, color: 'var(--text-tertiary)',
              letterSpacing: '0.07em', textTransform: 'uppercase',
            }}>
              Phoneme output
            </div>

            {error && (
              <div style={{
                margin: '0 20px 8px',
                display: 'flex', gap: 8, padding: '8px 12px',
                background: 'var(--danger-subtle)', borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-sm)', color: 'var(--danger)', flexShrink: 0,
              }}>
                <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }}/>{error}
              </div>
            )}

            {/* Scrollable word groups — this is what was broken */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 12px', minHeight: 0 }}>
              {wordGroups.filter(Boolean).length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {wordGroups.filter(Boolean).map((group, wi) => (
                    <div key={wi}
                      onMouseEnter={() => setActiveWord(wi)}
                      onMouseLeave={() => setActiveWord(null)}
                      style={{
                        padding: '8px 12px',
                        background: activeWord === wi ? 'var(--bg-sunken)' : 'var(--bg-base)',
                        borderRadius: 'var(--radius-md)',
                        border: `0.5px solid ${activeWord === wi ? 'var(--border-default)' : 'var(--border-subtle)'}`,
                        transition: 'all var(--duration-fast)',
                      }}
                    >
                      <div style={{ fontSize: 10, color: 'var(--text-tertiary)',
                                     fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
                        {group.word}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {(group.tokens as ConversionResult['tokens']).map((tok, ti) => {
                          const conf = typeof tok.mlc_confidence === 'number' ? tok.mlc_confidence : 0.6;
                          return (
                            <span key={ti} style={{
                              padding: '2px 9px',
                              borderRadius: 'var(--radius-full)',
                              fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)',
                              background: confBg(conf), color: confColor(conf),
                              border: `0.5px solid ${confColor(conf)}`,
                              borderTop: tok.stressed ? `2px solid ${confColor(conf)}` : undefined,
                            }}>
                              {tok.display}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : !loading ? (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', minHeight: 160,
                  color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)', gap: 12, textAlign: 'center',
                }}>
                  <Languages size={32} style={{ opacity: 0.15 }}/>
                  Type lyrics on the left
                </div>
              ) : null}
            </div>

            {/* Warnings + stats */}
            {result && (
              <div style={{ padding: '0 20px 10px', flexShrink: 0 }}>
                {result.warnings.map((w, i) => (
                  <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4,
                                         fontSize: 11, color: 'var(--warning)' }}>
                    <AlertTriangle size={10} style={{ flexShrink: 0, marginTop: 1 }}/>{w}
                  </div>
                ))}
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)',
                               display: 'flex', gap: 12 }}>
                  <span>{result.tokens.length} tokens</span>
                  <span>{result.words.length} words</span>
                  <span>{result.language.toUpperCase()}</span>
                  <span>{result.processing_ms}ms</span>
                  {result.from_cache && <span>cached</span>}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <div style={{
          height: 56, flexShrink: 0,
          borderTop: '0.5px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 20px',
          background: 'var(--bg-sunken)',
        }}>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
            {hasTokens && notes.length > 0
              ? `${result!.tokens.length} phonemes → ${Math.min(result!.tokens.length, notes.length)} notes`
              : hasTokens && notes.length === 0
              ? 'Draw notes in piano roll to apply'
              : 'Type lyrics above to generate phonemes'
            }
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {/* Copy */}
            <button
              disabled={!hasTokens}
              onClick={() => {
                if (!result) return;
                navigator.clipboard?.writeText(result.tokens.map(t => t.display).join(' '));
                notify({ type: 'success', title: 'Phonemes copied to clipboard' });
              }}
              style={{
                height: 32, padding: '0 12px',
                border: '0.5px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-sm)', color: hasTokens ? 'var(--text-secondary)' : 'var(--text-disabled)',
                display: 'flex', alignItems: 'center', gap: 6,
                cursor: hasTokens ? 'pointer' : 'not-allowed',
                transition: 'all var(--duration-fast)',
              }}
              onMouseEnter={e => { if (hasTokens) e.currentTarget.style.background = 'var(--bg-surface)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <Copy size={13}/> Copy phonemes
            </button>

            {/* Apply — always visible, shows helpful state */}
            <button
              onClick={handleApply}
              disabled={!hasTokens}
              style={{
                height: 32, padding: '0 16px',
                background: hasTokens ? 'var(--accent)' : 'var(--bg-sunken)',
                border: hasTokens ? 'none' : '0.5px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-sm)',
                color: hasTokens ? 'white' : 'var(--text-tertiary)',
                fontWeight: 500,
                display: 'flex', alignItems: 'center', gap: 6,
                cursor: hasTokens ? 'pointer' : 'not-allowed',
                transition: 'all var(--duration-fast)',
              }}
              onMouseEnter={e => { if (hasTokens) e.currentTarget.style.background = 'var(--accent-hover)'; }}
              onMouseLeave={e => { if (hasTokens) e.currentTarget.style.background = 'var(--accent)'; }}
            >
              Apply to project <ArrowRight size={13}/>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
