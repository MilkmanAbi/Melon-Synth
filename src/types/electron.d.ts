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
      detectLanguage(text: string):              Promise<{ lang:string; confidence:number }>;
      suggestSingability(p: {
        text:string; moduleId?:string; lang?:string;
      }):                                        Promise<{ suggested:number; reason:string }>;
      cacheStats():                              Promise<object>;
      clearCache(target:'g2p'|'phrase'|'all'):   Promise<{ cleared:string }>;
    };
    app: {
      saveUIState(data: Partial<UIState>):        void;
      getUIState():                               Promise<UIState>;
      onUIState(cb:(state:UIState)=>void):        void;
      getAddonsDir():                             Promise<string>;
      installAddonDialog():                       Promise<{ok:boolean; path?:string; result?:string; error?:string; canceled?:boolean}>;
      installAddon(filePath:string):              Promise<{ok:boolean; path?:string; result?:string; error?:string}>;
      uninstallAddon(addonId:string):             Promise<{ok:boolean; removed?:string; error?:string}>;
      openProject():                              Promise<string|null>;
      saveProject(name?:string):                  Promise<string|null>;
      exportWAV(name?:string):                    Promise<string|null>;
      openPath(p:string):                         void;
      openURL(url:string):                        void;
      getSystemDark():                            Promise<boolean>;
      onSystemDarkChanged(cb:(dark:boolean)=>void): void;
    };
  }
}
