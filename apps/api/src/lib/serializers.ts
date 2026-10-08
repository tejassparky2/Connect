import type { Prisma } from '@prisma/client';

/** The only user fields other users may ever see. No phone, no location. */
export const publicUserSelect = {
  id: true,
  name: true,
  avatarUrl: true,
  verificationLevel: true,
  neighborhood: { select: { name: true } },
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

export function toPublicUser(u: PublicUser) {
  return {
    id: u.id,
    name: u.name ?? 'Neighbour',
    avatarUrl: u.avatarUrl,
    verificationLevel: u.verificationLevel,
    neighborhood: u.neighborhood?.name ?? null,
  };
}

export const postInclude = (viewerId: string) =>
  ({
    author: { select: publicUserSelect },
    reactions: { where: { userId: viewerId }, select: { userId: true } },
  }) satisfies Prisma.PostInclude;

type PostWithAuthor = Prisma.PostGetPayload<{ include: ReturnType<typeof postInclude> }>;

export function toPost(p: PostWithAuthor, viewerId: string, distanceM?: number) {
  return {
    id: p.id,
    type: p.type,
    title: p.title,
    body: p.body,
    images: p.images,
    pricePaise: p.pricePaise,
    condition: p.condition,
    isSold: p.isSold,
    severity: p.severity,
    hobbyTag: p.hobbyTag,
    eventAt: p.eventAt,
    expiresAt: p.expiresAt,
    likeCount: p.likeCount,
    commentCount: p.commentCount,
    likedByMe: p.reactions.length > 0,
    isMine: p.authorId === viewerId,
    status: p.status,
    distanceM: distanceM ?? null,
    author: toPublicUser(p.author),
    createdAt: p.createdAt,
  };
}
