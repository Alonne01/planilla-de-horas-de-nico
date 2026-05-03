import { Router, Response } from 'express';
import { PrismaClient, ConceptoTipo } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH } from '../middleware/roles.middleware.js';
import { logAuditoria } from '../lib/auditoria.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);
router.use(requireLevel(LEVEL_RRHH));

// ─── Schemas ─────────────────────────────────────

const createConceptoSchema = z.object({
  convenioId: z.string().uuid(),
  codigo: z.string().min(1).max(20),
  nombre: z.string().min(1).max(100),
  tipo: z.nativeEnum(ConceptoTipo),
  descripcion: z.string().max(500).optional(),
  esPorcentual: z.boolean().optional(),
  porcentajeBase: z.number().optional(),
  montoFijo: z.number().optional(),
  baseCalculo: z.string().max(50).optional(),
  aplicaSiempre: z.boolean().optional(),
  condicionFormula: z.string().max(500).optional(),
  esRemunerativo: z.boolean().optional(),
  visibleEmpleado: z.boolean().optional(),
  editableRrhh: z.boolean().optional(),
  orden: z.number().int().optional(),
});

const createValorSchema = z.object({
  categoriaId: z.string().uuid().optional(),
  vigenteDesde: z.string(),
  vigenteHasta: z.string().optional(),
  monto: z.number().optional(),
  porcentaje: z.number().optional(),
});

