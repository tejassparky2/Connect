/** ₹ formatting with Indian digit grouping: 1234567 paise → "₹12,345.67" (drops .00). */
export function formatRupees(paise: number | null | undefined): string {
  if (paise == null) return '';
  const rupees = paise / 100;
  const hasFraction = paise % 100 !== 0;
  const [intPart, frac] = rupees.toFixed(2).split('.');
  const lastThree = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree : lastThree;
  return `₹${grouped}${hasFraction ? '.' + frac : ''}`;
}

export function rupeesToPaise(input: string): number | null {
  const clean = input.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(parseFloat(clean) * 100);
}

export function formatDistance(m: number | null | undefined): string {
  if (m == null) return '';
  if (m < 1000) return `${Math.round(m / 100) * 100 || 100} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function initials(name: string | null | undefined): string {
  if (!name) return '🏠';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** "9876543210" / "+91 98765 43210" → "+919876543210" or null. Mirrors the API's rule. */
export function normalizePhone(input: string): string | null {
  let d = input.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

export function prettyPhone(e164: string): string {
  const d = e164.replace('+91', '');
  return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
}

export const humanize = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
