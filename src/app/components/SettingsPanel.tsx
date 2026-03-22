/**
 * Settings Panel
 * ===============
 * Full-screen settings panel covering:
 *   - General settings (theme, language)
 *   - Keyboard shortcuts (viewable, customizable in future)
 *   - Audio settings
 *   - About / System info
 */

import React, { useState, useEffect } from 'react';
import {
  X, Settings, Keyboard, Volume2, Info, Sun, Moon,
  Check, ExternalLink, Cpu, Music2, HardDrive,
} from 'lucide-react';
import { useProjectStore } from '../../store/project';

interface Props {
  onClose:     () => void;
  initialTab?: 'general' | 'shortcuts' | 'audio' | 'about';
}

type Tab = 'general' | 'shortcuts' | 'audio' | 'about';

// Default keyboard shortcuts
const SHORTCUTS: { action: string; keys: string; description: string; category: string }[] = [
  // File
  { action: 'new',         keys: '⌘N',    description: 'New project',       category: 'File' },
  { action: 'open',        keys: '⌘O',    description: 'Open project',      category: 'File' },
  { action: 'save',        keys: '⌘S',    description: 'Save project',      category: 'File' },
  { action: 'saveAs',      keys: '⌘⇧S',   description: 'Save as…',          category: 'File' },
  { action: 'importMidi',  keys: '⌘I',    description: 'Import MIDI',       category: 'File' },
  
  // Edit
  { action: 'undo',        keys: '⌘Z',    description: 'Undo',              category: 'Edit' },
  { action: 'redo',        keys: '⌘⇧Z',   description: 'Redo',              category: 'Edit' },
  { action: 'selectAll',   keys: '⌘A',    description: 'Select all',        category: 'Edit' },
  { action: 'delete',      keys: 'Del',   description: 'Delete selected',   category: 'Edit' },
  { action: 'duplicate',   keys: '⌘D',    description: 'Duplicate',         category: 'Edit' },
  
  // Transport
  { action: 'playPause',   keys: 'Space', description: 'Play/Pause',        category: 'Transport' },
  { action: 'stop',        keys: '.',     description: 'Stop',              category: 'Transport' },
  
  // Tools
  { action: 'selectTool',  keys: 'S',     description: 'Select tool',       category: 'Tools' },
  { action: 'drawTool',    keys: 'N',     description: 'Draw tool',         category: 'Tools' },
  { action: 'eraseTool',   keys: 'E',     description: 'Erase tool',        category: 'Tools' },
  { action: 'pitchTool',   keys: 'P',     description: 'Pitch tool',        category: 'Tools' },
  
  // View
  { action: 'palette',     keys: '⌘K',    description: 'Command palette',   category: 'View' },
  { action: 'darkMode',    keys: '⌘⇧D',   description: 'Toggle dark mode',  category: 'View' },
  { action: 'zoomIn',      keys: '⌘+',    description: 'Zoom in',           category: 'View' },
  { action: 'zoomOut',     keys: '⌘-',    description: 'Zoom out',          category: 'View' },
];

