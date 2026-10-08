/**
 * Trust ladder: PHONE → LOCATION → ADDRESS.
 *
 * The level is always DERIVED from evidence (GPS checks, vouches, RWA approval)
 * by `recomputeLevel`, never set directly by a route. That keeps one source of
 * truth and makes downgrades (address change, revoked membership) automatic.
 *
 * Zero-manual-overhead path for most users:
 *   1. OTP                       → PHONE   (SIM is KYC'd in India: real identity anchor)
 *   2. 2× on-device GPS checks   → LOCATION (≥ GPS_CHECK_MIN_GAP_HOURS apart, mock-location rejected)
 *   3. RWA admin approves / society invite code / 2 neighbour vouches → ADDRESS
 * The platform team only reviews societies (RWA registration), not individuals.
 */
import { MembershipStatus, VerificationLevel, VerificationMethod } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { distanceBetween, getPoint, getUserHome, pointSql } from '../lib/geo';
import { badRequest, conflict, forbidden, notFound, tooMany } from '../lib/errors';
import { notifyLater } from './notify';

const VOUCH_RADIUS_M = 1000;
const MAX_VOUCHES_PER_30D = 5;
const SOCIETY_MATCH_RADIUS_M = 500;

export async function getPrimaryAddress(userId: string) {
  return prisma.address.findFirst({ where: { userId, isPrimary: true }, orderBy: { createdAt: 'desc' } });
}

/** Greedy count of passing checks that are at least `gapH` hours apart. */
export function countSpacedChecks(times: Date[], gapH: number): number {
  const sorted = [...times].sort((a, b) => a.getTime() - b.getTime());
  let count = 0;
  let last = -Infinity;
  for (const t of sorted) {
    if (t.getTime() - last >= gapH * 3600_000) {
      count++;
      last = t.getTime();
    }
  }
  return count;
}

export async function gpsProgress(addressId: string) {
  const passed = await prisma.locationCheck.findMany({ where: { addressId, passed: true }, select: { createdAt: true }, orderBy: { createdAt: 'asc' } });
  const spaced = countSpacedChecks(passed.map((p) => p.createdAt), env.GPS_CHECK_MIN_GAP_HOURS);
  const last = passed[passed.length - 1]?.createdAt;
  const eligible = last ? new Date(last.getTime() + env.GPS_CHECK_MIN_GAP_HOURS * 3600_000) : null;
  // Only report a wait if it's actually in the future.
  const nextEligibleAt = eligible && spaced < env.GPS_CHECKS_REQUIRED && eligible.getTime() > Date.now() ? eligible : null;
  return { passed: spaced, required: env.GPS_CHECKS_REQUIRED, done: spaced >= env.GPS_CHECKS_REQUIRED, nextEligibleAt };
}

/** Recompute and persist the user's verification level from evidence. */
export async function recomputeLevel(userId: string): Promise<VerificationLevel> {
  const address = await getPrimaryAddress(userId);
  let level: VerificationLevel = VerificationLevel.PHONE;
  if (address) {
    const gps = await gpsProgress(address.id);
    if (address.status === 'PENDING' && gps.done) {
      // Vouches only count once the vouchee has physically proven presence.
      const vouches = await prisma.vouch.count({ where: { addressId: address.id } });
      if (vouches >= env.VOUCHES_REQUIRED) {
        await prisma.address.update({
          where: { id: address.id },
          data: { status: 'VERIFIED', method: VerificationMethod.NEIGHBOR_VOUCH, verifiedAt: new Date() },
        });
        address.status = 'VERIFIED';
      }
    }
    if (address.status === 'VERIFIED') level = VerificationLevel.ADDRESS;
    else if (gps.done) level = VerificationLevel.LOCATION;
  }
  const prev = await prisma.user.findUnique({ where: { id: userId }, select: { verificationLevel: true } });
  if (prev && prev.verificationLevel !== level) {
    await prisma.user.update({ where: { id: userId }, data: { verificationLevel: level } });
    if (level !== 'PHONE') {
      notifyLater([userId], {
        type: 'SYSTEM',
        title: level === 'ADDRESS' ? 'Address verified ✅' : 'Location verified 📍',
        body: level === 'ADDRESS' ? 'You now have full access, including your society group.' : 'You can now post in your neighbourhood feed.',
      });
    }
  }
  return level;
}

