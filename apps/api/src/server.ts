import { env } from './config/env';
import { createApp } from './app';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { drainJobs } from './services/jobs';
import { sweepExpiredCampaigns } from './modules/ads.routes';

const app = createApp();
const server = app.listen(env.PORT, '0.0.0.0', () => logger.info(`🏘️  Mohalla Connect API listening on :${env.PORT} (${env.NODE_ENV}, otp=${env.OTP_PROVIDER})`));

// Settle expired ad campaigns every 10 minutes (refund unspent budget).
const sweeper = setInterval(() => {
  sweepExpiredCampaigns().catch((err) => logger.error({ err }, 'Campaign sweep failed'));
}, 10 * 60_000);
sweeper.unref();

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  clearInterval(sweeper);
  server.close();
  await drainJobs();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
