/**
 * Private society / RWA groups.
 *
 * Access model:
 *   • Discovery (name, address, member count) is open to signed-in users near it.
 *   • EVERYTHING else (notices, helpdesk, parking, directory) requires an
 *     APPROVED membership — enforced by `requireMember` on every route.
 *   • Join requests are geo-fenced: your verified home pin must be inside the
 *     compound polygon (or within 250 m of the gate when no polygon exists).
 *   • RWA_ADMIN / RWA_COMMITTEE approve members, post notices, run the helpdesk.
 */
import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { MembershipStatus, Prisma, SocietyRole, SocietyType, TicketCategory, TicketStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { bucketDistance, createWithPoint, getUserHome, isInIndia, isPointInSociety, pointSql, queryNearbySocieties } from '../lib/geo';
import { normalizeVehicleNumber } from '../lib/vehicle';
import { publicUserSelect, toPublicUser } from '../lib/serializers';
import { me, requireAuth, requireLevel, uuidParams } from '../middleware/auth';
import { q, validate } from '../middleware/validate';
import { clean } from '../services/moderation';
import { notifyLater } from '../services/notify';
import { applySocietyApproval, recomputeLevel } from '../services/verification';

export const societiesRouter = Router();
uuidParams(societiesRouter, 'id', 'membershipId', 'nid', 'tid', 'vid', 'aid');
societiesRouter.use(requireAuth);

type Req = Request<Record<string, string>>;
const STAFF: SocietyRole[] = ['RWA_ADMIN', 'RWA_COMMITTEE'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion

export function generateInviteCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}

async function requireMember(req: Req, societyId: string, roles?: SocietyRole[]) {
  const m = await prisma.societyMembership.findUnique({ where: { societyId_userId: { societyId, userId: me(req).id } } });
  if (!m || m.status !== MembershipStatus.APPROVED) throw forbidden('Only verified residents of this society can access this');
  if (roles && !roles.includes(m.role)) throw forbidden('Only the RWA committee can do this');
  return m;
}

async function staffIds(societyId: string) {
  const s = await prisma.societyMembership.findMany({ where: { societyId, status: 'APPROVED', role: { in: STAFF } }, select: { userId: true } });
  return s.map((x) => x.userId);
}

async function memberIds(societyId: string, exclude?: string) {
  const s = await prisma.societyMembership.findMany({ where: { societyId, status: 'APPROVED', userId: exclude ? { not: exclude } : undefined }, select: { userId: true } });
  return s.map((x) => x.userId);
}

async function recountMembers(societyId: string) {
  const n = await prisma.societyMembership.count({ where: { societyId, status: 'APPROVED' } });
  await prisma.society.update({ where: { id: societyId }, data: { memberCount: n } });
}

// ─────────────── Discovery / create / join ───────────────

societiesRouter.get('/nearby', validate('query', z.object({ q: z.string().trim().max(60).optional() })), async (req, res) => {
  const home = await getUserHome(me(req).id);
  if (!home) throw badRequest('Set your home address first');
  const rows = await queryNearbySocieties(home, 2000, q<{ q?: string }>(req).q || undefined);
  res.json({ items: rows.map(({ distance, ...r }) => ({ ...r, distanceM: bucketDistance(distance) })) });
});

societiesRouter.get('/mine', async (req, res) => {
  const ms = await prisma.societyMembership.findMany({
    where: { userId: me(req).id, status: { in: ['APPROVED', 'PENDING'] } },
    include: { society: { select: { id: true, name: true, addressLine: true, city: true, isVerified: true, memberCount: true, type: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const pendingCounts = await prisma.societyMembership.groupBy({
    by: ['societyId'],
    where: { societyId: { in: ms.filter((m) => STAFF.includes(m.role) && m.status === 'APPROVED').map((m) => m.societyId) }, status: 'PENDING' },
    _count: true,
  });
  const pending = new Map(pendingCounts.map((p) => [p.societyId, p._count]));
  res.json({
    items: ms.map((m) => ({
      membershipId: m.id,
      role: m.role,
      status: m.status,
      unit: m.unit,
      tower: m.tower,
      pendingRequests: pending.get(m.societyId) ?? 0,
      society: m.society,
    })),
  });
});

const createSociety = z.object({
  name: z.string().trim().min(3).max(100),
  type: z.enum(SocietyType).default('APARTMENT'),
  addressLine: z.string().trim().min(5).max(200),
  city: z.string().trim().min(2).max(80),
  pincode: z.string().regex(/^[1-9]\d{5}$/),
  lat: z.number(),
  lng: z.number(),
  tower: z.string().trim().max(20).optional(),
  unit: z.string().trim().min(1).max(20),
});

societiesRouter.post('/', requireLevel('LOCATION'), validate('body', createSociety), async (req, res) => {
  const user = me(req);
  const input = req.body as z.infer<typeof createSociety>;
  const point = { lat: input.lat, lng: input.lng };
  if (!isInIndia(point)) throw badRequest('Society must be in India');
  const home = await getUserHome(user.id);
  if (!home) throw badRequest('Set your home address first');
  const near = await queryNearbySocieties(point, 75);
  if (near.length) throw conflict(`"${near[0].name}" is already registered here — request to join it instead`);
  const distRows = await prisma.$queryRaw<{ d: number }[]>`SELECT ST_Distance(${pointSql(home)}, ${pointSql(point)}) AS d`;
  if (distRows[0].d > 300) throw forbidden('You can only register the society you live in (your home pin must be within 300 m)');

  const society = await createWithPoint(
    'societies',
    point,
    (tx) =>
      tx.society.create({
        data: {
          name: clean(input.name),
          type: input.type,
          addressLine: clean(input.addressLine),
          city: input.city,
          pincode: input.pincode,
          neighborhoodId: user.neighborhoodId,
          inviteCode: generateInviteCode(),
          createdById: user.id,
          memberCount: 1,
        },
      }),
    {
      after: async (tx, s) => {
        await tx.societyMembership.create({
          data: { societyId: s.id, userId: user.id, role: 'RWA_ADMIN', status: 'APPROVED', tower: input.tower, unit: input.unit, approvedAt: new Date() },
        });
      },
    },
  );
  res.status(201).json(society);
});

societiesRouter.get('/:id', async (req, res) => {
  const s = await prisma.society.findUnique({ where: { id: req.params.id } });
  if (!s) throw notFound('Society');
  const m = await prisma.societyMembership.findUnique({ where: { societyId_userId: { societyId: s.id, userId: me(req).id } } });
  const isStaff = m?.status === 'APPROVED' && STAFF.includes(m.role);
  const [openTickets, activeParking, pendingRequests] =
    m?.status === 'APPROVED'
      ? await Promise.all([
          prisma.ticket.count({ where: { societyId: s.id, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
          prisma.parkingAlert.count({ where: { societyId: s.id, status: 'ACTIVE' } }),
          isStaff ? prisma.societyMembership.count({ where: { societyId: s.id, status: 'PENDING' } }) : Promise.resolve(0),
        ])
      : [0, 0, 0];
  res.json({
    id: s.id,
    name: s.name,
    type: s.type,
    addressLine: s.addressLine,
    city: s.city,
    pincode: s.pincode,
    isVerified: s.isVerified,
    memberCount: s.memberCount,
    membership: m ? { id: m.id, role: m.role, status: m.status, unit: m.unit, tower: m.tower } : null,
    ...(m?.status === 'APPROVED' ? { stats: { openTickets, activeParking, pendingRequests } } : {}),
    ...(isStaff ? { inviteCode: s.inviteCode, requireApproval: s.requireApproval } : {}),
  });
});

societiesRouter.patch(
  '/:id',
  validate('body', z.object({ name: z.string().trim().min(3).max(100).optional(), requireApproval: z.boolean().optional() })),
  async (req, res) => {
    await requireMember(req, req.params.id, ['RWA_ADMIN']);
    const s = await prisma.society.update({
      where: { id: req.params.id },
      data: { ...req.body, ...(req.body.name ? { name: clean(req.body.name), isVerified: false } : {}) },
    });
    res.json({ id: s.id, name: s.name, requireApproval: s.requireApproval, isVerified: s.isVerified });
  },
);

societiesRouter.post('/:id/invite-code/rotate', async (req, res) => {
  await requireMember(req, req.params.id, ['RWA_ADMIN']);
  const s = await prisma.society.update({ where: { id: req.params.id }, data: { inviteCode: generateInviteCode() } });
  res.json({ inviteCode: s.inviteCode });
});

const joinSchema = z
  .object({
    societyId: z.uuid().optional(),
    inviteCode: z.string().trim().toUpperCase().length(8).optional(),
    tower: z.string().trim().max(20).optional(),
    unit: z.string().trim().min(1).max(20),
    occupancy: z.enum(['OWNER', 'TENANT', 'FAMILY_MEMBER']).default('OWNER'),
  })
  .refine((v) => v.societyId || v.inviteCode, { message: 'Provide a society or an invite code' });

societiesRouter.post('/join', validate('body', joinSchema), async (req, res) => {
  const user = me(req);
  const input = req.body as z.infer<typeof joinSchema>;
  const society = input.inviteCode
    ? await prisma.society.findUnique({ where: { inviteCode: input.inviteCode } })
    : await prisma.society.findUnique({ where: { id: input.societyId! } });
  if (!society) throw notFound(input.inviteCode ? 'Society for this invite code' : 'Society');

  const home = await getUserHome(user.id);
  if (!home) throw badRequest('Set your home address first');
  const fence = await isPointInSociety(society.id, home);
  if (!fence.inside) throw forbidden(`Your home pin is ${Math.round(fence.distanceM)} m from ${society.name}. Only residents can join.`);

  const existing = await prisma.societyMembership.findUnique({ where: { societyId_userId: { societyId: society.id, userId: user.id } } });
  if (existing?.status === 'APPROVED') throw conflict('You are already a member');
  if (existing?.status === 'PENDING') throw conflict('Your request is awaiting RWA approval');

  // Valid code + society allows auto-join + user has proven GPS presence → instant approval.
  const autoApprove = !!input.inviteCode && !society.requireApproval && user.verificationLevel !== 'PHONE';
  const data = {
    tower: input.tower,
    unit: input.unit,
    occupancy: input.occupancy,
    role: 'RESIDENT' as const,
    status: autoApprove ? ('APPROVED' as const) : ('PENDING' as const),
    approvedAt: autoApprove ? new Date() : null,
    approvedById: null,
  };
  const m = existing
    ? await prisma.societyMembership.update({ where: { id: existing.id }, data })
    : await prisma.societyMembership.create({ data: { ...data, societyId: society.id, userId: user.id } });

  if (autoApprove) {
    await recountMembers(society.id);
    await applySocietyApproval(user.id, society.id, 'INVITE_CODE');
  } else {
    notifyLater(await staffIds(society.id), {
      type: 'SOCIETY_MEMBERSHIP',
      title: 'New join request',
      body: `${user.name ?? 'A resident'} (${input.tower ? input.tower + '-' : ''}${input.unit}) wants to join ${society.name}`,
      data: { societyId: society.id },
    });
  }
  res.status(201).json({ membershipId: m.id, status: m.status, society: { id: society.id, name: society.name } });
});

societiesRouter.delete('/:id/membership', async (req, res) => {
  const m = await prisma.societyMembership.findUnique({ where: { societyId_userId: { societyId: req.params.id, userId: me(req).id } } });
  if (!m || m.status === 'REMOVED') throw notFound('Membership');
  if (m.role === 'RWA_ADMIN') {
    const admins = await prisma.societyMembership.count({ where: { societyId: m.societyId, role: 'RWA_ADMIN', status: 'APPROVED' } });
    if (admins <= 1) throw forbidden('Appoint another RWA admin before leaving');
  }
  await prisma.societyMembership.update({ where: { id: m.id }, data: { status: 'REMOVED', role: 'RESIDENT' } });
  await recountMembers(m.societyId);
  await recomputeLevel(me(req).id);
  res.json({ ok: true });
});

// ─────────────── Members (directory + approvals) ───────────────

societiesRouter.get(
  '/:id/members',
  validate('query', z.object({ status: z.enum(['APPROVED', 'PENDING']).default('APPROVED') })),
  async (req, res) => {
    const { status } = q<{ status: 'APPROVED' | 'PENDING' }>(req);
    await requireMember(req, req.params.id, status === 'PENDING' ? STAFF : undefined);
    const ms = await prisma.societyMembership.findMany({
      where: { societyId: req.params.id, status },
      include: { user: { select: publicUserSelect } },
      orderBy: [{ role: 'desc' }, { tower: 'asc' }, { unit: 'asc' }],
      take: 500,
    });
    res.json({
      items: ms.map((m) => ({ membershipId: m.id, role: m.role, status: m.status, tower: m.tower, unit: m.unit, occupancy: m.occupancy, requestedAt: m.createdAt, user: toPublicUser(m.user) })),
    });
  },
);

async function decide(req: Req, approve: boolean) {
  const admin = await requireMember(req, req.params.id, STAFF);
  const m = await prisma.societyMembership.findUnique({ where: { id: req.params.membershipId }, include: { society: { select: { name: true } } } });
  if (!m || m.societyId !== req.params.id) throw notFound('Request');
  if (m.status !== 'PENDING') throw conflict('This request was already handled');
  await prisma.societyMembership.update({
    where: { id: m.id },
    data: { status: approve ? 'APPROVED' : 'REJECTED', approvedById: admin.userId, approvedAt: approve ? new Date() : null },
  });
  if (approve) {
    await recountMembers(m.societyId);
    await applySocietyApproval(m.userId, m.societyId, 'SOCIETY_ADMIN');
  }
  notifyLater([m.userId], {
    type: 'SOCIETY_MEMBERSHIP',
    title: approve ? `Welcome to ${m.society.name}! 🏠` : 'Join request declined',
    body: approve ? 'Your RWA approved your request. Notices, helpdesk and parking alerts are now unlocked.' : `${m.society.name} RWA could not verify your request. Contact your RWA office.`,
    data: { societyId: m.societyId },
  });
}

societiesRouter.post('/:id/members/:membershipId/approve', async (req, res) => {
  await decide(req, true);
  res.json({ ok: true });
});

societiesRouter.post('/:id/members/:membershipId/reject', async (req, res) => {
  await decide(req, false);
  res.json({ ok: true });
});

societiesRouter.patch(
  '/:id/members/:membershipId',
  validate('body', z.object({ role: z.enum(SocietyRole).optional(), remove: z.boolean().optional() })),
  async (req, res) => {
    const admin = await requireMember(req, req.params.id, ['RWA_ADMIN']);
    const m = await prisma.societyMembership.findUnique({ where: { id: req.params.membershipId } });
    if (!m || m.societyId !== req.params.id || m.status !== 'APPROVED') throw notFound('Member');
    if (m.id === admin.id) throw badRequest('Use "leave society" to change your own membership');
    await prisma.societyMembership.update({
      where: { id: m.id },
      data: req.body.remove ? { status: 'REMOVED', role: 'RESIDENT' } : { role: req.body.role },
    });
    if (req.body.remove) {
      await recountMembers(m.societyId);
      await recomputeLevel(m.userId);
    }
    res.json({ ok: true });
  },
);

// ─────────────── Notice board ───────────────

societiesRouter.get('/:id/notices', async (req, res) => {
  await requireMember(req, req.params.id);
  const notices = await prisma.notice.findMany({
    where: { societyId: req.params.id, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    include: { author: { select: publicUserSelect } },
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
  res.json({ items: notices.map((n) => ({ ...n, author: toPublicUser(n.author) })) });
});

const noticeBody = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(5).max(5000),
  category: z.enum(['GENERAL', 'MAINTENANCE', 'MEETING', 'EVENT', 'WATER', 'ELECTRICITY', 'SECURITY', 'PAYMENT']).default('GENERAL'),
  isPinned: z.boolean().default(false),
  expiresAt: z.coerce.date().optional(),
});

societiesRouter.post('/:id/notices', validate('body', noticeBody), async (req, res) => {
  const m = await requireMember(req, req.params.id, STAFF);
  const n = await prisma.notice.create({
    data: { ...req.body, title: clean(req.body.title), body: clean(req.body.body), societyId: m.societyId, authorId: m.userId },
    include: { author: { select: publicUserSelect } },
  });
  notifyLater(await memberIds(m.societyId, m.userId), {
    type: 'SOCIETY_NOTICE',
    title: `📌 ${n.title}`,
    body: n.body.slice(0, 140),
    data: { societyId: m.societyId, noticeId: n.id },
  });
  res.status(201).json({ ...n, author: toPublicUser(n.author) });
});

societiesRouter.patch('/:id/notices/:nid', validate('body', noticeBody.partial()), async (req, res) => {
  await requireMember(req, req.params.id, STAFF);
  const n = await prisma.notice.findUnique({ where: { id: req.params.nid } });
  if (!n || n.societyId !== req.params.id) throw notFound('Notice');
  const updated = await prisma.notice.update({ where: { id: n.id }, data: req.body });
  res.json(updated);
});

societiesRouter.delete('/:id/notices/:nid', async (req, res) => {
  await requireMember(req, req.params.id, STAFF);
  const n = await prisma.notice.findUnique({ where: { id: req.params.nid } });
  if (!n || n.societyId !== req.params.id) throw notFound('Notice');
  await prisma.notice.delete({ where: { id: n.id } });
  res.json({ ok: true });
});

// ─────────────── Helpdesk / maintenance discussions ───────────────

societiesRouter.get(
  '/:id/tickets',
  validate('query', z.object({ status: z.enum(TicketStatus).optional(), mine: z.coerce.boolean().optional() })),
  async (req, res) => {
    const m = await requireMember(req, req.params.id);
    const query = q<{ status?: TicketStatus; mine?: boolean }>(req);
    const isStaff = STAFF.includes(m.role);
    const where: Prisma.TicketWhereInput = {
      societyId: m.societyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.mine ? { authorId: m.userId } : {}),
      ...(isStaff ? {} : { OR: [{ isPrivate: false }, { authorId: m.userId }] }),
    };
    const tickets = await prisma.ticket.findMany({
      where,
      include: { author: { select: publicUserSelect }, _count: { select: { comments: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ items: tickets.map(({ _count, ...t }) => ({ ...t, commentCount: _count.comments, author: toPublicUser(t.author), isMine: t.authorId === m.userId })) });
  },
);

societiesRouter.post(
  '/:id/tickets',
  validate(
    'body',
    z.object({
      title: z.string().trim().min(5).max(120),
      description: z.string().trim().min(10).max(3000),
      category: z.enum(TicketCategory).default('OTHER'),
      isPrivate: z.boolean().default(false),
    }),
  ),
  async (req, res) => {
    const m = await requireMember(req, req.params.id);
    const t = await prisma.ticket.create({
      data: { ...req.body, title: clean(req.body.title), description: clean(req.body.description), societyId: m.societyId, authorId: m.userId },
      include: { author: { select: publicUserSelect } },
    });
    notifyLater((await staffIds(m.societyId)).filter((id) => id !== m.userId), {
      type: 'TICKET_UPDATE',
      title: `New ${t.category.toLowerCase()} complaint`,
      body: t.title,
      data: { societyId: m.societyId, ticketId: t.id },
    });
    res.status(201).json({ ...t, author: toPublicUser(t.author), commentCount: 0, isMine: true });
  },
);

async function loadTicket(req: Req) {
  const m = await requireMember(req, req.params.id);
  const t = await prisma.ticket.findUnique({ where: { id: req.params.tid } });
  if (!t || t.societyId !== m.societyId) throw notFound('Ticket');
  if (t.isPrivate && t.authorId !== m.userId && !STAFF.includes(m.role)) throw notFound('Ticket');
  return { m, t };
}

societiesRouter.get('/:id/tickets/:tid', async (req, res) => {
  const { m } = await loadTicket(req);
  const t = await prisma.ticket.findUniqueOrThrow({
    where: { id: req.params.tid },
    include: {
      author: { select: publicUserSelect },
      comments: { include: { author: { select: publicUserSelect } }, orderBy: { createdAt: 'asc' } },
    },
  });
  res.json({
    ...t,
    author: toPublicUser(t.author),
    isMine: t.authorId === m.userId,
    canManage: STAFF.includes(m.role),
    comments: t.comments.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, author: toPublicUser(c.author), isMine: c.authorId === m.userId })),
  });
});

societiesRouter.patch('/:id/tickets/:tid', validate('body', z.object({ status: z.enum(TicketStatus) })), async (req, res) => {
  const { m, t } = await loadTicket(req);
  const isStaff = STAFF.includes(m.role);
  const isAuthor = t.authorId === m.userId;
  const status: TicketStatus = req.body.status;
  // Residents may only close or re-open their own tickets; the committee drives the workflow.
  if (!isStaff && !(isAuthor && (status === 'CLOSED' || status === 'OPEN'))) throw forbidden('Only the RWA committee can change this status');
  const updated = await prisma.ticket.update({
    where: { id: t.id },
    data: { status, resolvedAt: status === 'RESOLVED' || status === 'CLOSED' ? new Date() : null },
  });
  if (!isAuthor) {
    notifyLater([t.authorId], {
      type: 'TICKET_UPDATE',
      title: `Complaint ${status.replace('_', ' ').toLowerCase()}`,
      body: t.title,
      data: { societyId: t.societyId, ticketId: t.id },
    });
  }
  res.json(updated);
});

societiesRouter.post('/:id/tickets/:tid/comments', validate('body', z.object({ body: z.string().trim().min(1).max(1000) })), async (req, res) => {
  const { m, t } = await loadTicket(req);
  const c = await prisma.ticketComment.create({
    data: { ticketId: t.id, authorId: m.userId, body: clean(req.body.body) },
    include: { author: { select: publicUserSelect } },
  });
  await prisma.ticket.update({ where: { id: t.id }, data: { updatedAt: new Date() } });
  const recipients = t.authorId === m.userId ? await staffIds(t.societyId) : [t.authorId];
  notifyLater(recipients.filter((id) => id !== m.userId), {
    type: 'TICKET_UPDATE',
    title: `New reply on "${t.title.slice(0, 40)}"`,
    body: c.body.slice(0, 120),
    data: { societyId: t.societyId, ticketId: t.id },
  });
  res.status(201).json({ id: c.id, body: c.body, createdAt: c.createdAt, author: toPublicUser(c.author), isMine: true });
});

// ─────────────── Vehicles & parking alerts ───────────────

societiesRouter.get('/:id/vehicles', async (req, res) => {
  const m = await requireMember(req, req.params.id);
  res.json({ items: await prisma.vehicle.findMany({ where: { societyId: m.societyId, userId: m.userId }, orderBy: { createdAt: 'desc' } }) });
});

societiesRouter.post(
  '/:id/vehicles',
  validate('body', z.object({ number: z.string().min(4).max(16), label: z.string().trim().max(40).optional() })),
  async (req, res) => {
    const m = await requireMember(req, req.params.id);
    const number = normalizeVehicleNumber(req.body.number);
    if (!number) throw badRequest('Enter a valid vehicle number, e.g. KA01AB1234');
    const count = await prisma.vehicle.count({ where: { userId: m.userId, societyId: m.societyId } });
    if (count >= 6) throw forbidden('At most 6 vehicles per resident');
    const existing = await prisma.vehicle.findUnique({ where: { societyId_number: { societyId: m.societyId, number } } });
    if (existing) throw conflict(existing.userId === m.userId ? 'Vehicle already added' : 'This vehicle is registered to another resident. Contact the RWA.');
    const v = await prisma.vehicle.create({ data: { userId: m.userId, societyId: m.societyId, number, label: req.body.label } });
    res.status(201).json(v);
  },
);

societiesRouter.delete('/:id/vehicles/:vid', async (req, res) => {
  const m = await requireMember(req, req.params.id);
  const r = await prisma.vehicle.deleteMany({ where: { id: req.params.vid, userId: m.userId, societyId: m.societyId } });
  if (!r.count) throw notFound('Vehicle');
  res.json({ ok: true });
});

societiesRouter.get('/:id/parking-alerts', async (req, res) => {
  const m = await requireMember(req, req.params.id);
  const alerts = await prisma.parkingAlert.findMany({
    where: { societyId: m.societyId, OR: [{ status: 'ACTIVE' }, { createdAt: { gt: new Date(Date.now() - 3 * 86400_000) } }] },
    include: { reporter: { select: publicUserSelect } },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 50,
  });
  res.json({
    items: alerts.map((a) => ({
      id: a.id,
      vehicleNumber: a.vehicleNumber,
      message: a.message,
      location: a.location,
      status: a.status,
      createdAt: a.createdAt,
      resolvedAt: a.resolvedAt,
      reporter: toPublicUser(a.reporter),
      isMine: a.reporterId === m.userId,
      isMyVehicle: a.ownerId === m.userId,
      ownerNotified: !!a.ownerId,
    })),
  });
});

societiesRouter.post(
  '/:id/parking-alerts',
  validate(
    'body',
    z.object({
      vehicleNumber: z.string().min(4).max(16),
      message: z.string().trim().min(3).max(300).default('Your vehicle is blocking mine. Please move it.'),
      location: z.string().trim().max(80).optional(),
    }),
  ),
  async (req, res) => {
    const m = await requireMember(req, req.params.id);
    const number = normalizeVehicleNumber(req.body.vehicleNumber);
    if (!number) throw badRequest('Enter a valid vehicle number, e.g. KA01AB1234');
    const recent = await prisma.parkingAlert.count({ where: { reporterId: m.userId, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
    if (recent >= 5) throw forbidden('Too many parking alerts. Please contact security.');
    const vehicle = await prisma.vehicle.findUnique({ where: { societyId_number: { societyId: m.societyId, number } } });
    const a = await prisma.parkingAlert.create({
      data: { societyId: m.societyId, reporterId: m.userId, ownerId: vehicle?.userId, vehicleNumber: number, message: clean(req.body.message), location: req.body.location },
    });
    const notice = {
      type: 'PARKING_ALERT' as const,
      title: `🚗 ${number}: please move your vehicle`,
      body: `${a.message}${a.location ? ` (${a.location})` : ''}`,
      data: { societyId: m.societyId, alertId: a.id },
      highPriority: true,
    };
    // Owner known → ping only them (privacy: reporter never sees the owner's identity or flat).
    // Unknown vehicle → escalate to the committee / security desk.
    if (vehicle && vehicle.userId !== m.userId) notifyLater([vehicle.userId], notice);
    else if (!vehicle) notifyLater((await staffIds(m.societyId)).filter((id) => id !== m.userId), { ...notice, title: `🚗 Unregistered vehicle ${number} reported` });
    res.status(201).json({ id: a.id, status: a.status, ownerNotified: !!vehicle });
  },
);

societiesRouter.post('/:id/parking-alerts/:aid/resolve', async (req, res) => {
  const m = await requireMember(req, req.params.id);
  const a = await prisma.parkingAlert.findUnique({ where: { id: req.params.aid } });
  if (!a || a.societyId !== m.societyId) throw notFound('Alert');
  if (a.status === 'RESOLVED') throw conflict('Already resolved');
  if (a.reporterId !== m.userId && a.ownerId !== m.userId && !STAFF.includes(m.role)) throw forbidden();
  await prisma.parkingAlert.update({ where: { id: a.id }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
  if (a.reporterId !== m.userId) {
    notifyLater([a.reporterId], { type: 'PARKING_ALERT', title: `✅ ${a.vehicleNumber} moved`, body: 'Your parking alert was resolved.', data: { societyId: a.societyId, alertId: a.id } });
  }
  res.json({ ok: true });
});
