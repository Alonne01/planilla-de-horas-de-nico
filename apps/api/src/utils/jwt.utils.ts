import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET environment variables are required in production');
  }
  console.warn('⚠️  JWT_SECRET or JWT_REFRESH_SECRET not set — using insecure dev defaults');
}

const SECRET = JWT_SECRET ?? 'fallback-dev-secret';
const REFRESH_SECRET = JWT_REFRESH_SECRET ?? 'fallback-refresh-secret';
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

interface TokenPayload {
  userId: string;
  empresaId: string;
  rol: string;
  rolNivel: number;
  email: string;
}

// In-memory refresh token store (for dev — in production use Redis)
const refreshTokenStore = new Map<string, { userId: string; expiresAt: number }>();

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function signRefreshToken(userId: string): string {
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000;
  refreshTokenStore.set(token, { userId, expiresAt });
  return token;
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, SECRET) as TokenPayload;
}

export function verifyRefreshToken(token: string): string | null {
  const entry = refreshTokenStore.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    refreshTokenStore.delete(token);
    return null;
  }
  return entry.userId;
}

export function revokeRefreshToken(token: string): void {
  refreshTokenStore.delete(token);
}

export function revokeAllRefreshTokensForUser(userId: string): void {
  for (const [token, entry] of refreshTokenStore.entries()) {
    if (entry.userId === userId) {
      refreshTokenStore.delete(token);
    }
  }
}
