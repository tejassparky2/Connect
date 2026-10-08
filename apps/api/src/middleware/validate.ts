import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import { badRequest } from '../lib/errors';

type Part = 'body' | 'query' | 'params';

/**
 * Validates and REPLACES req[part] with the parsed (coerced, stripped) value.
 * Express 5 makes req.query a getter, so we store parsed query on req.valid.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validate(part: Part, schema: ZodType): RequestHandler<any> {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part] ?? {});
    if (!result.success) {
      return next(
        badRequest(
          'Validation failed',
          result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        ),
      );
    }
    if (part === 'body') req.body = result.data;
    else (req as unknown as { valid: Record<string, unknown> }).valid = { ...((req as unknown as { valid?: object }).valid ?? {}), [part]: result.data };
    next();
  };
}

export function q<T>(req: Request): T {
  return ((req as unknown as { valid?: { query?: T } }).valid?.query ?? {}) as T;
}
