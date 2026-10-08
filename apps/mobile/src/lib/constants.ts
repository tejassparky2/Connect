import type { PostType } from './types';

export const POST_TYPES: { key: PostType; label: string; emoji: string; hint: string }[] = [
  { key: 'GENERAL', label: 'General', emoji: '💬', hint: 'Share news or start a conversation' },
  { key: 'CLASSIFIED', label: 'Sell', emoji: '🏷️', hint: 'Sell or give away something' },
  { key: 'RECOMMENDATION', label: 'Ask', emoji: '🙋', hint: 'Ask neighbours for a recommendation' },
  { key: 'HOBBY', label: 'Hobby', emoji: '🏸', hint: 'Find partners for a hobby or sport' },
  { key: 'EVENT', label: 'Event', emoji: '🎉', hint: 'Invite neighbours to an event' },
  { key: 'LOST_FOUND', label: 'Lost & Found', emoji: '🔎', hint: 'Lost a pet or found something?' },
  { key: 'ALERT', label: 'Alert', emoji: '🚨', hint: 'Warn neighbours about safety issues' },
];

export const FEED_FILTERS: { key: PostType | undefined; label: string }[] = [
  { key: undefined, label: 'For you' },
  { key: 'ALERT', label: '🚨 Alerts' },
  { key: 'CLASSIFIED', label: '🏷️ Marketplace' },
  { key: 'HOBBY', label: '🏸 Hobbies' },
  { key: 'RECOMMENDATION', label: '🙋 Asks' },
  { key: 'EVENT', label: '🎉 Events' },
  { key: 'LOST_FOUND', label: '🔎 Lost & Found' },
];

export const TYPE_META: Record<PostType, { label: string; color: string; bg: string }> = {
  GENERAL: { label: 'Post', color: '#334155', bg: '#F1F5F9' },
  CLASSIFIED: { label: 'For sale', color: '#0F766E', bg: '#D1FAEC' },
  RECOMMENDATION: { label: 'Recommendation', color: '#6D28D9', bg: '#EDE9FE' },
  HOBBY: { label: 'Hobby', color: '#B45309', bg: '#FEF3C7' },
  EVENT: { label: 'Event', color: '#BE185D', bg: '#FCE7F3' },
  LOST_FOUND: { label: 'Lost & Found', color: '#1D4ED8', bg: '#DBEAFE' },
  ALERT: { label: 'Alert', color: '#B91C1C', bg: '#FEE2E2' },
};

export const BUSINESS_CATEGORIES: { key: string; label: string; emoji: string }[] = [
  { key: 'CAFE', label: 'Cafés', emoji: '☕' },
  { key: 'RESTAURANT', label: 'Food', emoji: '🍛' },
  { key: 'GROCERY', label: 'Kirana', emoji: '🛒' },
  { key: 'SALON', label: 'Salons', emoji: '💇' },
  { key: 'PHARMACY', label: 'Pharmacy', emoji: '💊' },
  { key: 'CLINIC', label: 'Clinics', emoji: '🩺' },
  { key: 'GYM', label: 'Fitness', emoji: '🏋️' },
  { key: 'BAKERY', label: 'Bakery', emoji: '🥐' },
  { key: 'TUTOR', label: 'Tutors', emoji: '📚' },
  { key: 'LAUNDRY', label: 'Laundry', emoji: '👕' },
  { key: 'ELECTRONICS', label: 'Electronics', emoji: '🔌' },
  { key: 'HARDWARE', label: 'Hardware', emoji: '🔧' },
  { key: 'BOUTIQUE', label: 'Boutique', emoji: '👗' },
  { key: 'OTHER', label: 'Other', emoji: '🏪' },
];

export const SKILLS: { key: string; label: string; emoji: string }[] = [
  { key: 'MAID', label: 'Maid', emoji: '🧹' },
  { key: 'COOK', label: 'Cook', emoji: '🍳' },
  { key: 'PLUMBER', label: 'Plumber', emoji: '🚰' },
  { key: 'ELECTRICIAN', label: 'Electrician', emoji: '💡' },
  { key: 'DRIVER', label: 'Driver', emoji: '🚗' },
  { key: 'CARPENTER', label: 'Carpenter', emoji: '🪚' },
  { key: 'AC_REPAIR', label: 'AC repair', emoji: '❄️' },
  { key: 'APPLIANCE_REPAIR', label: 'Appliances', emoji: '🔌' },
  { key: 'PAINTER', label: 'Painter', emoji: '🎨' },
  { key: 'NANNY', label: 'Nanny', emoji: '🧸' },
  { key: 'PEST_CONTROL', label: 'Pest control', emoji: '🪳' },
  { key: 'GARDENER', label: 'Gardener', emoji: '🌿' },
  { key: 'SECURITY_GUARD', label: 'Security', emoji: '🛡️' },
  { key: 'TAILOR', label: 'Tailor', emoji: '🧵' },
  { key: 'OTHER', label: 'Other', emoji: '🧰' },
];

export const skillLabel = (k: string) => SKILLS.find((s) => s.key === k)?.label ?? k;
export const categoryMeta = (k: string) => BUSINESS_CATEGORIES.find((c) => c.key === k) ?? { key: k, label: k, emoji: '🏪' };

export const TICKET_CATEGORIES = ['PLUMBING', 'ELECTRICAL', 'LIFT', 'SECURITY', 'HOUSEKEEPING', 'PARKING', 'WATER', 'OTHER'] as const;
export const NOTICE_CATEGORIES = ['GENERAL', 'MAINTENANCE', 'MEETING', 'EVENT', 'WATER', 'ELECTRICITY', 'SECURITY', 'PAYMENT'] as const;
