import { beforeEach, describe, expect, it } from 'vitest';
import { addressVerified, drainJobs, HSR, locationVerified, login, makeAdmin, offset, prisma, resetDb, setHome, type TestUser } from './helpers';

beforeEach(resetDb);

const GATE = offset(HSR, 100, 100);

async function createSociety(admin: TestUser, extra: object = {}) {
  const r = await admin.post('/v1/societies', { name: 'Green Meadows Residency', type: 'GATED_COMMUNITY', addressLine: '27th Main, HSR Sector 2', city: 'Bengaluru', pincode: '560102', ...GATE, tower: 'B', unit: '1204', ...extra });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.body as { id: string; inviteCode: string };
}

describe('society creation', () => {
  it('requires LOCATION level and that the creator lives there', async () => {
    const phoneOnly = await login();
    await setHome(phoneOnly, GATE);
    expect((await phoneOnly.post('/v1/societies', { name: 'X Society', addressLine: 'Somewhere road', city: 'Bengaluru', pincode: '560102', ...GATE, unit: '1' })).status).toBe(403);
    const faraway = await locationVerified('Far', offset(HSR, 2000, 0));
    const r = await faraway.post('/v1/societies', { name: 'X Society', addressLine: 'Somewhere road', city: 'Bengaluru', pincode: '560102', ...GATE, unit: '1' });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/300 m/);
  });

  it('creator becomes RWA admin; duplicates within 75 m are refused', async () => {
    const admin = await locationVerified('Priya', GATE);
    const s = await createSociety(admin);
    const detail = await admin.get(`/v1/societies/${s.id}`);
    expect(detail.body).toMatchObject({ membership: { role: 'RWA_ADMIN', status: 'APPROVED' }, memberCount: 1, isVerified: false });
    expect(detail.body.inviteCode).toMatch(/^[A-Z2-9]{8}$/);
    const other = await locationVerified('Other', offset(GATE, 20, 20));
    const dup = await other.post('/v1/societies', { name: 'Green Meadows 2', addressLine: '27th Main road', city: 'Bengaluru', pincode: '560102', ...offset(GATE, 30, 0), unit: '5' });
    expect(dup.status).toBe(409);
  });
});

describe('joining & approvals', () => {
  it('geo-fences join requests, then RWA approves → member; verified society upgrades address', async () => {
    const admin = await locationVerified('Priya', GATE);
    const s = await createSociety(admin);
    await prisma.society.update({ where: { id: s.id }, data: { isVerified: true } });

    const outsider = await locationVerified('Outsider', offset(HSR, 1500, 0));
    const no = await outsider.post('/v1/societies/join', { societyId: s.id, unit: '101' });
    expect(no.status).toBe(403);
    expect(no.body.error.message).toMatch(/Only residents/);

    const resident = await locationVerified('Arjun', offset(GATE, 40, -30));
    const req = await resident.post('/v1/societies/join', { societyId: s.id, tower: 'A', unit: '803', occupancy: 'TENANT' });
    expect(req.body.status).toBe('PENDING');
    expect((await resident.post('/v1/societies/join', { societyId: s.id, unit: '803' })).status).toBe(409);

    // Pending members can't see private content.
    expect((await resident.get(`/v1/societies/${s.id}/notices`)).status).toBe(403);
    // Residents can't see the pending queue; admin can.
    const pending = await admin.get(`/v1/societies/${s.id}/members?status=PENDING`);
    expect(pending.body.items).toHaveLength(1);
    await drainJobs();
    expect(await prisma.notification.count({ where: { userId: admin.id, type: 'SOCIETY_MEMBERSHIP' } })).toBe(1);

    const ok = await admin.post(`/v1/societies/${s.id}/members/${pending.body.items[0].membershipId}/approve`);
    expect(ok.status).toBe(200);
    expect((await admin.post(`/v1/societies/${s.id}/members/${pending.body.items[0].membershipId}/approve`)).status).toBe(409);
    expect((await resident.get(`/v1/societies/${s.id}/notices`)).status).toBe(200);
    expect((await resident.get('/v1/me')).body.verificationLevel).toBe('ADDRESS');
    expect((await admin.get(`/v1/societies/${s.id}`)).body.memberCount).toBe(2);
    expect((await resident.get(`/v1/societies/${s.id}/members?status=PENDING`)).status).toBe(403);
  });

  it('approval in an UNVERIFIED society grants access but not ADDRESS level', async () => {
    const admin = await locationVerified('Priya', GATE);
    const s = await createSociety(admin);
    const resident = await locationVerified('Arjun', offset(GATE, 40, -30));
    await resident.post('/v1/societies/join', { societyId: s.id, unit: '803' });
    const pending = await admin.get(`/v1/societies/${s.id}/members?status=PENDING`);
    await admin.post(`/v1/societies/${s.id}/members/${pending.body.items[0].membershipId}/approve`);
    expect((await resident.get('/v1/me')).body.verificationLevel).toBe('LOCATION');
    // Platform verifies the society later → retroactive upgrade.
    const ops = await login();
    await makeAdmin(ops);
    expect((await ops.post(`/v1/admin/societies/${s.id}/verify`)).body.membersReverified).toBe(2);
    expect((await resident.get('/v1/me')).body.verificationLevel).toBe('ADDRESS');
  });

  it('invite code + auto-approve setting joins instantly; rotating the code invalidates the old one', async () => {
    const admin = await locationVerified('Priya', GATE);
    const s = await createSociety(admin);
    await admin.patch(`/v1/societies/${s.id}`, { requireApproval: false });
    const code = (await admin.get(`/v1/societies/${s.id}`)).body.inviteCode;
    const resident = await locationVerified('Meera', offset(GATE, -20, 10));
    const j = await resident.post('/v1/societies/join', { inviteCode: code.toLowerCase(), unit: '402' });
    expect(j.body.status).toBe('APPROVED');
    const rotated = await admin.post(`/v1/societies/${s.id}/invite-code/rotate`);
    expect(rotated.body.inviteCode).not.toBe(code);
    const late = await locationVerified('Late', offset(GATE, -25, 10));
    expect((await late.post('/v1/societies/join', { inviteCode: code, unit: '9' })).status).toBe(404);
    // Only RWA_ADMIN may rotate.
    expect((await resident.post(`/v1/societies/${s.id}/invite-code/rotate`)).status).toBe(403);
  });

  it('rejected users are notified and may re-apply; last admin cannot leave', async () => {
    const admin = await locationVerified('Priya', GATE);
    const s = await createSociety(admin);
    const u = await locationVerified('Ravi', offset(GATE, 10, 10));
    await u.post('/v1/societies/join', { societyId: s.id, unit: '7' });
    const p = await admin.get(`/v1/societies/${s.id}/members?status=PENDING`);
    await admin.post(`/v1/societies/${s.id}/members/${p.body.items[0].membershipId}/reject`);
    expect((await u.post('/v1/societies/join', { societyId: s.id, unit: '7' })).body.status).toBe('PENDING');
    expect((await admin.del(`/v1/societies/${s.id}/membership`)).status).toBe(403);
  });
});

