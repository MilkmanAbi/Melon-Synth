import React, { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  separator?: false;
  onClick: () => void;
}

export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

interface Props {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    // Use mousedown so it fires before click — prevents the triggering click
    // from immediately re-opening the menu on fast double-right-click.
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  // Clamp to viewport so the menu never bleeds off-screen
  const [pos, setPos] = React.useState({ x, y });
  useEffect(() => {
    if (!ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    setPos({
      x: Math.min(x, vw - width - 8),
      y: Math.min(y, vh - height - 8),
    });
  }, [x, y]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: pos.x,
        top:  pos.y,
        zIndex: 500,
        background: 'var(--bg-overlay)',
        border: '0.5px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.08)',
        padding: '4px 0',
        minWidth: 192,
        animation: 'slideDown 100ms var(--ease-out) both',
        userSelect: 'none',
      }}
    >
      {items.map((item, i) => {
        if ('separator' in item && item.separator) {
          return (
            <div key={i} style={{
              height: '0.5px',
              background: 'var(--border-subtle)',
              margin: '4px 0',
            }} />
          );
        }
        const it = item as ContextMenuItem;
        return (
          <button
            key={i}
            disabled={it.disabled}
            onClick={() => { it.onClick(); onClose(); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              padding: '0 var(--space-3)',
              height: 30,
              gap: 'var(--space-2)',
              fontSize: 'var(--text-base)',
              color: it.danger ? 'var(--danger)' : it.disabled ? 'var(--text-disabled)' : 'var(--text-primary)',
              background: 'transparent',
              textAlign: 'left',
              cursor: it.disabled ? 'default' : 'pointer',
              transition: 'background var(--duration-fast)',
            }}
            onMouseEnter={e => {
              if (!it.disabled)
                e.currentTarget.style.background = it.danger ? 'var(--danger-subtle)' : 'var(--bg-sunken)';
            }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            {it.icon && (
              <span style={{ color: it.danger ? 'var(--danger)' : 'var(--text-tertiary)', display: 'flex', flexShrink: 0 }}>
                {it.icon}
              </span>
            )}
            <span style={{ flex: 1 }}>{it.label}</span>
            {it.shortcut && (
              <span style={{
                fontSize: 'var(--text-xs)',
                fontFamily: 'var(--font-mono)',
                color: it.danger ? 'var(--danger)' : 'var(--text-tertiary)',
                marginLeft: 'var(--space-4)',
                flexShrink: 0,
              }}>
                {it.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
