import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

// Sin secretos el proceso no arranca, en ningún entorno: firmar con una constante
// del código fuente equivale a aceptar tokens forjados por cualquiera que lea el repo.
if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error('JWT_SECRET y JWT_REFRESH_SECRET son obligatorios: definilos antes de arrancar el API');
}

const SECRET = JWT_SECRET;
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

interface TokenPayload {
  userId: string;
  empresaId: string;
  rol: string;
  rolNivel: number;
  email: string;
  /** Sólo en tokens de cuentas con primerLogin: los acota al cambio de contraseña. */
  scope?: 'cambio-password';
}

// Refresh tokens are persisted in the DB (hashed) so API restarts don't log everyone out.
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export async function signRefreshToken(userId: string): Promise<string> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
  await prisma.refreshToken.create({
    data: { tokenHash: hashToken(token), usuarioId: userId, expiresAt },
  });
  return token;
}

export function verifyAccessToken(token: string): TokenPayload {
  const payload = jwt.verify(token, SECRET) as TokenPayload;
  // El cambio de contraseña obligatorio se exige acá, no sólo en el front: mientras
  // la cuenta tenga primerLogin su token no sirve para el resto de la API.
  if (payload.scope === 'cambio-password') {
    throw new Error('Token acotado al cambio de contraseña obligatorio');
  }
  return payload;
}

/** Igual que verifyAccessToken, pero acepta además los tokens acotados al cambio de contraseña. */
export function verifyAccessTokenForPasswordChange(token: string): TokenPayload {
  return jwt.verify(token, SECRET) as TokenPayload;
}

export async function verifyRefreshToken(token: string): Promise<string | null> {
  const entry = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!entry) return null;
  if (Date.now() > entry.expiresAt.getTime()) {
    await prisma.refreshToken.delete({ where: { id: entry.id } }).catch(() => {});
    return null;
  }
  return entry.usuarioId;
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function revokeAllRefreshTokensForUser(userId: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { usuarioId: userId } });
}

/** Periodic cleanup of expired refresh tokens (call from a scheduler). */
export async function pruneExpiredRefreshTokens(): Promise<number> {
  const { count } = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
