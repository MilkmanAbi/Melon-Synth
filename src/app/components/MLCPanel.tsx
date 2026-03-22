/**
 * MLC Panel — sidebar bar only
 * Clean single-row button. Click → opens full MLCWindow.
 * No inline textarea, no token pills, nothing ugly.
 */

import React from 'react';
import { Languages, Maximize2 } from 'lucide-react';
import { mlcClient } from '../../subsystems/mlc-client';

interface Props { onOpenWindow?: () => void; }

export function MLCPanel({ onOpenWindow }: Props = {}) {
  const live = mlcClient.isLive;

  return (
    <button
      onClick={onOpenWindow}
      style={{
        width: '100%',
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px var(--space-4)',
        borderTop: '0.5px solid var(--border-subtle)',
        background: 'transparent',
        cursor: 'pointer',
        transition: 'background var(--duration-fast)',
        flexShrink: 0,
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-sunken)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <Languages size={13} style={{ color: 'var(--accent)', flexShrink: 0 }}/>
      <span style={{ flex: 1, textAlign: 'left', fontSize: 'var(--text-sm)',
                     color: 'var(--text-secondary)', fontWeight: 500 }}>
        Lyric Conversion
      </span>
      {!live && (
        <span style={{
          fontSize: 10, padding: '1px 5px',
          background: 'var(--warning-subtle)', color: 'var(--warning)',
          borderRadius: 'var(--radius-sm)',
        }}>
          rule engine
        </span>
      )}
      <Maximize2 size={11} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}/>
    </button>
  );
}
