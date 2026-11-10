import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { UUID_RE } from '../constants.js';

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required. Copy .env.example to .env.');
}

export function requireAuth(req, res, next) {
  const match = /^Bearer\s+(.+)$/i.exec(req.get('Authorization') || '');
  if (!match) return res.status(401).json({ error: 'Authentication required' });

  try {
    const claims = jwt.verify(match[1], process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'tenant-practice',
      audience: 'tenant-practice-api'
    });
    if (typeof claims.sub !== 'string' || !UUID_RE.test(claims.sub)) {
      return res.status(401).json({ error: 'Invalid token subject' });
    }
    req.userId = claims.sub;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireTenant(req, res, next) {
  const tenantId = req.get('X-Tenant-ID');
  if (!tenantId || !UUID_RE.test(tenantId)) {
    return res.status(400).json({ error: 'Valid X-Tenant-ID header required' });
  }
  req.tenantId = tenantId;
  return next();
}
