const ONLY_EMOJI =
  /^(?:\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}‍️\s])+$/u;
const HAS_EMOJI = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]/u;

/** True when a message is just a few emoji (rendered big, no bubble). */
export function isEmojiOnly(text: string, max = 5): boolean {
  const t = text.trim();
  if (!t || !ONLY_EMOJI.test(t) || !HAS_EMOJI.test(t)) return false;
  const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let count = 0;
  for (const { segment } of seg.segment(t)) {
    if (segment.trim()) count++;
    if (count > max) return false;
  }
  return true;
}
