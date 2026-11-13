import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { resolveFfmpegPath } from "./ffmpeg-path";
import { isSoftwareEncoder } from "./encode-args";

const run = promisify(execFile);

export function parseEncoders(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[VAS]\S{5}\s/.test(line))
    .map((line) => line.split(/\s+/)[1])
    .filter(Boolean);
}

type Codec = "h264" | "h265" | "hevc" | "av1" | "prores" | "vp9";

const PREFERENCE: Partial<Record<Codec, Partial<Record<NodeJS.Platform | "any", string[]>>>> = {
  h264: {
    darwin: ["h264_videotoolbox"],
    win32: ["h264_nvenc", "h264_qsv", "h264_amf"],
    linux: ["h264_nvenc", "h264_vaapi"],
    any: ["libx264"],
  },
  hevc: {
    darwin: ["hevc_videotoolbox"],
    win32: ["hevc_nvenc", "hevc_qsv", "hevc_amf"],
    linux: ["hevc_nvenc", "hevc_vaapi"],
    any: ["libx265"],
  },
  av1: {
    win32: ["av1_nvenc", "av1_qsv", "av1_amf"],
    linux: ["av1_nvenc", "av1_vaapi"],
    any: ["libsvtav1"],
  },
  prores: {
    darwin: ["prores_videotoolbox", "prores_ks"],
    any: ["prores_ks"],
  },
};

export function selectEncoder(
  codec: string,
  platform: NodeJS.Platform,
  available: string[],
  mode: "fast" | "balanced" | "smallest" = "balanced",
  unusable: readonly string[] = [],
): string | null {
  const key = (codec === "h265" ? "hevc" : codec) as Codec;
  const pref = PREFERENCE[key];
  if (!pref) return null;
  const hardwareFirst = [...(pref[platform] ?? []), ...(pref.any ?? [])];
  const softwareFirst = [
    ...(pref.any ?? []),
    ...(pref[platform] ?? []),
  ];
  const ordered = mode === "smallest" ? softwareFirst : hardwareFirst;
  const usable = ordered.filter((c) => !unusable.includes(c));
  const pick = usable.find((c) => available.includes(c));
  if (pick) return pick;
  return (
    [...hardwareFirst, ...softwareFirst].find(
      (c) => available.includes(c) && !unusable.includes(c) && isSoftwareEncoder(c),
    ) ??
    [...hardwareFirst].find((c) => available.includes(c) && !unusable.includes(c)) ??
    null
  );
}

export async function probeEncoders(): Promise<string[]> {
  try {
    const { stdout } = await run(resolveFfmpegPath(), ["-hide_banner", "-encoders"], { maxBuffer: 4 * 1024 * 1024 });
    return parseEncoders(stdout);
  } catch {
    return [];
  }
}

/**
 * Full selection pipeline: pick by preference order, verify each candidate
 * with a tiny real encode, and fall back to the next preference whenever a
 * candidate cannot actually open an encoding session (some platforms list
 * hardware encoders that fail at runtime, e.g. h264_videotoolbox on Intel
 * Macs). Software encoders always verify, so the loop terminates. Returns a
 * verified encoder, or null when nothing can be selected.
 */
export async function selectVerifiedEncoder(
  codec: string,
  platform: NodeJS.Platform,
  encoders: string[],
  mode: "fast" | "balanced" | "smallest" = "balanced",
): Promise<string | null> {
  const unusable: string[] = [];
  let encoder = selectEncoder(codec, platform, encoders, mode, unusable);
  while (encoder) {
    if (await verifyEncoderWorks(encoder)) break;
    unusable.push(encoder);
    const next = selectEncoder(codec, platform, encoders, mode, unusable);
    if (!next || next === encoder) break;
    encoder = next;
  }
  return encoder;
}

/**
 * Some platforms list a hardware encoder in `-encoders` even though creating a
 * real encoding session fails at runtime (e.g. h264_videotoolbox on Intel Macs
 * where the hardware session is unavailable: exit -12903). Verify with a tiny
 * real encode so selection can fall back to a working encoder.
 */
export async function verifyEncoderWorks(encoder: string, ffmpegPath = resolveFfmpegPath()): Promise<boolean> {
  if (verified.has(encoder)) return verified.get(encoder)!;
  const ok = await new Promise<boolean>((resolve) => {
    // testsrc produces real frames; even 1 frame exercises encoder open/close.
    const args = [
      "-hide_banner",
      "-f", "lavfi", "-i", "testsrc=duration=0.2:size=160x120:rate=10",
      "-frames:v", "2",
      "-c:v", encoder,
      "-pix_fmt", "yuv420p",
      "-f", "null", "-",
    ];
    let stderrTail = "";
    const proc = spawn(ffmpegPath, args);
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2_000);
    });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => {
      if (code === 0) return resolve(true);
      console.warn(`[encoder-probe] ${encoder} failed verification (exit ${code}): ${stderrTail.slice(-300)}`);
      resolve(false);
    });
  });
  verified.set(encoder, ok);
  return ok;
}

const verified = new Map<string, boolean>();

/** Clear memoized verification results (tests). */
export function resetEncoderVerification(): void {
  verified.clear();
}
