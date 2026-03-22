/**
 * Extensions Panel — GNOME-style addon manager
 * =============================================
 * Two top-level tabs: MLC Addons (.mlc) and App Extensions (.melon).
 * Each addon shows as a clean card with toggle, metadata, permissions.
 *
 * Opened via: Help → Extensions, or Cmd+E
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Package, Puzzle, RefreshCw, Trash2, ChevronDown, ChevronUp,
  Download, ExternalLink, AlertTriangle, CheckCircle2, Bug,
  ArrowUpCircle, Loader2, Plus, Shield, Globe, Mic, FolderOpen,
  Bell, Clipboard, Music2, Edit3, Cpu, Search,
} from 'lucide-react';
import { useProjectStore } from '../../store/project';
import { AddonInstallDialog } from './AddonInstallDialog';
import type { MelonPermission } from '../../platform/melon-addon-types';

interface Props { onClose: () => void; }

// ── Types ─────────────────────────────────────────────────────────────────────

interface AddonMeta {
  id:          string;
  name:        string;
  version:     string;
  description: string;
  author:      string;
  license:     string;
  addon_type:  string;
  homepage?:   string;
  update_url?: string;
  tags:        string[];
  installed_at?: number;
  enabled?:    boolean;
  // .mlc specific
  for_languages?: string[];
  for_modules?:   string[];
  handles?:       string[];
  // .melon specific
  permissions?: MelonPermission[];
  contributes?: Record<string, any>;
}

interface UpdateInfo {
  id: string; name: string;
  current_version: string; latest_version: string;
  download_url: string; changelog: string; is_breaking: boolean;
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const TYPE_META: Record<string, { label: string; hue: string }> = {
  language_pack:        { label: 'Language Pack',   hue: '#7B8FE8' },
  voicebank_mapper:     { label: 'Voicebank Mapper', hue: 'var(--accent)' },
  pipeline_plugin:      { label: 'Pipeline Plugin', hue: '#F5A623' },
  word_override:        { label: 'Word Override',   hue: '#E8607A' },
  phoneme_corrector:    { label: 'Phoneme Corrector', hue: '#E8A030' },
  output_postprocessor: { label: 'Postprocessor',   hue: '#9A9590' },
  custom_g2p:           { label: 'Custom G2P',      hue: '#5BA8E8' },
  analyzer:             { label: 'Analyzer',        hue: '#7B8FE8' },
  composite:            { label: 'Composite',       hue: '#56C78A' },
  app_addon:            { label: 'App Extension',   hue: 'var(--accent)' },
};

const PERM_META: Record<MelonPermission, { icon: React.ReactNode; label: string; risk: 'low' | 'medium' | 'high' }> = {
  microphone:         { icon: <Mic size={12}/>,        label: 'Microphone',      risk: 'medium' },
  'project.read':     { icon: <Music2 size={12}/>,     label: 'Read project',    risk: 'low'    },
  'project.write':    { icon: <Edit3 size={12}/>,      label: 'Modify project',  risk: 'medium' },
  'mlc.convert':      { icon: <Cpu size={12}/>,        label: 'MLC engine',      risk: 'low'    },
  'audio.play':       { icon: <Music2 size={12}/>,     label: 'Play audio',      risk: 'low'    },
  'audio.capture':    { icon: <Mic size={12}/>,        label: 'Capture audio',   risk: 'medium' },
  'filesystem.read':  { icon: <FolderOpen size={12}/>, label: 'Read files',      risk: 'medium' },
  'filesystem.write': { icon: <FolderOpen size={12}/>, label: 'Write files',     risk: 'high'   },
  network:            { icon: <Globe size={12}/>,      label: 'Internet access', risk: 'medium' },
  notifications:      { icon: <Bell size={12}/>,       label: 'Notifications',   risk: 'low'    },
  clipboard:          { icon: <Clipboard size={12}/>,  label: 'Clipboard',       risk: 'medium' },
};

const RISK_COLOR: Record<string, string> = {
  low:    'var(--accent)',
  medium: '#F5A623',
  high:   '#E8607A',
};

// ── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onChange(!on); }}
      style={{
        width: 36, height: 20, borderRadius: 10, position: 'relative',
        background: on ? 'var(--accent)' : 'var(--border-default)',
        transition: 'background 150ms', flexShrink: 0, cursor: 'pointer',
        border: 'none',
      }}
    >
      <div style={{
        position: 'absolute', top: 2, left: on ? 18 : 2,
        width: 16, height: 16, borderRadius: '50%', background: 'white',
        transition: 'left 150ms', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }}/>
    </button>
  );
}

// ── Addon card ────────────────────────────────────────────────────────────────

function AddonCard({
  addon, updateInfo, onRemove, onUpdate, onToggle, removing, updating,
}: {
  addon:      AddonMeta;
  updateInfo?: UpdateInfo;
  onRemove:   (id: string) => void;
  onUpdate?:  (id: string, url: string) => void;
  onToggle?:  (id: string, enabled: boolean) => void;
  removing:   boolean;
  updating:   boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const t   = TYPE_META[addon.addon_type] ?? { label: addon.addon_type, hue: 'var(--text-tertiary)' };
  const date = addon.installed_at
    ? new Date(addon.installed_at).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' })
    : null;

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: `0.5px solid ${expanded ? 'var(--border-default)' : 'var(--border-subtle)'}`,
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
      transition: 'border-color var(--duration-fast)',
    }}>
      {/* Main row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '14px 16px', cursor: 'pointer',
        userSelect: 'none',
      }} onClick={() => setExpanded(e => !e)}>

        {/* Icon */}
        <div style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: `${t.hue}14`,
          border: `1px solid ${t.hue}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Package size={18} style={{ color: t.hue }}/>
        </div>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--text-primary)' }}>
              {addon.name}
            </span>
            {/* Type badge */}
            <span style={{
              fontSize: 10, padding: '1px 7px', borderRadius: 'var(--radius-full)',
              background: `${t.hue}14`, color: t.hue,
              border: `0.5px solid ${t.hue}40`,
              fontWeight: 500, flexShrink: 0,
            }}>
              {t.label}
            </span>
            {/* Update badge */}
            {updateInfo && (
              <span style={{
                fontSize: 10, padding: '1px 7px', borderRadius: 'var(--radius-full)',
                background: 'var(--warning-subtle)', color: 'var(--warning)',
                border: '0.5px solid var(--warning)', fontWeight: 500, flexShrink: 0,
              }}>
                Update
              </span>
            )}
          </div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {addon.description || <span style={{ fontStyle: 'italic', color: 'var(--text-tertiary)' }}>No description</span>}
          </div>
        </div>

        {/* Right side controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}
             onClick={e => e.stopPropagation()}>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            v{addon.version}
          </span>
          {onToggle && (
            <Toggle
              on={addon.enabled !== false}
              onChange={v => onToggle(addon.id, v)}
            />
          )}
          <button
            onClick={() => onRemove(addon.id)}
            disabled={removing}
            title="Remove"
            style={{
              width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-tertiary)',
              cursor: removing ? 'not-allowed' : 'pointer',
              transition: 'all var(--duration-fast)',
            }}
            onMouseEnter={e => { if (!removing) { e.currentTarget.style.color='var(--danger)'; e.currentTarget.style.background='var(--danger-subtle)'; }}}
            onMouseLeave={e => { e.currentTarget.style.color='var(--text-tertiary)'; e.currentTarget.style.background='transparent'; }}
          >
            {removing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }}/> : <Trash2 size={13}/>}
          </button>
          <div style={{
            color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center',
          }} onClick={() => setExpanded(e => !e)}>
            {expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
          </div>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{
          borderTop: '0.5px solid var(--border-subtle)',
          padding: '14px 16px',
          display: 'flex', flexDirection: 'column', gap: 12,
          background: 'var(--bg-base)',
        }}>

          {/* Metadata grid */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px',
          }}>
            {[
              { label: 'Author',   value: addon.author || '—' },
              { label: 'License',  value: addon.license || '—' },
              { label: 'Addon ID', value: addon.id },
              { label: 'Installed',value: date || '—' },
              ...(addon.for_languages?.length ? [{ label: 'Languages', value: addon.for_languages.join(', ') }] : []),
              ...(addon.handles?.length        ? [{ label: 'Handles',   value: addon.handles.join(', ') }] : []),
              ...(addon.for_modules?.length    ? [{ label: 'Modules',   value: addon.for_modules.join(', ') }] : []),
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0, minWidth: 60 }}>{label}</span>
                <span style={{
                  fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Permissions (melon only) */}
          {addon.permissions && addon.permissions.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-tertiary)',
                             textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Permissions
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {addon.permissions.map(perm => {
                  const info = PERM_META[perm];
                  if (!info) return (
                    <span key={perm} style={{
                      fontSize: 11, padding: '3px 8px', borderRadius: 'var(--radius-full)',
                      background: 'var(--bg-sunken)', color: 'var(--text-tertiary)',
                      border: '0.5px solid var(--border-subtle)',
                      display: 'flex', alignItems: 'center', gap: 5,
                    }}>{perm}</span>
                  );
                  return (
                    <span key={perm} style={{
                      fontSize: 11, padding: '3px 8px', borderRadius: 'var(--radius-full)',
                      background: `${RISK_COLOR[info.risk]}14`,
                      color: RISK_COLOR[info.risk],
                      border: `0.5px solid ${RISK_COLOR[info.risk]}40`,
                      display: 'flex', alignItems: 'center', gap: 5,
                    }}>
                      {info.icon} {info.label}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tags */}
          {addon.tags?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {addon.tags.map(tag => (
                <span key={tag} style={{
                  fontSize: 10, padding: '2px 7px', borderRadius: 'var(--radius-full)',
                  background: 'var(--bg-sunken)', color: 'var(--text-tertiary)',
                  border: '0.5px solid var(--border-subtle)',
                }}>
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Update notice */}
          {updateInfo && (
            <div style={{
              padding: '10px 12px',
              background: 'var(--warning-subtle)',
              border: '0.5px solid var(--warning)',
              borderRadius: 'var(--radius-md)',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <ArrowUpCircle size={14} style={{ color: 'var(--warning)', flexShrink: 0 }}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: 500 }}>
                  v{updateInfo.latest_version} available
                  {updateInfo.is_breaking && (
                    <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--danger)' }}>
                      Breaking changes
                    </span>
                  )}
                </div>
                {updateInfo.changelog && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {updateInfo.changelog}
                  </div>
                )}
              </div>
              <button
                onClick={() => onUpdate?.(addon.id, updateInfo.download_url)}
                disabled={updating}
                style={{
                  height: 28, padding: '0 12px', borderRadius: 'var(--radius-md)',
                  background: 'var(--warning)', color: 'white',
                  fontSize: 11, fontWeight: 500, cursor: updating ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
                  opacity: updating ? 0.6 : 1,
                }}
              >
                {updating ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }}/> : <Download size={11}/>}
                Update
              </button>
            </div>
          )}

          {/* Links */}
          <div style={{ display: 'flex', gap: 8 }}>
            {addon.homepage && (
              <button onClick={() => {
                if ((window as any).app?.openURL) (window as any).app.openURL(addon.homepage!);
                else window.open(addon.homepage, '_blank');
              }} style={{
                fontSize: 11, color: 'var(--accent)', display: 'flex',
                alignItems: 'center', gap: 4, cursor: 'pointer',
              }}>
                <ExternalLink size={10}/> Homepage
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

type Tab = 'mlc' | 'melon' | 'debug';

export function ExtensionsPanel({ onClose }: Props) {
  const { notify } = useProjectStore();
  const [tab,           setTab]           = useState<Tab>('mlc');
  const [mlcAddons,     setMlcAddons]     = useState<AddonMeta[]>([]);
  const [melonExts,     setMelonExts]     = useState<AddonMeta[]>([]);
  const [updates,       setUpdates]       = useState<UpdateInfo[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [checking,      setChecking]      = useState(false);
  const [search,        setSearch]        = useState('');
  const [removing,      setRemoving]      = useState<Record<string, boolean>>({});
  const [updating,      setUpdating]      = useState<Record<string, boolean>>({});
  const [installing,    setInstalling]    = useState(false);
  const [dragOver,      setDragOver]      = useState(false);
  const [dropStatus,    setDropStatus]    = useState<{ type: 'success'|'error'|'info'; msg: string } | null>(null);
  const [installPrompt, setInstallPrompt] = useState<{
    id: string; name: string; version: string;
    description: string; author: string;
    permissions: MelonPermission[];
    onConfirm: () => void;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // MLC addons — all types via list_addons_full
      const mlcRes = await (window as any).mlc?.listAddonsFull?.();
      // Bridge resolves with msg.data directly — mlcRes = {addons:[...]} or {voicebank_mappers:[...]}
      if (mlcRes) {
        // Flat list from list_addons_full action
        const flat: AddonMeta[] = (mlcRes.addons ?? [
          ...(mlcRes.voicebank_mappers    ?? []),
          ...(mlcRes.language_packs       ?? []),
          ...(mlcRes.pipeline_plugins     ?? []),
          ...(mlcRes.word_overrides       ?? []),
          ...(mlcRes.phoneme_correctors   ?? []),
          ...(mlcRes.output_postprocessors ?? []),
          ...(mlcRes.custom_g2ps          ?? []),
          ...(mlcRes.analyzers            ?? []),
        ]).map((a: any) => ({ tags: [], ...a }));
        setMlcAddons(flat);
      }
      // .melon extensions
      const melonList = await (window as any).app?.listExtensions?.();
      if (Array.isArray(melonList)) {
        setMelonExts(melonList.map((a: any) => ({
          tags: [], addon_type: 'app_addon', ...a,
        })));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const checkUpdates = async () => {
    setChecking(true);
    try {
      const mlcUp = await (window as any).mlc?.checkUpdates?.();
      const melUp = await (window as any).app?.checkExtensionUpdates?.();
      const all = [
        ...(mlcUp?.data?.updates ?? mlcUp?.updates ?? []),
        ...(Array.isArray(melUp) ? melUp : []),
      ];
      setUpdates(all);
      if (all.length === 0) notify({ type: 'info', title: 'All addons up to date' });
      else notify({ type: 'info', title: `${all.length} update${all.length > 1 ? 's' : ''} available` });
    } finally {
      setChecking(false);
    }
  };

  const removeAddon = async (id: string, type: 'mlc' | 'melon') => {
    setRemoving(r => ({ ...r, [id]: true }));
    try {
      if (type === 'mlc') {
        const r = await (window as any).mlc?.removeAddon?.({ addon_id: id });
        if (r?.ok) {
          notify({ type: 'success', title: 'Addon removed' });
          setMlcAddons(prev => prev.filter(a => a.id !== id));
        } else {
          notify({ type: 'error', title: 'Remove failed', body: r?.error });
        }
      } else {
        const r = await (window as any).app?.removeExtension?.(id);
        if (r?.ok) {
          notify({ type: 'success', title: 'Extension removed' });
          setMelonExts(prev => prev.filter(a => a.id !== id));
        } else {
          notify({ type: 'error', title: 'Remove failed', body: r?.error });
        }
      }
    } finally {
      setRemoving(r => ({ ...r, [id]: false }));
    }
  };

  const applyUpdate = async (id: string, url: string) => {
    setUpdating(u => ({ ...u, [id]: true }));
    try {
      const r = await (window as any).mlc?.applyUpdate?.({ addon_id: id, download_url: url });
      if (r?.ok) {
        notify({ type: 'success', title: `Updated to v${r.data?.version ?? '?'}` });
        setUpdates(prev => prev.filter(u => u.id !== id));
        load();
      } else {
        notify({ type: 'error', title: 'Update failed', body: r?.error });
      }
    } finally {
      setUpdating(u => ({ ...u, [id]: false }));
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    setDropStatus({ type: 'info', msg: `Installing ${file.name}…` });
    const isMlc   = file.name.endsWith('.mlc');
    const isMelon = file.name.endsWith('.melon');
    if (!isMlc && !isMelon) {
      notify({ type: 'error', title: 'Invalid file', body: 'Drop a .mlc or .melon file' });
      return;
    }
    const filePath = (file as any).path ?? file.name;
    if (isMelon) {
      const bridge = (window as any).app;
      const manifest = await bridge?.readMelonManifest?.(filePath).catch(() => null);
      if (manifest) {
        setInstallPrompt({
          id: manifest.id ?? '', name: manifest.name ?? file.name,
          version: manifest.version ?? '?', description: manifest.description ?? '',
          author: manifest.author ?? '', permissions: manifest.permissions ?? [],
          onConfirm: async () => {
            setInstallPrompt(null); setInstalling(true);
            try {
              const r = await bridge.installExtension({ path: filePath });
              if (r?.ok) { notify({ type: 'success', title: `Installed ${r.name ?? file.name}` }); load(); }
              else notify({ type: 'error', title: 'Install failed', body: r?.error });
            } finally { setInstalling(false); }
          },
        });
        return;
      }
      setInstalling(true);
      try {
        const r = await bridge?.installExtension?.({ path: filePath });
        if (r?.ok) {
          setDropStatus({ type: 'success', msg: `Installed ${r.name ?? file.name}` });
          notify({ type: 'success', title: `Installed ${r.name ?? file.name}` });
          load();
        } else {
          setDropStatus({ type: 'error', msg: r?.error ?? 'Install failed' });
          notify({ type: 'error', title: 'Install failed', body: r?.error });
        }
      } catch (e: any) {
        setDropStatus({ type: 'error', msg: e.message });
      } finally {
        setInstalling(false);
        setTimeout(() => setDropStatus(null), 4000);
      }
      return;
    }
    setInstalling(true);
    try {
      const r = await (window as any).app?.installAddon?.(filePath);
      if (r?.ok) {
        const label = r.name ? `${r.name} v${r.version ?? '?'}` : file.name;
        setDropStatus({ type: 'success', msg: `✓ Installed ${label}` });
        notify({ type: 'success', title: `Installed ${label}` });
        setTimeout(() => { setDropStatus(null); load(); }, 2000);
      } else {
        const err = r?.error ?? 'Install failed — check the file is a valid .mlc addon';
        setDropStatus({ type: 'error', msg: err });
        notify({ type: 'error', title: 'Install failed', body: err });
        setTimeout(() => setDropStatus(null), 6000);
      }
    } catch (e: any) {
      const err = e.message ?? 'Unexpected error during install';
      setDropStatus({ type: 'error', msg: err });
      notify({ type: 'error', title: 'Install error', body: err });
      setTimeout(() => setDropStatus(null), 6000);
    } finally {
      setInstalling(false);
    }
  };

  const updateMap = Object.fromEntries(updates.map(u => [u.id, u]));

  const filterAddons = (list: AddonMeta[]) => {
    const q = search.toLowerCase();
    if (!q) return list;
    return list.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.description?.toLowerCase().includes(q) ||
      a.author?.toLowerCase().includes(q) ||
      a.addon_type?.toLowerCase().includes(q) ||
      a.tags?.some(t => t.toLowerCase().includes(q))
    );
  };

  const mlcFiltered   = filterAddons(mlcAddons);
  const melonFiltered = filterAddons(melonExts);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 700,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'fadeIn 120ms var(--ease-out) both',
    }} onClick={onClose}>
      <div style={{
        width: 680, height: '84vh', maxHeight: 680,
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border-default)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        animation: 'slideDown 160ms var(--ease-out) both',
      }} onClick={e => e.stopPropagation()}>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div style={{
          padding: '20px 24px 0',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                Extensions
              </div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: 2 }}>
                {mlcAddons.length} MLC addon{mlcAddons.length !== 1 ? 's' : ''} ·{' '}
                {melonExts.length} app extension{melonExts.length !== 1 ? 's' : ''}
                {updates.length > 0 && (
                  <span style={{ color: 'var(--warning)', marginLeft: 6 }}>
                    · {updates.length} update{updates.length !== 1 ? 's' : ''} available
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={checkUpdates} disabled={checking} style={{
                height: 30, padding: '0 12px', borderRadius: 'var(--radius-md)',
                border: '0.5px solid var(--border-default)',
                fontSize: 12, color: 'var(--text-secondary)',
                display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                transition: 'all var(--duration-fast)',
              }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-default)'}
              >
                {checking
                  ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }}/>
                  : <RefreshCw size={11}/>
                } Check updates
              </button>
              <button onClick={onClose} style={{
                width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 'var(--radius-md)', color: 'var(--text-tertiary)', cursor: 'pointer',
                transition: 'all var(--duration-fast)',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-sunken)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
              >
                <X size={15}/>
              </button>
            </div>
          </div>

          {/* Tabs + search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, borderBottom: '0.5px solid var(--border-subtle)', paddingBottom: 0 }}>
            {([
              { id: 'mlc'   as Tab, label: 'MLC Addons',     count: mlcAddons.length },
              { id: 'melon' as Tab, label: 'App Extensions', count: melonExts.length },
              { id: 'debug' as Tab, label: 'Debug',           count: undefined },
            ] as const).map(({ id, label, count }) => (
              <button key={id} onClick={() => setTab(id)} style={{
                height: 36, padding: '0 16px', borderRadius: 0,
                fontSize: 'var(--text-sm)', fontWeight: tab === id ? 500 : 400,
                color: tab === id ? 'var(--accent)' : 'var(--text-secondary)',
                borderBottom: tab === id ? '2px solid var(--accent)' : '2px solid transparent',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7,
                transition: 'color var(--duration-fast)',
                background: 'transparent',
              }}>
                {label}
                {count !== undefined && (
                  <span style={{
                    minWidth: 18, height: 18, borderRadius: 9, padding: '0 5px',
                    background: tab === id ? 'var(--accent)' : 'var(--bg-sunken)',
                    color: tab === id ? 'white' : 'var(--text-tertiary)',
                    fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 500,
                  }}>
                    {count}
                  </span>
                )}
              </button>
            ))}
            <div style={{ flex: 1 }}/>
            {/* Search */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '0 10px', height: 28,
              background: 'var(--bg-sunken)', borderRadius: 'var(--radius-md)',
              border: '0.5px solid var(--border-subtle)', marginBottom: 4,
            }}>
              <Search size={11} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}/>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Filter…"
                style={{
                  width: 120, fontSize: 12, color: 'var(--text-primary)',
                  background: 'transparent', outline: 'none', border: 'none',
                }}/>
            </div>
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────────── */}
        <div
          style={{
            flex: 1, overflowY: 'auto', padding: '16px 24px',
            minHeight: 0,
            background: dragOver ? 'var(--accent-subtle)' : 'transparent',
            outline: dragOver ? '2px dashed var(--accent)' : 'none',
            outlineOffset: -8,
            transition: 'all 100ms',
          }}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 160 }}>
              <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-tertiary)' }}/>
            </div>
          ) : (
            <>
              {/* MLC tab */}
              {tab === 'mlc' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {mlcFiltered.length === 0 ? (
                    <EmptySlate
                      icon={<Package size={36} style={{ opacity: 0.15 }}/>}
                      title={search ? 'No addons match your search' : 'No MLC addons installed'}
                      body={search ? 'Try a different search term' : 'Drop a .mlc file here to install a language pack, voicebank mapper, or pipeline plugin.'}
                      docUrl="https://github.com/MilkmanAbi/Melon-Synth/blob/main/docs/MLC_ADDON_API.md"
                    />
                  ) : (
                    mlcFiltered.map(a => (
                      <AddonCard key={a.id} addon={a}
                        updateInfo={updateMap[a.id]}
                        onRemove={id => removeAddon(id, 'mlc')}
                        onUpdate={applyUpdate}
                        removing={!!removing[a.id]}
                        updating={!!updating[a.id]}
                      />
                    ))
                  )}
                </div>
              )}

              {/* .melon tab */}
              {tab === 'melon' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {melonFiltered.length === 0 ? (
                    <EmptySlate
                      icon={<Puzzle size={36} style={{ opacity: 0.15 }}/>}
                      title={search ? 'No extensions match your search' : 'No app extensions installed'}
                      body={search ? 'Try a different search term' : 'Drop a .melon file here to install tools, panels, and integrations.'}
                      docUrl="https://github.com/MilkmanAbi/Melon-Synth/blob/main/docs/MELON_APP_API.md"
                    />
                  ) : (
                    melonFiltered.map(a => (
                      <AddonCard key={a.id} addon={a}
                        updateInfo={updateMap[a.id]}
                        onRemove={id => removeAddon(id, 'melon')}
                        onUpdate={applyUpdate}
                        onToggle={async (id, enabled) => {
                          setMelonExts(prev => prev.map(x => x.id === id ? { ...x, enabled } : x));
                          // TODO: persist toggle state
                        }}
                        removing={!!removing[a.id]}
                        updating={!!updating[a.id]}
                      />
                    ))
                  )}
                </div>
              )}

              {/* Debug tab */}
              {tab === 'debug' && <PipelineDebugTab/>}

              {/* Drop status feedback */}
              {dropStatus && (
                <div style={{
                  marginTop: 8, padding: '8px 12px', borderRadius: 'var(--radius-md)',
                  background: dropStatus.type === 'success' ? 'var(--success-subtle)'
                            : dropStatus.type === 'error'   ? 'var(--danger-subtle)'
                            : 'var(--bg-sunken)',
                  border: `0.5px solid ${dropStatus.type === 'success' ? 'var(--success)'
                           : dropStatus.type === 'error'   ? 'var(--danger)'
                           : 'var(--border-default)'}`,
                  fontSize: 'var(--text-sm)',
                  color: dropStatus.type === 'success' ? 'var(--success)'
                       : dropStatus.type === 'error'   ? 'var(--danger)'
                       : 'var(--text-secondary)',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  {dropStatus.type === 'info' && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}/>}
                  {dropStatus.msg}
                </div>
              )}

              {/* Install zone */}
              {tab !== 'debug' && (
                <div style={{
                  marginTop: 16, borderRadius: 'var(--radius-md)',
                  border: '1px dashed var(--border-default)',
                  padding: '14px 16px', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 8,
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                    Drop a <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>.mlc</code> or{' '}
                    <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>.melon</code> file here, or
                  </div>
                  <button
                    disabled={installing}
                    onClick={async () => {
                      const r = await (window as any).app?.installAddonDialog?.();
                      if (!r) return;
                      if (r.ok) {
                        const label = r.name ? `${r.name} v${r.version ?? '?'}` : 'addon';
                        setDropStatus({ type: 'success', msg: `✓ Installed ${label}` });
                        notify({ type: 'success', title: `Installed ${label}` });
                        setTimeout(() => { setDropStatus(null); load(); }, 1500);
                      } else if (!r.canceled) {
                        const err = r.error ?? 'Install failed';
                        setDropStatus({ type: 'error', msg: err });
                        notify({ type: 'error', title: 'Install failed', body: err });
                        setTimeout(() => setDropStatus(null), 6000);
                      }
                    }}
                    style={{
                      height: 32, padding: '0 20px', borderRadius: 'var(--radius-md)',
                      background: 'var(--accent)', color: 'white',
                      fontSize: 'var(--text-sm)', fontWeight: 500,
                      cursor: installing ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', gap: 6,
                      opacity: installing ? 0.6 : 1,
                    }}
                  >
                    {installing
                      ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }}/> Installing…</>
                      : <><Plus size={13}/> Browse for addon file…</>
                    }
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {installPrompt && (
          <AddonInstallDialog
            addon={installPrompt}
            onConfirm={installPrompt.onConfirm}
            onCancel={() => setInstallPrompt(null)}
          />
        )}
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptySlate({ icon, title, body, docUrl }: {
  icon: React.ReactNode; title: string; body: string; docUrl?: string;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: 200, gap: 10, textAlign: 'center',
      color: 'var(--text-tertiary)',
    }}>
      {icon}
      <div>
        <div style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4 }}>
          {title}
        </div>
        <div style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6, maxWidth: 340 }}>{body}</div>
      </div>
      {docUrl && (
        <button onClick={() => {
          if ((window as any).app?.openURL) (window as any).app.openURL(docUrl);
          else window.open(docUrl, '_blank');
        }} style={{ fontSize: 11, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <ExternalLink size={10}/> Developer guide
        </button>
      )}
    </div>
  );
}

// ── Pipeline debug tab ────────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
  language_detected:      'var(--text-tertiary)',
  word_override_check:    '#E8607A',
  word_overrides_applied: '#E8607A',
  g2p:                    '#7B8FE8',
  phoneme_corrector:      '#F5A623',
  voicebank_map:          'var(--accent)',
  output_postprocessor:   '#9A9590',
  analyzer:               '#5BA8E8',
};

function PipelineDebugTab() {
  const [testText, setTestText] = useState('beautiful dream');
  const [moduleId, setModuleId] = useState('jp_cv_standard');
  const [trace,    setTrace]    = useState<any[]>([]);
  const [tokens,   setTokens]   = useState<any[]>([]);
  const [running,  setRunning]  = useState(false);
  const [error,    setError]    = useState('');

  const run = async () => {
    setRunning(true); setError(''); setTrace([]); setTokens([]);
    try {
      if (!(window as any).mlc?.getPipelineTrace) {
        setError('MLC engine not available. Make sure the app started correctly.');
        return;
      }
      // Run trace and convert in parallel
      const [traceRes, convRes] = await Promise.all([
        (window as any).mlc.getPipelineTrace({ text: testText, module_id: moduleId }),
        (window as any).mlc.convert({ text: testText, moduleId, singability: 0.65 }),
      ]);
      // Bridge resolves with msg.data directly (not the full {ok, data} wrapper)
      const traceData   = traceRes?.trace   ?? traceRes?.data?.trace   ?? [];
      const tokensData  = convRes?.tokens   ?? convRes?.data?.tokens   ?? [];
      if (traceData.length === 0 && tokensData.length === 0) {
        setError('No output from engine. Check the module ID is correct.');
      }
      setTrace(traceData);
      setTokens(tokensData);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (msg.includes('timed out')) {
        setError('Engine timed out — it may still be starting up. Wait a moment and try again.');
      } else {
        setError(msg || 'Trace failed');
      }
    } finally { setRunning(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        Trace the full MLC pipeline step by step. See exactly which stage ran and which addon fired.
        Red tokens were produced by a <strong>WordOverride</strong> — hover for source details.
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input value={testText} onChange={e => setTestText(e.target.value)}
          placeholder="Test text…" onKeyDown={e => e.key === 'Enter' && run()}
          style={{
            flex: 2, height: 32, padding: '0 10px',
            background: 'var(--bg-sunken)', border: '0.5px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)',
            color: 'var(--text-primary)', outline: 'none',
          }}/>
        <input value={moduleId} onChange={e => setModuleId(e.target.value)}
          placeholder="module_id"
          style={{
            flex: 1, height: 32, padding: '0 10px',
            background: 'var(--bg-sunken)', border: '0.5px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)',
            color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', outline: 'none',
          }}/>
        <button onClick={run} disabled={running} style={{
          height: 32, padding: '0 16px', background: 'var(--accent)', color: 'white',
          borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', fontWeight: 500,
          cursor: running ? 'not-allowed' : 'pointer', opacity: running ? 0.6 : 1,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Bug size={13}/> {running ? 'Running…' : 'Trace'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', background: 'var(--danger-subtle)', borderRadius: 'var(--radius-md)',
                       fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {trace.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-tertiary)', textTransform: 'uppercase',
                         letterSpacing: '0.06em', marginBottom: 8 }}>
            Pipeline ({trace.length} stages)
          </div>
          <div style={{ border: '0.5px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {trace.map((step, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px',
                borderBottom: i < trace.length - 1 ? '0.5px solid var(--border-subtle)' : 'none',
                background: i % 2 === 1 ? 'var(--bg-sunken)' : 'transparent',
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                               background: STAGE_COLORS[step.stage] ?? 'var(--text-tertiary)' }}/>
                <span style={{ fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)',
                                color: 'var(--text-primary)', fontWeight: 500, minWidth: 180 }}>
                  {step.stage}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {step.backend ? `backend: ${step.backend}` : ''}
                  {step.id ? `addon: ${step.id}` : ''}
                  {step.active?.length ? `active: ${step.active.join(', ')}` : ''}
                  {step.words?.length ? (
                    <span style={{ color: '#E8607A' }}> overrode: {step.words.join(', ')}</span>
                  ) : ''}
                  {step.lang ? `lang: ${step.lang}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tokens.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-tertiary)', textTransform: 'uppercase',
                         letterSpacing: '0.06em', marginBottom: 8 }}>
            Output ({tokens.length} tokens)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {tokens.map((t: any, i: number) => {
              const isOverride = t.g2p_source === 'word_override';
              return (
                <span key={i} title={`source: ${t.g2p_source || 'g2p'} · conf: ${Math.round((t.mlc_confidence || 0) * 100)}%`}
                  style={{
                    padding: '4px 10px', borderRadius: 'var(--radius-full)',
                    fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)',
                    background: isOverride ? 'rgba(232,96,122,0.1)' : 'var(--bg-sunken)',
                    color: isOverride ? '#E8607A' : 'var(--text-primary)',
                    border: `0.5px solid ${isOverride ? 'rgba(232,96,122,0.4)' : 'var(--border-subtle)'}`,
                    cursor: 'default',
                  }}>
                  {t.display}
                </span>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>
            Red = WordOverride · hover any token for source + confidence
          </div>
        </div>
      )}
    </div>
  );
}
