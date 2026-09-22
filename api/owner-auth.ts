import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'node:crypto';

const TTL_SECONDS = 12 * 60 * 60;

function json(res: VercelResponse, status: number, payload: unknown) {
  res.status(status).setHeader('Content-Type', 'application/json').send(JSON.stringify(payload));
}

function getSecret() {
  return process.env.TRIMEMO_OWNER_AUTH_SECRET || process.env.TRIMEMO_OWNER_PASSWORD || '';
}

function sign(input: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(input).digest('base64url');
}

function createToken(email: string) {
  const secret = getSecret();
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ sub: email.toLowerCase(), role: 'owner', exp })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

function verifyToken(token: string) {
  const secret = getSecret();
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !secret) return null;

  const expected = sign(payload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub: string;
      role: string;
      exp: number;
    };
    if (data.role !== 'owner' || !data.sub || Date.now() / 1000 >= data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  const ownerEmail = (process.env.TRIMEMO_OWNER_EMAIL || '').trim().toLowerCase();
  const ownerPassword = process.env.TRIMEMO_OWNER_PASSWORD || '';

  if (!ownerEmail || !ownerPassword || !getSecret()) {
    return json(res, 503, { ok: false, error: 'OWNER_AUTH_NOT_CONFIGURED' });
  }

  if (req.method === 'POST') {
    const { action, email, password, token } = req.body || {};

    if (action === 'login') {
      const validEmail = typeof email === 'string' && email.trim().toLowerCase() === ownerEmail;
      const validPassword = typeof password === 'string' && password === ownerPassword;
      if (!validEmail || !validPassword) {
        return json(res, 401, { ok: false, error: 'INVALID_CREDENTIALS' });
      }
      return json(res, 200, {
        ok: true,
        role: 'owner',
        token: createToken(ownerEmail),
        expiresIn: TTL_SECONDS,
      });
    }

    if (action === 'verify') {
      const data = typeof token === 'string' ? verifyToken(token) : null;
      if (!data || data.sub !== ownerEmail) {
        return json(res, 401, { ok: false, error: 'INVALID_SESSION' });
      }
      return json(res, 200, { ok: true, role: 'owner', email: data.sub, exp: data.exp });
    }
  }

  return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
}