describe('society features', () => {
  async function setup() {
    const admin = await locationVerified('Priya', GATE);
    const s = await createSociety(admin);
    await admin.patch(`/v1/societies/${s.id}`, { requireApproval: false });
    const code = (await admin.get(`/v1/societies/${s.id}`)).body.inviteCode;
    const a = await locationVerified('Arjun', offset(GATE, 20, 0));
    const b = await locationVerified('Meera', offset(GATE, 0, 20));
    await a.post('/v1/societies/join', { inviteCode: code, tower: 'A', unit: '803' });
    await b.post('/v1/societies/join', { inviteCode: code, tower: 'C', unit: '402' });
    return { admin, s, a, b };
  }

  it('notice board: committee posts, members read (pinned first), residents cannot post', async () => {
    const { admin, s, a } = await setup();
    expect((await a.post(`/v1/societies/${s.id}/notices`, { title: 'Hack', body: 'Residents cannot post notices' })).status).toBe(403);
    await admin.post(`/v1/societies/${s.id}/notices`, { title: 'Diwali meeting', body: 'Clubhouse at 6pm Sunday', category: 'EVENT' });
    await admin.post(`/v1/societies/${s.id}/notices`, { title: 'Water cut Saturday', body: 'Store water on Friday', category: 'WATER', isPinned: true });
    const list = await a.get(`/v1/societies/${s.id}/notices`);
    expect(list.body.items.map((n: { title: string }) => n.title)).toEqual(['Water cut Saturday', 'Diwali meeting']);
    await drainJobs();
    expect(await prisma.notification.count({ where: { userId: a.id, type: 'SOCIETY_NOTICE' } })).toBe(2);
    // Promote Arjun to committee → can post.
    const members = await admin.get(`/v1/societies/${s.id}/members`);
    const arjun = members.body.items.find((m: { user: { id: string } }) => m.user.id === a.id);
    await admin.patch(`/v1/societies/${s.id}/members/${arjun.membershipId}`, { role: 'RWA_COMMITTEE' });
    expect((await a.post(`/v1/societies/${s.id}/notices`, { title: 'Now I can', body: 'Committee member notice' })).status).toBe(201);
  });

  it('helpdesk: residents raise, committee drives status, private tickets stay private', async () => {
    const { admin, s, a, b } = await setup();
    const t = await a.post(`/v1/societies/${s.id}/tickets`, { title: 'Lift 2 stuck again', description: 'Stopped between 5th and 6th floor twice', category: 'LIFT' });
    expect(t.status).toBe(201);
    expect((await a.patch(`/v1/societies/${s.id}/tickets/${t.body.id}`, { status: 'RESOLVED' })).status).toBe(403);
    expect((await admin.patch(`/v1/societies/${s.id}/tickets/${t.body.id}`, { status: 'IN_PROGRESS' })).body.status).toBe('IN_PROGRESS');
    await admin.post(`/v1/societies/${s.id}/tickets/${t.body.id}/comments`, { body: 'Technician coming Thursday' });
    const d = await a.get(`/v1/societies/${s.id}/tickets/${t.body.id}`);
    expect(d.body).toMatchObject({ status: 'IN_PROGRESS', canManage: false, isMine: true });
    expect(d.body.comments).toHaveLength(1);
    expect((await a.patch(`/v1/societies/${s.id}/tickets/${t.body.id}`, { status: 'CLOSED' })).body.status).toBe('CLOSED');

    const priv = await a.post(`/v1/societies/${s.id}/tickets`, { title: 'Neighbour noise complaint', description: 'Loud music after midnight from flat 902', isPrivate: true, category: 'SECURITY' });
    expect((await b.get(`/v1/societies/${s.id}/tickets/${priv.body.id}`)).status).toBe(404);
    expect((await b.get(`/v1/societies/${s.id}/tickets`)).body.items.map((x: { id: string }) => x.id)).not.toContain(priv.body.id);
    expect((await admin.get(`/v1/societies/${s.id}/tickets/${priv.body.id}`)).status).toBe(200);
    await drainJobs();
    expect(await prisma.notification.count({ where: { userId: a.id, type: 'TICKET_UPDATE' } })).toBeGreaterThanOrEqual(2);
  });

  it('parking alerts reach only the registered owner; unknown vehicles escalate to the committee', async () => {
    const { admin, s, a, b } = await setup();
    expect((await a.post(`/v1/societies/${s.id}/vehicles`, { number: 'ka-01 ab 1234', label: 'White Swift' })).body.number).toBe('KA01AB1234');
    expect((await b.post(`/v1/societies/${s.id}/vehicles`, { number: 'KA01AB1234' })).status).toBe(409);
    expect((await b.post(`/v1/societies/${s.id}/vehicles`, { number: 'not a plate' })).status).toBe(400);

    const alert = await b.post(`/v1/societies/${s.id}/parking-alerts`, { vehicleNumber: 'KA 01 AB 1234', location: 'Visitor slot V3' });
    expect(alert.body.ownerNotified).toBe(true);
    await drainJobs();
    expect(await prisma.notification.count({ where: { userId: a.id, type: 'PARKING_ALERT' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: admin.id, type: 'PARKING_ALERT' } })).toBe(0);
    const list = await a.get(`/v1/societies/${s.id}/parking-alerts`);
    expect(list.body.items[0]).toMatchObject({ isMyVehicle: true, status: 'ACTIVE' });
    expect(JSON.stringify(list.body)).not.toContain(a.phone);
    expect((await a.post(`/v1/societies/${s.id}/parking-alerts/${alert.body.id}/resolve`)).status).toBe(200);
    expect((await a.post(`/v1/societies/${s.id}/parking-alerts/${alert.body.id}/resolve`)).status).toBe(409);

    const unknown = await b.post(`/v1/societies/${s.id}/parking-alerts`, { vehicleNumber: 'MH12DE1433' });
    expect(unknown.body.ownerNotified).toBe(false);
    await drainJobs();
    expect(await prisma.notification.count({ where: { userId: admin.id, type: 'PARKING_ALERT' } })).toBe(1);
  });

  it('non-members get nothing private; /mine lists memberships with pending counts for staff', async () => {
    const { admin, s } = await setup();
    const stranger = await addressVerified('Stranger', offset(GATE, 50, 50));
    for (const path of ['notices', 'tickets', 'parking-alerts', 'members', 'vehicles']) {
      expect((await stranger.get(`/v1/societies/${s.id}/${path}`)).status).toBe(403);
    }
    const pub = await stranger.get(`/v1/societies/${s.id}`);
    expect(pub.body.inviteCode).toBeUndefined();
    expect(pub.body.stats).toBeUndefined();
    const near = await stranger.get('/v1/societies/nearby');
    expect(near.body.items[0]).toMatchObject({ name: 'Green Meadows Residency' });
    const mine = await admin.get('/v1/societies/mine');
    expect(mine.body.items[0]).toMatchObject({ role: 'RWA_ADMIN', pendingRequests: 0 });
  });
});
