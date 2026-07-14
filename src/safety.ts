const CRISIS_PATTERNS: RegExp[] = [
  /\bkill(ing)?\s+myself\b/i,
  /\bsuicid(e|al)\b/i,
  /\bself[-\s]?harm/i,
  /\bharming\s+myself\b/i,
  /\bhurt(ing)?\s+myself\b/i,
  /\bwant\s+to\s+die\b/i,
  /\bend\s+my\s+life\b/i,
  /\btake\s+my\s+own\s+life\b/i,
];

export function detectCrisis(text: string): boolean {
  if (!text) return false;
  return CRISIS_PATTERNS.some(re => re.test(text));
}

export const CRISIS_MESSAGE =
  "I'm really glad you told me, and I'm sorry you're feeling this way — you don't have to face it alone. " +
  "If things feel overwhelming, you can call Samaritans free on 116 123, day or night, or text SHOUT to 85258. " +
  "If you're in immediate danger, please call 999. It's also worth speaking to your GP or another professional who can support you.";
