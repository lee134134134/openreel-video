import { afterEach, describe, it, expect, vi } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  parseEncoders,
  selectEncoder,
  probeEncoders,
  selectVerifiedEncoder,
  verifyEncoderWorks,
  resetEncoderVerification,
} from "../src/main/sidecar/encoder-probe";
import {
  resolveFfmpegPath,
} from "../src/main/sidecar/ffmpeg-path";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

// In vitest, __dirname inside ffmpeg-path.ts resolves to the test directory,
// so pin the binary path relative to the repo layout like export-integration
// does (resources/bin is gitignored; fetch it with `pnpm fetch:ffmpeg`).
vi.mock("../src/main/sidecar/ffmpeg-path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/main/sidecar/ffmpeg-path")>();
  const bin = path.resolve(
    __dirname,
    "../resources/bin",
    actual.ffmpegRelativePath(process.platform, process.arch),
  );
  return { ...actual, resolveFfmpegPath: () => bin };
});

const SAMPLE = `
 V....D h264_videotoolbox    VideoToolbox H.264 Encoder
 V....D hevc_videotoolbox    VideoToolbox HEVC Encoder
 V....D libx264              libx264 H.264
 V....D prores_videotoolbox  Apple ProRes
`;

describe("encoder probe", () => {
  it("parses encoder names from ffmpeg -encoders output", () => {
    const names = parseEncoders(SAMPLE);
    expect(names).toContain("h264_videotoolbox");
    expect(names).toContain("libx264");
  });

  it("selects videotoolbox h264 on darwin when present", () => {
    const names = parseEncoders(SAMPLE);
    expect(selectEncoder("h264", "darwin", names)).toBe("h264_videotoolbox");
  });

  it("falls back to libx264 when no hw encoder present", () => {
    expect(selectEncoder("h264", "linux", ["libx264"])).toBe("libx264");
  });

  it("selects prores_videotoolbox for prores on darwin", () => {
    const names = parseEncoders(SAMPLE);
    expect(selectEncoder("prores", "darwin", names)).toBe("prores_videotoolbox");
  });

  it("skips encoders marked unusable", () => {
    const names = parseEncoders(SAMPLE);
    // e.g. h264_videotoolbox is listed but failed session verification.
    expect(
      selectEncoder("h264", "darwin", names, "balanced", ["h264_videotoolbox"]),
    ).toBe("libx264");
  });

  it("returns null when every candidate is unusable", () => {
    expect(
      selectEncoder("h264", "darwin", ["libx264"], "balanced", ["libx264"]),
    ).toBeNull();
  });
});

describe("selectEncoder mode-awareness", () => {
  const hw = ["h264_videotoolbox", "hevc_videotoolbox", "libx264", "libx265", "libsvtav1"];

  it("prefers hardware for fast/balanced", () => {
    expect(selectEncoder("h265", "darwin", hw, "balanced")).toBe("hevc_videotoolbox");
    expect(selectEncoder("h264", "darwin", hw, "fast")).toBe("h264_videotoolbox");
  });

  it("forces software for smallest", () => {
    expect(selectEncoder("h265", "darwin", hw, "smallest")).toBe("libx265");
    expect(selectEncoder("av1", "darwin", hw, "smallest")).toBe("libsvtav1");
  });

  it("falls back to software when hardware is missing", () => {
    const swOnly = ["libx264", "libx265", "libsvtav1"];
    expect(selectEncoder("h265", "darwin", swOnly, "balanced")).toBe("libx265");
  });
});

// Real-machine tests: exercise the actual ffmpeg binary shipped in
// resources/bin. Skipped automatically when the binary has not been fetched
// yet (`pnpm fetch:ffmpeg`).
const ffmpegBin = resolveFfmpegPath();
const realFfmpeg = existsSync(ffmpegBin) ? describe : describe.skip;

realFfmpeg("verifyEncoderWorks (real ffmpeg)", () => {
  afterEach(() => {
    resetEncoderVerification();
    vi.restoreAllMocks();
  });

  it("passes a real libx264 encode", async () => {
    expect(await verifyEncoderWorks("libx264", ffmpegBin)).toBe(true);
  });

  it("fails an unknown encoder and logs the failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await verifyEncoderWorks("definitely_not_an_encoder", ffmpegBin)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("definitely_not_an_encoder"));
  });

  it("memoizes verification per encoder until reset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bogus = "definitely_not_an_encoder_memo";

    await verifyEncoderWorks(bogus, ffmpegBin);
    expect(warn).toHaveBeenCalledTimes(1);

    // Second call hits the memo: no new ffmpeg run, no new warning.
    await verifyEncoderWorks(bogus, ffmpegBin);
    expect(warn).toHaveBeenCalledTimes(1);

    resetEncoderVerification();
    await verifyEncoderWorks(bogus, ffmpegBin);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("selectVerifiedEncoder always lands on a working encoder", async () => {
    const encoders = await probeEncoders();
    expect(encoders.length).toBeGreaterThan(0);

    // Mirrors startExport's production path: hardware encoders can be listed
    // but fail to open a session (Intel Macs: h264_videotoolbox -12903), so
    // the pipeline must end on an encoder that actually encodes.
    const encoder = await selectVerifiedEncoder("h264", process.platform, encoders, "balanced");
    expect(encoder).toBeTruthy();
    expect(await verifyEncoderWorks(encoder!, ffmpegBin)).toBe(true);
  });
});
