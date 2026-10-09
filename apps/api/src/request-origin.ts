import type { FastifyRequest } from 'fastify';

// Exact origins only. The proxy keeps API calls on the frontend's own origin.
export function allowedAppOrigins() {
  return [
    process.env.APP_ORIGIN,
    ...(process.env.APP_ADDITIONAL_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    'http://localhost:3100',
    'http://127.0.0.1:3100',
  ].filter((s): s is string => Boolean(s));
}

export function trustedRequestOrigin(req: Pick<FastifyRequest, 'headers'>) {
  const origin = req.headers.origin;
  return origin && allowedAppOrigins().includes(origin) ? origin : process.env.APP_ORIGIN;
}