/** Record an on-device GPS reading against the user's claimed home pin. */
export async function recordGpsCheck(userId: string, input: { lat: number; lng: number; accuracyM: number; isMocked?: boolean }) {
  const address = await getPrimaryAddress(userId);
  if (!address) throw badRequest('Add your home address first');
  const home = await getPoint('addresses', address.id);
  if (!home) throw badRequest('Address has no location');

  const recent = await prisma.locationCheck.count({ where: { userId, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
  if (recent >= 10) throw tooMany('Too many location checks. Try again later.');

  const distanceM = await distanceBetween(home, input);
  const reasons: string[] = [];
  if (input.isMocked) reasons.push('Mock location detected. Disable location-spoofing apps.');
  if (input.accuracyM > env.GPS_MAX_ACCURACY_M) reasons.push('GPS signal is weak. Step near a window or outdoors and retry.');
  if (distanceM > env.GPS_MAX_DISTANCE_M) reasons.push(`You appear to be ${Math.round(distanceM)} m from your home pin. Run this check while at home.`);
  const passed = reasons.length === 0;

  // `location` is a required Unsupported column → insert via parameterised raw SQL.
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO location_checks (id, "userId", "addressId", location, "accuracyM", "distanceM", passed, "isMocked")
    VALUES (gen_random_uuid(), ${userId}::uuid, ${address.id}::uuid, ${pointSql(input)},
            ${input.accuracyM}::float8, ${distanceM}::float8, ${passed}, ${!!input.isMocked})
    RETURNING id`;
  const checkId = rows[0].id;

  const level = await recomputeLevel(userId);
  return { checkId, passed, distanceM: Math.round(distanceM), reasons, level, progress: await gpsProgress(address.id) };
}

/** An ADDRESS-verified neighbour vouches that `voucheeId` lives at their claimed address. */
export async function vouchForNeighbor(voucherId: string, voucheeId: string) {
  if (voucherId === voucheeId) throw badRequest("You can't vouch for yourself");
  const voucher = await prisma.user.findUnique({ where: { id: voucherId }, select: { verificationLevel: true, name: true } });
  if (voucher?.verificationLevel !== 'ADDRESS') throw forbidden('Only address-verified residents can vouch');
  const address = await getPrimaryAddress(voucheeId);
  if (!address) throw notFound('Neighbour address');
  if (address.status === 'VERIFIED') throw conflict('This neighbour is already verified');

  const [vHome, aLoc] = await Promise.all([getUserHome(voucherId), getPoint('addresses', address.id)]);
  if (!vHome || !aLoc) throw badRequest('Location missing');
  if ((await distanceBetween(vHome, aLoc)) > VOUCH_RADIUS_M) throw forbidden('You can only vouch for neighbours within 1 km of your home');

  const given = await prisma.vouch.count({ where: { voucherId, createdAt: { gt: new Date(Date.now() - 30 * 86400_000) } } });
  if (given >= MAX_VOUCHES_PER_30D) throw tooMany('You can vouch for at most 5 neighbours per month');

  if (await prisma.vouch.findUnique({ where: { voucherId_voucheeId: { voucherId, voucheeId } } })) throw conflict('You have already vouched for this neighbour');
  await prisma.vouch.create({ data: { voucherId, voucheeId, addressId: address.id } });
  notifyLater([voucheeId], { type: 'VOUCH_RECEIVED', title: 'A neighbour vouched for you', body: `${voucher.name ?? 'A neighbour'} confirmed you live nearby.` });
  const level = await recomputeLevel(voucheeId);
  return { level, vouches: await prisma.vouch.count({ where: { addressId: address.id } }), required: env.VOUCHES_REQUIRED };
}

/**
 * Called when a society membership becomes APPROVED. If the society itself is
 * platform-verified and the member's home pin is within the compound, the
 * RWA's approval verifies the address.
 */
export async function applySocietyApproval(userId: string, societyId: string, method: VerificationMethod) {
  const society = await prisma.society.findUnique({ where: { id: societyId }, select: { isVerified: true } });
  const address = await getPrimaryAddress(userId);
  if (!society?.isVerified || !address) return recomputeLevel(userId);
  const [sLoc, aLoc] = await Promise.all([getPoint('societies', societyId), getPoint('addresses', address.id)]);
  if (sLoc && aLoc && (await distanceBetween(sLoc, aLoc)) <= SOCIETY_MATCH_RADIUS_M) {
    await prisma.address.update({ where: { id: address.id }, data: { status: 'VERIFIED', method, verifiedAt: new Date(), societyId } });
  }
  return recomputeLevel(userId);
}

export async function isApprovedMember(userId: string, societyId: string) {
  const m = await prisma.societyMembership.findUnique({ where: { societyId_userId: { societyId, userId } } });
  return m?.status === MembershipStatus.APPROVED ? m : null;
}
