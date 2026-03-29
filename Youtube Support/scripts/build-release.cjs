/**
 * Build `release/`: chỉ một file JS đầu ra `main.js` (router + toàn bộ mã extension).
 *
 * Copy cây (bỏ mọi .js + thư mục entry) → esbuild entry/main-entry.js → obfuscator + terser main.js → manifest.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const esbuild = require("esbuild");
const JavaScriptObfuscator = require("javascript-obfuscator");
const { minify } = require("terser");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "release");
const OBF_CONFIG_MAIN = require(path.join(ROOT, "obfuscator.main.config.js"));

const SKIP_DIRS = new Set(["node_modules", "release", ".git", "scripts", "entry"]);

const SKIP_ROOT_FILES = new Set(["package.json", "package-lock.json", "obfuscator.config.js", "manifest.json"]);

function shouldCopyFile(relPosix) {
  const base = path.basename(relPosix);
  if (SKIP_ROOT_FILES.has(base)) return false;
  if (/\.obf\.js$/i.test(base) || /\.protected\.js$/i.test(base)) return false;
  if (relPosix.endsWith(".js")) return false;
  return true;
}

function copyDir(srcRoot, dstRoot) {
  fs.mkdirSync(dstRoot, { recursive: true });
  for (const ent of fs.readdirSync(srcRoot, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const src = path.join(srcRoot, ent.name);
    const dst = path.join(dstRoot, ent.name);
    const rel = path.relative(ROOT, src).replace(/\\/g, "/");
    if (ent.isDirectory()) {
      copyDir(src, dst);
    } else if (shouldCopyFile(rel)) {
      fs.copyFileSync(src, dst);
    }
  }
}

function copyExtensionTree() {
  fs.rmSync(OUT, { recursive: true, force: true });
  copyDir(ROOT, OUT);
}

function ensureVendor() {
  const from = path.join(ROOT, "node_modules/youtube-transcript/dist/youtube-transcript.esm.js");
  if (!fs.existsSync(from)) {
    throw new Error("Thiếu node_modules/youtube-transcript — chạy npm install");
  }
  const dir = path.join(ROOT, "background/dubbing/vendor");
  const to = path.join(dir, "youtube-transcript.esm.js");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(from, to);
}

function runIconsPng() {
  const script = path.join(ROOT, "icons/generate-png.cjs");
  if (!fs.existsSync(script)) return;
  const r = spawnSync(process.execPath, [script], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) throw new Error("icons/generate-png.cjs thất bại");
}

async function minifyClassic(absPath) {
  const code = fs.readFileSync(absPath, "utf8");
  const r = await minify(code, {
    compress: true,
    mangle: true,
    format: { comments: false },
  });
  if (!r.code) throw new Error(`Terser (classic) rỗng: ${absPath}`);
  fs.writeFileSync(absPath, r.code, "utf8");
}

function obfuscateMain(absPath) {
  const code = fs.readFileSync(absPath, "utf8");
  const result = JavaScriptObfuscator.obfuscate(code, OBF_CONFIG_MAIN);
  fs.writeFileSync(absPath, result.getObfuscatedCode(), "utf8");
}

function stripReleasePrefix(value) {
  if (Array.isArray(value)) return value.map(stripReleasePrefix);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = stripReleasePrefix(v);
    return out;
  }
  if (typeof value === "string" && value.startsWith("release/")) return value.slice("release/".length);
  return value;
}

function writeReleaseManifest() {
  const raw = fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8");
  const manifest = JSON.parse(raw);
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(stripReleasePrefix(manifest), null, 2), "utf8");
}

async function bundleMain() {
  const entry = path.join(ROOT, "entry/main-entry.js");
  const outfile = path.join(OUT, "main.js");
  await esbuild.build({
    absWorkingDir: ROOT,
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    logLevel: "warning",
  });
  console.log("esbuild → main.js");
}

async function processMainJs() {
  const abs = path.join(OUT, "main.js");
  if (!fs.existsSync(abs)) throw new Error("Thiếu release/main.js");
  console.log("[main.js] obfuscator + terser");
  obfuscateMain(abs);
  await minifyClassic(abs);
}

async function main() {
  console.log("1) Vendor youtube-transcript …");
  ensureVendor();
  console.log("2) Icons PNG …");
  runIconsPng();
  console.log("3) Copy → release/ (không copy .js, không copy entry/) …");
  copyExtensionTree();

  console.log("4) esbuild gộp toàn bộ JS → main.js …");
  await bundleMain();

  console.log("5) Obfuscate / minify …");
  await processMainJs();

  writeReleaseManifest();

  console.log("\nXong — release/main.js + manifest, HTML, CSS, icons.");
  console.log("Load unpacked: thư mục release/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
