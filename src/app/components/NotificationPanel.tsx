/**
 * Notification Panel
 * ==================
 * Slide-down panel pinned to the command bar.
 * Each notification can have: type, title, body, progress, action button.
 * Auto-dismisses success after 4s. Info/warning/error stay until dismissed.
 */

import React, { useEffect, useRef } from 'react';
import { X, CheckCircle2, AlertTriangle, Info, AlertCircle, XCircle, Pin, PinOff } from 'lucide-react';
import { AppNotification } from '../../store/project';

interface Props {
  notifications: AppNotification[];
  isPinned:      boolean;
  onClose:       () => void;
  onTogglePin:   () => void;
  onDismiss:     (id: string) => void;
  onClearAll:    () => void;
}

const TYPE_CONFIG = {
  success: { icon: CheckCircle2, color: 'var(--success)',  bg: 'var(--success-subtle)'  },
  info:    { icon: Info,         color: 'var(--accent)',   bg: 'var(--accent-subtle)'   },
  warning: { icon: AlertTriangle,color: 'var(--warning)',  bg: 'var(--warning-subtle)'  },
  error:   { icon: XCircle,      color: 'var(--danger)',   bg: 'var(--danger-subtle)'   },
  tip:     { icon: Info,         color: 'var(--accent)',   bg: 'var(--accent-subtle)'   },
};

function NotifItem({ n, onDismiss }: { n: AppNotification; onDismiss: (id: string) => void }) {
  const cfg    = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.info;
  const Icon   = cfg.icon;
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  // Auto-dismiss success/info after 4s
  useEffect(() => {
    if (n.type === 'success' || (n.type === 'info' && n.progress === undefined)) {
      timerRef.current = setTimeout(() => onDismiss(n.id), 4000);
    }
    return () => clearTimeout(timerRef.current);
  }, [n.id, n.type]);

  return (
    <div style={{
      display: 'flex', gap: 'var(--space-3)',
      padding: 'var(--space-3)',
      background: 'var(--bg-surface)',
      borderLeft: `3px solid ${cfg.color}`,
      borderBottom: '0.5px solid var(--border-subtle)',
      animation: 'slideDown 150ms var(--ease-out) both',
    }}>
      <Icon size={14} style={{ color: cfg.color, flexShrink: 0, marginTop: 2 }}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: 500 }}>
          {n.title}
        </div>
        {n.body && (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {n.body}
          </div>
        )}
        {n.progress !== undefined && (
          <div style={{ marginTop: 6, height: 3, background: 'var(--bg-sunken)',
                        borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${n.progress}%`,
              background: cfg.color, borderRadius: 'var(--radius-full)',
              transition: 'width 300ms ease',
            }}/>
          </div>
        )}
        {n.action && (
          <button
            onClick={n.action.onClick}
            style={{
              marginTop: 6, fontSize: 'var(--text-xs)', color: cfg.color,
              fontWeight: 500, cursor: 'pointer',
              transition: 'opacity var(--duration-fast)',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            {n.action.label} →
          </button>
        )}
      </div>
      <button
        onClick={() => onDismiss(n.id)}
        style={{ color: 'var(--text-tertiary)', flexShrink: 0, display: 'flex', alignItems: 'flex-start',
                 cursor: 'pointer', padding: 2, borderRadius: 'var(--radius-sm)',
                 transition: 'all var(--duration-fast)' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-sunken)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
      >
        <X size={12}/>
      </button>
    </div>
  );
}

export function NotificationPanel({ notifications, isPinned, onClose, onTogglePin, onDismiss, onClearAll }: Props) {
  return (
    <div style={{
      position: 'absolute', top: 80, right: 12, zIndex: 500,
      width: 320, maxHeight: 400, overflow: 'hidden',
      background: 'var(--bg-surface)',
      border: '0.5px solid var(--border-default)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
      display: 'flex', flexDirection: 'column',
      animation: 'slideDown 150ms var(--ease-out) both',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: '0.5px solid var(--border-subtle)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--text-secondary)',
                       letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Notifications {notifications.length > 0 && `(${notifications.length})`}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {notifications.length > 0 && (
            <button onClick={onClearAll} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)',
                                                   cursor: 'pointer', padding: '2px 6px',
                                                   borderRadius: 'var(--radius-sm)',
                                                   transition: 'all var(--duration-fast)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-sunken)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              Clear all
            </button>
          )}
          <button onClick={onTogglePin} title={isPinned ? 'Unpin' : 'Keep open'}
            style={{ color: isPinned ? 'var(--accent)' : 'var(--text-tertiary)',
                     display: 'flex', alignItems: 'center', padding: 4,
                     borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                     transition: 'all var(--duration-fast)' }}
          >
            {isPinned ? <Pin size={12}/> : <PinOff size={12}/>}
          </button>
          <button onClick={onClose}
            style={{ color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center',
                     padding: 4, borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                     transition: 'all var(--duration-fast)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-sunken)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <X size={12}/>
          </button>
        </div>
      </div>

      {/* Items */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {notifications.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center',
                        fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
            No notifications
          </div>
        ) : (
          notifications.map(n => (
            <NotifItem key={n.id} n={n} onDismiss={onDismiss}/>
          ))
        )}
      </div>
    </div>
  );
}
