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
import { sendPasswordResetEmail } from '../utils/email.utils.js';

const prisma = new PrismaClient();
const router = Router();

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000';

// ─── Schemas de validación ───────────────────────

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Password requerido'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Password actual requerido'),
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

    const passwordValid = await bcrypt.compare(password, usuario.passwordHash);
    if (!passwordValid) {
      res.status(401).json({ error: 'Credenciales inválidas' });
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
    const refreshToken = signRefreshToken(usuario.id);

    // Set refresh token in httpOnly cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      path: '/',
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

    const userId = verifyRefreshToken(oldRefreshToken);
    if (!userId) {
      res.status(401).json({ error: 'Refresh token inválido o expirado' });
      return;
    }

    // Revoke old token (rotation)
    revokeRefreshToken(oldRefreshToken);

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
    const newRefreshToken = signRefreshToken(usuario.id);

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
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
      },
    });
  } catch (error) {
    console.error('Error en refresh:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /auth/logout ───────────────────────────

router.post('/logout', (req: Request, res: Response): void => {
  const refreshToken = req.cookies?.refreshToken as string | undefined;
  if (refreshToken) {
    revokeRefreshToken(refreshToken);
  }

  res.clearCookie('refreshToken', { path: '/' });
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
        categoria: { select: { id: true, codigo: true, nombre: true } },
        convenio: { select: { id: true, nombre: true } },
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
      categoriaId: usuario.categoriaId,
      categoriaCodigo: usuario.categoria?.codigo ?? null,
      categoriaNombre: usuario.categoria?.nombre ?? null,
      convenioId: usuario.convenioId,
      convenioNombre: usuario.convenio?.nombre ?? null,
      tipoContrato: usuario.tipoContrato,
      fechaIngreso: usuario.fechaIngreso,
      diasVacacionesSaldo: usuario.diasVacacionesSaldo,
      diasVacacionesUsados: usuario.diasVacacionesUsados,
      primerLogin: usuario.primerLogin,
      avatarUrl: usuario.avatarUrl,
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

    const { currentPassword, newPassword } = parsed.data;

    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user!.userId },
    });

    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    const passwordValid = await bcrypt.compare(currentPassword, usuario.passwordHash);
    if (!passwordValid) {
      res.status(400).json({ error: 'La contraseña actual es incorrecta' });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        passwordHash: newHash,
        primerLogin: false,
      },
    });

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

    // Always respond 200 to prevent email enumeration
    const successMessage = 'Si el email existe en nuestro sistema, recibirás un link para restablecer tu contraseña.';

    const usuario = await prisma.usuario.findUnique({
      where: { email },
      select: { id: true, activo: true },
    });

    if (!usuario || !usuario.activo) {
      // Don't reveal that the user doesn't exist
      res.json({ message: successMessage });
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

    res.json({ message: successMessage });
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
    revokeAllRefreshTokensForUser(resetToken.usuario.id);

    res.json({ message: 'Contraseña restablecida correctamente. Ya podés iniciar sesión.' });
  } catch (error) {
    console.error('Error en reset-password:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;

