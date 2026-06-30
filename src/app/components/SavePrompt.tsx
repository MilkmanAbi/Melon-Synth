/**
 * SavePrompt — clean modal asking save/discard/cancel
 * Three actions: Save → run saveProject, Discard → skip save, Cancel → do nothing
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  projectName: string;
  onSave:    () => void;
  onDiscard: () => void;
  onCancel:  () => void;
}

export function SavePrompt({ projectName, onSave, onDiscard, onCancel }: Props) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fadeIn 120ms var(--ease-out) both',
      }}
      onClick={onCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 340,
          background: 'var(--bg-surface)',
          border: '0.5px solid var(--border-default)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.20)',
          overflow: 'hidden',
          animation: 'slideDown 160ms var(--ease-out) both',
        }}
      >
        {/* Body */}
        <div style={{ padding: '24px 24px 20px', display: 'flex', gap: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: 'var(--warning-subtle)',
            border: '0.5px solid var(--warning)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <AlertTriangle size={16} style={{ color: 'var(--warning)' }}/>
          </div>
          <div>
            <div style={{
              fontSize: 'var(--text-base)', fontWeight: 500,
              color: 'var(--text-primary)', marginBottom: 6,
            }}>
              Save changes?
            </div>
            <div style={{
              fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.5,
            }}>
              <strong style={{ color: 'var(--text-primary)' }}>"{projectName}"</strong> has
              unsaved changes. Save before continuing?
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div style={{
          display: 'flex', gap: 8, padding: '0 16px 16px',
          justifyContent: 'flex-end',
        }}>
          <button
            onClick={onCancel}
            style={{
              height: 32, padding: '0 14px',
              border: '0.5px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
              cursor: 'pointer', transition: 'all var(--duration-fast)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-sunken)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            Cancel
          </button>
          <button
            onClick={onDiscard}
            style={{
              height: 32, padding: '0 14px',
              border: '0.5px solid var(--danger)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-sm)', color: 'var(--danger)',
              cursor: 'pointer', transition: 'all var(--duration-fast)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--danger-subtle)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            Discard
          </button>
          <button
            onClick={onSave}
            style={{
              height: 32, padding: '0 16px',
              background: 'var(--accent)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-sm)', color: 'white', fontWeight: 500,
              cursor: 'pointer', transition: 'background var(--duration-fast)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent)'; }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
