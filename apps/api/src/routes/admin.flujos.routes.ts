import { Router, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_ADMIN } from '../middleware/roles.middleware.js';
import { logAuditoria } from '../lib/auditoria.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);
router.use(requireLevel(LEVEL_ADMIN));

// ─── Schemas ─────────────────────────────────────

/**
 * Los tipos de documento que pasan por un flujo. Es la misma lista que
 * `TipoDocumentoFlujo` en utils/circuito.utils.ts: si un tipo no está acá, el
 * admin no puede crear el flujo que después el motor va a buscar. CAMBIO_DIAGRAMA
 * faltaba, así que quien borrara ese flujo del seed no tenía forma de recrearlo.
 */
const TIPOS_DOCUMENTO = ['PLANILLA', 'VACACION', 'AUSENCIA', 'COMPENSATORIO', 'CAMBIO_DIAGRAMA'] as const;

// Shared paso shape used in create/update/individual step operations
const pasoSchema = z.object({
  orden: z.number().int().min(1),
  nombrePaso: z.string().min(1).max(100),
  rolAprobador: z.string().min(1),
  usuarioEspecificoId: z.string().uuid().optional().nullable(),
  requiereComentarioRechazo: z.boolean().optional(),
  notificarRoles: z.array(z.string().min(1)).optional(),
  tiempoLimiteHoras: z.number().int().optional().nullable(),
});

const createFlujoSchema = z.object({
  nombre: z.string().min(1).max(100),
  tipoDocumento: z.enum(TIPOS_DOCUMENTO),
  descripcion: z.string().max(500).optional(),
  pasos: z.array(pasoSchema).min(1),
});

const updateFlujoSchema = z.object({
  nombre: z.string().min(1).max(100).optional(),
  descripcion: z.string().max(500).optional(),
  activo: z.boolean().optional(),
  pasos: z.array(pasoSchema).min(1).optional(),
});

// Alias for the individual step creation endpoint
const createPasoSchema = pasoSchema;

const createAsignacionSchema = z.object({
  flujoId: z.string().uuid(),
  // Era `z.string()` suelto: se podía asignar un flujo a un tipo inexistente y
  // la asignación quedaba muerta sin que nadie se enterara.
  tipoDocumento: z.enum(TIPOS_DOCUMENTO),
  sectorId: z.string().uuid().optional().nullable(),
  usuarioId: z.string().uuid().optional().nullable(),
});

// ─── Helpers ─────────────────────────────────────

