/**
 * Development / demo seed — Bengaluru (HSR Layout, Koramangala, Indiranagar).
 *
 *   npm run db:seed
 *
 * Demo logins (OTP_PROVIDER=dev shows the code in the app):
 *   +91 99000 00001  Priya Sharma   — RWA admin, Green Meadows Residency (ADDRESS verified)
 *   +91 99000 00002  Arjun Mehta    — resident, same society (ADDRESS verified)
 *   +91 99000 00003  Kavya Reddy    — owns "Filter Kaapi House" café (LOCATION verified)
 *   +91 99000 00009  Platform admin
 * Any other number signs up as a brand-new user.
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const HSR = { lat: 12.9116, lng: 77.6474 };
const KORA = { lat: 12.9352, lng: 77.6245 };
const INDIRA = { lat: 12.9784, lng: 77.6408 };

type P = { lat: number; lng: number };
const pt = (p: P) => Prisma.sql`ST_SetSRID(ST_MakePoint(${p.lng}::float8, ${p.lat}::float8), 4326)::geography`;
const fuzz = (p: P) => Prisma.sql`ST_SnapToGrid(ST_SetSRID(ST_MakePoint(${p.lng}::float8, ${p.lat}::float8), 4326), 0.0015)::geography`;
/** Offset a point by metres (good enough at city scale). */
const offset = (p: P, northM: number, eastM: number): P => ({
  lat: p.lat + northM / 111_320,
  lng: p.lng + eastM / (111_320 * Math.cos((p.lat * Math.PI) / 180)),
});
const box = (c: P, halfM: number) => {
  const sw = offset(c, -halfM, -halfM);
  const ne = offset(c, halfM, halfM);
  return { type: 'MultiPolygon', coordinates: [[[[sw.lng, sw.lat], [ne.lng, sw.lat], [ne.lng, ne.lat], [sw.lng, ne.lat], [sw.lng, sw.lat]]]] };
};

async function setGeo(table: string, column: string, id: string, p: P, fuzzed = false) {
  await prisma.$executeRaw`UPDATE ${Prisma.raw(`"${table}"`)} SET ${Prisma.raw(`"${column}"`)} = ${fuzzed ? fuzz(p) : pt(p)} WHERE id = ${id}::uuid`;
}

