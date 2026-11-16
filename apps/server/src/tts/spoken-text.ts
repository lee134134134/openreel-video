/**
 * Light, deterministic normalization that turns LLM-written narration into a
 * natural spoken script before TTS synthesis. No LLM involved — this is a
 * free, always-available pass; the heavier copywriting guidance lives in the
 * plan prompts (videogen/proposal.service.ts).
 *
 * Design constraints:
 * - deterministic and idempotent (applying twice === once),
 * - never rewrites wording, only strips noise and adjusts punctuation,
 * - safe on empty/whitespace input (returns "").
 */

const SENTENCE_END = /[。！？!?…]/;
const CONNECTIVES = ["不过", "但是", "可是", "然后", "所以", "而且", "因为", "接着", "另外", "最后", "其实", "更妙的是"];

export function toSpokenNarration(input: string): string {
  let text = String(input ?? "");
  if (!text.trim()) return "";
  text = stripMarkdown(text);
  text = stripUrls(text);
  text = stripAnnotationParentheticals(text);
  text = stripWrappingQuotes(text);
  text = collapseWhitespace(text);
  text = polishSentences(text);
  return text.trim();
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/g, "");
}

/** Remove （…）/ (…) only when they read as annotations, not as real speech. */
function stripAnnotationParentheticals(text: string): string {
  return text
    .replace(/（([^（）]{1,30})）/g, (match, inner: string) => (SENTENCE_END.test(inner) ? match : ""))
    .replace(/\(([^()]{1,30})\)/g, (match, inner: string) => (SENTENCE_END.test(inner) ? match : ""));
}

function stripWrappingQuotes(text: string): string {
  return text
    .replace(/^[\s「『"“‘']*/, "")
    .replace(/[\s」』"”‘']*$/, "");
}

function collapseWhitespace(text: string): string {
  const joined = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("，");
  return joined
    .replace(/，，+/g, "，")
    .replace(/。，+/g, "。")
    .replace(/，。/g, "。")
    .replace(/[ \t]+/g, " ");
}

function polishSentences(text: string): string {
  const ensured = ensureTerminalPunctuation(text);
  return splitLongSentences(ensured);
}

function ensureTerminalPunctuation(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (SENTENCE_END.test(trimmed.slice(-1))) return trimmed;
  return `${trimmed}。`;
}

/** Break sentences that are too long for natural TTS breathing. */
function splitLongSentences(text: string): string {
  const parts = text.split(/(?<=[。！？!?…])/);
  const out: string[] = [];
  for (const part of parts) {
    const sentence = part.trim();
    if (!sentence) continue;
    if (sentence.length <= 55 || /[，,、：:；;]/.test(sentence)) {
      out.push(sentence);
      continue;
    }
    out.push(insertPauseNearMiddle(sentence));
  }
  return out.join("");
}

function insertPauseNearMiddle(sentence: string): string {
  const middle = Math.floor(sentence.length / 2);
  const window = sentence.slice(Math.max(1, middle - 18), Math.min(sentence.length - 1, middle + 18));
  for (const connective of CONNECTIVES) {
    const at = window.indexOf(connective);
    if (at >= 0) {
      const cut = Math.max(1, middle - 18) + at;
      return `${sentence.slice(0, cut)}，${sentence.slice(cut)}`;
    }
  }
  // No connective: fall back to the character boundary nearest the midpoint
  // that does not split a number/latin word.
  let cut = middle;
  while (cut > 1 && isWordChar(sentence[cut - 1]) && isWordChar(sentence[cut])) cut -= 1;
  if (cut <= 1) cut = middle;
  return `${sentence.slice(0, cut)}，${sentence.slice(cut)}`;
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9]/.test(char);
}
