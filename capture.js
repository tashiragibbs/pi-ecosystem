// Capture 4 beat frames from pie-scenario.html and stitch into an MP4
// with crossfades between beats. Requires ffmpeg on PATH.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer");

const WIDTH = 1280;
const HEIGHT = 820;
const HOLD_SEC = 1.6;     // each beat held this long
const FADE_SEC = 0.25;    // crossfade duration between beats
const SETTLE_MS = 350;    // wait after setFrame before screenshot
const NUM_BEATS = 4;

const HTML_PATH = path.resolve(__dirname, "pie-scenario.html");
const FRAMES_DIR = path.resolve(__dirname, "frames");
const OUT_MP4 = path.resolve(__dirname, "pie-scenario.mp4");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function captureFrames() {
  if (!fs.existsSync(FRAMES_DIR)) fs.mkdirSync(FRAMES_DIR);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });
  await page.goto("file://" + HTML_PATH, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.body.classList.add("capture"));

  const files = [];
  for (let i = 0; i < NUM_BEATS; i++) {
    await page.evaluate((idx) => window.setFrame(idx), i);
    await sleep(SETTLE_MS);
    const file = path.join(FRAMES_DIR, `frame-${i}.png`);
    await page.screenshot({ path: file, type: "png", clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
    files.push(file);
    console.log("captured", file);
  }
  await browser.close();
  return files;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: "inherit" });
    p.on("error", reject);
    p.on("close", code => code === 0 ? resolve() : reject(new Error("ffmpeg exited " + code)));
  });
}

async function stitch(files) {
  // Build a 4-beat loop with crossfades between each beat AND from beat 4 back to beat 1
  // so the MP4 loops seamlessly in players that loop on end.
  //
  // Timeline (per beat: HOLD then fade into next):
  //   beat 1: 0.00 -> 1.60  (then 0.25 fade)
  //   beat 2: 1.85 -> 3.45  (then 0.25 fade)
  //   beat 3: 3.70 -> 5.30  (then 0.25 fade)
  //   beat 4: 5.55 -> 7.15  (then 0.25 fade back to beat 1)
  //   loop tail: total ~7.40s

  const inputs = [];
  files.forEach(f => {
    inputs.push("-loop", "1", "-t", String(HOLD_SEC + FADE_SEC), "-i", f);
  });
  // Add beat 1 again at the end for the loop-back crossfade
  inputs.push("-loop", "1", "-t", String(FADE_SEC), "-i", files[0]);

  const offsets = [];
  for (let i = 0; i < NUM_BEATS; i++) {
    offsets.push(HOLD_SEC + i * (HOLD_SEC + FADE_SEC));
  }

  const filterParts = [];
  let prev = "[0:v]";
  for (let i = 1; i <= NUM_BEATS; i++) {
    const label = (i === NUM_BEATS) ? "[vout]" : `[v${i}]`;
    filterParts.push(
      `${prev}[${i}:v]xfade=transition=fade:duration=${FADE_SEC}:offset=${offsets[i - 1].toFixed(3)}${label}`
    );
    prev = label;
  }
  const filterComplex = filterParts.join(";");

  const args = [
    "-y",
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "slow",
    "-crf", "18",
    "-movflags", "+faststart",
    "-r", "30",
    OUT_MP4
  ];

  console.log("running ffmpeg...");
  await runFfmpeg(args);
  console.log("wrote", OUT_MP4);
}

async function main() {
  const files = await captureFrames();
  await stitch(files);
}

main().catch(err => { console.error(err); process.exit(1); });
