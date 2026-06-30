# Melon Synth on the web

Melon Synth started as an Electron app: the React UI talked to a Node/Electron
main process for file access, voicebank management, and synthesis (it shelled
out to OpenUTAU). That made it desktop-only. This build runs the exact same UI
fully in the browser, with no Electron and no server, so it can be hosted on
GitHub Pages and opened by a kid on a Chromebook.

Nothing about the UI was rewritten. The renderer always spoke to the desktop
side through a set of `window.*` bridges, and it already branched on
`isElectron = !!window.app`. The web port supplies those same bridges in the
browser, backed by Substrate, so every path that used to need Electron now
lights up against an in-page backend instead.

## What runs where now

- Files and projects: a virtual filesystem persisted in IndexedDB (Substrate).
  Projects are saved as `.loid` v2 ZIP archives in the VFS and also offered as a
  download. They survive refreshes and revisits with no server.
- Voicebanks: UTAU banks (WAV + oto.ini + character.txt) are installed by
  uploading a `.zip` or by cloning a GitHub repo. They are unpacked into the VFS
  and persist. `oto.ini` and `character.txt` are parsed in the browser.
- Synthesis: a small concatenative resampler runs in the page. It reads the
  selected bank's samples and oto.ini, maps each note's phoneme to a sample,
  pitch-shifts and time-stretches it, crossfades neighbours, and mixes one WAV.
  It is not OpenUTAU-quality, but it sings with the real voicebank, in-browser.
- Phonemes (g2p): a rule-based phonemizer (Japanese kana morae, basic Latin to
  CV). The Python MLC engine is not bundled. Pyodide can be dropped in later
  behind the same `window.mlc` shape if native-accuracy g2p is wanted.
- Terminal (MTI): a small shell over the VFS (`ls`, `cat`, `vb`, etc). `python`
  reports that it is desktop-only.
- Window controls, external editors, OS folder opening: no-ops on web.

## Where the new code lives

- `src/platform/substrate-host.ts` - boots Substrate and installs all the
  `window.*` bridges. This is the switch that turns the web build into the full
  app. Called once from `src/main.tsx` before React mounts.
- `src/platform/voicebank-store.ts` - install/scan/load UTAU banks over the VFS,
  plus the `oto.ini` and `character.txt` parsers.
- `src/platform/utau-render.ts` - the in-browser synth (pure Float32 DSP, no Web
  Audio dependency for rendering, so it is deterministic and testable).
- `src/platform/phonemizer.ts` - the browser g2p behind `window.mlc`.
- `src/platform/zip.ts` - ZIP read/write using the platform CompressionStream.
- `src/vendor/substrate/` - the Substrate browser kernel (VFS, git-over-CDN,
  caches). Vendored so the app has no runtime dependency on an external package.

## Run it

    npm install
    npm run dev        # local dev server
    npm run build      # static site into dist/
    npm run preview    # serve the built dist/ locally

## Deploy to GitHub Pages

1. Push to `main`.
2. Repo Settings -> Pages -> Source -> "GitHub Actions".
3. The workflow in `.github/workflows/deploy.yml` builds `dist/` and publishes
   it. It also copies `index.html` to `404.html` as an SPA fallback.

The Vite `base` is set to `./` (relative), so the build works on a project path
(`https://<user>.github.io/Melon-Synth/`) today and on a custom domain root
later with no rebuild. All runtime asset lookups go through
`import.meta.env.BASE_URL`.

## Voicebanks in the browser - notes

- Best path: host a bank in a GitHub repo and install it by repo, or upload the
  bank `.zip` directly. Both are unpacked into the VFS and persist.
- Direct downloads from third-party voicebank sites usually fail in the browser
  because those hosts do not send CORS headers. That is a property of those
  hosts, not of this app. Upload the `.zip` or mirror the bank on GitHub.
- The bundled `public/voicebank-catalog.json` still lists banks; entries with a
  GitHub mirror install cleanly, direct-only entries will hit the CORS limit
  above.

## A couple of things to do before you push

- The vendored Substrate carried a short GPL-2.0 notice. Melon Synth is GPL-3.0.
  You own both projects, so relicense the vendored copy to be GPL-3-compatible
  (GPL-2.0-or-later or GPL-3.0) to keep the combined license clean.
- The desktop/Electron code (`electron-src/`, `mlc/`) is left in place and still
  works for a desktop build. The web build simply never touches it.
