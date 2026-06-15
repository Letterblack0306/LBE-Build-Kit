import fs from "node:fs";
import path from "node:path";

const requiredPaths = [
  "plan.txt",
  "package.json",
  "README.md",
  path.join("app", "ui", "index.html"),
  path.join("app", "ui", "styles.css"),
  path.join("app", "ui", "app.js"),
  path.join("core", "build", "index.mjs"),
  path.join("core", "runtime", "index.mjs"),
  path.join("core", "debug", "index.mjs"),
  path.join("adapters", "cep", "index.mjs"),
  path.join("adapters", "ae", "index.mjs"),
  path.join("browser", "cef-debug", "index.html"),
];

const missing = requiredPaths.filter((entry) => !fs.existsSync(path.resolve(entry)));

if (missing.length > 0) {
  console.error("Missing required IDE paths:");
  for (const entry of missing) {
    console.error(`- ${entry}`);
  }
  process.exitCode = 1;
} else {
  console.log("PASS structure");
  console.log("IDE scaffold matches the current plan baseline.");
}
