/**
 * Voicebank Manager
 * ==================
 * Full-screen panel (accessible from Voice Panel or File menu).
 * Three tabs:
 *   Installed   — voicebanks already on this machine
 *   Catalog     — community voicebanks available to download
 *   Engines     — OpenUTAU + music editors setup
 *
 * Design: follows the rulebook — no modals, inline popovers,
 * progress in notification-style inline bars.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Download, FolderOpen, CheckCircle2, AlertTriangle,
  ExternalLink, RefreshCw, Music2, Cpu, Package,
  ChevronRight, X, Loader2, Puzzle, Plus, Upload,
} from 'lucide-react';
import { withLock } from '../../subsystems/async-lock';

// ── Types ─────────────────────────────────────────────────────────────────────

interface InstalledVoicebank {
  id:        string;
  name:      string;
  author?:   string;
  path:      string;
  type:      string;
  language:  string;
  image?:    string;
  installed: boolean;
  web?:      string;
}

interface CatalogEntry {
  id:          string;
  name:        string;
  author:      string;
  description: string;
  language:    string;
  phoneme_set: string;
  mlc_module:  string;
  type:        string;
  size_mb:     number;
  tags:        string[];
  color:       string;
  avatar_emoji: string;
  license:     string;
  download:    { method: string; url: string | null; note?: string };
  install_note: string;
}

interface EditorInfo {
  id:       string;
  name:     string;
  license:  string;
  website:  string;
  path:     string | null;
  detected: boolean;
}

interface AddonInfo {
  id:         string;
  name:       string;
  version:    string;
  description: string;
  addon_type: string;
  language:   string;
  from_bundle: boolean;
  source:     string;
}

interface DownloadState {
  percent: number;
  phase:   'downloading' | 'extracting' | 'done' | 'error';
  error?:  string;
}

// ── Demo data for browser dev mode ───────────────────────────────────────────

const DEMO_CATALOG: CatalogEntry[] = [
  {
    id:'kasane_teto_cv', name:'Kasane Teto CV', author:'Teto_family',
    description:'The iconic UTAU mascot. Warm, slightly rough chimera voice. Best for pop, rock, anime-style songs.',
    language:'ja', phoneme_set:'jp_cv', mlc_module:'jp_cv_standard',
    type:'cv', size_mb:48, tags:['japanese','cv','pop','beginner-friendly','iconic'],
    color:'#E8607A', avatar_emoji:'🍓', license:'CC BY-NC 3.0',
    download:{ method:'direct', url:'https://kasaneteto.jp/download/Teto_VB.zip' },
    install_note:'Standard UTAU CV voicebank.',
  },
  {
    id:'utane_uta_defoko', name:'Utane Uta (Defoko)', author:'Ameya/Ayame',
    description:'The default UTAU voice. Clear, neutral tone. Great for learning the workflow.',
    language:'ja', phoneme_set:'jp_cv', mlc_module:'jp_cv_standard',
    type:'cv', size_mb:32, tags:['japanese','cv','neutral','default'],
    color:'#7B8FE8', avatar_emoji:'🎙️', license:'Free for non-commercial use',
    download:{ method:'direct', url:'https://utau2008.xrea.jp/utau_dl.html' },
    install_note:'Classic UTAU default voice.',
  },
  {
    id:'namine_ritsu_kire', name:'Namine Ritsu KIRE', author:'NARU-T',
    description:'Clear, bright feminine voice. KIRE version has a sharp, clean quality perfect for ballads.',
    language:'ja', phoneme_set:'jp_cv', mlc_module:'jp_cv_standard',
    type:'cv', size_mb:55, tags:['japanese','cv','bright','feminine','ballad'],
    color:'#F5A623', avatar_emoji:'🌸', license:'CC BY-NC-SA 4.0',
    download:{ method:'direct', url:'https://narue.plala.jp/ritsu_dl.html' },
    install_note:'Standard CV voicebank. Compatible with OpenUTAU.',
  },
  {
    id:'kasane_teto_cvvc_en', name:'Kasane Teto English CVVC', author:'RubyRedEnder',
    description:"English CVVC Teto. Uses ARPAbet phonemes for natural English synthesis with Teto's iconic voice.",
    language:'en', phoneme_set:'arpabet_cvvc', mlc_module:'en_arpabet',
    type:'cvvc', size_mb:180, tags:['english','cvvc','arpabet','teto'],
    color:'#E8607A', avatar_emoji:'🍓', license:'CC BY-NC 3.0',
    download:{ method:'direct', url:'https://github.com/RubyRedEnder/Kasane-Teto-English/releases/latest/download/KasaneTeto_ENG.zip' },
    install_note:"Select 'English ARPAbet' in MLC for correct phoneme mapping.",
  },
  {
    id:'miku_v4x_append_soft', name:'Hatsune Miku Append Soft', author:'Crypton / community port',
    description:'Breathy, soft texture. Community OpenUTAU port. Great for emotional ballads.',
    language:'ja', phoneme_set:'jp_cvvc', mlc_module:'jp_cvvc_miku',
    type:'cvvc', size_mb:250, tags:['japanese','cvvc','miku','soft','advanced'],
    color:'#4DBF90', avatar_emoji:'💎', license:'Check Crypton terms',
    download:{ method:'community_catalog', url:null, note:'Install via OpenUTAU → Tools → Install Singer.' },
    install_note:'Install via OpenUTAU built-in installer.',
  },
];

const DEMO_EDITORS: EditorInfo[] = [
  { id:'ardour', name:'Ardour', license:'GPL', website:'https://ardour.org', path:null, detected:false },
  { id:'lmms',   name:'LMMS',   license:'GPL', website:'https://lmms.io',   path:null, detected:false },
  { id:'reaper', name:'Reaper', license:'commercial (free to try)', website:'https://www.reaper.fm', path:null, detected:false },
];

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  onClose:        () => void;
  onSelectBank:   (vb: InstalledVoicebank) => void;
}

type Tab = 'installed' | 'catalog' | 'addons' | 'engines';

export function VoicebankManager({ onClose, onSelectBank }: Props) {
  const [tab,        setTab]        = useState<Tab>('catalog');
  const [addons,     setAddons]     = useState<AddonInfo[]>([]);
  const [addonLoading, setAddonLoading] = useState(false);
  const [installed,  setInstalled]  = useState<InstalledVoicebank[]>([]);
  const [catalog,    setCatalog]    = useState<CatalogEntry[]>([]);
  const [editors,    setEditors]    = useState<EditorInfo[]>([]);
  const [openutau,   setOpenutau]   = useState<{ found:boolean; path:string|null }>({ found:false, path:null });
  const [loading,    setLoading]    = useState<Record<string,boolean>>({});
  const [downloads,  setDownloads]  = useState<Record<string, DownloadState>>({});
  const [filter,     setFilter]     = useState('');
  const isElectron = !!(window as any).voicebanks;

  // Load data
  useEffect(() => {
    if (isElectron) {
      (window as any).voicebanks.list().then(setInstalled).catch(console.error);
      (window as any).voicebanks.detectSystem().then((sys: any) => {
        setOpenutau(sys.openutau ?? { found:false, path:null });
        setEditors(sys.editors ?? []);
      }).catch(console.error);
    } else {
      setEditors(DEMO_EDITORS);
    }

    // Load catalog from bundled JSON
    fetch(import.meta.env.BASE_URL + 'voicebank-catalog.json')
      .then(r => r.json())
      .then((d: any) => setCatalog(d.voicebanks ?? []))
      .catch(() => setCatalog(DEMO_CATALOG));

    // Load addons list from MLC
    const loadAddons = async () => {
      if ((window as any).mlc?.listAllAddons) {
        try {
          const list = await (window as any).mlc.listAllAddons();
          setAddons(list || []);
        } catch {}
      }
    };
    loadAddons();

    // Listen for download progress
    if (isElectron) {
      (window as any).voicebanks.onDownloadProgress((p: any) => {
        setDownloads(prev => ({
          ...prev,
          [p.id]: p.phase === 'done'
            ? { percent:100, phase:'done' }
            : p.phase === 'extracting'
            ? { percent:99,  phase:'extracting' }
            : { percent: p.percent ?? 0, phase:'downloading' },
        }));
        if (p.phase === 'done') {
          // Refresh installed list
          (window as any).voicebanks.list().then(setInstalled);
        }
      });
    }
  }, [isElectron]);

  const startDownload = useCallback(async (entry: CatalogEntry) => {
    if (!entry.download.url) return;
    return withLock(`vb-download-${entry.id}`, async () => {
    setDownloads(prev => ({ ...prev, [entry.id]: { percent:0, phase:'downloading' } }));
    if (isElectron) {
      const result = await (window as any).voicebanks.download({
        id:      entry.id,
        url:     entry.download.url,
        mirrors: entry.download.mirrors,
        name:    entry.name,
      });
      if (!result.ok) {
        setDownloads(prev => ({ ...prev, [entry.id]: { percent:0, phase:'error', error:result.error } }));
      }
    } else {
      // Demo: simulate download
      for (let p=0; p<=100; p+=10) {
        await new Promise(r => setTimeout(r, 120));
        setDownloads(prev => ({ ...prev, [entry.id]: { percent:p, phase:'downloading' } }));
      }
      setDownloads(prev => ({ ...prev, [entry.id]: { percent:100, phase:'done' } }));
    }
    });
  }, [isElectron]);

  const isInstalled = (id: string) =>
    installed.some(vb => vb.id === id) || downloads[id]?.phase === 'done';

  const filteredCatalog = catalog.filter(e =>
    !filter || e.name.toLowerCase().includes(filter.toLowerCase()) ||
    e.tags.some(t => t.includes(filter.toLowerCase()))
  );

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 400,
      background: 'rgba(0,0,0,0.3)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'fadeIn 150ms var(--ease-out) both',
    }} onClick={onClose}>
      <div style={{
        width: 680, maxHeight: '80vh',
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border-default)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: '0 16px 48px rgba(0,0,0,0.18)',
        display: 'flex', flexDirection: 'column',
        animation: 'slideDown 200ms var(--ease-out) both',
        overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{
          height: 48, flexShrink: 0,
          display: 'flex', alignItems: 'center',
          padding: '0 var(--space-5)',
          borderBottom: '0.5px solid var(--border-subtle)',
          gap: 'var(--space-3)',
        }}>
          <Music2 size={16} style={{ color: 'var(--accent)' }}/>
          <span style={{ flex:1, fontSize:'var(--text-md)', fontWeight:'var(--font-weight-medium)', color:'var(--text-primary)' }}>
            Voicebanks
          </span>

          {/* Tabs */}
          <div style={{ display:'flex', gap:2 }}>
            {(['installed','catalog','addons','engines'] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                height:28, padding:'0 var(--space-3)',
                borderRadius:'var(--radius-md)',
                fontSize:'var(--text-sm)',
                color: tab===t ? 'var(--text-primary)' : 'var(--text-tertiary)',
                background: tab===t ? 'var(--bg-sunken)' : 'transparent',
                fontWeight: tab===t ? 'var(--font-weight-medium)' as any : undefined,
                transition:'all var(--duration-fast)',
              }}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
                {t==='installed' && installed.length > 0 && (
                  <span style={{ marginLeft:4, fontSize:'var(--text-xs)', color:'var(--text-tertiary)' }}>
                    {installed.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <button onClick={onClose} style={{
            width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center',
            color:'var(--text-tertiary)', borderRadius:'var(--radius-md)',
            transition:'all var(--duration-fast)',
          }}
            onMouseEnter={e=>(e.currentTarget.style.background='var(--bg-sunken)')}
            onMouseLeave={e=>(e.currentTarget.style.background='transparent')}
          >
            <X size={14}/>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:'auto', padding:'var(--space-4)' }}>

          {/* ── Installed tab ─────────────────────────────────────────── */}
          {tab === 'installed' && (
            <div>
              {installed.length === 0 ? (
                <div style={{
                  padding:'var(--space-8)', textAlign:'center',
                  color:'var(--text-tertiary)', fontSize:'var(--text-sm)',
                }}>
                  <Music2 size={32} style={{ marginBottom:'var(--space-3)', opacity:0.3 }}/>
                  <div>No voicebanks installed yet</div>
                  <button onClick={()=>setTab('catalog')} style={{
                    marginTop:'var(--space-3)',
                    color:'var(--accent)', fontSize:'var(--text-sm)',
                    display:'flex', alignItems:'center', gap:4, margin:'var(--space-3) auto 0',
                  }}>
                    Browse catalog <ChevronRight size={12}/>
                  </button>
                </div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-2)' }}>
                  {installed.map(vb => (
                    <div key={vb.id} style={{
                      display:'flex', alignItems:'center', gap:'var(--space-3)',
                      padding:'var(--space-3)',
                      background:'var(--bg-sunken)', borderRadius:'var(--radius-lg)',
                      border:'0.5px solid var(--border-subtle)',
                    }}>
                      <div style={{
                        width:36, height:36, borderRadius:'var(--radius-md)',
                        background:'var(--bg-surface)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontSize:20, flexShrink:0,
                        border:'0.5px solid var(--border-default)',
                      }}>
                        🎙️
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:'var(--text-base)', fontWeight:'var(--font-weight-medium)', color:'var(--text-primary)' }}>
                          {vb.name}
                        </div>
                        <div style={{ fontSize:'var(--text-sm)', color:'var(--text-tertiary)', display:'flex', gap:'var(--space-2)' }}>
                          <span>{vb.type.toUpperCase()}</span>
                          <span>·</span>
                          <span>{vb.language.toUpperCase()}</span>
                          {vb.author && <><span>·</span><span>{vb.author}</span></>}
                        </div>
                      </div>
                      <div style={{ display:'flex', gap:'var(--space-2)' }}>
                        <button onClick={()=>(window as any).voicebanks?.openFolder(vb.path)} style={{
                          height:26, padding:'0 var(--space-2)',
                          border:'0.5px solid var(--border-default)',
                          borderRadius:'var(--radius-md)',
                          fontSize:'var(--text-xs)', color:'var(--text-secondary)',
                          display:'flex', alignItems:'center', gap:4,
                          transition:'all var(--duration-fast)',
                        }}>
                          <FolderOpen size={11}/> Open folder
                        </button>
                        <button onClick={()=>onSelectBank(vb)} style={{
                          height:26, padding:'0 var(--space-2)',
                          background:'var(--accent)',
                          borderRadius:'var(--radius-md)',
                          fontSize:'var(--text-xs)', color:'white',
                          fontWeight:'var(--font-weight-medium)' as any,
                          transition:'background var(--duration-fast)',
                        }}>
                          Use this bank
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Catalog tab ───────────────────────────────────────────── */}
          {tab === 'catalog' && (
            <div>
              <input
                placeholder="Filter voicebanks…"
                value={filter} onChange={e=>setFilter(e.target.value)}
                style={{
                  width:'100%', height:32,
                  background:'var(--bg-sunken)', border:'0.5px solid var(--border-default)',
                  borderRadius:'var(--radius-md)', padding:'0 var(--space-3)',
                  fontSize:'var(--text-sm)', color:'var(--text-primary)',
                  outline:'none', marginBottom:'var(--space-3)',
                  transition:'border-color var(--duration-fast)',
                }}
                onFocus={e=>(e.currentTarget.style.borderColor='var(--accent)')}
                onBlur={e=>(e.currentTarget.style.borderColor='var(--border-default)')}
              />

              <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-2)' }}>
                {filteredCatalog.map(entry => {
                  const dl  = downloads[entry.id];
                  const got = isInstalled(entry.id);
                  const canDL = entry.download.method === 'direct' && entry.download.url;

                  return (
                    <div key={entry.id} style={{
                      border:'0.5px solid var(--border-subtle)',
                      borderRadius:'var(--radius-lg)',
                      overflow:'hidden',
                      background: got ? 'var(--success-subtle)' : 'var(--bg-sunken)',
                    }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'var(--space-3)', padding:'var(--space-3)' }}>
                        {/* Avatar */}
                        <div style={{
                          width:44, height:44, borderRadius:'var(--radius-md)',
                          background: entry.color + '22',
                          border:`1.5px solid ${entry.color}44`,
                          display:'flex', alignItems:'center', justifyContent:'center',
                          fontSize:22, flexShrink:0,
                        }}>
                          {entry.avatar_emoji}
                        </div>

                        {/* Info */}
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:'var(--space-2)', marginBottom:2 }}>
                            <span style={{ fontSize:'var(--text-base)', fontWeight:'var(--font-weight-medium)', color:'var(--text-primary)' }}>
                              {entry.name}
                            </span>
                            <span style={{
                              fontSize:'var(--text-xs)', padding:'1px 6px',
                              background:`${entry.color}22`, color:entry.color,
                              borderRadius:'var(--radius-full)',
                            }}>
                              {entry.type.toUpperCase()} · {entry.language.toUpperCase()}
                            </span>
                            {got && <CheckCircle2 size={12} style={{ color:'var(--success)', flexShrink:0 }}/>}
                          </div>
                          <div style={{ fontSize:'var(--text-sm)', color:'var(--text-secondary)', lineHeight:1.4 }}>
                            {entry.description}
                          </div>
                          <div style={{
                            display:'flex', gap:'var(--space-2)', marginTop:4,
                            flexWrap:'wrap',
                          }}>
                            {entry.tags.slice(0,4).map(t => (
                              <span key={t} style={{
                                fontSize:'var(--text-xs)', color:'var(--text-tertiary)',
                                padding:'1px 5px',
                                background:'var(--bg-surface)', borderRadius:'var(--radius-sm)',
                                border:'0.5px solid var(--border-subtle)',
                              }}>{t}</span>
                            ))}
                          </div>
                        </div>

                        {/* Action */}
                        <div style={{ flexShrink:0, display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'var(--space-1)' }}>
                          <span style={{ fontSize:'var(--text-xs)', color:'var(--text-tertiary)' }}>
                            ~{entry.size_mb}MB
                          </span>
                          {got ? (
                            <span style={{ fontSize:'var(--text-xs)', color:'var(--success)', display:'flex', alignItems:'center', gap:3 }}>
                              <CheckCircle2 size={11}/> Installed
                            </span>
                          ) : !canDL ? (
                            <span style={{ fontSize:'var(--text-xs)', color:'var(--text-tertiary)' }}>
                              Manual install
                            </span>
                          ) : dl && dl.phase !== 'error' ? (
                            <span style={{ fontSize:'var(--text-xs)', color:'var(--accent)', display:'flex', alignItems:'center', gap:4 }}>
                              <Loader2 size={10} style={{ animation:'spin 1s linear infinite' }}/>
                              {dl.phase === 'extracting' ? 'Extracting…' : `${dl.percent}%`}
                            </span>
                          ) : (
                            <button onClick={()=>startDownload(entry)} style={{
                              height:26, padding:'0 var(--space-3)',
                              background:'var(--accent)',
                              borderRadius:'var(--radius-md)',
                              fontSize:'var(--text-xs)', color:'white',
                              fontWeight:'var(--font-weight-medium)' as any,
                              display:'flex', alignItems:'center', gap:4,
                              transition:'background var(--duration-fast)',
                            }}>
                              <Download size={11}/> Download
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Download progress bar */}
                      {dl && dl.phase !== 'done' && dl.phase !== 'error' && (
                        <div style={{ height:3, background:'var(--bg-sunken)' }}>
                          <div style={{
                            height:'100%', background:'var(--accent)',
                            width:`${dl.percent}%`,
                            transition:'width 200ms var(--ease-standard)',
                          }}/>
                        </div>
                      )}

                      {/* Error */}
                      {dl?.phase === 'error' && (
                        <div style={{
                          padding:'var(--space-2) var(--space-3)',
                          background:'var(--danger-subtle)',
                          fontSize:'var(--text-xs)', color:'var(--danger)',
                          display:'flex', alignItems:'center', gap:4,
                        }}>
                          <AlertTriangle size={10}/>{dl.error}
                        </div>
                      )}

                      {/* Manual install note */}
                      {!canDL && (
                        <div style={{
                          padding:'var(--space-2) var(--space-3)',
                          background:'var(--bg-surface)',
                          fontSize:'var(--text-xs)', color:'var(--text-secondary)',
                          borderTop:'0.5px solid var(--border-subtle)',
                          display:'flex', alignItems:'center', gap:4,
                        }}>
                          <Package size={10} style={{ flexShrink:0 }}/>
                          {entry.download.note ?? entry.install_note}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Addons tab ───────────────────────────────────────────── */}
          {tab === 'addons' && (
            <div>
              {/* Install section */}
              <div style={{ marginBottom:'var(--space-4)' }}>
                <div style={{
                  fontSize:'var(--text-xs)', fontWeight:'var(--font-weight-medium)',
                  color:'var(--text-tertiary)', letterSpacing:'0.07em',
                  textTransform:'uppercase', marginBottom:'var(--space-2)',
                }}>
                  Install an addon
                </div>
                <div style={{ display:'flex', gap:'var(--space-2)' }}>
                  <button
                    onClick={async () => {
                      setAddonLoading(true);
                      try {
                        const result = await (window as any).app?.installAddonDialog?.();
                        if (result?.ok) {
                          const list = await (window as any).mlc?.listAllAddons?.();
                          setAddons(list || []);
                        } else if (result?.error) {
                          console.error('Install failed:', result.error);
                        }
                      } finally { setAddonLoading(false); }
                    }}
                    style={{
                      display:'flex', alignItems:'center', gap:'var(--space-2)',
                      height:32, padding:'0 var(--space-3)',
                      background:'var(--accent)', borderRadius:'var(--radius-md)',
                      fontSize:'var(--text-sm)', color:'white',
                      transition:'background var(--duration-fast)',
                    }}
                  >
                    {addonLoading ? <Loader2 size={13} style={{ animation:'spin 1s linear infinite' }}/> : <Upload size={13}/>}
                    Install .mlc file…
                  </button>
                  <button
                    onClick={() => (window as any).app?.openURL?.('https://github.com/MilkmanAbi/Melon-Synth/blob/main/docs/WRITING_ADDONS.md')}
                    style={{
                      display:'flex', alignItems:'center', gap:'var(--space-2)',
                      height:32, padding:'0 var(--space-3)',
                      border:'0.5px solid var(--border-default)',
                      borderRadius:'var(--radius-md)',
                      fontSize:'var(--text-sm)', color:'var(--text-secondary)',
                      transition:'all var(--duration-fast)',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background='var(--bg-sunken)')}
                    onMouseLeave={e => (e.currentTarget.style.background='transparent')}
                  >
                    <ExternalLink size={13}/> Write an addon
                  </button>
                </div>
                <div style={{
                  marginTop:'var(--space-2)',
                  padding:'var(--space-2) var(--space-3)',
                  background:'var(--accent-subtle)', borderRadius:'var(--radius-md)',
                  fontSize:'var(--text-xs)', color:'var(--accent-text)', lineHeight:1.5,
                }}>
                  Drop a <code style={{ fontFamily:'var(--font-mono)' }}>.mlc</code> file above to install a new voicebank mapper, language pack, or pipeline plugin.
                  Addons are hot-reloaded — no restart needed.
                </div>
              </div>

              {/* Loaded addons */}
              <div>
                <div style={{
                  fontSize:'var(--text-xs)', fontWeight:'var(--font-weight-medium)',
                  color:'var(--text-tertiary)', letterSpacing:'0.07em',
                  textTransform:'uppercase', marginBottom:'var(--space-2)',
                }}>
                  Loaded ({addons.length})
                </div>
                {addons.length === 0 ? (
                  <div style={{
                    padding:'var(--space-6)',
                    textAlign:'center', fontSize:'var(--text-sm)', color:'var(--text-tertiary)',
                    background:'var(--bg-sunken)', borderRadius:'var(--radius-lg)',
                    border:'0.5px solid var(--border-subtle)',
                  }}>
                    No addons loaded yet
                  </div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-2)' }}>
                    {addons.map((addon: AddonInfo) => (
                      <div key={addon.id} style={{
                        display:'flex', alignItems:'center', gap:'var(--space-3)',
                        padding:'var(--space-3)',
                        background:'var(--bg-sunken)', borderRadius:'var(--radius-lg)',
                        border:'0.5px solid var(--border-subtle)',
                      }}>
                        <div style={{
                          width:36, height:36, borderRadius:'var(--radius-md)',
                          background: addon.from_bundle ? 'var(--accent-subtle)' : 'var(--bg-surface)',
                          border:`0.5px solid ${addon.from_bundle ? 'var(--accent)' : 'var(--border-default)'}`,
                          display:'flex', alignItems:'center', justifyContent:'center',
                          flexShrink:0, fontSize:16,
                        }}>
                          {addon.addon_type === 'language_pack' ? '🌐' :
                           addon.addon_type === 'pipeline_plugin' ? '⚙️' : '🎙️'}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:'var(--space-2)' }}>
                            <span style={{ fontSize:'var(--text-base)', fontWeight:'var(--font-weight-medium)', color:'var(--text-primary)' }}>
                              {addon.name}
                            </span>
                            <span style={{
                              fontSize:'var(--text-xs)', padding:'1px 5px',
                              background: addon.from_bundle ? 'var(--accent-subtle)' : 'var(--bg-surface)',
                              color: addon.from_bundle ? 'var(--accent)' : 'var(--text-tertiary)',
                              borderRadius:'var(--radius-sm)',
                            }}>
                              {addon.from_bundle ? 'bundle' : 'built-in'}
                            </span>
                          </div>
                          <div style={{ fontSize:'var(--text-sm)', color:'var(--text-secondary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {addon.description}
                          </div>
                          <div style={{ fontSize:'var(--text-xs)', color:'var(--text-tertiary)', fontFamily:'var(--font-mono)' }}>
                            {addon.id} · v{addon.version} · {addon.addon_type.replace('_',' ')}
                          </div>
                        </div>
                        {addon.from_bundle && (
                          <button
                            onClick={async () => {
                              if (!confirm(`Remove addon "${addon.name}"?`)) return;
                              await (window as any).app?.uninstallAddon?.(addon.id);
                              const list = await (window as any).mlc?.listAllAddons?.();
                              setAddons(list || []);
                            }}
                            style={{
                              height:24, padding:'0 var(--space-2)',
                              border:'0.5px solid var(--danger)',
                              borderRadius:'var(--radius-md)',
                              fontSize:'var(--text-xs)', color:'var(--danger)',
                              transition:'all var(--duration-fast)',
                              flexShrink:0,
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Engines tab ───────────────────────────────────────────── */}
          {tab === 'engines' && (
            <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-4)' }}>

              {/* OpenUTAU */}
              <div>
                <div style={{
                  fontSize:'var(--text-xs)', fontWeight:'var(--font-weight-medium)',
                  color:'var(--text-tertiary)', letterSpacing:'0.07em',
                  textTransform:'uppercase', marginBottom:'var(--space-2)',
                }}>
                  Synthesis Engine
                </div>
                <div style={{
                  padding:'var(--space-3)',
                  background: openutau.found ? 'var(--success-subtle)' : 'var(--bg-sunken)',
                  border:`0.5px solid ${openutau.found ? 'var(--success)' : 'var(--border-default)'}`,
                  borderRadius:'var(--radius-lg)',
                  display:'flex', alignItems:'center', gap:'var(--space-3)',
                }}>
                  <Cpu size={20} style={{ color: openutau.found ? 'var(--success)' : 'var(--text-tertiary)', flexShrink:0 }}/>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:'var(--text-base)', fontWeight:'var(--font-weight-medium)', color:'var(--text-primary)', marginBottom:2 }}>
                      OpenUTAU
                      <span style={{
                        marginLeft:'var(--space-2)', fontSize:'var(--text-xs)',
                        padding:'1px 6px', borderRadius:'var(--radius-full)',
                        background: openutau.found ? 'var(--success-subtle)' : 'var(--danger-subtle)',
                        color: openutau.found ? 'var(--success)' : 'var(--danger)',
                      }}>
                        {openutau.found ? '✓ detected' : 'not found'}
                      </span>
                    </div>
                    <div style={{ fontSize:'var(--text-sm)', color:'var(--text-secondary)' }}>
                      {openutau.found
                        ? `Found at: ${openutau.path}`
                        : 'Required for rendering. Free, open source, works on all platforms.'}
                    </div>
                  </div>
                  {!openutau.found && (
                    <button onClick={()=>(window as any).app?.openURL('https://www.openutau.com')} style={{
                      height:28, padding:'0 var(--space-3)',
                      background:'var(--accent)', borderRadius:'var(--radius-md)',
                      fontSize:'var(--text-sm)', color:'white',
                      display:'flex', alignItems:'center', gap:4,
                      flexShrink:0,
                    }}>
                      Install <ExternalLink size={11}/>
                    </button>
                  )}
                </div>
              </div>

              {/* Music editors */}
              <div>
                <div style={{
                  fontSize:'var(--text-xs)', fontWeight:'var(--font-weight-medium)',
                  color:'var(--text-tertiary)', letterSpacing:'0.07em',
                  textTransform:'uppercase', marginBottom:'var(--space-2)',
                }}>
                  Music Editors (for layering &amp; mixing)
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-2)' }}>
                  {(editors.length ? editors : DEMO_EDITORS).map(editor => (
                    <div key={editor.id} style={{
                      padding:'var(--space-3)',
                      background: editor.detected ? 'var(--success-subtle)' : 'var(--bg-sunken)',
                      border:`0.5px solid ${editor.detected ? 'var(--success)' : 'var(--border-subtle)'}`,
                      borderRadius:'var(--radius-lg)',
                      display:'flex', alignItems:'center', gap:'var(--space-3)',
                    }}>
                      <Music2 size={16} style={{ color: editor.detected ? 'var(--success)' : 'var(--text-tertiary)', flexShrink:0 }}/>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:'var(--text-base)', fontWeight:'var(--font-weight-medium)', color:'var(--text-primary)' }}>
                          {editor.name}
                          <span style={{ marginLeft:'var(--space-2)', fontSize:'var(--text-xs)', color:'var(--text-tertiary)' }}>
                            {editor.license}
                          </span>
                        </div>
                        {editor.detected
                          ? <div style={{ fontSize:'var(--text-xs)', color:'var(--text-tertiary)' }}>{editor.path}</div>
                          : <div style={{ fontSize:'var(--text-sm)', color:'var(--text-secondary)' }}>Not detected on this machine</div>
                        }
                      </div>
                      {!editor.detected && (
                        <button onClick={()=>(window as any).app?.openURL(editor.website)} style={{
                          height:26, padding:'0 var(--space-2)',
                          border:'0.5px solid var(--border-default)',
                          borderRadius:'var(--radius-md)',
                          fontSize:'var(--text-xs)', color:'var(--text-secondary)',
                          display:'flex', alignItems:'center', gap:3,
                          transition:'all var(--duration-fast)',
                        }}>
                          Get it free <ExternalLink size={10}/>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{
                padding:'var(--space-3)',
                background:'var(--bg-sunken)', borderRadius:'var(--radius-md)',
                border:'0.5px solid var(--border-subtle)',
                fontSize:'var(--text-sm)', color:'var(--text-secondary)', lineHeight:1.5,
              }}>
                <strong style={{ color:'var(--text-primary)', fontWeight:'var(--font-weight-medium)' }}>How it works:</strong>{' '}
                Render your voice part in Melon Synth, then click "Open in Music Editor"
                to launch Ardour or LMMS with the rendered stem pre-loaded.
                Melon Synth stays open — both windows run side by side.
                When you make changes, re-render and the stem updates automatically.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
