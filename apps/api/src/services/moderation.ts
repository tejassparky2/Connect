/**
 * First-pass automated moderation. Cheap, synchronous, deliberately
 * conservative: it only routes content to human review, never silently deletes.
 * Production: plug a classifier (Perspective API / an LLM) behind the same API.
 */
const BLOCKLIST = [
  // scams common in Indian classifieds / ads
  'otp share', 'share otp', 'kyc update', 'lottery', 'work from home earn', 'guaranteed returns', 'double your money',
  'kill them',
  // Hate-speech / slur lists are maintained outside the codebase (per language)
  // and injected via MODERATION_EXTRA_TERMS (comma-separated).
  ...(process.env.MODERATION_EXTRA_TERMS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
];

export function needsReview(...texts: (string | null | undefined)[]): boolean {
  const t = texts.filter(Boolean).join(' ').toLowerCase();
  return BLOCKLIST.some((w) => t.includes(w));
}

/** Strip control chars and collapse runs of whitespace. */
export function clean(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/[ \t]{3,}/g, '  ').trim();
}
