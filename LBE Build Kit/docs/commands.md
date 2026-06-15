# Commands

# Dev Commands

## `ext-build dev`

Prepares the fast CEP development loop:

- doctor checks
- resolve live source based on `dev.liveMode`
- sync workspace or dist into CEP target
- write `.debug`
- enable `PlayerDebugMode`
- optional browser/devtools URL
- optional local static server

Modes:

- `workspace-sync`: live source is `dev.source`
- `dist-live`: live source is `paths.dist`; optional `dev.buildCommand` runs first

## `ext-build watch`

Runs the dev setup, then watches source changes and reports whether each change needs:

- panel reload
- After Effects restart

Use `--once` for a single planning cycle.

In `dist-live`, `watch` observes source changes, runs `dev.buildCommand` if configured, then reevaluates reload rules against the rebuilt live output model.

## `ext-build sync`

Copies the resolved live source into the CEP target folder. Use `--dry-run` to preview.

- `workspace-sync`: source -> CEP target
- `dist-live`: dist -> CEP target, or no-op if AE reads `dist` directly

## `ext-build reload --changed <file1,file2>`

Classifies changed files into:

- `panel-reload`
- `ae-restart`
- `no-reload`

In `dist-live`, messages explicitly remind you to rebuild `dist` before reload/restart.

## `ext-build debug`

Writes the CEP `.debug` file, enables `PlayerDebugMode`, and reports the browser debug URL.

## `ext-build dev-verify`

Validates the currently active live dev adapter without running the full release pipeline.

- runs `doctor`
- runs source `check`
- validates the active live root for the selected `dev.liveMode`
- checks required and forbidden files in the live adapter
- validates the live manifest identity
- in `dist-live`, can run `dev.buildCommand` first and then validate dist version carriers

## Build Commands

## `ext-build doctor`

Checks Node version, required config paths, required env vars, and required tools.

## `ext-build check`

Runs source-level gates:

- config path checks
- version consistency
- manifest identity validation

## `ext-build verify`

Runs build-output gates against `paths.dist`:

- required files present
- forbidden files absent
- version consistency
- manifest identity
- bundle structure
- artifact version carriers
- checksum inventory

## `ext-build integrity`

Runs release-oriented checks:

- source version carriers
- git tag format and presence rules
- required release artifacts
- bundle structure
- artifact version carriers

## `ext-build diff --against <path>`

Compares the current `dist` directory against another artifact directory.

## `ext-build init [target-dir]`

Scaffolds a baseline config and sample manifest/version files.

Options:

- `--mode workspace-sync`
- `--mode dist-live`

## `ext-build simulate`

Runs `doctor`, `check`, and `verify` in sequence.

## `ext-build release`

Runs the full release workflow:

- `doctor`
- `check`
- `verify`
- `integrity`
- stage a release bundle under `release.outputDir`
- write `checksums.sha256`, `release-manifest.json`, and `release-notes.txt`
- stage adapter outputs under `release-out/adapters`
- run configured release adapters

Without external packager commands configured, local workflow testing still produces:

- an unsigned `.zxp` archive
- an Inno Setup script and helper launcher
- a DMG spec file

For local testing use:

- `ext-build release --allow-local-release`
