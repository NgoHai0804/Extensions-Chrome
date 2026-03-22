/* Rasterize icons/icon.svg → PNG for Chrome toolbar (requires: npm i -D sharp) */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const root = path.join(__dirname, "..");
const svgPath = path.join(root, "icons", "icon.svg");
const outDir = path.join(root, "icons");

async function main() {
  const svg = fs.readFileSync(svgPath);
  const sizes = [16, 32, 48, 128];
  for (const size of sizes) {
    const out = path.join(outDir, `icon-${size}.png`);
    await sharp(svg).resize(size, size).png({ compressionLevel: 9 }).toFile(out);
    process.stdout.write(`OK ${out}\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
