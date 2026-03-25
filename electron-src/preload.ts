/**
 * Melon Synth — Preload Script  v1.0.0-alpha
 * =============================================
 * Security boundary. Runs with contextIsolation=true.
 * Whitelists exactly which IPC calls the renderer can make.
 */

import { contextBridge, ipcRenderer } from 'electron';

// ── window.mlc — MLC Engine ───────────────────────────────────────────────

contextBridge.exposeInMainWorld('mlc', {
  // Core conversion
  ping:               ()       => ipcRenderer.invoke('mlc:ping'),
  convert:            (p: any) => ipcRenderer.invoke('mlc:convert', p),
  preview:            (p: any) => ipcRenderer.invoke('mlc:preview', p),
  listModules:        ()       => ipcRenderer.invoke('mlc:list-modules'),
  listAllAddons:      ()       => ipcRenderer.invoke('mlc:list-all-addons'),
  detectLanguage:     (t: any) => ipcRenderer.invoke('mlc:detect-lang', t),
  suggestSingability: (p: any) => ipcRenderer.invoke('mlc:suggest-singability', p),
  cacheStats:         ()       => ipcRenderer.invoke('mlc:cache-stats'),
  clearCache:         (t: any) => ipcRenderer.invoke('mlc:cache-clear', { target: t }),

  // Addon Manager v2
  listAddonsFull:   (p?: any) => ipcRenderer.invoke('mlc:list-addons-full', p),
  installAddon:     (p: any)  => ipcRenderer.invoke('mlc:install-addon-path', p?.path ?? p),
  removeAddon:      (p: any)  => ipcRenderer.invoke('mlc:remove-addon', p?.addon_id ?? p),
  checkUpdates:     (p?: any) => ipcRenderer.invoke('mlc:check-updates', p),
  applyUpdate:      (p: any)  => ipcRenderer.invoke('mlc:apply-update', p?.addon_id, p?.download_url),
  getAddonInfo:     (p: any)  => ipcRenderer.invoke('mlc:get-addon-info', p?.addon_id ?? p),
  getPipelineTrace: (p: any)  => ipcRenderer.invoke('mlc:get-pipeline-trace', p),
});

// ── window.app — OS Operations ────────────────────────────────────────────

contextBridge.exposeInMainWorld('app', {
  // Settings
  saveUIState:         (d: any)   => ipcRenderer.send('app:save-ui-state', d),
  getUIState:          ()         => ipcRenderer.invoke('app:get-ui-state'),
  onUIState:           (cb: any)  => ipcRenderer.on('app:ui-state', (_e, s) => cb(s)),

  // Addon system
  getAddonsDir:        ()         => ipcRenderer.invoke('app:get-addons-dir'),
  installAddonDialog:  ()         => ipcRenderer.invoke('app:install-addon-dialog'),
  installAddon:        (p: any)   => ipcRenderer.invoke('app:install-addon', p),
  uninstallAddon:      (id: any)  => ipcRenderer.invoke('app:uninstall-addon', id),

  // .melon extensions
  installExtension:    (p: any)   => ipcRenderer.invoke('app:install-extension', p?.path ?? p),
  removeExtension:     (id: any)  => ipcRenderer.invoke('app:remove-extension', id),
  listExtensions:      ()         => ipcRenderer.invoke('app:list-extensions'),
  openExtensionUI:     (id: any)  => ipcRenderer.invoke('app:open-extension-ui', id),
  checkExtensionUpdates: ()       => ipcRenderer.invoke('app:check-extension-updates'),
  readMelonManifest:   (p: any)   => ipcRenderer.invoke('app:read-melon-manifest', p),

  // File dialogs
  openProject:         ()         => ipcRenderer.invoke('dialog:open-project'),
  saveProject:         (n?: any)  => ipcRenderer.invoke('dialog:save-project', n),
  exportWAV:           (n?: any)  => ipcRenderer.invoke('dialog:export-wav', n),

  // Shell
  openPath:            (p: any)   => ipcRenderer.send('shell:open-path', p),
  openURL:             (u: any)   => ipcRenderer.send('shell:open-url', u),

  // File I/O
  writeFile:  (path: any, content: any) => ipcRenderer.invoke('fs:write-file', path, content),
  readFile:   (path: any) => ipcRenderer.invoke('fs:read-file', path).then((r: any) => {
    if (!r.ok) throw new Error(r.error);
    return r.content;
  }),
  fileExists: (path: any) => ipcRenderer.invoke('fs:exists', path),

  // ZIP project save/load (.loid v2 format)
  saveProjectZip: (path: any, files: any) => ipcRenderer.invoke('fs:save-project-zip', path, files),
  readProjectZip: (path: any) => ipcRenderer.invoke('fs:read-project-zip', path),

  // Theme
  getSystemDark:       ()        => ipcRenderer.invoke('app:get-system-dark'),
  onSystemDarkChanged: (cb: any) => ipcRenderer.on('app:system-dark-changed', (_e, d) => cb(d)),

  getPlatform: () => process.platform,
});

