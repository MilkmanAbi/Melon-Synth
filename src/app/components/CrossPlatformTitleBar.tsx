/**
 * Window Controls — Cross-platform
 * =================================
 * Custom window control buttons for frameless windows.
 * macOS uses native traffic lights (handled by Electron).
 * Windows/Linux get custom minimize/maximize/close buttons.
 *
 * Integrates with App.tsx title bar area.
 */

import React, { useState, useEffect } from 'react';
import { Minus, Square, X, Maximize2 } from 'lucide-react';

interface Props {
  platform: 'darwin' | 'win32' | 'linux' | string;
}

export function WindowControls({ platform }: Props) {
  const [isMaximized, setIsMaximized] = useState(false);
  
  // macOS uses native traffic lights, no custom controls needed
  if (platform === 'darwin') {
    return null;
  }
  
  // Listen for maximize state changes
  useEffect(() => {
    const checkMaximized = async () => {
      if ((window as any).electron?.isMaximized) {
        setIsMaximized(await (window as any).electron.isMaximized());
      }
    };
    
    // Check on mount
    checkMaximized();
    
    // Could add listener for window state changes here
  }, []);
  
  const handleMinimize = () => {
    if ((window as any).electron?.minimize) {
      (window as any).electron.minimize();
    }
  };
  
  const handleMaximize = () => {
    if ((window as any).electron?.maximize) {
      (window as any).electron.maximize();
      setIsMaximized(!isMaximized);
    }
  };
  
  const handleClose = () => {
    if ((window as any).electron?.close) {
      (window as any).electron.close();
    }
  };
  
  const btnStyle: React.CSSProperties = {
    width: 46,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'background var(--duration-fast)',
    WebkitAppRegion: 'no-drag',
  };
  
  return (
    <div style={{
      display: 'flex',
      alignItems: 'stretch',
      height: '100%',
      marginLeft: 'auto',
      WebkitAppRegion: 'no-drag',
    }}>
      {/* Minimize */}
      <button
        onClick={handleMinimize}
        style={btnStyle}
        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-sunken)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        title="Minimize"
      >
        <Minus size={14} style={{ color: 'var(--text-secondary)' }} />
      </button>
      
      {/* Maximize/Restore */}
      <button
        onClick={handleMaximize}
        style={btnStyle}
        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-sunken)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        title={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? (
          <Maximize2 size={12} style={{ color: 'var(--text-secondary)' }} />
        ) : (
          <Square size={12} style={{ color: 'var(--text-secondary)' }} />
        )}
      </button>
      
      {/* Close */}
      <button
        onClick={handleClose}
        style={{
          ...btnStyle,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#e81123';
          (e.currentTarget.querySelector('svg') as any).style.color = 'white';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          (e.currentTarget.querySelector('svg') as any).style.color = 'var(--text-secondary)';
        }}
        title="Close"
      >
        <X size={14} style={{ color: 'var(--text-secondary)', transition: 'color var(--duration-fast)' }} />
      </button>
    </div>
  );
}

/**
 * Cross-platform Title Bar
 * ========================
 * Contains:
 *   - Drag region for moving window
 *   - Project name (editable)
 *   - Window controls (Windows/Linux only)
 *   - Dirty indicator
 */

interface TitleBarProps {
  projectName: string;
  isDirty: boolean;
  platform: string;
  onRename?: (name: string) => void;
}

export function CrossPlatformTitleBar({ projectName, isDirty, platform, onRename }: TitleBarProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(projectName);
  
  const handleDoubleClick = () => {
    if (onRename) {
      setEditValue(projectName);
      setEditing(true);
    }
  };
  
  const handleSubmit = () => {
    if (editValue.trim() && onRename) {
      onRename(editValue.trim());
    }
    setEditing(false);
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'Escape') {
      setEditing(false);
      setEditValue(projectName);
    }
  };
  
  // macOS: minimal title bar, Electron handles traffic lights
  // Windows/Linux: custom window controls
  const isMac = platform === 'darwin';
  
  return (
    <div style={{
      height: 32,
      background: 'var(--bg-app)',
      borderBottom: '0.5px solid var(--border-subtle)',
      display: 'flex',
      alignItems: 'center',
      WebkitAppRegion: 'drag',
      paddingLeft: isMac ? 78 : 12, // Space for traffic lights on macOS
      paddingRight: isMac ? 12 : 0,
    }}>
      {/* Project name */}
      <div
        onDoubleClick={handleDoubleClick}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 0,
        }}
      >
        {editing ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSubmit}
            onKeyDown={handleKeyDown}
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--accent)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 8px',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-primary)',
              textAlign: 'center',
              outline: 'none',
              maxWidth: 200,
              WebkitAppRegion: 'no-drag',
            }}
          />
        ) : (
          <span style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: onRename ? 'text' : 'default',
          }}>
            {projectName}
            {isDirty && (
              <span style={{ color: 'var(--text-tertiary)', marginLeft: 4 }}>●</span>
            )}
          </span>
        )}
      </div>
      
      {/* Window controls (Windows/Linux only) */}
      {!isMac && <WindowControls platform={platform} />}
    </div>
  );
}

export default CrossPlatformTitleBar;