export function SettingsPanel({ onClose, initialTab }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'general');
  const { isDark, toggleDark } = useProjectStore();
  const [systemInfo, setSystemInfo] = useState<{
    openutau: { found: boolean; path: string | null };
    editors: { name: string; detected: boolean; path: string | null }[];
    voicebankCount: number;
    platform: string;
  } | null>(null);

  useEffect(() => {
    const loadSystemInfo = async () => {
      if (!(window as any).voicebanks) {
        setSystemInfo({
          openutau: { found: false, path: null },
          editors: [],
          voicebankCount: 0,
          platform: 'browser',
        });
        return;
      }
      
      try {
        const sys = await (window as any).voicebanks.detectSystem();
        const vbs = await (window as any).voicebanks.list();
        setSystemInfo({
          openutau: sys.openutau ?? { found: false, path: null },
          editors: sys.editors ?? [],
          voicebankCount: vbs.length,
          platform: (window as any).__melonPlatform ?? 'unknown',
        });
      } catch (e) {
        console.error('Failed to load system info:', e);
      }
    };
    loadSystemInfo();
  }, []);

  const TAB_ITEMS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'general',   label: 'General',   icon: <Settings size={16}/> },
    { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard size={16}/> },
    { id: 'audio',     label: 'Audio',     icon: <Volume2 size={16}/> },
    { id: 'about',     label: 'About',     icon: <Info size={16}/> },
  ];

  // Group shortcuts by category
  const shortcutGroups: Record<string, typeof SHORTCUTS> = {};
  SHORTCUTS.forEach(s => { (shortcutGroups[s.category] ??= []).push(s); });

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'fadeIn 120ms var(--ease-out) both',
    }} onClick={onClose}>
      <div style={{
        width: 640, maxHeight: '85vh',
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border-default)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column',
        animation: 'slideDown 180ms var(--ease-out) both',
        overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{
          height: 52, flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          padding: '0 var(--space-5)',
          borderBottom: '0.5px solid var(--border-subtle)',
        }}>
          <Settings size={18} style={{ color: 'var(--accent)' }}/>
          <span style={{ flex: 1, fontSize: 'var(--text-md)', fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)' }}>
            Settings
          </span>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: 'var(--radius-md)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-tertiary)',
          }}>
            <X size={16}/>
          </button>
        </div>

        {/* Content */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          
          {/* Sidebar tabs */}
          <div style={{
            width: 160, flexShrink: 0,
            borderRight: '0.5px solid var(--border-subtle)',
            padding: 'var(--space-3)',
          }}>
            {TAB_ITEMS.map(item => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                style={{
                  width: '100%',
                  padding: 'var(--space-2) var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                  fontSize: 'var(--text-sm)',
                  color: tab === item.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                  background: tab === item.id ? 'var(--bg-sunken)' : 'transparent',
                  marginBottom: 2,
                }}
              >
                <span style={{ color: tab === item.id ? 'var(--accent)' : 'var(--text-tertiary)' }}>
                  {item.icon}
                </span>
                {item.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-5)' }}>
            
            {/* General */}
            {tab === 'general' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <div>
                  <div style={{
                    fontSize: 'var(--text-xs)', fontWeight: 'var(--font-weight-medium)',
                    color: 'var(--text-tertiary)', textTransform: 'uppercase',
                    letterSpacing: '0.05em', marginBottom: 'var(--space-2)',
                  }}>
                    Appearance
                  </div>
                  <button
                    onClick={toggleDark}
                    style={{
                      width: '100%',
                      padding: 'var(--space-3)',
                      background: 'var(--bg-sunken)',
                      border: '0.5px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                    }}
                  >
                    {isDark ? <Moon size={18} style={{ color: 'var(--accent)' }}/> : <Sun size={18} style={{ color: 'var(--accent)' }}/>}
                    <div style={{ flex: 1, textAlign: 'left' }}>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)' }}>
                        {isDark ? 'Dark mode' : 'Light mode'}
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        Press ⌘⇧D to toggle
                      </div>
                    </div>
                    <div style={{
                      width: 42, height: 24, borderRadius: 12,
                      background: isDark ? 'var(--accent)' : 'var(--border-default)',
                      position: 'relative', transition: 'background var(--duration-fast)',
                    }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: '50%',
                        background: 'white',
                        position: 'absolute', top: 3,
                        left: isDark ? 21 : 3,
                        transition: 'left var(--duration-fast)',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      }}/>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* Shortcuts */}
            {tab === 'shortcuts' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <div style={{
                  padding: 'var(--space-3)',
                  background: 'var(--bg-sunken)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
                }}>
                  Keyboard shortcuts help you work faster. Custom key bindings coming soon!
                </div>
                
                {Object.entries(shortcutGroups).map(([category, shortcuts]) => (
                  <div key={category}>
                    <div style={{
                      fontSize: 'var(--text-xs)', fontWeight: 'var(--font-weight-medium)',
                      color: 'var(--text-tertiary)', textTransform: 'uppercase',
                      letterSpacing: '0.05em', marginBottom: 'var(--space-2)',
                    }}>
                      {category}
                    </div>
                    <div style={{
                      background: 'var(--bg-sunken)',
                      border: '0.5px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      overflow: 'hidden',
                    }}>
                      {shortcuts.map((s, i) => (
                        <div key={s.action} style={{
                          display: 'flex', alignItems: 'center',
                          padding: 'var(--space-2) var(--space-3)',
                          borderTop: i > 0 ? '0.5px solid var(--border-subtle)' : 'none',
                        }}>
                          <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                            {s.description}
                          </span>
                          <span style={{
                            padding: '2px 8px',
                            background: 'var(--bg-surface)',
                            border: '0.5px solid var(--border-default)',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: 'var(--mono-sm)',
                            fontFamily: 'var(--font-mono)',
                            color: 'var(--text-secondary)',
                          }}>
                            {s.keys}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Audio */}
            {tab === 'audio' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <div>
                  <div style={{
                    fontSize: 'var(--text-xs)', fontWeight: 'var(--font-weight-medium)',
                    color: 'var(--text-tertiary)', textTransform: 'uppercase',
                    letterSpacing: '0.05em', marginBottom: 'var(--space-2)',
                  }}>
                    Preview Engine
                  </div>
                  <div style={{
                    padding: 'var(--space-3)',
                    background: 'var(--bg-sunken)',
                    border: '0.5px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                  }}>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', marginBottom: 4 }}>
                      Web Audio API
                    </div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                      Built-in preview uses Web Audio for low-latency playback. 
                      Rendered WAV files are played back directly.
                    </div>
                  </div>
                </div>

                <div>
                  <div style={{
                    fontSize: 'var(--text-xs)', fontWeight: 'var(--font-weight-medium)',
                    color: 'var(--text-tertiary)', textTransform: 'uppercase',
                    letterSpacing: '0.05em', marginBottom: 'var(--space-2)',
                  }}>
                    Render Engine
                  </div>
                  <div style={{
                    padding: 'var(--space-3)',
                    background: systemInfo?.openutau.found ? 'var(--success-subtle)' : 'var(--bg-sunken)',
                    border: `0.5px solid ${systemInfo?.openutau.found ? 'var(--success)' : 'var(--border-subtle)'}`,
                    borderRadius: 'var(--radius-md)',
                    display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                  }}>
                    <Cpu size={20} style={{ color: systemInfo?.openutau.found ? 'var(--success)' : 'var(--text-tertiary)' }}/>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: 'var(--font-weight-medium)' }}>
                        OpenUTAU
                        <span style={{
                          marginLeft: 8, padding: '1px 6px',
                          fontSize: 'var(--text-xs)', borderRadius: 'var(--radius-full)',
                          background: systemInfo?.openutau.found ? 'var(--success)' : 'var(--danger)',
                          color: 'white',
                        }}>
                          {systemInfo?.openutau.found ? 'Detected' : 'Not found'}
                        </span>
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        {systemInfo?.openutau.path || 'Required for rendering vocals'}
                      </div>
                    </div>
                    {!systemInfo?.openutau.found && (
                      <button
                        onClick={() => { if ((window as any).app?.openURL) (window as any).app.openURL('https://www.openutau.com'); else window.open('https://www.openutau.com', '_blank'); }}
                        style={{
                          padding: '6px 12px',
                          background: 'var(--accent)',
                          borderRadius: 'var(--radius-md)',
                          fontSize: 'var(--text-sm)', color: 'white',
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}
                      >
                        Install <ExternalLink size={12}/>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* About */}
            {tab === 'about' && (
              <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-5)' }}>

                {/* Logo + title block */}
                <div style={{
                  display:'flex', flexDirection:'column', alignItems:'center',
                  padding:'var(--space-6) var(--space-4) var(--space-4)',
                  gap:'var(--space-3)',
                }}>
                  <img src="/melon-logo.png" alt="Melon Synth"
                    style={{ width:88, height:88, borderRadius:20, objectFit:'contain',
                             boxShadow:'0 4px 20px rgba(61,158,120,0.25)' }}
                  />
                  <div style={{ textAlign:'center' }}>
                    <div style={{ fontSize:'var(--text-md)', fontWeight:500, color:'var(--text-primary)', letterSpacing:'-0.01em' }}>
                      Melon Synth
                    </div>
                    <div style={{ fontSize:'var(--text-sm)', color:'var(--text-tertiary)', marginTop:3 }}>
                      Version 1.0.0 Alpha · Open singing voice editor
                    </div>
                  </div>
                </div>

                {/* Description */}
                <div style={{
                  padding:'var(--space-4)',
                  background:'var(--bg-sunken)', borderRadius:'var(--radius-lg)',
                  border:'0.5px solid var(--border-subtle)',
                  fontSize:'var(--text-sm)', color:'var(--text-secondary)', lineHeight:1.7,
                }}>
                  Melon Synth is a free and open-source singing voice editor built for beginners
                  who want to make music without having to read a manual. Draw notes, type lyrics,
                  convert them to phonemes, and render with your favourite UTAU voicebank.
                  <br/><br/>
                  Modern, intuitive, and cross-platform. No gatekeeping. No paywalls.
                  If you can hum a melody, you can use Melon Synth.
                </div>

                {/* Credits */}
                <div>
                  <div style={{ fontSize:11, fontWeight:500, color:'var(--text-tertiary)', letterSpacing:'0.07em', textTransform:'uppercase', marginBottom:'var(--space-2)' }}>
                    Credits
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-1)',
                                 background:'var(--bg-sunken)', borderRadius:'var(--radius-lg)',
                                 border:'0.5px solid var(--border-subtle)', overflow:'hidden' }}>
                    {[
                      { label:'Developed by',  value:'MilkmanAbi' },
                      { label:'Released',       value:'2026' },
                      { label:'OpenUTAU',       value:'stakira — MIT License' },
                    ].map(({ label, value }, i, arr) => (
                      <div key={label} style={{
                        display:'flex', padding:'8px var(--space-4)',
                        borderBottom: i < arr.length-1 ? '0.5px solid var(--border-subtle)' : 'none',
                        fontSize:'var(--text-sm)',
                      }}>
                        <span style={{ flex:1, color:'var(--text-tertiary)' }}>{label}</span>
                        <span style={{ color:'var(--text-primary)', fontWeight:500 }}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Licenses */}
                <div>
                  <div style={{ fontSize:11, fontWeight:500, color:'var(--text-tertiary)', letterSpacing:'0.07em', textTransform:'uppercase', marginBottom:'var(--space-2)' }}>
                    Licensing
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-1)',
                                 background:'var(--bg-sunken)', borderRadius:'var(--radius-lg)',
                                 border:'0.5px solid var(--border-subtle)', overflow:'hidden' }}>
                    {[
                      { name:'Melon Synth app',  license:'GPL-3.0',  desc:'Free forever. Source available.' },
                      { name:'MLC Engine',        license:'GPL-3.0',  desc:'Lyric-to-phoneme pipeline.' },
                      { name:'MLC Addons (.mlc)', license:'MIT',      desc:'Build and share freely.' },
                    ].map(({ name, license, desc }, i, arr) => (
                      <div key={name} style={{
                        display:'flex', alignItems:'center', gap:'var(--space-3)',
                        padding:'10px var(--space-4)',
                        borderBottom: i < arr.length-1 ? '0.5px solid var(--border-subtle)' : 'none',
                      }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:'var(--text-sm)', color:'var(--text-primary)', fontWeight:500 }}>{name}</div>
                          <div style={{ fontSize:11, color:'var(--text-tertiary)', marginTop:1 }}>{desc}</div>
                        </div>
                        <span style={{
                          fontSize:11, padding:'2px 8px', borderRadius:'var(--radius-full)',
                          background: license === 'MIT' ? 'var(--accent-subtle)' : 'var(--warning-subtle)',
                          color:      license === 'MIT' ? 'var(--accent)'        : 'var(--warning)',
                          border:     `0.5px solid ${license === 'MIT' ? 'var(--accent)' : 'var(--warning)'}`,
                          fontWeight: 500, flexShrink:0, fontFamily:'var(--font-mono)',
                        }}>
                          {license}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* System info */}
                <div>
                  <div style={{ fontSize:11, fontWeight:500, color:'var(--text-tertiary)', letterSpacing:'0.07em', textTransform:'uppercase', marginBottom:'var(--space-2)' }}>
                    System
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:0,
                                 background:'var(--bg-sunken)', borderRadius:'var(--radius-lg)',
                                 border:'0.5px solid var(--border-subtle)', overflow:'hidden' }}>
                    {[
                      { label:'Platform',   value: systemInfo?.platform ?? 'Detecting…' },
                      { label:'OpenUTAU',   value: systemInfo?.openutau.found ? `✓ ${systemInfo.openutau.path}` : '✗ Not found' },
                      { label:'Voicebanks', value: `${systemInfo?.voicebankCount ?? 0} installed` },
                    ].map(({ label, value }, i, arr) => (
                      <div key={label} style={{
                        display:'flex', padding:'8px var(--space-4)',
                        borderBottom: i < arr.length-1 ? '0.5px solid var(--border-subtle)' : 'none',
                        fontSize:'var(--text-sm)',
                      }}>
                        <span style={{ flex:1, color:'var(--text-tertiary)' }}>{label}</span>
                        <span style={{
                          color: label === 'OpenUTAU'
                            ? systemInfo?.openutau.found ? 'var(--success)' : 'var(--danger)'
                            : 'var(--text-primary)',
                          fontFamily: label === 'Platform' ? 'var(--font-mono)' : undefined,
                          fontSize: label === 'OpenUTAU' && systemInfo?.openutau.found ? 10 : undefined,
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:200,
                        }}>
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Links */}
                <div style={{ display:'flex', gap:'var(--space-2)', justifyContent:'center', paddingBottom:'var(--space-2)' }}>
                  {[
                    { label:'GitHub',       url:'https://github.com/MilkmanAbi/Melon-Synth' },
                    { label:'Discord',      url:'https://discord.gg/J9xwk3p9' },
                    { label:'Write addon',  url:'https://github.com/MilkmanAbi/Melon-Synth/blob/main/docs/WRITING_ADDONS.md' },
                  ].map(({ label, url }) => (
                    <button key={label}
                      onClick={() => {
                        if ((window as any).app?.openURL) (window as any).app.openURL(url);
                        else window.open(url, '_blank');
                      }}
                      style={{
                        padding:'7px 14px', background:'var(--bg-sunken)',
                        border:'0.5px solid var(--border-default)', borderRadius:'var(--radius-md)',
                        fontSize:'var(--text-sm)', color:'var(--text-secondary)',
                        display:'flex', alignItems:'center', gap:5, cursor:'pointer',
                        transition:'all var(--duration-fast)',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor='var(--accent)'; e.currentTarget.style.color='var(--accent)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border-default)'; e.currentTarget.style.color='var(--text-secondary)'; }}
                    >
                      {label} <ExternalLink size={11}/>
                    </button>
                  ))}
                </div>

              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
