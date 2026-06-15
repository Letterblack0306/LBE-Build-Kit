# Getting Started

## 1. Create or scaffold a project config

```bash
node ./ext-build.mjs init
```

## 2. Edit `ext-build.config.json`

Set:

- `identity.extensionId`
- `paths.manifest`
- `versioning.files`
- `validation.requiredFiles`
- `validation.forbiddenPatterns`
- `dev.liveMode`
- `release.outputDir`
- `release.adapters`

### Dev Mode A: `workspace-sync`

Use this when the reference model is:

`source -> sync -> CEP extensions folder -> AE`

Recommended config shape:

```json
{
  "dev": {
    "liveMode": "workspace-sync",
    "source": "src",
    "targetDir": null
  }
}
```

### Dev Mode B: `dist-live`

Use this when the model is:

`source -> build -> dist -> AE`

Recommended config shape:

```json
{
  "dev": {
    "liveMode": "dist-live",
    "buildCommand": "npm run build",
    "targetDir": null
  }
}
```

If AE reads another installed CEP folder instead of `dist` directly, set `dev.targetDir` so `ext-build sync` copies `dist` there.

## 3. Run the first phase commands

```bash
node ./ext-build.mjs init .\my-extension
node ./ext-build.mjs init .\my-extension-dist --mode dist-live
node ./ext-build.mjs dev --dry-run
node ./ext-build.mjs sync --dry-run
node ./ext-build.mjs reload --changed "src/index.html,src/CSXS/manifest.xml"
node ./ext-build.mjs doctor
node ./ext-build.mjs check
node ./ext-build.mjs verify
node ./ext-build.mjs integrity
node ./ext-build.mjs release --allow-local-release
```

## Dev Mode Rules

- HTML, CSS, JS, JSON changes usually need panel reload only.
- Manifest, JSX, and `.debug` changes should be treated as AE restart changes.
- `http://localhost:8088` is the CEP debug endpoint when `.debug` and `PlayerDebugMode` are active.
- A separate local static server is optional and configured under `dev.localServer`.

## Release Workflow

`release` stages output under `release.outputDir` and can run command-driven adapters:

```json
{
  "release": {
    "outputDir": "release-out",
    "adapters": {
      "zxp": {
        "enabled": true,
        "command": "npm run build:zxp",
        "outputPath": "artifacts/zxp"
      }
    }
  }
}
```

Local testing without external packager commands still produces staged outputs in `release-out/` so the workflow can be verified end to end before wiring real packaging tools.
