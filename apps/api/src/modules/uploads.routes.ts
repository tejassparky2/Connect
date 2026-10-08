import { Router } from 'express';
import multer from 'multer';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { me, requireAuth } from '../middleware/auth';
import { badRequest } from '../lib/errors';
import { storeImage } from '../services/storage';
import { isTest } from '../config/env';

export const uploadsRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const limiter = rateLimit({ windowMs: 60 * 60_000, limit: isTest ? 1000 : 60, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? '0.0.0.0') });

uploadsRouter.post('/', requireAuth, limiter, upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Attach an image in the "file" field');
  const url = await storeImage(req.file.buffer, me(req).id);
  res.status(201).json({ url });
});
