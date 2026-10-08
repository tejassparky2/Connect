import type { Ticket } from '@/lib/types';

export const STATUS_STYLE: Record<Ticket['status'], { bg: string; fg: string }> = {
  OPEN: { bg: '#FEE2E2', fg: '#B91C1C' },
  IN_PROGRESS: { bg: '#FEF3C7', fg: '#B45309' },
  RESOLVED: { bg: '#D1FAEC', fg: '#0F766E' },
  CLOSED: { bg: '#F1F5F9', fg: '#475569' },
};
export const CAT_EMOJI: Record<string, string> = { PLUMBING: '🚰', ELECTRICAL: '💡', LIFT: '🛗', SECURITY: '🛡️', HOUSEKEEPING: '🧹', PARKING: '🚗', WATER: '💧', OTHER: '📝' };

