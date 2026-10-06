import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Renders the edit to out/v<N>/waymark.mp4, then a GIF of it under 5 MB for
 * places that cannot play video. Each render gets the next N, so earlier cuts
 * stay to compare against. Needs ffmpeg on the PATH and a capture from
 * `pnpm --filter demo record`.
 */

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
mkdirSync(here("out"), { recursive: true });
const taken = readdirSync(here("out")).map((name) => /^v(\d+)$/.exec(name)?.[1]).filter((n) => n !== undefined).map(Number);
const version = `v${Math.max(0, ...taken) + 1}`;
const dir = here(`out/${version}`);
mkdirSync(dir);
const MP4 = `${dir}/waymark.mp4`;
const GIF = `${dir}/waymark.gif`;
// Kept beside the cut, so it can be traced back to the recording it came from.
copyFileSync(here("video/public/capture.json"), `${dir}/capture.json`);
const LIMIT = 5 * 1024 * 1024;

if (!existsSync(here("video/public/capture.mp4"))) {
  console.error("No capture yet. Run pnpm --filter demo record first.");
  process.exit(1);
}

// Anything after `--` goes to Remotion, e.g. --props='{"align":"center"}'.
execFileSync("remotion", ["render", "Waymark", MP4, "--codec=h264", "--crf=16", ...process.argv.slice(2).filter((arg) => arg !== "--")], { stdio: "inherit" });

// Smaller and slower until it fits. The UI is flat colour, so no dithering: it
// only adds noise that compresses badly.
const tries = [
  { width: 800, fps: 10 },
  { width: 720, fps: 10 },
  { width: 640, fps: 10 },
  { width: 640, fps: 8 },
];
for (const { width, fps } of tries) {
  execFileSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-i", MP4, "-filter_complex",
     `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`,
     GIF],
    { stdio: "inherit" },
  );
  const size = statSync(GIF).size;
  console.log(`GIF at ${width}px, ${fps} fps: ${(size / 1024 / 1024).toFixed(2)} MB`);
  if (size <= LIMIT) break;
}
// The MP4 is the real output; an oversized GIF is worth knowing about, not failing on.
if (statSync(GIF).size > LIMIT) console.warn("The GIF is still over 5 MB. Shorten the edit or drop a size from `tries`.");
console.log(`→ ${MP4}\n→ ${GIF}`);
