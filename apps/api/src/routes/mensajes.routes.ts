import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH } from '../middleware/roles.middleware.js';
import { upload } from '../middleware/upload.middleware.js';
import { crearNotificacion } from '../utils/notificacion.utils.js';
import { alcanceDeDifusion, destinosPermitidos, NIVEL_MINIMO_DIFUSION, type AlcanceDifusion } from '../utils/difusion.utils.js';
import { turnoKey, etiquetaTurno } from '../utils/turnos.utils.js';
import { tramoDelDia, type TramoDiagrama } from '../utils/diagrama-vigencia.utils.js';
import { hoyLocalEmpresa } from '../utils/fecha-dia.utils.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

/**
 * Los adjuntos de un mensaje, listos para el `create` anidado.
 *
 * El tipo sale del mimetype que ya validó el `fileFilter` del middleware y no de
 * la extensión: el nombre lo elige quien sube el archivo y renombrar un .docx a
 * .png haría que el front intentara pintarlo como imagen.
 */
function adjuntosDesdeArchivo(file: Express.Multer.File | undefined) {
  if (!file) return [];
  return [{
    url: `/uploads/${file.filename}`,
    nombre: file.originalname,
    tipo: file.mimetype.startsWith('image/') ? 'IMAGEN' : 'ARCHIVO',
    tamanioBytes: file.size,
  }];
}

// ─── Difusión: alcance y agrupamiento por turno ──────────────────────────────

/** El alcance del remitente y los destinos que ese alcance habilita. */
async function contextoDeDifusion(user: { userId: string; rol: string; rolNivel: number }): Promise<{
  sectorId: string | null;
  alcance: AlcanceDifusion;
  permitidos: string[];
}> {
  const remitente = await prisma.usuario.findUnique({
    where: { id: user.userId },
    select: { sectorId: true },
  });
  // El sector sale de la BASE y no del token: el token se emitió al iniciar
  // sesión y un cambio de sector posterior no lo invalida.
  const sectorId = remitente?.sectorId ?? null;
  const alcance = alcanceDeDifusion({ rol: user.rol, rolNivel: user.rolNivel, sectorId });
  return { sectorId, alcance, permitidos: destinosPermitidos(alcance, user.rolNivel) };
}

/**
 * El turno de cada usuario, evaluando el tramo VIGENTE HOY.
 *
 * Si alguien cambió de diagrama la semana pasada cae en su grupo nuevo, que es
 * lo que espera quien manda el mensaje.
 */
async function turnosDeUsuarios(
  usuarioIds: string[],
): Promise<Map<string, { clave: string; tramo: TramoDiagrama | null }>> {
  const hoy = hoyLocalEmpresa();
  const salida = new Map<string, { clave: string; tramo: TramoDiagrama | null }>();
  if (usuarioIds.length === 0) return salida;

  // `fechaInicio` guarda la HORA REAL de la aprobación, no la medianoche del día
  // (ver `tramosDeUsuario`). Con `lte: hoy` una asignación aprobada hoy a las
  // 15:32 quedaría afuera aunque por día calendario ya rija. Se amplía a fin del
  // día y el recorte fino por clave lo hace `tramoDelDia`.
  const finDeHoy = new Date(hoy.getTime() + 86_400_000 - 1);
  const asignaciones = await prisma.usuarioDiagrama.findMany({
    where: {
      usuarioId: { in: usuarioIds },
      fechaInicio: { lte: finDeHoy },
      OR: [{ fechaFin: null }, { fechaFin: { gte: hoy } }],
    },
    orderBy: { fechaInicio: 'asc' },
    select: {
      usuarioId: true, fechaInicio: true, fechaFin: true,
      diagrama: { select: { id: true, nombre: true, tipo: true, diasTrabajo: true, diasDescanso: true, diasSemana: true } },
    },
  });

  const porUsuario = new Map<string, TramoDiagrama[]>();
  for (const a of asignaciones) {
    const lista = porUsuario.get(a.usuarioId) ?? [];
    lista.push({ diagrama: a.diagrama, fechaInicio: a.fechaInicio, fechaFin: a.fechaFin });
    porUsuario.set(a.usuarioId, lista);
  }
  for (const uid of usuarioIds) {
    const vigente = tramoDelDia(porUsuario.get(uid) ?? [], hoy);
    salida.set(uid, { clave: turnoKey(vigente), tramo: vigente });
  }
  return salida;
}

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
              adjuntos: true,
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

