import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { env, isProd, isTest } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authRouter } from './modules/auth.routes';
import { meRouter, usersRouter } from './modules/me.routes';
import { postsRouter } from './modules/posts.routes';
import { messagesRouter } from './modules/messages.routes';
import { businessesRouter } from './modules/businesses.routes';
import { providersRouter } from './modules/providers.routes';
import { adsRouter } from './modules/ads.routes';
import { societiesRouter } from './modules/societies.routes';
import { notificationsRouter } from './modules/notifications.routes';
import { uploadsRouter } from './modules/uploads.routes';
import { reportsRouter } from './modules/reports.routes';
import { adminRouter } from './modules/admin.routes';
import { paymentsRouter, razorpayWebhook } from './modules/payments.routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) || false : env.TRUST_PROXY);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  const origins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({ origin: origins.includes('*') ? true : origins, maxAge: 600 }));
  app.post('/pay/webhook', ...razorpayWebhook); // raw body for HMAC — before express.json()
  app.use(express.json({ limit: '200kb' }));
  if (!isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));
  app.use(rateLimit({ windowMs: 60_000, limit: isTest ? 100_000 : 300, standardHeaders: 'draft-7', legacyHeaders: false }));

  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, db: 'up', version: process.env.npm_package_version ?? '1.0.0' });
    } catch {
      res.status(503).json({ ok: false, db: 'down' });
    }
  });

  if (env.UPLOAD_DRIVER === 'local') {
    app.use('/uploads', express.static(path.resolve(env.UPLOAD_DIR), { maxAge: isProd ? '365d' : 0, immutable: isProd, index: false, dotfiles: 'deny' }));
  }

  app.use('/pay', paymentsRouter);

  const v1 = express.Router();
  v1.use('/auth', authRouter);
  v1.use('/me', meRouter);
  v1.use('/users', usersRouter);
  v1.use('/', postsRouter); // /feed, /posts, /comments, /me/posts
  v1.use('/conversations', messagesRouter);
  v1.use('/businesses', businessesRouter);
  v1.use('/providers', providersRouter);
  v1.use('/ads', adsRouter);
  v1.use('/societies', societiesRouter);
  v1.use('/notifications', notificationsRouter);
  v1.use('/uploads', uploadsRouter);
  v1.use('/reports', reportsRouter);
  v1.use('/admin', adminRouter);
  app.use('/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
