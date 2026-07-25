import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { z } from 'zod';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  verifyAccessTokenForPasswordChange,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
} from '../utils/jwt.utils.js';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { sendPasswordResetEmail } from '../utils/email.utils.js';
import { puedeVerCalendario } from '../utils/calendario-access.utils.js';
import { DEBUG_AUTH, claveDebugValida } from '../utils/debug-auth.utils.js';

const prisma = new PrismaClient();
const router = Router();

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000';

// Cookie config — sameSite: 'lax' is safe because frontend proxies API calls
// through the same origin (Vite proxy in dev, nginx in production)
// `secure` sale del esquema público real (PUBLIC_URL llega como FRONTEND_URL al
// contenedor) y no de NODE_ENV: en el modo HTTP para LAN el navegador descartaba la
// cookie marcada Secure y el refresh dejaba a todo el personal afuera cada 15 minutos.
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: (process.env.PUBLIC_URL ?? FRONTEND_URL).startsWith('https://'),
  sameSite: 'lax' as const,
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  path: '/',
};

// ─── Cambio de contraseña obligatorio (primerLogin) ──
//
// El API no se conforma con el redirect del front: a una cuenta con primerLogin se
// le emite un token acotado (scope 'cambio-password') que authMiddleware rechaza,
// así que sólo sirve para las rutas de esta sección. Con DEBUG_AUTH se emite el
// token normal: ese modo ya entra sin contraseña y es el que usa el testing remoto.
function scopeCambioPassword(primerLogin: boolean): { scope?: 'cambio-password' } {
  return primerLogin && !DEBUG_AUTH ? { scope: 'cambio-password' } : {};
}

/** authMiddleware que además acepta los tokens acotados: es la salida de primerLogin. */
function authCambioPassword(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token de acceso requerido' });
    return;
  }

  try {
    const payload = verifyAccessTokenForPasswordChange(authHeader.split(' ')[1]);
    if (!payload.userId || !payload.empresaId || !payload.rol || typeof payload.rolNivel !== 'number') {
      res.status(401).json({ error: 'Token inválido: claims incompletos' });
      return;
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// ─── Schemas de validación ───────────────────────

// Con DEBUG_AUTH la contraseña también es obligatoria: ahí va la clave de debug.
const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Password requerido'),
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
//
// Devuelve la nómina completa sin autenticar, así que exige la clave de debug en
// el header: sin eso, cualquiera que abriera la URL del túnel se llevaba la lista
// de emails y roles de toda la empresa.

router.get('/debug-users', async (req: Request, res: Response): Promise<void> => {
  if (!claveDebugValida(req.headers['x-debug-clave'])) {
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

    // La clave de debug entra sin la contraseña real; cualquier otro valor se
    // verifica normalmente, así que las contraseñas de verdad siguen funcionando
    // y quien no tenga la clave no pasa ni con DEBUG_AUTH prendido.
    if (!claveDebugValida(password)) {
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
      ...scopeCambioPassword(usuario.primerLogin),
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
      ...scopeCambioPassword(usuario.primerLogin),
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

router.get('/me', authCambioPassword, async (req: AuthRequest, res: Response): Promise<void> => {
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

router.post('/change-password', authCambioPassword, async (req: AuthRequest, res: Response): Promise<void> => {
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

    // Exigir y verificar la contraseña actual siempre, también en el cambio forzado
    // del primer login: si no, una sesión secuestrada en esa ventana fija la clave
    // nueva sin haber conocido nunca la temporal que generó el admin.
    // Quien entró con la clave de debug no conoce la temporal: se le acepta esa
    // misma clave acá para que el testing remoto no quede trabado en la pantalla.
    if (!claveDebugValida(currentPassword)) {
      if (!currentPassword) {
        res.status(400).json({
          error: usuario.primerLogin
            ? 'Debés ingresar la contraseña temporal que te dieron'
            : 'Debés ingresar tu contraseña actual',
        });
        return;
      }
      const valida = await bcrypt.compare(currentPassword, usuario.passwordHash);
      if (!valida) {
        res.status(401).json({ error: 'La contraseña actual es incorrecta' });
        return;
      }
      // Cambiar la clave por la misma no es un cambio: dejaría la temporal viva.
      if (currentPassword === newPassword) {
        res.status(400).json({ error: 'La nueva contraseña debe ser distinta de la actual' });
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

    // Revocar todos los refresh tokens tras el cambio (igual que reset-password) y
    // renovar la cookie de quien lo hizo: si venía de primerLogin su access token quedó
    // acotado, y este refresh nuevo es el que le devuelve la sesión completa sin pasar
    // otra vez por el login.
    await revokeAllRefreshTokensForUser(usuario.id);
    res.cookie('refreshToken', await signRefreshToken(usuario.id), COOKIE_OPTIONS);

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

    // Misma respuesta exista o no la cuenta: distinguir por status convertía esta ruta
    // pública en un oráculo para reconstruir la nómina y ver quién está dado de baja.
    const respuestaGenerica = {
      message: 'Si el email está registrado, te enviamos un link para restablecer tu contraseña. Revisá tu bandeja de entrada y spam.',
    };

    const usuario = await prisma.usuario.findUnique({
      where: { email },
      select: { id: true, activo: true },
    });

    if (!usuario || !usuario.activo) {
      res.json(respuestaGenerica);
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

    // El link nunca vuelve en el body: sin SMTP configurado queda escrito en la consola
    // del servidor (sendPasswordResetEmail), que lo ve el que corre el proceso y nadie más.
    res.json(respuestaGenerica);
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
        // Este flujo prueba posesión del email y fija una clave que sólo conoce el
        // usuario, así que cierra el primerLogin (si no, la cuenta quedaba trabada en él).
        data: { passwordHash: newHash, primerLogin: false },
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