// ── window.electron — Window Controls ────────────────────────────────────

contextBridge.exposeInMainWorld('electron', {
  minimize:    () => ipcRenderer.send('win:minimize'),
  maximize:    () => ipcRenderer.send('win:maximize'),
  close:       () => ipcRenderer.send('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
  platform:    process.platform,
});

// ── window.voicebanks ─────────────────────────────────────────────────────

contextBridge.exposeInMainWorld('voicebanks', {
  list:           ()       => ipcRenderer.invoke('vb:list'),
  detectSystem:   ()       => ipcRenderer.invoke('vb:detect-system'),
  download:       (p: any) => ipcRenderer.invoke('vb:download', p),
  installFromZip: (p: any) => ipcRenderer.invoke('vb:install-from-zip', p),
  openFolder:     (p: any) => ipcRenderer.send('vb:open-folder', p),
  onDownloadProgress: (cb: any) =>
    ipcRenderer.on('vb:download-progress', (_e, p) => cb(p)),
});

// ── window.render ─────────────────────────────────────────────────────────

contextBridge.exposeInMainWorld('render', {
  generateUST:   (p: any) => ipcRenderer.invoke('render:generate-ust', p),
  render:        (p: any) => ipcRenderer.invoke('render:render', p),
  detectEditors: ()       => ipcRenderer.invoke('editor:detect'),
  openInEditor:  (p: any) => ipcRenderer.invoke('editor:open', p),
  onComplete:    (cb: any) => ipcRenderer.on('render:complete', (_e, r) => cb(r)),
  onError:       (cb: any) => ipcRenderer.on('render:error', (_e, e) => cb(e)),
});

// ── window.mti — Melon Terminal Interface ─────────────────────────────────

contextBridge.exposeInMainWorld('mti', {
  // Persistent shell sessions
  spawnSession:    (id: any)            => ipcRenderer.invoke('mti:spawn-session', id),
  write:           (id: any, data: any) => ipcRenderer.invoke('mti:write', id, data),
  kill:            (id: any)            => ipcRenderer.invoke('mti:kill', id),

  // One-shot commands
  exec:            (cmd: any, cwd?: any) => ipcRenderer.invoke('mti:exec', cmd, cwd),
  python:          (script: any)        => ipcRenderer.invoke('mti:python', script),
  mlcCommands:     ()                   => ipcRenderer.invoke('mti:mlc-commands'),

  // Events from shell sessions
  onStdout:  (cb: any) => ipcRenderer.on('mti:stdout', (_e, id, data) => cb(id, data)),
  onStderr:  (cb: any) => ipcRenderer.on('mti:stderr', (_e, id, data) => cb(id, data)),
  onExit:    (cb: any) => ipcRenderer.on('mti:exit',   (_e, id, code) => cb(id, code)),
});

// ── window.melonAddons — Extension Panel System ───────────────────────────

contextBridge.exposeInMainWorld('melonAddons', {
  // Get registered panels (for AddonPanelHost)
  getPanels:             ()           => ipcRenderer.invoke('addons:get-panels'),
  // Get registered toolbar items
  getToolbarItems:       ()           => ipcRenderer.invoke('addons:get-toolbar-items'),
  // Get registered menu items
  getMenuItems:          ()           => ipcRenderer.invoke('addons:get-menu-items'),
  // Get registered commands
  getCommands:           ()           => ipcRenderer.invoke('addons:get-commands'),
  // Execute an addon-registered command
  executeCommand:        (id: any)    => ipcRenderer.invoke('addons:execute-command', id),
  // Call an addon's backend
  callBackend:           (extId: any, method: any, args: any) =>
    ipcRenderer.invoke('app:extension-call-backend', extId, method, args),
  // Events: addon loaded/unloaded
  onAddonLoaded:   (cb: any) => ipcRenderer.on('addons:loaded',   (_e, info) => cb(info)),
  onAddonUnloaded: (cb: any) => ipcRenderer.on('addons:unloaded', (_e, id) => cb(id)),
});

export {};
