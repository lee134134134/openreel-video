import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { PluginContext } from "@openreel/plugin-sdk";
import { MacosSayTtsAdapter } from "./macos-say.adapter";
import { probeAudioDuration, run } from "../render/ffmpeg.utils";

vi.mock("../render/ffmpeg.utils", () => ({
  run: vi.fn(async (args: string[]) => {
    const out = args[args.length - 1];
    if (out) fs.writeFileSync(out, Buffer.from("wav"));
    return { code: 0, stdout: "", stderr: "" };
  }),
  probeAudioDuration: vi.fn(async () => 4.25),
}));

/** `promisify(execFile)` resolves with the callback's second argument, so the
 * mock passes `{ stdout }` (matching util.promisify.custom's shape) for the
 * `say -v ?` listing, and writes the output file for real syntheses. */
const execFileMock = vi.hoisted(() =>
  vi.fn((cmd: string, args: string[], opts: unknown, cb: (err: Error | null, value?: unknown) => void) => {
    const outIndex = args.indexOf("-o");
    if (outIndex >= 0 && args[outIndex + 1]) {
      fs.writeFileSync(args[outIndex + 1], Buffer.from("aiff-bytes"));
    }
    cb(null, { stdout: "", stderr: "" });
  }),
);

vi.mock("node:child_process", () => ({ execFile: execFileMock }));

let dir: string | undefined;

beforeEach(() => {
  execFileMock.mockClear();
  vi.mocked(run).mockClear();
});

afterEach(() => {
  delete process.env.MACOS_SAY_VOICE;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function tempDir(): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-tts-say-"));
  return dir;
}

function callArgs(index: number): string[] {
  return (execFileMock.mock.calls[index] as unknown as [string, string[]])[1];
}

describe("MacosSayTtsAdapter", () => {
  it("synthesizes with the default Tingting voice and normalizes to wav", async () => {
    const out = tempDir();
    const adapter = new MacosSayTtsAdapter();
    const result = await adapter.synthesize("你好世界", { voiceId: "" }, { dir: out, basename: "s1" }, {} as PluginContext);

    const [cmd] = execFileMock.mock.calls[0] as unknown as [string];
    const args = callArgs(0);
    expect(cmd).toBe("/usr/bin/say");
    expect(args.slice(0, 2)).toEqual(["-v", "Tingting"]);
    expect(args).toContain("你好世界");
    const aiff = args[args.indexOf("-o") + 1];
    expect(aiff).toBe(path.join(out, "s1.aiff"));
    // aiff is only an intermediate: removed once the wav exists
    expect(fs.existsSync(aiff)).toBe(false);

    const convertArgs = vi.mocked(run).mock.calls[0][0] as string[];
    expect(convertArgs).toContain("-ar");
    expect(convertArgs).toContain("48000");
    expect(result).toMatchObject({ audioPath: path.join(out, "s1.wav"), durationSec: 4.25, voiceId: "Tingting" });
    expect(fs.readFileSync(result.audioPath, "utf8")).toBe("wav");
  });

  it("prefers the requested voice and honors MACOS_SAY_VOICE as the default", async () => {
    process.env.MACOS_SAY_VOICE = "Meijia";
    const adapter = new MacosSayTtsAdapter();
    await adapter.synthesize("a", { voiceId: "Sinji" }, { dir: tempDir(), basename: "v1" }, {} as PluginContext);
    await adapter.synthesize("b", { voiceId: "" }, { dir: tempDir(), basename: "v2" }, {} as PluginContext);
    expect(callArgs(0).slice(0, 2)).toEqual(["-v", "Sinji"]);
    expect(callArgs(1).slice(0, 2)).toEqual(["-v", "Meijia"]);
  });

  it("fails clearly when say produces no audio", async () => {
    execFileMock.mockImplementationOnce((_cmd, _args, _opts, cb) => cb(null, { stdout: "", stderr: "" }));
    const adapter = new MacosSayTtsAdapter();
    await expect(
      adapter.synthesize("x", { voiceId: "" }, { dir: tempDir(), basename: "e1" }, {} as PluginContext),
    ).rejects.toThrow(/无输出/);
  });

  it("fails clearly when the wav conversion fails", async () => {
    vi.mocked(run).mockResolvedValueOnce({ code: 1, stdout: "", stderr: "no encoder" });
    const adapter = new MacosSayTtsAdapter();
    await expect(
      adapter.synthesize("x", { voiceId: "" }, { dir: tempDir(), basename: "e2" }, {} as PluginContext),
    ).rejects.toThrow(/转码失败.*no encoder/);
  });

  it("parses installed system voices and falls back to Tingting", async () => {
    execFileMock.mockImplementationOnce((_cmd, _args, _opts, cb) =>
      cb(null, {
        stdout: "Tingting            zh_CN    # 你好\nAlex                en_US    # Hello\nAlex                en_US    # dup\n",
        stderr: "",
      }),
    );
    const adapter = new MacosSayTtsAdapter();
    await expect(adapter.voices({} as PluginContext)).resolves.toEqual([
      { id: "Tingting", label: "Tingting（zh_CN）" },
      { id: "Alex", label: "Alex（en_US）" },
    ]);

    execFileMock.mockImplementationOnce((_cmd, _args, _opts, cb) => cb(new Error("say missing")));
    await expect(adapter.voices({} as PluginContext)).resolves.toEqual([
      { id: "Tingting", label: "婷婷（zh_CN 系统语音）" },
    ]);
  });
});