/** Choque contra un índice único de Postgres (asignación repetida, orden repetido). */
function esConflictoUnico(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Documentos que todavía están circulando por un flujo.
 *
 * Los cuatro tipos que pasan por un circuito tienen cada uno su propio enum de
 * estados y NO coinciden: la planilla usa ENVIADA y los otros tres PENDIENTE.
 * Por eso la lista de estados va escrita tipo por tipo.
 *
 * `soloSinCircuitoPropio` deja solo los que no congelaron el circuito al
 * enviarse (documentos anteriores a `circuitoSnapshot`): esos siguen leyendo
 * los pasos vivos del flujo — mirá `pasosDe` — y son los únicos que se quedan
 * sin circuito si el flujo desaparece.
 */
async function contarDocumentosEnCurso(flujoId: string, soloSinCircuitoPropio = false): Promise<number> {
  // `undefined` en Prisma significa "sin filtro"; AnyNull cubre tanto el NULL de
  // la columna como un JSON `null` guardado adentro.
  const sinCircuito = soloSinCircuitoPropio ? { equals: Prisma.AnyNull } : undefined;
  const [planillas, vacaciones, ausencias, cambiosDiagrama] = await Promise.all([
    prisma.planilla.count({
      where: { flujoId, estado: { in: ['ENVIADA', 'EN_REVISION'] }, circuitoSnapshot: sinCircuito },
    }),
    prisma.vacacion.count({
      where: { flujoId, estado: { in: ['PENDIENTE', 'EN_REVISION'] }, circuitoSnapshot: sinCircuito },
    }),
    prisma.ausencia.count({
      where: { flujoId, estado: { in: ['PENDIENTE', 'EN_REVISION'] }, circuitoSnapshot: sinCircuito },
    }),
    prisma.solicitudCambioDiagrama.count({
      where: { flujoId, estado: { in: ['PENDIENTE', 'EN_REVISION'] }, circuitoSnapshot: sinCircuito },
    }),
  ]);
  return planillas + vacaciones + ausencias + cambiosDiagrama;
}

/**
 * Renumera los pasos de un flujo 1..N después de borrar uno.
 *
 * Va de menor a mayor orden a propósito. El índice único (flujo_id, orden) se
 * verifica fila por fila, no al final de la transacción, así que actualizar en
 * cualquier orden puede chocar contra un paso que todavía no se movió. Yendo de
 * menor a mayor, el i-ésimo paso que queda siempre baja a i+1 y los anteriores
 * ya ocuparon 1..i: el destino nunca está tomado.
 */
async function renumerarPasos(tx: Prisma.TransactionClient, flujoId: string): Promise<void> {
  const restantes = await tx.flujoPaso.findMany({
    where: { flujoId },
    orderBy: { orden: 'asc' },
    select: { id: true, orden: true },
  });
  for (let i = 0; i < restantes.length; i++) {
    const paso = restantes[i]!;
    if (paso.orden !== i + 1) {
      await tx.flujoPaso.update({ where: { id: paso.id }, data: { orden: i + 1 } });
    }
  }
}

/** El orden que venía en el cuerpo del pedido, solo para armar el mensaje del 409. */
function ordenDelCuerpo(body: unknown): string {
  if (body && typeof body === 'object' && 'orden' in body) return String((body as { orden: unknown }).orden);
  return 'indicado';
}

/** Etiqueta legible del alcance de una asignación, para los mensajes de error. */
function alcanceDe(a: {
  sector: { nombre: string } | null;
  usuario: { nombre: string; apellido: string } | null;
}): string {
  if (a.usuario) return `${a.usuario.nombre} ${a.usuario.apellido}`;
  if (a.sector) return a.sector.nombre;
  return 'global';
}

// ─── GET /admin/flujos ───────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const flujos = await prisma.flujoAprobacion.findMany({
      where: { empresaId: req.user!.empresaId },
      include: {
        pasos: { orderBy: { orden: 'asc' } },
        _count: { select: { asignaciones: true, planillas: true, vacaciones: true } },
      },
      orderBy: { nombre: 'asc' },
    });
    res.json(flujos);
  } catch (error) {
    console.error('Error listing flujos:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /admin/flujos ──────────────────────────

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createFlujoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const ordenes = parsed.data.pasos.map((p) => p.orden);
    if (new Set(ordenes).size !== ordenes.length) {
      res.status(409).json({ error: 'Hay dos pasos con el mismo orden. Cada paso tiene que tener un orden distinto.' });
      return;
    }

    const flujo = await prisma.flujoAprobacion.create({
      data: {
        empresaId: req.user!.empresaId,
        nombre: parsed.data.nombre,
        tipoDocumento: parsed.data.tipoDocumento,
        descripcion: parsed.data.descripcion ?? null,
        pasos: {
          create: parsed.data.pasos.map((p) => ({
            orden: p.orden,
            nombrePaso: p.nombrePaso,
            rolAprobador: p.rolAprobador,
            usuarioEspecificoId: p.usuarioEspecificoId ?? null,
            requiereComentarioRechazo: p.requiereComentarioRechazo ?? true,
            notificarRoles: p.notificarRoles ?? [],
            tiempoLimiteHoras: p.tiempoLimiteHoras ?? null,
          })),
        },
      },
      include: { pasos: { orderBy: { orden: 'asc' } } },
    });

    await logAuditoria({
      entidad: 'FlujoAprobacion',
      entidadId: flujo.id,
      accion: 'CREAR',
      descripcion: `Alta del flujo "${flujo.nombre}" (${flujo.tipoDocumento}) con ${flujo.pasos.length} paso(s): ${flujo.pasos.map((p) => p.rolAprobador).join(' → ')}`,
      usuarioId: req.user!.userId,
    }).catch(() => { /* la auditoría no puede tumbar la respuesta */ });

    res.status(201).json(flujo);
  } catch (error) {
    if (esConflictoUnico(error)) {
      res.status(409).json({ error: 'Hay dos pasos con el mismo orden. Cada paso tiene que tener un orden distinto.' });
      return;
    }
    console.error('Error creating flujo:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /admin/flujos/:id ───────────────────────

router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const flujoId = req.params.id as string;
    const flujo = await prisma.flujoAprobacion.findFirst({
      where: { id: flujoId, empresaId: req.user!.empresaId },
      include: {
        pasos: {
          orderBy: { orden: 'asc' },
          include: { usuarioEspecifico: { select: { nombre: true, apellido: true } } },
        },
        asignaciones: {
          include: {
            sector: { select: { id: true, nombre: true } },
            usuario: { select: { id: true, nombre: true, apellido: true } },
          },
        },
      },
    });

    if (!flujo) {
      res.status(404).json({ error: 'Flujo no encontrado' });
      return;
    }
    res.json(flujo);
  } catch (error) {
    console.error('Error getting flujo:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PUT /admin/flujos/:id ───────────────────────

router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const flujoId = req.params.id as string;
    const parsed = updateFlujoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos' });
      return;
    }

    const existing = await prisma.flujoAprobacion.findFirst({
      where: { id: flujoId, empresaId: req.user!.empresaId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Flujo no encontrado' });
      return;
    }

    const { pasos, ...flujoData } = parsed.data;

    if (pasos) {
      const ordenes = pasos.map((p) => p.orden);
      if (new Set(ordenes).size !== ordenes.length) {
        res.status(409).json({ error: 'Hay dos pasos con el mismo orden. Cada paso tiene que tener un orden distinto.' });
        return;
      }
    }

    let flujo;
    if (pasos) {
      // Atomic replace: delete all steps and create the new ones in one transaction
      const [, updated] = await prisma.$transaction([
        prisma.flujoPaso.deleteMany({ where: { flujoId } }),
        prisma.flujoAprobacion.update({
          where: { id: flujoId },
          data: {
            ...flujoData,
            pasos: {
              create: pasos.map((p) => ({
                orden: p.orden,
                nombrePaso: p.nombrePaso,
                rolAprobador: p.rolAprobador,
                usuarioEspecificoId: p.usuarioEspecificoId ?? null,
                requiereComentarioRechazo: p.requiereComentarioRechazo ?? true,
                notificarRoles: p.notificarRoles ?? [],
                tiempoLimiteHoras: p.tiempoLimiteHoras ?? null,
              })),
            },
          },
          include: { pasos: { orderBy: { orden: 'asc' } } },
        }),
      ]);
      flujo = updated;
    } else {
      flujo = await prisma.flujoAprobacion.update({
        where: { id: flujoId },
        data: flujoData,
        include: { pasos: { orderBy: { orden: 'asc' } } },
      });
    }

    await logAuditoria({
      entidad: 'FlujoAprobacion',
      entidadId: flujoId,
      accion: 'EDITAR',
      descripcion:
        `Edición del flujo "${flujo.nombre}"` +
        (pasos ? ` — cadena reemplazada: ${flujo.pasos.map((p) => p.rolAprobador).join(' → ')}` : '') +
        (flujoData.activo !== undefined ? ` — activo=${flujoData.activo}` : ''),
      usuarioId: req.user!.userId,
    }).catch(() => { /* la auditoría no puede tumbar la respuesta */ });

    // Cuántos documentos nacieron de este flujo y siguen en curso. NO bloquea:
    // los que se enviaron con el circuito congelado ya no dependen de esta
    // configuración. Es información para que el admin sepa el alcance del cambio.
    const documentosEnCurso = await contarDocumentosEnCurso(flujoId);

    res.json({ ...flujo, documentosEnCurso });
  } catch (error) {
    if (esConflictoUnico(error)) {
      res.status(409).json({ error: 'Hay dos pasos con el mismo orden. Cada paso tiene que tener un orden distinto.' });
      return;
    }
    console.error('Error updating flujo:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── DELETE /admin/flujos/:id ────────────────────

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const flujoId = req.params.id as string;
    const existing = await prisma.flujoAprobacion.findFirst({
      where: { id: flujoId, empresaId: req.user!.empresaId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Flujo no encontrado' });
      return;
    }

    // La FK de flujos_asignaciones es RESTRICT: sin borrar las asignaciones
    // primero, Postgres rechaza el DELETE y el usuario recibe un 500 opaco.
    // (Los pasos son CASCADE y el flujo_id de los documentos es SET NULL, así
    // que esos dos no bloquean el borrado.)
    const asignaciones = await prisma.flujoAsignacion.findMany({
      where: { flujoId },
      include: {
        sector: { select: { nombre: true } },
        usuario: { select: { nombre: true, apellido: true } },
      },
    });

    // Un documento en curso SIN circuito congelado todavía lee los pasos vivos
    // del flujo: si el flujo desaparece se queda sin circuito y no puede avanzar.
    const huerfanos = await contarDocumentosEnCurso(flujoId, true);

    const forzar = req.query.forzarDesasignacion === 'true';
    if ((asignaciones.length > 0 || huerfanos > 0) && !forzar) {
      const motivos: string[] = [];
      if (asignaciones.length > 0) {
        motivos.push(`está asignado a: ${asignaciones.map(alcanceDe).join(', ')}`);
      }
      if (huerfanos > 0) {
        motivos.push(`hay ${huerfanos} documento(s) en curso sin circuito congelado que quedarían trabados`);
      }
      res.status(409).json({
        error: `No se borró el flujo porque ${motivos.join(' y ')}. Repetí la operación con forzarDesasignacion=true para desasignarlo y borrarlo igual.`,
        asignaciones: asignaciones.length,
        documentosSinCircuitoPropio: huerfanos,
      });
      return;
    }

    // Los pasos se borran explícitamente aunque la FK sea CASCADE: así el
    // borrado no depende de una regla que vive solo en la migración.
    await prisma.$transaction([
      prisma.flujoAsignacion.deleteMany({ where: { flujoId } }),
      prisma.flujoPaso.deleteMany({ where: { flujoId } }),
      prisma.flujoAprobacion.delete({ where: { id: flujoId } }),
    ]);

    await logAuditoria({
      entidad: 'FlujoAprobacion',
      entidadId: flujoId,
      accion: 'ELIMINAR',
      descripcion:
        `Baja del flujo "${existing.nombre}" (${existing.tipoDocumento})` +
        (asignaciones.length > 0 ? ` — se desasignaron ${asignaciones.length} alcance(s): ${asignaciones.map(alcanceDe).join(', ')}` : '') +
        (huerfanos > 0 ? ` — ${huerfanos} documento(s) en curso quedaron sin flujo` : ''),
      usuarioId: req.user!.userId,
    }).catch(() => { /* la auditoría no puede tumbar la respuesta */ });

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting flujo:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /admin/flujos/:id/pasos ────────────────

router.post('/:id/pasos', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const flujoId = req.params.id as string;
    const parsed = createPasoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const flujo = await prisma.flujoAprobacion.findFirst({
      where: { id: flujoId, empresaId: req.user!.empresaId },
    });
    if (!flujo) {
      res.status(404).json({ error: 'Flujo no encontrado' });
      return;
    }

    const paso = await prisma.flujoPaso.create({
      data: {
        flujoId,
        orden: parsed.data.orden,
        nombrePaso: parsed.data.nombrePaso,
        rolAprobador: parsed.data.rolAprobador,
        usuarioEspecificoId: parsed.data.usuarioEspecificoId ?? null,
        requiereComentarioRechazo: parsed.data.requiereComentarioRechazo ?? true,
        notificarRoles: parsed.data.notificarRoles ?? [],
        tiempoLimiteHoras: parsed.data.tiempoLimiteHoras ?? null,
      },
    });
    res.status(201).json(paso);
  } catch (error) {
    // El índice único (flujo_id, orden) devolvía un 500 opaco cuando el orden
    // ya estaba ocupado.
    if (esConflictoUnico(error)) {
      res.status(409).json({ error: `Ya hay un paso con el orden ${ordenDelCuerpo(req.body)} en este flujo.` });
      return;
    }
    console.error('Error creating paso:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PUT /admin/flujos/:id/pasos/:pid ────────────

router.put('/:id/pasos/:pid', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const pid = req.params.pid as string;
    const empresaId = req.user!.empresaId;
    const parsed = pasoSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }
    // Tenant check is folded into the WHERE — atomic, no TOCTOU
    const result = await prisma.flujoPaso.updateMany({
      where: { id: pid, flujo: { empresaId } },
      data: parsed.data,
    });
    if (result.count === 0) {
      res.status(404).json({ error: 'Paso no encontrado' });
      return;
    }
    const paso = await prisma.flujoPaso.findUnique({ where: { id: pid } });
    res.json(paso);
  } catch (error) {
    if (esConflictoUnico(error)) {
      res.status(409).json({ error: `Ya hay otro paso con el orden ${ordenDelCuerpo(req.body)} en este flujo.` });
      return;
    }
    console.error('Error updating paso:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── DELETE /admin/flujos/:id/pasos/:pid ─────────

/** Sentinela para salir de la transacción con un 404 y sin dejar nada a medias. */
const PASO_NO_ENCONTRADO = 'PASO_NO_ENCONTRADO';

router.delete('/:id/pasos/:pid', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const pid = req.params.pid as string;
    const empresaId = req.user!.empresaId;
    // Borrar y renumerar van en la misma transacción: con el índice único
    // (flujo_id, orden), un flujo que quede con huecos rechaza el próximo paso
    // que quiera ocupar un orden intermedio.
    await prisma.$transaction(async (tx) => {
      // Tenant check folded into the WHERE — no hay ventana entre buscar y borrar
      // porque la transacción cubre las dos cosas.
      const paso = await tx.flujoPaso.findFirst({
        where: { id: pid, flujo: { empresaId } },
        select: { flujoId: true },
      });
      if (!paso) throw new Error(PASO_NO_ENCONTRADO);
      await tx.flujoPaso.delete({ where: { id: pid } });
      await renumerarPasos(tx, paso.flujoId);
    });
    res.status(204).send();
  } catch (error) {
    if (error instanceof Error && error.message === PASO_NO_ENCONTRADO) {
      res.status(404).json({ error: 'Paso no encontrado' });
      return;
    }
    console.error('Error deleting paso:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /admin/flujos/asignaciones ──────────────

router.get('/asignaciones/list', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const asignaciones = await prisma.flujoAsignacion.findMany({
      where: { flujo: { empresaId: req.user!.empresaId } },
      include: {
        flujo: { select: { nombre: true, tipoDocumento: true } },
        sector: { select: { id: true, nombre: true } },
        usuario: { select: { id: true, nombre: true, apellido: true } },
      },
    });
    res.json(asignaciones);
  } catch (error) {
    console.error('Error listing asignaciones:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /admin/flujos/asignaciones ─────────────

router.post('/asignaciones', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createAsignacionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const empresaId = req.user!.empresaId;
    const flujo = await prisma.flujoAprobacion.findFirst({
      where: { id: parsed.data.flujoId, empresaId },
    });
    if (!flujo) {
      res.status(404).json({ error: 'Flujo no encontrado' });
      return;
    }

    // Asignar un flujo de PLANILLA al tipo VACACION no rompe nada, pero
    // `resolverFlujo` exige que los dos tipos coincidan: la asignación quedaría
    // muerta y nadie se enteraría.
    if (flujo.tipoDocumento !== parsed.data.tipoDocumento) {
      res.status(400).json({
        error: `El flujo "${flujo.nombre}" es de tipo ${flujo.tipoDocumento} y lo estás asignando a ${parsed.data.tipoDocumento}. Tienen que coincidir.`,
      });
      return;
    }

    const sectorId = parsed.data.sectorId ?? null;
    const usuarioId = parsed.data.usuarioId ?? null;

    // Un alcance = un flujo por tipo de documento. El WHERE NO incluye flujoId
    // a propósito: lo que hay que impedir es que dos flujos distintos se peleen
    // el mismo alcance, no solo repetir el mismo flujo.
    //
    // Tampoco filtra por `activo`: los índices únicos de la base no lo miran, y
    // una asignación desactivada ocupa el lugar igual. Si filtráramos, el insert
    // pasaría la guarda y explotaría con un P2002 crudo.
    const ocupado = await prisma.flujoAsignacion.findFirst({
      where: { tipoDocumento: parsed.data.tipoDocumento, sectorId, usuarioId },
      include: { flujo: { select: { nombre: true, empresaId: true } } },
    });
    if (ocupado) {
      // Los índices únicos no llevan empresa (la tabla no tiene empresa_id), así
      // que el choque puede venir de otra empresa: en ese caso no se filtra el
      // nombre del flujo ajeno.
      const detalle =
        ocupado.flujo.empresaId === empresaId
          ? `ya usa el flujo "${ocupado.flujo.nombre}"${ocupado.activo ? '' : ' (desactivado, pero ocupa el lugar igual)'}`
          : 'ya está ocupado';
      res.status(409).json({
        error: `Ese alcance ${detalle}. Cada sector puede tener un solo flujo por tipo de documento: borrá la asignación existente antes de crear otra.`,
      });
      return;
    }

    const asignacion = await prisma.flujoAsignacion.create({
      data: {
        flujoId: parsed.data.flujoId,
        tipoDocumento: parsed.data.tipoDocumento,
        sectorId,
        usuarioId,
      },
      include: {
        sector: { select: { nombre: true } },
        usuario: { select: { nombre: true, apellido: true } },
      },
    });

    await logAuditoria({
      entidad: 'FlujoAsignacion',
      entidadId: asignacion.id,
      accion: 'CREAR',
      descripcion: `El flujo "${flujo.nombre}" pasa a regir ${parsed.data.tipoDocumento} para: ${alcanceDe(asignacion)}`,
      usuarioId: req.user!.userId,
    }).catch(() => { /* la auditoría no puede tumbar la respuesta */ });

    res.status(201).json(asignacion);
  } catch (error) {
    // Red de contención: entre la guarda de arriba y el insert puede colarse
    // otra asignación del mismo alcance.
    if (esConflictoUnico(error)) {
      res.status(409).json({
        error: 'Ese alcance ya tiene un flujo asignado para este tipo de documento. Borrá la asignación existente antes de crear otra.',
      });
      return;
    }
    console.error('Error creating asignacion:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── DELETE /admin/flujos/asignaciones/:id ───────

router.delete('/asignaciones/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const asignacion = await prisma.flujoAsignacion.findFirst({
      where: { id: req.params.id, flujo: { empresaId: req.user!.empresaId } },
      include: {
        flujo: { select: { nombre: true } },
        sector: { select: { nombre: true } },
        usuario: { select: { nombre: true, apellido: true } },
      },
    });
    if (!asignacion) {
      res.status(404).json({ error: 'Asignación no encontrada' });
      return;
    }
    await prisma.flujoAsignacion.delete({ where: { id: req.params.id } });

    await logAuditoria({
      entidad: 'FlujoAsignacion',
      entidadId: asignacion.id,
      accion: 'ELIMINAR',
      descripcion: `El flujo "${asignacion.flujo.nombre}" deja de regir ${asignacion.tipoDocumento} para: ${alcanceDe(asignacion)}`,
      usuarioId: req.user!.userId,
    }).catch(() => { /* la auditoría no puede tumbar la respuesta */ });

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting asignacion:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
