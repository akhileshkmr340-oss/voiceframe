# VoiceFrame

A mobile-responsive, buildless photo-film editor. Static site files are in `dist/`.

## Working features

- Upload photos and add optional scene captions.
- Pan/zoom, colour grading, transitions, optional letterboxing.
- Record/upload your own narration, with an audio runtime match control.
- 720p / 1080p video export. MP4, WebM and encoder support depend on the browser.
- Frame-by-frame encoding when WebCodecs is supported; browser recording fallback otherwise.
- Save and import text/settings as project JSON; reattach media after import.

AI story writing, realistic generated footage, talking avatars, voice cloning and generated narration **are not connected**. Device speech synthesis is preview-only. No generation service credentials are embedded in the source.

## GitHub Pages

The included `.github/workflows/pages.yml` publishes `dist/` from the main branch. In repository Settings → Pages, select GitHub Actions. GitHub Free Pages hosting requires a public repository. Actual publication needs authenticated GitHub repository access. No GitHub Pages URL has been provisioned by merely preparing these files.

All assets use relative URLs, so the site supports repository subpaths. The bundled media encoder's licence is provided in `dist/mediabunny-LICENSE.txt`.

## Verify

```
node --check dist/app.js
node tests/export-fallback.test.cjs
```

If editing the encoder source, rebuild with `node_modules/.bin/esbuild src/encoder.js --bundle --minify --format=esm --outfile=dist/encoder.js` after dependency installation.

Use sharp source photos and original/licensed audio. No app can guarantee the absence of copyright claims or compatibility with every phone and social platform.