async function main() {
  console.log('🧹 Resetting data…');
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);

  console.log('🗺️  Neighbourhoods…');
  const hoods: Record<string, string> = {};
  for (const [slug, name, c, half] of [
    ['hsr-layout', 'HSR Layout', HSR, 1800],
    ['koramangala', 'Koramangala', KORA, 1600],
    ['indiranagar', 'Indiranagar', INDIRA, 1600],
  ] as const) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO neighborhoods (id, name, slug, city, state, boundary, center, status)
      VALUES (gen_random_uuid(), ${name}, ${slug}, 'Bengaluru', 'Karnataka',
              ST_GeomFromGeoJSON(${JSON.stringify(box(c, half))})::geography, ${pt(c)}, 'ACTIVE')
      RETURNING id`;
    hoods[slug] = rows[0].id;
  }

  console.log('👥 Users…');
  const societyGate = offset(HSR, 200, -150);
  const mk = async (
    phone: string,
    name: string,
    home: P,
    level: 'PHONE' | 'LOCATION' | 'ADDRESS',
    extra: Partial<Prisma.UserUncheckedCreateInput> = {},
    addr?: { unit: string; building?: string },
  ) => {
    const u = await prisma.user.create({
      data: { phone, name, verificationLevel: level, neighborhoodId: hoods['hsr-layout'], feedRadiusM: 3000, bio: extra.bio, platformRole: extra.platformRole },
    });
    await setGeo('users', 'homeLocation', u.id, home);
    const a = await prisma.$transaction(async (tx) => {
      const a = await tx.address.create({
        data: {
          userId: u.id,
          unit: addr?.unit ?? `${Math.floor(Math.random() * 900) + 100}`,
          building: addr?.building,
          street: '27th Main Road',
          locality: 'HSR Layout Sector 2',
          city: 'Bengaluru',
          pincode: '560102',
          neighborhoodId: hoods['hsr-layout'],
          status: level === 'ADDRESS' ? 'VERIFIED' : 'PENDING',
          method: level === 'ADDRESS' ? 'SOCIETY_ADMIN' : null,
          verifiedAt: level === 'ADDRESS' ? new Date() : null,
        },
      });
      await tx.$executeRaw`UPDATE addresses SET location = ${pt(home)} WHERE id = ${a.id}::uuid`;
      return a;
    });
    if (level !== 'PHONE') {
      // Two passing GPS checks 8h apart → LOCATION evidence.
      for (const hoursAgo of [30, 20]) {
        await prisma.$executeRaw`
          INSERT INTO location_checks (id, "userId", "addressId", location, "accuracyM", "distanceM", passed, "createdAt")
          VALUES (gen_random_uuid(), ${u.id}::uuid, ${a.id}::uuid, ${pt(home)}, 12, 8, true, now() - make_interval(hours => ${hoursAgo}::int))`;
      }
    }
    return u;
  };

  const priya = await mk('+919900000001', 'Priya Sharma', offset(societyGate, 20, 10), 'ADDRESS', { bio: 'RWA secretary · Plant mom · Weekend baker' }, { unit: '1204', building: 'Tower B' });
  const arjun = await mk('+919900000002', 'Arjun Mehta', offset(societyGate, -30, 40), 'ADDRESS', { bio: 'Cyclist. Ask me about trails around Agara lake.' }, { unit: '803', building: 'Tower A' });
  const kavya = await mk('+919900000003', 'Kavya Reddy', offset(HSR, -400, 500), 'LOCATION', { bio: 'Running Filter Kaapi House ☕' });
  const rohan = await mk('+919900000004', 'Rohan Iyer', offset(HSR, 600, 300), 'LOCATION', { bio: 'Badminton every evening at 7' });
  const fatima = await mk('+919900000005', 'Fatima Khan', offset(HSR, -800, -600), 'ADDRESS', { bio: 'Teacher · Book club host' });
  const sanjay = await mk('+919900000006', 'Sanjay Gupta', offset(HSR, 1200, -900), 'LOCATION');
  const meera = await mk('+919900000007', 'Meera Nair', offset(societyGate, 15, -35), 'ADDRESS', { bio: 'Tower C · Carnatic music lover' }, { unit: '402', building: 'Tower C' });
  await mk('+919900000009', 'Mohalla Admin', offset(HSR, 0, 0), 'ADDRESS', { platformRole: 'ADMIN' });
  // Background residents so neighbourhood stats & neighbour directory look alive.
  for (let i = 0; i < 40; i++) {
    const angle = (i / 40) * Math.PI * 2;
    const r = 300 + ((i * 97) % 2400);
    await mk(`+9198${String(10000000 + i).slice(0, 8)}`, ['Ananya', 'Vikram', 'Sneha', 'Rahul', 'Divya', 'Karthik', 'Pooja', 'Aditya'][i % 8] + ' ' + ['Rao', 'Patel', 'Singh', 'Menon', 'Das', 'Joshi', 'Pillai', 'Bose'][(i * 3) % 8], offset(HSR, Math.sin(angle) * r, Math.cos(angle) * r), i % 3 === 0 ? 'ADDRESS' : 'LOCATION');
  }
  await prisma.neighborhood.update({ where: { id: hoods['hsr-layout'] }, data: { memberCount: await prisma.user.count({ where: { neighborhoodId: hoods['hsr-layout'] } }) } });

  console.log('🏢 Society…');
  const society = await prisma.$transaction(async (tx) => {
    const s = await tx.society.create({
      data: {
        name: 'Green Meadows Residency',
        type: 'GATED_COMMUNITY',
        addressLine: '27th Main Road, HSR Layout Sector 2',
        city: 'Bengaluru',
        pincode: '560102',
        neighborhoodId: hoods['hsr-layout'],
        inviteCode: 'GREEN234',
        requireApproval: true,
        isVerified: true,
        createdById: priya.id,
        memberCount: 3,
      },
    });
    await tx.$executeRaw`UPDATE societies SET location = ${pt(societyGate)} WHERE id = ${s.id}::uuid`;
    return s;
  });
  await prisma.societyMembership.createMany({
    data: [
      { societyId: society.id, userId: priya.id, role: 'RWA_ADMIN', status: 'APPROVED', tower: 'B', unit: '1204', approvedAt: new Date() },
      { societyId: society.id, userId: arjun.id, role: 'RESIDENT', status: 'APPROVED', tower: 'A', unit: '803', approvedAt: new Date(), approvedById: priya.id },
      { societyId: society.id, userId: meera.id, role: 'RWA_COMMITTEE', status: 'APPROVED', tower: 'C', unit: '402', approvedAt: new Date(), approvedById: priya.id },
    ],
  });
  await prisma.address.updateMany({ where: { userId: { in: [priya.id, arjun.id, meera.id] } }, data: { societyId: society.id } });
  await prisma.vehicle.createMany({
    data: [
      { userId: arjun.id, societyId: society.id, number: 'KA01AB1234', label: 'White Swift' },
      { userId: priya.id, societyId: society.id, number: 'KA05MN4321', label: 'Activa' },
    ],
  });
  await prisma.notice.createMany({
    data: [
      { societyId: society.id, authorId: priya.id, title: 'Water supply interruption — Saturday 10am–2pm', body: 'BWSSB is replacing the main valve on 27th Main. Please store water on Friday night. Tanker backup arranged for Tower C.', category: 'WATER', isPinned: true },
      { societyId: society.id, authorId: priya.id, title: 'Q3 maintenance due by 15th', body: 'Maintenance of ₹4.2/sq ft for Jul–Sep is due. Pay via the society UPI ID greenmeadows@okhdfc. Late fee applies after the 15th.', category: 'PAYMENT' },
      { societyId: society.id, authorId: meera.id, title: 'Diwali celebration planning meeting', body: 'All residents welcome at the clubhouse this Sunday 6pm. Volunteers needed for rangoli and kids games!', category: 'EVENT' },
    ],
  });
  const ticket = await prisma.ticket.create({
    data: { societyId: society.id, authorId: arjun.id, title: 'Tower A lift stuck between floors twice this week', description: 'Lift 2 in Tower A stopped between 5th and 6th floor on Monday and Wednesday. Please get the AMC vendor to inspect urgently.', category: 'LIFT', status: 'IN_PROGRESS' },
  });
  await prisma.ticketComment.create({ data: { ticketId: ticket.id, authorId: meera.id, body: 'Otis technician scheduled for Thursday 11am. Please use Lift 1 till then.' } });
  await prisma.ticket.create({ data: { societyId: society.id, authorId: meera.id, title: 'Garbage segregation not followed in basement', description: 'Wet and dry waste are being mixed near the B2 bins. Requesting housekeeping to put up signage.', category: 'HOUSEKEEPING' } });
  await prisma.parkingAlert.create({ data: { societyId: society.id, reporterId: meera.id, ownerId: priya.id, vehicleNumber: 'KA05MN4321', message: 'Scooter parked in front of visitor slot V3', location: 'Visitor parking', status: 'RESOLVED', resolvedAt: new Date() } });

  console.log('📰 Posts…');
  const posts: { author: string; home: P; data: Partial<Prisma.PostUncheckedCreateInput>; hoursAgo: number }[] = [
    { author: rohan.id, home: offset(HSR, 600, 300), hoursAgo: 1, data: { type: 'ALERT', severity: 'WARNING', title: 'Chain snatching near 19th Main bus stop', body: 'Two men on a black Pulsar snatched a chain around 8:30pm near the 19th Main bus stop. Police informed (HSR PS: 080-22942573). Please be careful while walking alone in the evening.', expiresAt: new Date(Date.now() + 23 * 3600_000) } },
    { author: arjun.id, home: offset(societyGate, -30, 40), hoursAgo: 3, data: { type: 'CLASSIFIED', title: 'Decathlon cycle (Btwin Rockrider ST100)', body: 'Used for 1 year, serviced last month. New tyres. Pickup from Green Meadows, HSR Sector 2.', pricePaise: 650000, condition: 'GOOD', images: ['https://images.unsplash.com/photo-1532298229144-0ec0c57515c7?w=800'] } },
    { author: rohan.id, home: offset(HSR, 600, 300), hoursAgo: 5, data: { type: 'HOBBY', title: 'Badminton partners wanted 🏸', body: 'Looking for 2 intermediate players for doubles at the BDA complex court, weekdays 7–8pm. Shuttles on me!', hobbyTag: 'badminton' } },
    { author: fatima.id, home: offset(HSR, -800, -600), hoursAgo: 8, data: { type: 'RECOMMENDATION', title: 'Reliable AC service?', body: 'Need an AC technician for a split-AC gas refill this week. Any recommendations from neighbours? Last guy overcharged me ₹3,500.' } },
    { author: kavya.id, home: offset(HSR, -400, 500), hoursAgo: 12, data: { type: 'EVENT', title: 'Open mic night at Filter Kaapi House', body: 'Poetry, music and stand-up this Friday from 7pm. Free entry, filter coffee on the house for performers!', eventAt: new Date(Date.now() + 3 * 86400_000) } },
    { author: sanjay.id, home: offset(HSR, 1200, -900), hoursAgo: 20, data: { type: 'LOST_FOUND', title: 'Found: brown Labrador near Agara lake', body: 'Friendly lab with a red collar, no tag. Currently safe with us near 14th Cross. Call/DM if yours!', expiresAt: new Date(Date.now() + 13 * 86400_000) } },
    { author: meera.id, home: offset(societyGate, 15, -35), hoursAgo: 26, data: { type: 'CLASSIFIED', title: 'IKEA study table + chair', body: 'Moving out sale. Table (120x60) and ergonomic chair. Excellent condition.', pricePaise: 450000, condition: 'LIKE_NEW', images: ['https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?w=800'] } },
    { author: priya.id, home: offset(societyGate, 20, 10), hoursAgo: 30, data: { type: 'GENERAL', title: 'Tree plantation drive this Sunday 🌱', body: 'BBMP is giving free saplings. We are planting 50 trees along 27th Main at 7am. Bring gloves and water bottles — kids welcome!' } },
    { author: fatima.id, home: offset(HSR, -800, -600), hoursAgo: 40, data: { type: 'HOBBY', title: 'Kannada–English book club', body: 'Monthly meet-up, first Saturday. This month: "Samskara" by U.R. Ananthamurthy. All levels welcome.', hobbyTag: 'books' } },
    { author: sanjay.id, home: offset(HSR, 1200, -900), hoursAgo: 50, data: { type: 'ALERT', severity: 'INFO', title: 'Power cut tomorrow 10am–4pm', body: 'BESCOM scheduled maintenance for sectors 1 & 2. Charge your devices!', expiresAt: new Date(Date.now() + 20 * 3600_000) } },
  ];
  for (const p of posts) {
    await prisma.$transaction(async (tx) => {
      const created = await tx.post.create({
        data: { authorId: p.author, neighborhoodId: hoods['hsr-layout'], body: '', ...p.data, createdAt: new Date(Date.now() - p.hoursAgo * 3600_000) } as Prisma.PostUncheckedCreateInput,
      });
      await tx.$executeRaw`UPDATE posts SET location = ${fuzz(p.home)} WHERE id = ${created.id}::uuid`;
    });
  }
  const cycle = await prisma.post.findFirstOrThrow({ where: { title: { startsWith: 'Decathlon' } } });
  await prisma.comment.create({ data: { postId: cycle.id, authorId: rohan.id, body: 'Is the price negotiable? Can I see it this evening?' } });
  await prisma.post.update({ where: { id: cycle.id }, data: { commentCount: 1, likeCount: 2 } });
  await prisma.postReaction.createMany({ data: [{ postId: cycle.id, userId: rohan.id }, { postId: cycle.id, userId: fatima.id }] });

  console.log('☕ Businesses…');
  const mkBiz = async (owner: string, loc: P, data: Omit<Prisma.BusinessUncheckedCreateInput, 'ownerId'>) =>
    prisma.$transaction(async (tx) => {
      // Established shops opened long ago; only explicitly new ones get the "New" badge.
      const b = await tx.business.create({ data: { openedAt: new Date(Date.now() - 2 * 365 * 86400_000), ...data, ownerId: owner } });
      await tx.$executeRaw`UPDATE businesses SET location = ${pt(loc)} WHERE id = ${b.id}::uuid`;
      return b;
    });
  const cafe = await mkBiz(kavya.id, offset(HSR, -350, 520), {
    name: 'Filter Kaapi House',
    category: 'CAFE',
    description: 'South Indian filter coffee, ghee podi idli and fresh Mysore pak. Work-friendly with fast Wi-Fi.',
    phone: '+919900000003',
    whatsapp: '+919900000003',
    addressLine: '14th Main, HSR Layout Sector 3',
    pincode: '560102',
    hours: { mon: '07:00-22:00', tue: '07:00-22:00', wed: '07:00-22:00', thu: '07:00-22:00', fri: '07:00-23:00', sat: '07:00-23:00', sun: '08:00-22:00' },
    photos: ['https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=800'],
    isVerified: true,
    openedAt: new Date(Date.now() - 10 * 86400_000),
    walletPaise: 150000,
  });
  await prisma.businessAnnouncement.create({ data: { businessId: cafe.id, title: 'Grand opening: 20% off all week!', body: 'Show this app at the counter for 20% off on any order till Sunday.', validUntil: new Date(Date.now() + 5 * 86400_000) } });
  await prisma.walletTransaction.createMany({
    data: [
      { businessId: cafe.id, type: 'TOPUP', amountPaise: 200000, reference: 'seed:topup:1', note: 'Wallet top-up' },
      { businessId: cafe.id, type: 'AD_SPEND', amountPaise: -50000, reference: 'seed:reserve:1', note: 'Budget reserved: Grand opening' },
    ],
  });
  await prisma.$transaction(async (tx) => {
    const c = await tx.adCampaign.create({
      data: { businessId: cafe.id, headline: '☕ New in HSR: Filter Kaapi House', body: 'Authentic filter coffee & tiffin, 2 min from you. 20% off this week!', cta: 'WHATSAPP', radiusM: 3000, budgetPaise: 50000, cpmPaise: 5000, status: 'ACTIVE', endAt: new Date(Date.now() + 14 * 86400_000), imageUrl: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800' },
    });
    await tx.$executeRaw`UPDATE ad_campaigns SET location = ${pt(offset(HSR, -350, 520))} WHERE id = ${c.id}::uuid`;
  });
  const others: [string, P, Omit<Prisma.BusinessUncheckedCreateInput, 'ownerId'>][] = [
    [priya.id, offset(HSR, 300, -700), { name: 'Glow Unisex Salon', category: 'SALON', description: 'Haircuts, threading, bridal makeup. Home service available.', phone: '+918040001111', addressLine: '24th Main, HSR Sector 2', pincode: '560102', isVerified: true, ratingAvg: 4.6, ratingCount: 38, photos: ['https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800'] }],
    [arjun.id, offset(HSR, -900, 200), { name: 'Sri Lakshmi Provision Stores', category: 'GROCERY', description: 'Kirana since 1998. Free home delivery within 2 km — call or WhatsApp your list.', phone: '+918040002222', whatsapp: '+919845002222', addressLine: '17th Cross, HSR Sector 4', pincode: '560102', isVerified: true, ratingAvg: 4.4, ratingCount: 112 }],
    [fatima.id, offset(HSR, 1100, 900), { name: 'Apollo Pharmacy HSR', category: 'PHARMACY', description: '24×7 pharmacy with home delivery.', phone: '+918040003333', addressLine: 'Outer Ring Road, HSR', pincode: '560102', ratingAvg: 4.1, ratingCount: 54 }],
    [rohan.id, offset(HSR, 800, -300), { name: 'FitZone Gym', category: 'GYM', description: 'Strength, CrossFit & Zumba. First week free for HSR residents.', phone: '+918040004444', addressLine: '19th Main, HSR Sector 1', pincode: '560102', openedAt: new Date(Date.now() - 5 * 86400_000) }],
    [sanjay.id, offset(KORA, 0, 0), { name: 'Third Wave Bakehouse', category: 'BAKERY', description: 'Sourdough, croissants and eggless cakes.', phone: '+918040005555', addressLine: '80 Feet Road, Koramangala 4th Block', pincode: '560034', ratingAvg: 4.7, ratingCount: 210 }],
  ];
  for (const [owner, loc, data] of others) await mkBiz(owner, loc, data);
  await prisma.review.create({ data: { authorId: arjun.id, businessId: cafe.id, rating: 5, body: 'Best filter coffee outside Basavanagudi. The podi idli is a must!' } });
  await prisma.review.create({ data: { authorId: fatima.id, businessId: cafe.id, rating: 4, body: 'Lovely place to work from. Gets crowded on weekends.' } });
  await prisma.business.update({ where: { id: cafe.id }, data: { ratingAvg: 4.5, ratingCount: 2 } });

  console.log('🧰 Workers…');
  const workers: [string, P, Omit<Prisma.ServiceProviderUncheckedCreateInput, 'listedById'>, string[]][] = [
    [priya.id, offset(societyGate, 0, 0), { name: 'Ramesh Kumar', phone: '+919845011111', skills: ['PLUMBER'], languages: ['Kannada', 'Hindi'], about: 'Bathroom fittings, leakage, motor repair. Works in most HSR societies.', experienceYrs: 12, rateNote: '₹300/visit + parts', idVerified: true, ratingAvg: 4.8, ratingCount: 23 }, [arjun.id, meera.id]],
    [meera.id, offset(societyGate, 0, 0), { name: 'Lakshmamma', phone: '+919845022222', skills: ['MAID', 'COOK'], languages: ['Kannada', 'Tamil'], about: 'Cooking (South Indian, North Indian basics) and cleaning. Available mornings.', experienceYrs: 8, rateNote: '₹4,000/month per task', idVerified: true, ratingAvg: 4.9, ratingCount: 15 }, [priya.id]],
    [arjun.id, offset(HSR, 0, 0), { name: 'Imran Electricals', phone: '+919845033333', skills: ['ELECTRICIAN', 'APPLIANCE_REPAIR'], languages: ['Hindi', 'Urdu', 'Kannada'], about: 'Wiring, inverter installation, fan/geyser repair.', experienceYrs: 15, rateNote: '₹350/visit', ratingAvg: 4.6, ratingCount: 31 }, [fatima.id]],
    [fatima.id, offset(HSR, -500, -500), { name: 'Cool Breeze AC Services', phone: '+919845044444', skills: ['AC_REPAIR'], languages: ['Kannada', 'English'], about: 'Split/window AC service, gas refill, installation.', experienceYrs: 6, rateNote: '₹599 service, ₹2,200 gas refill', ratingAvg: 4.3, ratingCount: 9 }, []],
    [rohan.id, offset(HSR, 400, 400), { name: 'Suresh (Driver)', phone: '+919845055555', skills: ['DRIVER'], languages: ['Kannada', 'Telugu', 'Hindi'], about: 'Full-time / part-time driver. Clean licence, knows Bengaluru well.', experienceYrs: 10, rateNote: '₹18,000/month', ratingAvg: 4.5, ratingCount: 4 }, []],
  ];
  for (const [lister, loc, data, vouchers] of workers) {
    await prisma.$transaction(async (tx) => {
      const p = await tx.serviceProvider.create({ data: { ...data, listedById: lister, vouchCount: 1 + vouchers.length } });
      await tx.$executeRaw`UPDATE service_providers SET location = ${fuzz(loc)} WHERE id = ${p.id}::uuid`;
      await tx.providerVouch.createMany({ data: [lister, ...vouchers].map((userId) => ({ providerId: p.id, userId, note: userId === lister ? 'Listed this worker' : 'Works at our home, very reliable' })) });
    });
  }

  await prisma.notification.createMany({
    data: [
      { userId: priya.id, type: 'SYSTEM', title: 'Welcome to Mohalla Connect 👋', body: 'Your society Green Meadows Residency is verified.' },
      { userId: arjun.id, type: 'POST_COMMENT', title: 'Rohan Iyer commented', body: 'Is the price negotiable? Can I see it this evening?', data: { postId: cycle.id } },
    ],
  });

  const counts = await Promise.all([prisma.user.count(), prisma.post.count(), prisma.business.count(), prisma.serviceProvider.count()]);
  console.log(`✅ Seeded ${counts[0]} users, ${counts[1]} posts, ${counts[2]} businesses, ${counts[3]} workers.`);
  console.log('   Demo logins: +91 99000 00001 (RWA admin), …02 (resident), …03 (café owner), …09 (admin)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