// ─── GET /mensajes/enviados — Sent messages (COORDINADOR+) ──
// Ya filtra por `remitenteId`, así que bajar el nivel no expone nada ajeno: cada
// uno ve lo que mandó él.
router.get('/enviados', requireLevel(NIVEL_MINIMO_DIFUSION), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const mensajes = await prisma.mensaje.findMany({
      where: { remitenteId: req.user!.userId },
      include: {
        adjuntos: true,
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

// ─── GET /mensajes/grupos-difusion — A quiénes puedo escribirle ────
//
// Va ANTES de `GET /:id`, si no Express lo toma como un id.
//
// Devuelve el alcance del remitente y los grupos reales de su alcance, con el
// tamaño de cada uno. La idea es que antes de mandar vea a cuánta gente le está
// por escribir y cuándo arranca cada turno, en vez de elegir a ciegas de una
// lista fija que puede no corresponder a nadie.
router.get('/grupos-difusion', requireLevel(NIVEL_MINIMO_DIFUSION), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const empresaId = req.user!.empresaId;
    const { sectorId, alcance, permitidos } = await contextoDeDifusion(req.user!);
    if (alcance === 'NINGUNO') {
      res.status(403).json({ error: 'No podés enviar difusiones' });
      return;
    }

    // Con alcance SECTOR el filtro es siempre el sector propio, ignorando lo que
    // pida el cliente. Con alcance EMPRESA, `sectorId` de la query acota los
    // turnos al sector elegido (para que el conteo coincida con lo que se manda).
    const sectorPedido = typeof req.query.sectorId === 'string' && req.query.sectorId ? req.query.sectorId : null;
    const sectorFiltro = alcance === 'SECTOR' ? sectorId : sectorPedido;

    // Alcance SECTOR sin sector propio no debería existir —`alcanceDeDifusion`
    // devuelve EMPRESA en ese caso— pero si pasara, el alcance queda vacío en vez
    // de abarcar la empresa entera por omitir el filtro.
    if (alcance === 'SECTOR' && !sectorFiltro) {
      res.json({ alcance, sectorPropio: null, destinosPermitidos: permitidos, sectores: [], turnos: [], totalAlcance: 0 });
      return;
    }

    const where: { empresaId: string; activo: boolean; id: { not: string }; sectorId?: string } = {
      empresaId, activo: true, id: { not: req.user!.userId },
    };
    if (sectorFiltro) where.sectorId = sectorFiltro;

    const usuarios = await prisma.usuario.findMany({ where, select: { id: true } });
    const turnos = await turnosDeUsuarios(usuarios.map((u) => u.id));

    const hoy = hoyLocalEmpresa();
    const grupos = new Map<string, { clave: string; etiqueta: string; proximoInicio: string | null; cantidad: number }>();
    for (const { clave, tramo } of turnos.values()) {
      const ya = grupos.get(clave);
      if (ya) { ya.cantidad++; continue; }
      const { etiqueta, proximoInicio } = etiquetaTurno(tramo, hoy);
      grupos.set(clave, { clave, etiqueta, proximoInicio, cantidad: 1 });
    }

    const listaTurnos = [...grupos.values()].sort((a, b) => {
      // "Sin diagrama asignado" siempre último: es el cajón de sobras, no un turno.
      if (a.clave === 'SIN') return 1;
      if (b.clave === 'SIN') return -1;
      return b.cantidad - a.cantidad;
    });

    // Los sectores sólo tienen sentido si se puede elegir uno distinto al propio.
    const sectores = alcance === 'EMPRESA'
      ? await prisma.sector.findMany({
          where: { empresaId, activo: true },
          select: { id: true, nombre: true },
          orderBy: { nombre: 'asc' },
        })
      : [];

    res.json({
      alcance,
      sectorPropio: sectorId,
      destinosPermitidos: permitidos,
      sectores,
      turnos: listaTurnos,
      totalAlcance: usuarios.length,
    });
  } catch (error) {
    console.error('Error listing grupos de difusión:', error);
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
        adjuntos: true,
        respuestas: {
          include: {
            usuario: { select: { id: true, nombre: true, apellido: true, rol: true } },
            adjuntos: true,
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

    // Ensure message belongs to caller's empresa
    if (mensaje.empresaId !== req.user!.empresaId) {
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

    // Privacy: only the sender (or RRHH+) may see the full recipient list and
    // read-receipts of a broadcast. A plain recipient must not enumerate the rest.
    const canSeeRecipients = isSender || (req.user!.rolNivel ?? 0) >= LEVEL_RRHH;
    if (!canSeeRecipients) {
      const { destinatarios, ...rest } = mensaje;
      void destinatarios;
      res.json(rest);
      return;
    }

    res.json(mensaje);
  } catch (error) {
    console.error('Error getting mensaje:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /mensajes — Send message (COORDINADOR+) ───
const createMensajeSchema = z.object({
  asunto: z.string().min(1).max(200),
  cuerpo: z.string().min(1).max(5000),
  permiteRespuesta: z.boolean().optional().default(false),
  destinoTipo: z.enum(['TODOS', 'SECTOR', 'ROL', 'TURNO', 'USUARIO']),
  destinoValor: z.string().optional(),
  // Sólo lo mira quien tiene alcance EMPRESA: acota la difusión a un sector sin
  // que el destino deje de ser TODOS o TURNO.
  destinoSectorId: z.string().uuid().optional(),
});

router.post('/', requireLevel(NIVEL_MINIMO_DIFUSION), upload.single('archivo'), async (req: AuthRequest, res: Response): Promise<void> => {
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

    const { asunto, cuerpo, permiteRespuesta, destinoTipo, destinoValor, destinoSectorId } = parsed.data;
    const empresaId = req.user!.empresaId;
    const remitenteId = req.user!.userId;

    const { sectorId, alcance, permitidos } = await contextoDeDifusion(req.user!);
    if (!permitidos.includes(destinoTipo)) {
      res.status(403).json({ error: 'No podés difundir con ese destino' });
      return;
    }

    // Sector efectivo: con alcance SECTOR nunca es otro que el propio, mande lo
    // que mande el cliente. Es la única línea que impide que un coordinador le
    // escriba a otro sector poniendo un id a mano.
    const sectorEfectivo = alcance === 'SECTOR' ? sectorId : (destinoSectorId ?? null);

    // Piso común de TODA resolución de destinatarios: misma empresa, activo, y
    // nunca el propio remitente. Cada destino sólo agrega condiciones encima.
    const baseWhere: { empresaId: string; activo: boolean; id: { not: string }; sectorId?: string; rol?: string } = {
      empresaId, activo: true, id: { not: remitenteId },
    };
    if (sectorEfectivo) baseWhere.sectorId = sectorEfectivo;

    // Resolve recipients
    let userIds: string[] = [];

    if (destinoTipo === 'TODOS') {
      const users = await prisma.usuario.findMany({ where: baseWhere, select: { id: true } });
      userIds = users.map(u => u.id);
    } else if (destinoTipo === 'SECTOR') {
      if (!destinoValor) { res.status(400).json({ error: 'Se requiere el sector' }); return; }
      // Con alcance SECTOR el sector es el propio, aunque el cliente pida otro.
      if (alcance === 'SECTOR' && destinoValor !== sectorId) {
        res.status(403).json({ error: 'Sólo podés difundir a tu propio sector' });
        return;
      }
      const users = await prisma.usuario.findMany({
        where: { ...baseWhere, sectorId: destinoValor },
        select: { id: true },
      });
      userIds = users.map(u => u.id);
    } else if (destinoTipo === 'ROL') {
      if (!destinoValor) { res.status(400).json({ error: 'Se requiere el rol' }); return; }
      const users = await prisma.usuario.findMany({
        where: { ...baseWhere, rol: destinoValor },
        select: { id: true },
      });
      userIds = users.map(u => u.id);
    } else if (destinoTipo === 'TURNO') {
      if (!destinoValor) { res.status(400).json({ error: 'Se requiere el turno' }); return; }
      // El turno no es una columna: sale del diagrama vigente hoy de cada uno.
      // Por eso se trae el alcance entero y se filtra en memoria, en vez de en SQL.
      const users = await prisma.usuario.findMany({ where: baseWhere, select: { id: true } });
      const turnos = await turnosDeUsuarios(users.map(u => u.id));
      userIds = users.map(u => u.id).filter(uid => turnos.get(uid)?.clave === destinoValor);
    } else if (destinoTipo === 'USUARIO') {
      if (!destinoValor) { res.status(400).json({ error: 'Se requiere el usuario' }); return; }
      // Validate all recipient IDs belong to sender's empresa; never self-address.
      // Van contra `baseWhere`, así que un coordinador no puede escribirle a
      // alguien de otro sector pasando su id a mano.
      const rawIds = destinoValor.split(',').map(id => id.trim()).filter(Boolean).filter(id => id !== remitenteId);
      const validUsers = await prisma.usuario.findMany({
        where: { ...baseWhere, id: { in: rawIds, not: remitenteId } },
        select: { id: true },
      });
      userIds = validUsers.map(u => u.id);
    }

    if (userIds.length === 0) {
      res.status(400).json({ error: 'No se encontraron destinatarios' });
      return;
    }

    const mensaje = await prisma.mensaje.create({
      data: {
        empresaId,
        remitenteId,
        asunto,
        cuerpo,
        permiteRespuesta,
        esDifusion: destinoTipo !== 'USUARIO' || userIds.length > 1,
        destinoTipo,
        destinoValor: destinoValor ?? null,
        destinoSectorId: sectorEfectivo,
        destinatarios: {
          create: userIds.map(uid => ({ usuarioId: uid })),
        },
        adjuntos: { create: adjuntosDesdeArchivo(req.file) },
      },
      include: { adjuntos: true },
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
          titulo: `Nuevo mensaje: ${asunto}`,
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

    // Ensure message belongs to caller's empresa
    if (mensaje.empresaId !== req.user!.empresaId) {
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

    const respuesta = await prisma.mensajeRespuesta.create({
      data: {
        mensajeId,
        usuarioId: userId,
        cuerpo: parsed.data.cuerpo,
        adjuntos: { create: adjuntosDesdeArchivo(req.file) },
      },
      include: {
        usuario: { select: { id: true, nombre: true, apellido: true, rol: true } },
        adjuntos: true,
      },
    });

    // Notify the original sender about the reply
    if (mensaje.remitenteId !== userId) {
      const replier = respuesta.usuario;
      await crearNotificacion({
        usuarioId: mensaje.remitenteId,
        tipo: 'MENSAJE',
        titulo: `Respuesta a: ${mensaje.asunto}`,
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
