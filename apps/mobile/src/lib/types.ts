export type Level = 'PHONE' | 'LOCATION' | 'ADDRESS';
export type PostType = 'GENERAL' | 'HOBBY' | 'CLASSIFIED' | 'ALERT' | 'LOST_FOUND' | 'RECOMMENDATION' | 'EVENT';

export interface PublicUser {
  id: string;
  name: string;
  avatarUrl: string | null;
  verificationLevel: Level;
  neighborhood: string | null;
}

export interface Me {
  id: string;
  phone: string;
  name: string | null;
  bio: string | null;
  avatarUrl: string | null;
  language: string;
  platformRole: 'USER' | 'MODERATOR' | 'ADMIN';
  verificationLevel: Level;
  feedRadiusM: number;
  hasHome: boolean;
  address: { id: string; unit: string; building: string | null; street: string | null; locality: string; city: string; pincode: string; status: string; method: string | null } | null;
  neighborhood: { id: string; name: string; city: string; status: string; memberCount: number } | null;
  societies: { membershipId: string; role: string; status: string; unit: string; tower: string | null; id: string; name: string; isVerified: boolean }[];
  businesses: { id: string; name: string; category: string; isVerified: boolean }[];
}

export interface Post {
  id: string;
  type: PostType;
  title: string | null;
  body: string;
  images: string[];
  pricePaise: number | null;
  condition: 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR' | null;
  isSold: boolean;
  severity: 'INFO' | 'WARNING' | 'CRITICAL' | null;
  hobbyTag: string | null;
  eventAt: string | null;
  expiresAt: string | null;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  isMine: boolean;
  distanceM: number | null;
  author: PublicUser;
  createdAt: string;
}

export interface Ad {
  id: string;
  headline: string;
  body: string;
  imageUrl: string | null;
  cta: 'CALL' | 'WHATSAPP' | 'VIEW_BUSINESS';
  sponsored: true;
  business: { id: string; name: string; category: string; phone: string; whatsapp: string | null; isVerified: boolean; photos: string[] };
}

export interface FeedPage {
  items: Post[];
  pinnedAlerts: Post[];
  sponsored: Ad[];
  radiusM: number;
  expanded: boolean;
  nextCursor: string | null;
}

export interface Comment {
  id: string;
  body: string;
  createdAt: string;
  isMine: boolean;
  author: PublicUser;
}

export interface Business {
  id: string;
  name: string;
  category: string;
  description: string | null;
  phone: string;
  whatsapp: string | null;
  addressLine: string;
  pincode: string;
  hours: Record<string, string> | null;
  photos: string[];
  isVerified: boolean;
  ratingAvg: number;
  ratingCount: number;
  isNew: boolean;
  isMine: boolean;
  distanceM: number | null;
  walletPaise?: number;
}

export interface Review {
  id: string;
  rating: number;
  body: string | null;
  createdAt: string;
  isMine: boolean;
  author: PublicUser;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  validUntil: string | null;
  createdAt: string;
  business?: { id: string; name: string; category: string; isVerified: boolean; photos: string[] };
  distanceM?: number;
}

export interface Provider {
  id: string;
  name: string;
  phone: string;
  skills: string[];
  languages: string[];
  about: string | null;
  experienceYrs: number | null;
  rateNote: string | null;
  serviceRadiusM: number;
  idVerified: boolean;
  vouchCount: number;
  ratingAvg: number;
  ratingCount: number;
  canEdit: boolean;
  distanceM: number | null;
}

export interface Campaign {
  id: string;
  businessId: string;
  headline: string;
  body: string;
  imageUrl: string | null;
  cta: string;
  radiusM: number;
  budgetPaise: number;
  spentPaise: number;
  cpmPaise: number;
  impressions: number;
  clicks: number;
  ctr: number;
  remainingPaise: number;
  status: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'PAUSED' | 'EXHAUSTED' | 'ENDED' | 'REJECTED';
  rejectReason: string | null;
  startAt: string;
  endAt: string;
}

export interface SocietySummary {
  id: string;
  name: string;
  type: string;
  addressLine: string;
  city: string;
  pincode?: string;
  isVerified: boolean;
  memberCount: number;
  distanceM?: number;
  membership?: { id: string; role: string; status: string; unit: string; tower: string | null } | null;
  stats?: { openTickets: number; activeParking: number; pendingRequests: number };
  inviteCode?: string;
  requireApproval?: boolean;
}

export interface Notice {
  id: string;
  title: string;
  body: string;
  category: string;
  isPinned: boolean;
  createdAt: string;
  author: PublicUser;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  category: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
  commentCount?: number;
  isMine: boolean;
  canManage?: boolean;
  author: PublicUser;
  comments?: { id: string; body: string; createdAt: string; isMine: boolean; author: PublicUser }[];
}

export interface ParkingAlert {
  id: string;
  vehicleNumber: string;
  message: string;
  location: string | null;
  status: 'ACTIVE' | 'RESOLVED';
  createdAt: string;
  isMine: boolean;
  isMyVehicle: boolean;
  ownerNotified: boolean;
  reporter: PublicUser;
}

export interface Member {
  membershipId: string;
  role: 'RESIDENT' | 'RWA_COMMITTEE' | 'RWA_ADMIN';
  status: string;
  tower: string | null;
  unit: string;
  occupancy: string;
  requestedAt: string;
  user: PublicUser;
}

export interface Conversation {
  id: string;
  postId: string | null;
  lastMessage: string | null;
  lastMessageAt: string;
  unread: boolean;
  other: PublicUser;
}

export interface Message {
  id: string;
  body: string;
  createdAt: string;
  isMine: boolean;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, string> | null;
  readAt: string | null;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  nextCursor?: string | null;
}
