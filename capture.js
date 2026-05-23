// Capture 4 beat frames from pie-scenario.html and stitch into pie-scenario.gif
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const GIFEncoder = require("gifencoder");
const { PNG } = require("pngjs");

const WIDTH = 1280;
const HEIGHT = 820;
const FRAME_DELAY_MS = 800;
const SETTLE_MS = 300;
const NUM_BEATS = 4;

const HTML_PATH = path.resolve(__dirname, "pie-scenario.html");
const OUT_GIF = path.resolve(__dirname, "pie-scenario.gif");
const FRAMES_DIR = path.resolve(__dirname, "frames");

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  if (!fs.existsSync(FRAMES_DIR)) fs.mkdirSync(FRAMES_DIR);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  await page.goto("file://" + HTML_PATH, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.body.classList.add("capture"));

  const framePaths = [];
  for (let i = 0; i < NUM_BEATS; i++) {
    await page.evaluate((idx) => window.setFrame(idx), i);
    await sleep(SETTLE_MS);
    const file = path.join(FRAMES_DIR, `frame-${i}.png`);
    await page.screenshot({ path: file, type: "png", clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
    framePaths.push(file);
    console.log("captured", file);
  }

  await browser.close();

  // Stitch into GIF
  const encoder = new GIFEncoder(WIDTH, HEIGHT);
  const stream = encoder.createReadStream().pipe(fs.createWriteStream(OUT_GIF));

  encoder.start();
  encoder.setRepeat(0);
  encoder.setDelay(FRAME_DELAY_MS);
  encoder.setQuality(10);

  for (const file of framePaths) {
    const png = PNG.sync.read(fs.readFileSync(file));
    encoder.addFrame(png.data);
  }

  encoder.finish();

  await new Promise(resolve => stream.on("finish", resolve));
  console.log("wrote", OUT_GIF);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
