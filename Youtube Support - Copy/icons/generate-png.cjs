/** Xuất icon.svg → icon-{16,32,48,128}.png (cần: npm i -D sharp). */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const here = __dirname;
const svgPath = path.join(here, "icon.svg");

async function main() {
  const svg = fs.readFileSync(svgPath);
  const sizes = [16, 32, 48, 128];
  for (const size of sizes) {
    const out = path.join(here, `icon-${size}.png`);
    await sharp(svg).resize(size, size).png({ compressionLevel: 9 }).toFile(out);
    process.stdout.write(`OK ${out}\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