// ─── GET /admin/conceptos ────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const empresaId = req.user!.empresaId;
    const convenioId = req.query.convenioId as string | undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { convenio: { empresaId } };
    if (convenioId) where.convenioId = convenioId;

    const conceptos = await prisma.conceptoSalarial.findMany({
      where,
      include: {
        convenio: { select: { nombre: true } },
        valores: { include: { categoria: { select: { codigo: true, nombre: true } } }, orderBy: { vigenteDesde: 'desc' } },
      },
      orderBy: [{ convenioId: 'asc' }, { orden: 'asc' }],
    });
    res.json(conceptos);
  } catch (error) {
    console.error('Error listing conceptos:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /admin/conceptos ───────────────────────

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createConceptoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    // Verify convenio belongs to empresa
    const convenio = await prisma.convenio.findFirst({
      where: { id: parsed.data.convenioId, empresaId: req.user!.empresaId },
    });
    if (!convenio) {
      res.status(400).json({ error: 'Convenio no encontrado' });
      return;
    }

    const concepto = await prisma.conceptoSalarial.create({
      data: parsed.data,
      include: { convenio: { select: { nombre: true } } },
    });

    await logAuditoria({
      entidad: 'ConceptoSalarial',
      entidadId: concepto.id,
      accion: 'CREAR',
      descripcion: `Concepto ${concepto.codigo} — ${concepto.nombre}`,
      usuarioId: req.user!.userId,
    });

    res.status(201).json(concepto);
  } catch (error) {
    console.error('Error creating concepto:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /admin/conceptos/:id ────────────────────

router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Bug fix: scope by tenant to prevent cross-company salary data reads
    const concepto = await prisma.conceptoSalarial.findFirst({
      where: { id: req.params.id as string, convenio: { empresaId: req.user!.empresaId } },
      include: {
        convenio: { select: { nombre: true, tipo: true } },
        valores: {
          include: { categoria: { select: { codigo: true, nombre: true } } },
          orderBy: { vigenteDesde: 'desc' },
        },
      },
    });
    if (!concepto) {
      res.status(404).json({ error: 'Concepto no encontrado' });
      return;
    }
    res.json(concepto);
  } catch (error) {
    console.error('Error getting concepto:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PUT /admin/conceptos/:id ────────────────────

router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.conceptoSalarial.findUnique({
      where: { id },
      include: { convenio: { select: { empresaId: true } } },
    });
    if (!existing || existing.convenio.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Concepto no encontrado' });
      return;
    }

    const updateParsed = createConceptoSchema.partial().safeParse(req.body);
    if (!updateParsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: updateParsed.error.flatten() });
      return;
    }

    const concepto = await prisma.conceptoSalarial.update({
      where: { id },
      data: updateParsed.data,
      include: { convenio: { select: { nombre: true } } },
    });

    await logAuditoria({
      entidad: 'ConceptoSalarial',
      entidadId: concepto.id,
      accion: 'EDITAR',
      descripcion: `Concepto ${concepto.codigo} — ${concepto.nombre}`,
      usuarioId: req.user!.userId,
    });

    res.json(concepto);
  } catch (error) {
    console.error('Error updating concepto:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── DELETE /admin/conceptos/:id ─────────────────

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.conceptoSalarial.findUnique({
      where: { id },
      include: { convenio: { select: { empresaId: true } } },
    });
    if (!existing || existing.convenio.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Concepto no encontrado' });
      return;
    }
    await prisma.conceptoSalarial.delete({ where: { id } });

    await logAuditoria({
      entidad: 'ConceptoSalarial',
      entidadId: id,
      accion: 'ELIMINAR',
      descripcion: `Concepto ${existing.codigo} — ${existing.nombre} eliminado`,
      usuarioId: req.user!.userId,
    });

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting concepto:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /admin/conceptos/:id/valores ───────────

router.post('/:id/valores', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const conceptoId = req.params.id as string;
    const parsed = createValorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos' });
      return;
    }

    // Bug fix: verify concepto belongs to current empresa before writing
    const concepto = await prisma.conceptoSalarial.findFirst({
      where: { id: conceptoId, convenio: { empresaId: req.user!.empresaId } },
      select: { id: true },
    });
    if (!concepto) {
      res.status(404).json({ error: 'Concepto no encontrado' });
      return;
    }

    const valor = await prisma.conceptoValor.create({
      data: {
        conceptoId,
        categoriaId: parsed.data.categoriaId ?? null,
        vigenteDesde: new Date(parsed.data.vigenteDesde),
        vigenteHasta: parsed.data.vigenteHasta ? new Date(parsed.data.vigenteHasta) : null,
        monto: parsed.data.monto ?? null,
        porcentaje: parsed.data.porcentaje ?? null,
      },
      include: { categoria: { select: { codigo: true, nombre: true } } },
    });

    await logAuditoria({
      entidad: 'ConceptoValor',
      entidadId: valor.id,
      accion: 'CREAR',
      valorNuevo: parsed.data.monto != null ? `$${parsed.data.monto}` : parsed.data.porcentaje != null ? `${parsed.data.porcentaje}%` : null,
      descripcion: `Valor para concepto ${conceptoId}${valor.categoria ? ` cat. ${valor.categoria.codigo}` : ' (general)'}`,
      usuarioId: req.user!.userId,
    });

    res.status(201).json(valor);
  } catch (error) {
    console.error('Error creating valor:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── DELETE /admin/conceptos/valores/:vid ────────

router.delete('/valores/:vid', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const vid = req.params.vid as string;
    // Bug fix: scope deletion to current empresa to prevent cross-tenant data deletion
    const existing = await prisma.conceptoValor.findFirst({
      where: { id: vid, concepto: { convenio: { empresaId: req.user!.empresaId } } },
      include: { categoria: { select: { codigo: true } } },
    });
    if (!existing) {
      res.status(404).json({ error: 'Valor no encontrado' });
      return;
    }

    await prisma.conceptoValor.delete({ where: { id: vid } });

    await logAuditoria({
      entidad: 'ConceptoValor',
      entidadId: vid,
      accion: 'ELIMINAR',
      valorAnterior: existing.monto ? `$${existing.monto}` : existing.porcentaje ? `${existing.porcentaje}%` : null,
      descripcion: `Valor eliminado — concepto ${existing.conceptoId}${existing.categoria ? ` cat. ${existing.categoria.codigo}` : ' (general)'}`,
      usuarioId: req.user!.userId,
    });

    res.status(204).send();
  } catch (error) {
    if ((error as { code?: string }).code === 'P2025') {
      res.status(404).json({ error: 'Valor no encontrado' });
      return;
    }
    console.error('Error deleting valor:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
