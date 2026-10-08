/**
 * Normalise an Indian mobile number to E.164 (+91XXXXXXXXXX).
 * Accepts "98765 43210", "098765-43210", "+91 9876543210", "919876543210".
 * Indian mobiles are 10 digits starting 6–9.
 */
export function normalizeIndianPhone(input: string): string | null {
  let digits = input.replace(/[^\d]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91${digits}`;
}

/** "+919876543210" → "+91 98XXX XX210" */
export function maskPhone(e164: string): string {
  const d = e164.replace('+91', '');
  return `+91 ${d.slice(0, 2)}XXX XX${d.slice(7)}`;
}
