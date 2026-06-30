/**
 * Addon Install Dialog
 * ====================
 * Shows before a .melon addon is installed.
 * Lists requested permissions so the user can make an informed decision.
 * Similar to browser extension install prompts.
 */

import React from 'react';
import {
  Package, Mic, FolderOpen, Globe, Bell, Clipboard,
  Music2, Edit3, Cpu, Shield, X, Check,
} from 'lucide-react';
import type { MelonPermission } from '../../platform/melon-addon-types';

interface Props {
  addon: {
    id:          string;
    name:        string;
    version:     string;
    description: string;
    author:      string;
    permissions: MelonPermission[];
  };
  onConfirm: () => void;
  onCancel:  () => void;
}

const PERMISSION_INFO: Record<MelonPermission, { label: string; detail: string; icon: React.ReactNode; risk: 'low' | 'medium' | 'high' }> = {
  microphone:        { label: 'Microphone',        detail: 'Record audio from your microphone',           icon: <Mic size={14}/>,       risk: 'medium' },
  'project.read':    { label: 'Read project',      detail: 'Read your notes, tracks, and BPM',            icon: <Music2 size={14}/>,    risk: 'low' },
  'project.write':   { label: 'Modify project',    detail: 'Add, edit, and delete notes and tracks',      icon: <Edit3 size={14}/>,     risk: 'medium' },
  'mlc.convert':     { label: 'Use MLC engine',    detail: 'Convert lyrics to phonemes',                  icon: <Cpu size={14}/>,       risk: 'low' },
  'audio.play':      { label: 'Play audio',        detail: 'Trigger audio playback',                      icon: <Music2 size={14}/>,    risk: 'low' },
  'audio.capture':   { label: 'Capture audio',     detail: 'Capture and analyse the audio stream',        icon: <Mic size={14}/>,       risk: 'medium' },
  'filesystem.read': { label: 'Read files',        detail: 'Read files you choose via a dialog',          icon: <FolderOpen size={14}/>,risk: 'medium' },
  'filesystem.write':{ label: 'Write files',       detail: 'Save files to locations you choose',          icon: <FolderOpen size={14}/>,risk: 'high' },
  network:           { label: 'Internet access',   detail: 'Make outbound requests to external servers',  icon: <Globe size={14}/>,     risk: 'medium' },
  notifications:     { label: 'Notifications',     detail: 'Show notifications in the notification panel',icon: <Bell size={14}/>,      risk: 'low' },
  clipboard:         { label: 'Clipboard',         detail: 'Read and write your clipboard',               icon: <Clipboard size={14}/>, risk: 'medium' },
};

const RISK_COLORS: Record<string, string> = {
  low:    'var(--accent)',
  medium: '#F5A623',
  high:   '#E8607A',
};

export function AddonInstallDialog({ addon, onConfirm, onCancel }: Props) {
  const hasHighRisk = addon.permissions.some(p => PERMISSION_INFO[p]?.risk === 'high');
  const unknown     = addon.permissions.filter(p => !PERMISSION_INFO[p]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 420, maxHeight: '80vh', overflow: 'hidden',
        background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)',
        border: '0.5px solid var(--border-subtle)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column',
      }}>

        {/* Header */}
        <div style={{ padding: '20px 20px 16px', borderBottom: '0.5px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10, flexShrink: 0,
              background: 'var(--bg-sunken)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Package size={20} style={{ color: 'var(--accent)' }}/>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 'var(--text-base)', fontWeight: 600,
                             color: 'var(--text-primary)' }}>
                Install "{addon.name}"
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>
                v{addon.version} · by {addon.author}
              </div>
              {addon.description && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
                               marginTop: 6, lineHeight: 1.5 }}>
                  {addon.description}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Permissions */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {addon.permissions.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8,
                           padding: 12, background: 'rgba(77,191,144,0.08)',
                           borderRadius: 'var(--radius-md)' }}>
              <Shield size={14} style={{ color: 'var(--accent)' }}/>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                This addon requires no special permissions.
              </span>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
                             marginBottom: 10 }}>
                This addon requests the following permissions:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {addon.permissions.map(perm => {
                  const info = PERMISSION_INFO[perm];
                  if (!info) return null;
                  return (
                    <div key={perm} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                      padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-sunken)',
                      border: `0.5px solid ${info.risk === 'high' ? 'rgba(232,96,122,0.3)' : 'transparent'}`,
                    }}>
                      <div style={{ color: RISK_COLORS[info.risk], flexShrink: 0, marginTop: 1 }}>
                        {info.icon}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 500,
                                       color: 'var(--text-primary)' }}>
                          {info.label}
                          {info.risk === 'high' && (
                            <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 5px',
                                           background: 'rgba(232,96,122,0.15)', color: '#E8607A',
                                           borderRadius: 10 }}>
                              sensitive
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
                          {info.detail}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {unknown.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '4px 10px' }}>
                    Unknown permissions: {unknown.join(', ')}
                  </div>
                )}
              </div>
            </>
          )}

          {hasHighRisk && (
            <div style={{
              marginTop: 10, padding: '8px 10px', borderRadius: 'var(--radius-sm)',
              background: 'rgba(232,96,122,0.08)', border: '0.5px solid rgba(232,96,122,0.2)',
              fontSize: 'var(--text-xs)', color: '#E8607A',
            }}>
              This addon has access to sensitive operations. Only install from sources you trust.
            </div>
          )}

          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-tertiary)',
                         lineHeight: 1.5 }}>
            Addon code runs in the Melon Synth renderer process.
            You can disable or uninstall addons anytime in Settings → Addons.
          </div>
        </div>

        {/* Actions */}
        <div style={{
          padding: '14px 20px', borderTop: '0.5px solid var(--border-subtle)',
          display: 'flex', gap: 8, justifyContent: 'flex-end',
        }}>
          <button onClick={onCancel} style={{
            padding: '7px 16px', background: 'var(--bg-sunken)',
            border: '0.5px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <X size={13}/> Cancel
          </button>
          <button onClick={onConfirm} style={{
            padding: '7px 16px',
            background: hasHighRisk ? '#E8607A' : 'var(--accent)',
            border: 'none', borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-sm)', color: 'white', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5, fontWeight: 500,
          }}>
            <Check size={13}/> Install
          </button>
        </div>
      </div>
    </div>
  );
}
