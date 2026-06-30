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

export {};
