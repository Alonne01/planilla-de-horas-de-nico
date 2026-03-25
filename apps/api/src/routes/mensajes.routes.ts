import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH } from '../middleware/roles.middleware.js';
import { upload } from '../middleware/upload.middleware.js';
import { crearNotificacion } from '../utils/notificacion.utils.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// ─── GET /mensajes — User's inbox ─────────────────
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 20, 50));
    const offset = (page - 1) * limit;

    const [destinatarios, total] = await Promise.all([
      prisma.mensajeDestinatario.findMany({
        where: { usuarioId: userId },
        include: {
          mensaje: {
            include: {
              remitente: { select: { id: true, nombre: true, apellido: true, rol: true } },
              _count: { select: { respuestas: true } },
            },
          },
        },
        orderBy: { mensaje: { createdAt: 'desc' } },
        skip: offset,
        take: limit,
      }),
      prisma.mensajeDestinatario.count({ where: { usuarioId: userId } }),
    ]);

    const noLeidos = await prisma.mensajeDestinatario.count({
      where: { usuarioId: userId, leido: false },
    });

    res.json({
      mensajes: destinatarios.map(d => ({
        ...d.mensaje,
        leido: d.leido,
        leidoAt: d.leidoAt,
        destinatarioId: d.id,
      })),
      total,
      noLeidos,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Error listing mensajes:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /mensajes/no-leidos — Count unread ────────
router.get('/no-leidos', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const count = await prisma.mensajeDestinatario.count({
      where: { usuarioId: req.user!.userId, leido: false },
    });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /mensajes/enviados — Sent messages (RRHH+) ──
router.get('/enviados', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const mensajes = await prisma.mensaje.findMany({
      where: { remitenteId: req.user!.userId },
      include: {
        _count: { select: { destinatarios: true, respuestas: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(mensajes);
  } catch (error) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PUT /mensajes/leer-todas — Mark all as read ────
router.put('/leer-todas', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.mensajeDestinatario.updateMany({
      where: { usuarioId: req.user!.userId, leido: false },
      data: { leido: true, leidoAt: new Date() },
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /mensajes/:id — View single message ──────
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const mensajeId = req.params.id;

    const mensaje = await prisma.mensaje.findUnique({
      where: { id: mensajeId },
      include: {
        remitente: { select: { id: true, nombre: true, apellido: true, rol: true } },
        respuestas: {
          include: {
            usuario: { select: { id: true, nombre: true, apellido: true, rol: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        destinatarios: {
          select: { usuarioId: true, leido: true },
        },
      },
    });

    if (!mensaje) {
      res.status(404).json({ error: 'Mensaje no encontrado' });
      return;
    }

    // Check access: either sender or recipient
    const isRecipient = mensaje.destinatarios.some(d => d.usuarioId === userId);
    const isSender = mensaje.remitenteId === userId;
    if (!isRecipient && !isSender) {
      res.status(403).json({ error: 'Sin acceso a este mensaje' });
      return;
    }

    // Mark as read if recipient
    if (isRecipient) {
      await prisma.mensajeDestinatario.updateMany({
        where: { mensajeId, usuarioId: userId, leido: false },
        data: { leido: true, leidoAt: new Date() },
      });
    }

    res.json(mensaje);
  } catch (error) {
    console.error('Error getting mensaje:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /mensajes — Send message (RRHH/ADMIN) ───
const createMensajeSchema = z.object({
  asunto: z.string().min(1).max(200),
  cuerpo: z.string().min(1).max(5000),
  permiteRespuesta: z.boolean().optional().default(false),
  destinoTipo: z.enum(['TODOS', 'SECTOR', 'ROL', 'USUARIO']),
  destinoValor: z.string().optional(),
});

router.post('/', requireLevel(LEVEL_RRHH), upload.single('archivo'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Parse JSON fields from multipart form
    const body = {
      ...req.body,
      permiteRespuesta: req.body.permiteRespuesta === 'true' || req.body.permiteRespuesta === true,
    };

    const parsed = createMensajeSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const { asunto, cuerpo, permiteRespuesta, destinoTipo, destinoValor } = parsed.data;
    const empresaId = req.user!.empresaId;
    const remitenteId = req.user!.userId;

    // Resolve recipients
    let userIds: string[] = [];

    if (destinoTipo === 'TODOS') {
      const users = await prisma.usuario.findMany({
        where: { empresaId, activo: true, id: { not: remitenteId } },
        select: { id: true },
      });
      userIds = users.map(u => u.id);
    } else if (destinoTipo === 'SECTOR') {
      if (!destinoValor) { res.status(400).json({ error: 'Se requiere el sector' }); return; }
      const users = await prisma.usuario.findMany({
        where: { empresaId, activo: true, sectorId: destinoValor, id: { not: remitenteId } },
        select: { id: true },
      });
      userIds = users.map(u => u.id);
    } else if (destinoTipo === 'ROL') {
      if (!destinoValor) { res.status(400).json({ error: 'Se requiere el rol' }); return; }
      const users = await prisma.usuario.findMany({
        where: { empresaId, activo: true, rol: destinoValor, id: { not: remitenteId } },
        select: { id: true },
      });
      userIds = users.map(u => u.id);
    } else if (destinoTipo === 'USUARIO') {
      if (!destinoValor) { res.status(400).json({ error: 'Se requiere el usuario' }); return; }
      // Support comma-separated user IDs for multi-select
      userIds = destinoValor.split(',').map(id => id.trim()).filter(Boolean);
    }

    if (userIds.length === 0) {
      res.status(400).json({ error: 'No se encontraron destinatarios' });
      return;
    }

    const archivoUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const archivoNombre = req.file ? req.file.originalname : null;

    const mensaje = await prisma.mensaje.create({
      data: {
        empresaId,
        remitenteId,
        asunto,
        cuerpo,
        archivoUrl,
        archivoNombre,
        permiteRespuesta,
        esDifusion: destinoTipo !== 'USUARIO' || userIds.length > 1,
        destinoTipo,
        destinoValor: destinoValor ?? null,
        destinatarios: {
          create: userIds.map(uid => ({ usuarioId: uid })),
        },
      },
    });

    // Notify all recipients
    const remitente = await prisma.usuario.findUnique({
      where: { id: remitenteId },
      select: { nombre: true, apellido: true },
    });
    const nombreRemitente = remitente ? `${remitente.nombre} ${remitente.apellido}` : 'Alguien';
    await Promise.all(
      userIds.map(uid =>
        crearNotificacion({
          usuarioId: uid,
          tipo: 'MENSAJE',
          titulo: `📩 Nuevo mensaje: ${asunto}`,
          cuerpo: `${nombreRemitente} te envió un mensaje.`,
          link: '/mensajes',
        })
      )
    );

    res.status(201).json({ ...mensaje, destinatariosCount: userIds.length });
  } catch (error) {
    console.error('Error creating mensaje:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /mensajes/:id/responder — Reply to message ──
const respuestaSchema = z.object({
  cuerpo: z.string().min(1).max(5000),
});

router.post('/:id/responder', upload.single('archivo'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const mensajeId = req.params.id;
    const userId = req.user!.userId;

    const mensaje = await prisma.mensaje.findUnique({
      where: { id: mensajeId },
      include: { destinatarios: { where: { usuarioId: userId } } },
    });

    if (!mensaje) {
      res.status(404).json({ error: 'Mensaje no encontrado' });
      return;
    }

    // Must be recipient or sender
    const isRecipient = mensaje.destinatarios.length > 0;
    const isSender = mensaje.remitenteId === userId;
    if (!isRecipient && !isSender) {
      res.status(403).json({ error: 'Sin acceso a este mensaje' });
      return;
    }

    if (!mensaje.permiteRespuesta) {
      res.status(400).json({ error: 'Este mensaje no permite respuestas' });
      return;
    }

    const parsed = respuestaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos' });
      return;
    }

    const archivoUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const archivoNombre = req.file ? req.file.originalname : null;

    const respuesta = await prisma.mensajeRespuesta.create({
      data: {
        mensajeId,
        usuarioId: userId,
        cuerpo: parsed.data.cuerpo,
        archivoUrl,
        archivoNombre,
      },
      include: {
        usuario: { select: { id: true, nombre: true, apellido: true, rol: true } },
      },
    });

    // Notify the original sender about the reply
    if (mensaje.remitenteId !== userId) {
      const replier = respuesta.usuario;
      await crearNotificacion({
        usuarioId: mensaje.remitenteId,
        tipo: 'MENSAJE',
        titulo: `💬 Respuesta a: ${mensaje.asunto}`,
        cuerpo: `${replier.nombre} ${replier.apellido} respondió tu mensaje.`,
        link: '/mensajes',
      });
    }

    res.status(201).json(respuesta);
  } catch (error) {
    console.error('Error replying to mensaje:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PUT /mensajes/:id/leer — Mark as read ─────────
router.put('/:id/leer', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.mensajeDestinatario.updateMany({
      where: { mensajeId: req.params.id, usuarioId: req.user!.userId },
      data: { leido: true, leidoAt: new Date() },
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
