# LBE Build Kit

Public reusable build framework for Adobe CEP and hybrid extensions.

Current implementation focus:

- config-driven validation
- environment diagnostics
- version consistency checks
- manifest identity checks
- build output verification
- artifact diff reporting
- release integrity and tag checks
- checksum inventory generation
- CEP dev sync/debug workflow
- active dev adapter verification
- local release staging and adapter orchestration

## Live Dev Modes

`ext-build` now supports two CEP live-development models:

- `workspace-sync`: source/workspace files are synced into the CEP extensions folder AE reads.
- `dist-live`: source is built into `dist`, and AE reads `dist` directly or a synced copy of `dist`.

## Quick Start

```bash
npm run dev
npm run watch
npm run sync
npm run reload
npm run debug
npm run dev-verify
npm run doctor
npm run check
npm run verify
npm run integrity
npm run release
```

For `dist-live`, set `dev.liveMode` to `"dist-live"`. If AE is pointed directly at `dist`, leave `dev.targetDir` as `null`. If AE reads another installed CEP folder, set `dev.targetDir` and `sync` will copy `dist` there.

Template scaffold:

```bash
node ./ext-build.mjs init .\my-extension
node ./ext-build.mjs init .\my-extension-dist --mode dist-live
```

Each run writes structured output into `.build-report/`.

`release` now performs a real local workflow:

- runs doctor/check/verify/integrity
- stages a release bundle under `release.outputDir`
- writes `checksums.sha256`, `release-manifest.json`, and `release-notes.txt`
- stages an unsigned local `.zxp` for workflow testing when no external ZXP packager is configured
- stages Inno Setup and DMG packaging plans when no external packager command is configured
- runs configured adapters for `zxp`, `inno`, `electron-dmg`, and optional `github-release`
