import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { z } from 'zod';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
} from '../utils/jwt.utils.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { sendPasswordResetEmail, isSmtpConfigured } from '../utils/email.utils.js';
import { puedeVerCalendario } from '../utils/calendario-access.utils.js';

const prisma = new PrismaClient();
const router = Router();

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000';
const DEBUG_AUTH = process.env.DEBUG_AUTH === 'true' && process.env.NODE_ENV !== 'production';

// Cookie config — sameSite: 'lax' is safe because frontend proxies API calls
// through the same origin (Vite proxy in dev, nginx in production)
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  path: '/',
};

// ─── Schemas de validación ───────────────────────

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(DEBUG_AUTH ? 0 : 1, 'Password requerido'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z
    .string()
    .min(8, 'Mínimo 8 caracteres')
    .regex(/[A-Z]/, 'Debe contener al menos una mayúscula')
    .regex(/[0-9]/, 'Debe contener al menos un número'),
});

const forgotPasswordSchema = z.object({
  email: z.string().email('Email inválido'),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token requerido'),
  newPassword: z
    .string()
    .min(8, 'Mínimo 8 caracteres')
    .regex(/[A-Z]/, 'Debe contener al menos una mayúscula')
    .regex(/[0-9]/, 'Debe contener al menos un número'),
});

// ─── GET /auth/debug-users (dev only) ────────────

