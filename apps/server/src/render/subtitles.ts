import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AssemblySubtitleSpan } from "@openreel/plugin-sdk";

const execFileAsync = promisify(execFile);

export type SubtitleFilterSupport = "drawtext" | "ass" | "none";

const cache = new Map<string, SubtitleFilterSupport>();

/**
 * Detect which text-rendering filter the configured FFmpeg build provides.
 * Homebrew/custom builds often ship without libfreetype (no drawtext) but
 * with libass; static builds may vary either way. Result is cached per binary.
 */
export async function detectSubtitleSupport(ffmpegPath: string): Promise<SubtitleFilterSupport> {
  const cached = cache.get(ffmpegPath);
  if (cached) return cached;
  let support: SubtitleFilterSupport = "none";
  try {
    const { stdout } = await execFileAsync(ffmpegPath, ["-hide_banner", "-filters"], {
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (/\bdrawtext\b/.test(stdout)) support = "drawtext";
    else if (/\bsubtitles\b/.test(stdout)) support = "ass";
  } catch {
    support = "none";
  }
  cache.set(ffmpegPath, support);
  return support;
}

/** Reset the detection cache (mainly for tests). */
export function resetSubtitleSupportCache(): void {
  cache.clear();
}

function assTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const centis = Math.round((clamped - Math.floor(clamped)) * 100);
  const pad = (value: number, size = 2): string => String(value).padStart(size, "0");
  return `${hours}:${pad(minutes)}:${pad(secs)}.${pad(centis)}`;
}

/** Escape ASS dialogue text: replace newlines with \N and strip braces. */
function assText(text: string): string {
  return text.replace(/\r?\n/g, "\\N").replace(/[{}]/g, "");
}

/**
 * Build an ASS subtitle file mirroring the drawtext look: bottom-centered
 * white text over a translucent dark box. PlayRes matches the video size so
 * font sizing matches the drawtext path.
 */
export function buildSubtitleAss(
  spans: AssemblySubtitleSpan[],
  width: number,
  height: number,
  font: string,
): string {
  const size = Math.max(18, Math.round(Math.min(width, height) * 0.045));
  const marginV = Math.max(24, Math.round(height * 0.06));
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 2",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${font},${size},&H00FFFFFF,&H00FFFFFF,&HA6000000,&HA6000000,0,0,0,0,100,100,0,0,3,2,0,2,10,10,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");
  const dialogues = spans.map((span) =>
    `Dialogue: 0,${assTime(span.startSec)},${assTime(span.endSec)},Default,,0,0,0,,${assText(span.text)}`,
  );
  return [header, ...dialogues, ""].join("\n");
}

/** Escape a file path for use inside `subtitles=filename=...` in a filtergraph. */
export function escapeFilterPath(filePath: string): string {
  return filePath
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}
