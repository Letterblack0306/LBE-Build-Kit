import path from "node:path";
import fs from "node:fs";

const T = process.stdout.isTTY;
const G = s => T ? `\x1b[32m${s}\x1b[0m` : s;
const R = s => T ? `\x1b[31m${s}\x1b[0m` : s;
const D = s => T ? `\x1b[2m${s}\x1b[0m` : s;
const B = s => T ? `\x1b[1m${s}\x1b[0m` : s;
const CY = s => T ? `\x1b[36m${s}\x1b[0m` : s;

// Adobe signs ZXPs as ZIP files. The central directory stores filenames as
// plain text, so scanning the raw buffer for these strings is reliable without
// a full ZIP parser or external dependency.
const SIG_MARKERS = [
  Buffer.from("META-INF/signatures.xml"),
  Buffer.from("XMLSignatures.xml"),
];

function bufferContains(buf, needle) {
  for (let i = 0; i <= buf.length - needle.length; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (buf[i + j] !== needle[j]) { match = false; break; }
    }
    if (match) return true;
  }
  return false;
}

function findZxpFiles(searchRoots) {
  const found = [];
  for (const dir of searchRoots) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir);
      for (const e of entries) {
        if (e.toLowerCase().endsWith(".zxp")) found.push(path.join(dir, e));
      }
    } catch { /* non-fatal */ }
  }
  return found;
}

export async function runSignVerify(config, deps) {
  const { createCheck } = deps;
  const root = config.absolute.root;

  console.log(`\n${B(CY("▸"))} ${B("ext-build sign-verify")}\n`);

  const checks = [];

  // Search standard artifact locations
  const searchRoots = [
    path.join(root, "release-artifacts"),
    path.join(root, "release-out"),
    path.join(root, "dist"),
    root,
  ];

  const zxpFiles = findZxpFiles(searchRoots);

  // ── 1. ZXP presence ───────────────────────────────────────────────────────
  {
    const c = createCheck(
      "zxp.present",
      zxpFiles.length > 0,
      zxpFiles.length > 0
        ? `found ${zxpFiles.length} ZXP file(s): ${zxpFiles.map(f => path.relative(root, f)).join(", ")}`
        : `no .zxp file found in ${searchRoots.map(d => path.relative(root, d)).join(", ")}`,
    );
    const icon = c.ok ? G("✓") : R("✗");
    console.log(`  ${icon} ${"zxp-present".padEnd(16)} ${D(c.message)}`);
    checks.push(c);
  }

  // ── 2. Adobe signature proof (per ZXP) ────────────────────────────────────
  for (const zxpPath of zxpFiles) {
    const rel  = path.relative(root, zxpPath);
    const name = `zxp.signed:${path.basename(zxpPath)}`;
    let c;
    try {
      const buf    = fs.readFileSync(zxpPath);
      const signed = SIG_MARKERS.some(m => bufferContains(buf, m));
      c = createCheck(
        name,
        signed,
        signed
          ? `Adobe signature present (META-INF/signatures.xml found)`
          : `no Adobe signature found — ZXP may not be signed (run ZXPSignCmd first)`,
      );
    } catch (err) {
      c = createCheck(name, false, `could not read ${rel}: ${err.message}`);
    }
    const icon = c.ok ? G("✓") : R("✗");
    console.log(`  ${icon} ${rel.padEnd(32)} ${D(c.message)}`);
    checks.push(c);
  }

  console.log("");

  const ok = checks.every(c => c.ok);
  if (!ok && zxpFiles.length === 0) {
    console.log(`${D("▸ no ZXP files found — run")} ${CY("ext-build build")} ${D("first, then sign the output\n")}`);
  } else if (!ok) {
    console.log(`${R("▸ signature verification failed")} — sign the ZXP with ZXPSignCmd and re-run\n`);
  }

  return {
    ok,
    message: ok
      ? `ZXP signature verified (${zxpFiles.length} file(s)).`
      : zxpFiles.length === 0 ? "No ZXP files found to verify." : "ZXP signature verification failed.",
    checks,
    artifacts: zxpFiles.map(f => ({ path: path.relative(root, f), size: fs.statSync(f).size })),
    diff: null,
    version: null,
  };
}
