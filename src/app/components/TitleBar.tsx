/**
 * TitleBar
 * =========
 * Only renders on macOS (where titleBarStyle=hiddenInset leaves space for it).
 * On Linux/Windows the OS provides the native title bar.
 * NEVER fake OS window controls.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';

interface Props {
  projectName:      string;
  isDark:           boolean;
  isDirty?:         boolean;
  onToggleTheme:    () => void;
  onRenameProject?: (name: string) => void;
}

const isMac = typeof navigator !== 'undefined'
  && /Mac/.test(navigator.userAgent)
  && !(window as any).process?.platform === 'win32';

// In Electron, process.platform is available via the preload
const platform = typeof window !== 'undefined'
  ? ((window as any).__melonPlatform ?? 'linux')
  : 'linux';

export function TitleBar({ projectName, isDark, isDirty, onToggleTheme, onRenameProject }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(projectName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSubmit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== projectName) {
      onRenameProject?.(trimmed);
    }
    setIsEditing(false);
    setEditValue(trimmed || projectName);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditValue(projectName);
    }
  };

  // On Linux/Windows the OS draws the title bar — we only need the theme toggle
  // tucked into the command bar. Don't render this component at all on non-macOS.
  if (platform !== 'darwin') return null;

  return (
    <div style={{
      height:             '36px',
      flexShrink:         0,
      background:         'var(--bg-surface)',
      borderBottom:       '0.5px solid var(--border-subtle)',
      display:            'flex',
      alignItems:         'center',
      padding:            '0 var(--space-4)',
      position:           'relative',
      WebkitAppRegion:    'drag' as any,
    }}>
      {/* Traffic lights live here on macOS — DO NOT draw fake ones */}
      {/* The OS draws real ones in the 72px left space from hiddenInset */}
      <div style={{ width: 72 }} /> {/* spacer for native traffic lights */}

      {/* Centred title — double-click to edit */}
      <div 
        style={{
          position:   'absolute',
          left:       '50%',
          transform:  'translateX(-50%)',
          fontSize:   'var(--text-sm)',
          color:      'var(--text-tertiary)',
          whiteSpace: 'nowrap',
          WebkitAppRegion: 'no-drag' as any,
        }}
        onDoubleClick={() => {
          setEditValue(projectName);
          setIsEditing(true);
        }}
      >
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={handleSubmit}
            onKeyDown={handleKeyDown}
            style={{
              background: 'var(--bg-sunken)',
              border: '1px solid var(--accent)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 8px',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-primary)',
              outline: 'none',
              minWidth: 120,
              textAlign: 'center',
            }}
          />
        ) : (
          <span style={{ cursor: 'text' }} title="Double-click to rename">
            {isDirty ? '● ' : ''}{projectName}.loid — Melon Synth
          </span>
        )}
      </div>

      {/* Theme toggle — must be no-drag so clicks work */}
      <div style={{ marginLeft: 'auto', WebkitAppRegion: 'no-drag' as any }}>
        <button
          onClick={onToggleTheme}
          style={{
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'center',
            width:        28,
            height:       28,
            borderRadius: 'var(--radius-md)',
            color:        'var(--text-tertiary)',
            transition:   'background var(--duration-fast)',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-sunken)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          {isDark ? <Sun size={14}/> : <Moon size={14}/>}
        </button>
      </div>
    </div>
  );
}