router.get('/debug-users', async (_req: Request, res: Response): Promise<void> => {
  if (!DEBUG_AUTH) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  try {
    const usuarios = await prisma.usuario.findMany({
      where: { activo: true },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        email: true,
        rol: true,
        sector: { select: { nombre: true } },
      },
      orderBy: [{ rol: 'asc' }, { apellido: 'asc' }],
    });

    res.json(usuarios);
  } catch (error) {
    console.error('Error en debug-users:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /auth/login ────────────────────────────

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const { email, password } = parsed.data;

    const usuario = await prisma.usuario.findUnique({
      where: { email },
      include: {
        empresa: { select: { id: true, nombre: true } },
        sector: { select: { id: true, nombre: true } },
      },
    });

    if (!usuario || !usuario.activo) {
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }

    // Skip password check in debug mode
    if (!DEBUG_AUTH) {
      const passwordValid = await bcrypt.compare(password, usuario.passwordHash);
      if (!passwordValid) {
        res.status(401).json({ error: 'Credenciales inválidas' });
        return;
      }
    }

    // Look up role level from RolConfig
    const rolConfig = await prisma.rolConfig.findFirst({
      where: { empresaId: usuario.empresaId, codigo: usuario.rol, activo: true },
      select: { nivel: true },
    });
    const rolNivel = rolConfig?.nivel ?? 0;

    const tokenPayload = {
      userId: usuario.id,
      empresaId: usuario.empresaId,
      rol: usuario.rol,
      rolNivel,
      email: usuario.email,
    };

    const accessToken = signAccessToken(tokenPayload);
    const refreshToken = await signRefreshToken(usuario.id);

    // Set refresh token in httpOnly cookie
    res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);

    const puedeVerCal = await puedeVerCalendario(prisma, {
      rolNivel, empresaId: usuario.empresaId, sectorId: usuario.sectorId,
    });

    res.json({
      accessToken,
      user: {
        id: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        email: usuario.email,
        rol: usuario.rol,
        rolNivel,
        empresaId: usuario.empresaId,
        empresaNombre: usuario.empresa.nombre,
        sectorId: usuario.sectorId,
        sectorNombre: usuario.sector?.nombre ?? null,
        primerLogin: usuario.primerLogin,
        puedeVerCalendario: puedeVerCal,
      },
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /auth/refresh ──────────────────────────

router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const oldRefreshToken = req.cookies?.refreshToken as string | undefined;

    if (!oldRefreshToken) {
      res.status(401).json({ error: 'Refresh token no encontrado' });
      return;
    }

    const userId = await verifyRefreshToken(oldRefreshToken);
    if (!userId) {
      res.status(401).json({ error: 'Refresh token inválido o expirado' });
      return;
    }

    // Revoke old token (rotation)
    await revokeRefreshToken(oldRefreshToken);

    const usuario = await prisma.usuario.findUnique({
      where: { id: userId },
      select: {
        id: true, empresaId: true, rol: true, email: true, activo: true,
        nombre: true, apellido: true, sectorId: true, primerLogin: true,
        empresa: { select: { nombre: true } },
        sector: { select: { nombre: true } },
      },
    });

    if (!usuario || !usuario.activo) {
      res.status(401).json({ error: 'Usuario no encontrado o inactivo' });
      return;
    }

    // Look up role level from RolConfig
    const rolConfig = await prisma.rolConfig.findFirst({
      where: { empresaId: usuario.empresaId, codigo: usuario.rol, activo: true },
      select: { nivel: true },
    });
    const rolNivel = rolConfig?.nivel ?? 0;

    const tokenPayload = {
      userId: usuario.id,
      empresaId: usuario.empresaId,
      rol: usuario.rol,
      rolNivel,
      email: usuario.email,
    };

    const accessToken = signAccessToken(tokenPayload);
    const newRefreshToken = await signRefreshToken(usuario.id);

    res.cookie('refreshToken', newRefreshToken, COOKIE_OPTIONS);

    const puedeVerCal = await puedeVerCalendario(prisma, {
      rolNivel, empresaId: usuario.empresaId, sectorId: usuario.sectorId,
    });

    res.json({
      accessToken,
      user: {
        id: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        email: usuario.email,
        rol: usuario.rol,
        rolNivel,
        empresaId: usuario.empresaId,
        empresaNombre: usuario.empresa.nombre,
        sectorId: usuario.sectorId,
        sectorNombre: usuario.sector?.nombre ?? null,
        primerLogin: usuario.primerLogin,
        puedeVerCalendario: puedeVerCal,
      },
    });
  } catch (error) {
    console.error('Error en refresh:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /auth/logout ───────────────────────────

router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  const refreshToken = req.cookies?.refreshToken as string | undefined;
  if (refreshToken) {
    await revokeRefreshToken(refreshToken).catch(() => {});
  }

  res.clearCookie('refreshToken', {
    path: '/',
    httpOnly: true,
    secure: COOKIE_OPTIONS.secure,
    sameSite: COOKIE_OPTIONS.sameSite,
  });
  res.status(204).send();
});

// ─── GET /auth/me ────────────────────────────────

router.get('/me', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user!.userId },
      include: {
        empresa: { select: { id: true, nombre: true } },
        sector: { select: { id: true, nombre: true } },
      },
    });

    if (!usuario || !usuario.activo) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    res.json({
      id: usuario.id,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      email: usuario.email,
      rol: usuario.rol,
      legajo: usuario.legajo,
      dni: usuario.dni,
      cuil: usuario.cuil,
      telefono: usuario.telefono,
      empresaId: usuario.empresaId,
      empresaNombre: usuario.empresa.nombre,
      sectorId: usuario.sectorId,
      sectorNombre: usuario.sector?.nombre ?? null,
      tipoContrato: usuario.tipoContrato,
      fechaIngreso: usuario.fechaIngreso,
      diasVacacionesSaldo: usuario.diasVacacionesSaldo,
      diasVacacionesUsados: usuario.diasVacacionesUsados,
      primerLogin: usuario.primerLogin,
      avatarUrl: usuario.avatarUrl,
      puedeVerCalendario: await puedeVerCalendario(prisma, {
        rolNivel: req.user!.rolNivel ?? 0, empresaId: usuario.empresaId, sectorId: usuario.sectorId,
      }),
    });
  } catch (error) {
    console.error('Error en /me:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /auth/change-password ──────────────────

router.post('/change-password', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const { newPassword, currentPassword } = parsed.data;

    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user!.userId },
    });

    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    // Salvo en el cambio forzado de primer-login, exigir y verificar la contraseña
    // actual (evita que una sesión secuestrada cambie la clave sin conocerla).
    if (!usuario.primerLogin) {
      if (!currentPassword) {
        res.status(400).json({ error: 'Debés ingresar tu contraseña actual' });
        return;
      }
      const valida = await bcrypt.compare(currentPassword, usuario.passwordHash);
      if (!valida) {
        res.status(401).json({ error: 'La contraseña actual es incorrecta' });
        return;
      }
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        passwordHash: newHash,
        primerLogin: false,
      },
    });

    // Revocar todos los refresh tokens tras el cambio (igual que reset-password).
    await revokeAllRefreshTokensForUser(usuario.id);

    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (error) {
    console.error('Error en change-password:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /auth/forgot-password ──────────────────

router.post('/forgot-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Email inválido' });
      return;
    }

    const { email } = parsed.data;

    const usuario = await prisma.usuario.findUnique({
      where: { email },
      select: { id: true, activo: true },
    });

    if (!usuario) {
      res.status(404).json({ error: 'No existe una cuenta con ese email' });
      return;
    }

    if (!usuario.activo) {
      res.status(403).json({ error: 'La cuenta asociada a ese email está inactiva' });
      return;
    }

    // Invalidate any previous unused tokens for this user
    await prisma.passwordResetToken.updateMany({
      where: { usuarioId: usuario.id, used: false },
      data: { used: true },
    });

    // Generate new token (UUID)
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.passwordResetToken.create({
      data: {
        token,
        usuarioId: usuario.id,
        expiresAt,
      },
    });

    // Build reset URL and send email
    const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}`;
    await sendPasswordResetEmail(email, resetUrl);

    const response: Record<string, string> = {
      message: 'Te enviamos un link para restablecer tu contraseña. Revisá tu bandeja de entrada y spam.',
    };

    // In dev mode (SMTP not configured), include the reset link so devs can test the flow
    if (!isSmtpConfigured && process.env.NODE_ENV !== 'production') {
      response.resetUrl = resetUrl;
    }

    res.json(response);
  } catch (error) {
    console.error('Error en forgot-password:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /auth/reset-password ───────────────────

router.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const { token, newPassword } = parsed.data;

    // Find the token
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { usuario: { select: { id: true, activo: true } } },
    });

    if (!resetToken) {
      res.status(400).json({ error: 'Token inválido o expirado' });
      return;
    }

    if (resetToken.used) {
      res.status(400).json({ error: 'Este link ya fue utilizado. Solicitá uno nuevo.' });
      return;
    }

    if (new Date() > resetToken.expiresAt) {
      // Mark as used so it can't be retried
      await prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { used: true },
      });
      res.status(400).json({ error: 'El link expiró. Solicitá uno nuevo.' });
      return;
    }

    if (!resetToken.usuario.activo) {
      res.status(400).json({ error: 'Usuario inactivo' });
      return;
    }

    // Hash new password and update user
    const newHash = await bcrypt.hash(newPassword, 12);

    await prisma.$transaction([
      prisma.usuario.update({
        where: { id: resetToken.usuario.id },
        data: { passwordHash: newHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { used: true },
      }),
    ]);

    // Revoke all refresh tokens for security
    await revokeAllRefreshTokensForUser(resetToken.usuario.id);

    res.json({ message: 'Contraseña restablecida correctamente. Ya podés iniciar sesión.' });
  } catch (error) {
    console.error('Error en reset-password:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;

