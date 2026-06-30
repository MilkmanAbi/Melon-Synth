/**
 * TypeScript declarations for the Electron-exposed APIs.
 * These mirror exactly what preload.ts exposes via contextBridge.
 * Import these types in any React component that calls window.mlc / window.app.
 */

export interface SynthToken {
  phoneme:        string;
  display:        string;
  duration_hint:  number;
  is_vowel:       boolean;
  stressed:       boolean;
  word_index:     number;
  syllable_index: number;
  mlc_confidence: number;
  g2p_source:     string;
  source_phoneme: string;
  source_word:    string;
  note:           string;
  phon_class:     string;
}

export interface ConversionResult {
  tokens:           SynthToken[];
  words:            string[];
  word_boundaries:  [number, number][];
  language:         string;
  module_id:        string;
  singability:      number;
  confidence_score: number;
  warnings:         string[];
  processing_ms:    number;
  from_cache:       boolean;
  token_count:      number;
}

export interface ModuleInfo {
  id:           string;
  name:         string;
  description:  string;
  author:       string;
  version:      string;
  language:     string;
  languages:    string[];
  phoneme_set:  string;
  target_banks: string[];
  from_bundle:  boolean;
  source:       string;
}

export interface AddonInfo extends ModuleInfo {
  addon_type: 'voicebank_mapper' | 'language_pack' | 'pipeline_plugin';
}

export interface UIState {
  windowBounds?:     { x:number; y:number; width:number; height:number };
  voicePanelWidth?:  number;
  pitchPanelHeight?: number;
  isDark?:           boolean;
  lastProjectPath?:  string;
}

declare global {
  interface Window {
    mlc: {
      ping():                                    Promise<{ status:string; version:string; modules:number }>;
      convert(p: {
        text:string; moduleId?:string; singability?:number; lang?:string;
      }):                                        Promise<ConversionResult>;
      preview(p: {
        text:string; moduleId?:string; singability?:number;
      }):                                        Promise<ConversionResult>;
      listModules():                             Promise<ModuleInfo[]>;
      listAllAddons():                           Promise<AddonInfo[]>;
      listAddonsFull(p?: any):                   Promise<any>;
      detectLanguage(text: string):              Promise<{ lang:string; confidence:number }>;
      suggestSingability(p: {
        text:string; moduleId?:string; lang?:string;
      }):                                        Promise<{ suggested:number; reason:string }>;
      cacheStats():                              Promise<object>;
      clearCache(target:'g2p'|'phrase'|'all'):   Promise<{ cleared:string }>;
      installAddon(p: any):                      Promise<any>;
      removeAddon(p: any):                       Promise<any>;
      checkUpdates(p?: any):                     Promise<any>;
      applyUpdate(p: any):                       Promise<any>;
      getAddonInfo(p: any):                      Promise<any>;
      getPipelineTrace(p: any):                  Promise<any>;
    };
    app: {
      saveUIState(data: Partial<UIState>):        void;
      getUIState():                               Promise<UIState>;
      onUIState(cb:(state:UIState)=>void):        void;
      getAddonsDir():                             Promise<string>;
      installAddonDialog():                       Promise<{ok:boolean; name?:string; version?:string; path?:string; error?:string; canceled?:boolean}>;
      installAddon(filePath:string):              Promise<{ok:boolean; name?:string; version?:string; error?:string}>;
      uninstallAddon(addonId:string):             Promise<{ok:boolean; removed?:string; error?:string}>;
      installExtension(p: any):                   Promise<{ok:boolean; name?:string; error?:string}>;
      removeExtension(id:string):                 Promise<{ok:boolean; error?:string}>;
      listExtensions():                           Promise<any[]>;
      openExtensionUI(id:string):                 Promise<{ok:boolean; error?:string}>;
      checkExtensionUpdates():                    Promise<any[]>;
      readMelonManifest(path:string):             Promise<any>;
      openProject():                              Promise<string|null>;
      saveProject(name?:string):                  Promise<string|null>;
      exportWAV(name?:string):                    Promise<string|null>;
      openPath(p:string):                         void;
      openURL(url:string):                        void;
      writeFile(path:string, content:string):     Promise<{ok:boolean; error?:string}>;
      readFile(path:string):                      Promise<string>;
      fileExists(path:string):                    Promise<boolean>;
      saveProjectZip(path:string, files:Record<string,string>): Promise<{ok:boolean; error?:string}>;
      readProjectZip(path:string):                Promise<Record<string,string> | null>;
      getSystemDark():                            Promise<boolean>;
      onSystemDarkChanged(cb:(dark:boolean)=>void): void;
      getPlatform():                              string;
    };
    mti: {
      spawnSession(id:string):                    Promise<{ok:boolean; reused?:boolean; error?:string}>;
      write(id:string, data:string):              Promise<{ok:boolean; error?:string}>;
      kill(id:string):                            Promise<{ok:boolean}>;
      exec(cmd:string, cwd?:string):              Promise<{ok:boolean; stdout:string; stderr:string; code:number}>;
      python(script:string):                      Promise<{ok:boolean; stdout:string; stderr:string; code:number}>;
      mlcCommands():                              Promise<string[]>;
      onStdout(cb:(id:string, data:string)=>void): void;
      onStderr(cb:(id:string, data:string)=>void): void;
      onExit(cb:(id:string, code:number)=>void):   void;
    };
    melonAddons: {
      getPanels():                                Promise<any[]>;
      getToolbarItems():                          Promise<any[]>;
      getMenuItems():                             Promise<any[]>;
      getCommands():                              Promise<any[]>;
      executeCommand(id:string):                  Promise<any>;
      callBackend(extId:string, method:string, args:any): Promise<{ok:boolean; data?:any; error?:string}>;
      onAddonLoaded(cb:(info:any)=>void):         void;
      onAddonUnloaded(cb:(id:string)=>void):      void;
    };
    render: {
      generateUST(p: any):                        Promise<any>;
      render(p: any):                             Promise<{ok:boolean; wav_path?:string; duration_ms?:number; error?:string}>;
      detectEditors():                            Promise<any>;
      openInEditor(p: any):                       Promise<any>;
      onComplete(cb:(result:any)=>void):          void;
      onError(cb:(err:any)=>void):                void;
    };
    voicebanks: {
      list():                                     Promise<any[]>;
      detectSystem():                             Promise<any>;
      download(p: any):                           Promise<any>;
      installFromZip(p: any):                     Promise<any>;
      openFolder(p: any):                         void;
      onDownloadProgress(cb:(p:any)=>void):       void;
    };
    electron: {
      minimize():    void;
      maximize():    void;
      close():       void;
      isMaximized(): Promise<boolean>;
      platform:      string;
    };
  }
}
