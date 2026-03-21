import { Router, Response } from 'express';
import { PrismaClient, CctTipo, ConceptoTipo } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH } from '../middleware/roles.middleware.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);
router.use(requireLevel(LEVEL_RRHH));

// ─── CONVENIOS ───────────────────────────────────

const createConvenioSchema = z.object({
  nombre: z.string().min(1).max(200),
  tipo: z.nativeEnum(CctTipo),
  vigenteDesde: z.string().datetime(),
  vigenteHasta: z.string().datetime().optional().nullable(),
});

router.get('/convenios', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const convenios = await prisma.convenio.findMany({
      where: { empresaId: req.user!.empresaId },
      include: {
        _count: { select: { categorias: true, conceptos: true, usuarios: true } },
      },
      orderBy: { nombre: 'asc' },
    });
    res.json(convenios);
  } catch (error) {
    console.error('Error listing convenios:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.get('/convenios/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const convenio = await prisma.convenio.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
      include: {
        categorias: { orderBy: { orden: 'asc' } },
        conceptos: { orderBy: { orden: 'asc' } },
      },
    });
    if (!convenio) {
      res.status(404).json({ error: 'Convenio no encontrado' });
      return;
    }
    res.json(convenio);
  } catch (error) {
    console.error('Error getting convenio:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.post('/convenios', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createConvenioSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }
    const convenio = await prisma.convenio.create({
      data: {
        empresaId: req.user!.empresaId,
        nombre: parsed.data.nombre,
        tipo: parsed.data.tipo,
        vigenteDesde: new Date(parsed.data.vigenteDesde),
        vigenteHasta: parsed.data.vigenteHasta ? new Date(parsed.data.vigenteHasta) : null,
      },
    });
    res.status(201).json(convenio);
  } catch (error) {
    console.error('Error creating convenio:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.put('/convenios/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.convenio.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
    });
    if (!existing) { res.status(404).json({ error: 'Convenio no encontrado' }); return; }
    const convenio = await prisma.convenio.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(convenio);
  } catch (error) {
    console.error('Error updating convenio:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── CATEGORÍAS ──────────────────────────────────

const createCategoriaSchema = z.object({
  convenioId: z.string().uuid(),
  codigo: z.string().min(1).max(20),
  nombre: z.string().min(1).max(100),
  descripcion: z.string().max(300).optional(),
  orden: z.number().int().optional(),
});

router.get('/categorias', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { convenioId } = req.query;
    const where: Record<string, unknown> = {};
    if (convenioId) {
      where.convenioId = convenioId;
    } else {
      where.convenio = { empresaId: req.user!.empresaId };
    }
    const categorias = await prisma.categoria.findMany({
      where: where as Parameters<typeof prisma.categoria.findMany>[0]['where'],
      include: { convenio: { select: { nombre: true } } },
      orderBy: { orden: 'asc' },
    });
    res.json(categorias);
  } catch (error) {
    console.error('Error listing categorias:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.post('/categorias', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createCategoriaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }
    // Verify convenio ownership
    const conv = await prisma.convenio.findFirst({
      where: { id: parsed.data.convenioId, empresaId: req.user!.empresaId },
    });
    if (!conv) { res.status(404).json({ error: 'Convenio no encontrado' }); return; }

    const cat = await prisma.categoria.create({ data: parsed.data });
    res.status(201).json(cat);
  } catch (error) {
    console.error('Error creating categoria:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.put('/categorias/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cat = await prisma.categoria.findFirst({
      where: { id: req.params.id },
      include: { convenio: { select: { empresaId: true } } },
    });
    if (!cat || cat.convenio.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Categoría no encontrada' });
      return;
    }
    const updated = await prisma.categoria.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(updated);
  } catch (error) {
    console.error('Error updating categoria:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── CONCEPTOS SALARIALES ────────────────────────

const createConceptoSchema = z.object({
  convenioId: z.string().uuid(),
  codigo: z.string().min(1).max(20),
  nombre: z.string().min(1).max(200),
  tipo: z.nativeEnum(ConceptoTipo),
  descripcion: z.string().max(500).optional(),
  esPorcentual: z.boolean().optional(),
  porcentajeBase: z.number().optional().nullable(),
  montoFijo: z.number().optional().nullable(),
  baseCalculo: z.string().max(50).optional().nullable(),
  aplicaSiempre: z.boolean().optional(),
  condicionFormula: z.string().max(500).optional().nullable(),
  esRemunerativo: z.boolean().optional(),
  visibleEmpleado: z.boolean().optional(),
  editableRrhh: z.boolean().optional(),
  orden: z.number().int().optional(),
});

router.get('/conceptos', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { convenioId } = req.query;
    const where: Record<string, unknown> = {};
    if (convenioId) {
      where.convenioId = convenioId;
    } else {
      where.convenio = { empresaId: req.user!.empresaId };
    }
    const conceptos = await prisma.conceptoSalarial.findMany({
      where: where as Parameters<typeof prisma.conceptoSalarial.findMany>[0]['where'],
      orderBy: { orden: 'asc' },
    });
    res.json(conceptos);
  } catch (error) {
    console.error('Error listing conceptos:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.post('/conceptos', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createConceptoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }
    const conv = await prisma.convenio.findFirst({
      where: { id: parsed.data.convenioId, empresaId: req.user!.empresaId },
    });
    if (!conv) { res.status(404).json({ error: 'Convenio no encontrado' }); return; }

    const concepto = await prisma.conceptoSalarial.create({ data: parsed.data });
    res.status(201).json(concepto);
  } catch (error) {
    console.error('Error creating concepto:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.put('/conceptos/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const concepto = await prisma.conceptoSalarial.findFirst({
      where: { id: req.params.id },
      include: { convenio: { select: { empresaId: true } } },
    });
    if (!concepto || concepto.convenio.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Concepto no encontrado' });
      return;
    }
    const updated = await prisma.conceptoSalarial.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(updated);
  } catch (error) {
    console.error('Error updating concepto:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PATCH /admin/conceptos/:id/valor ────────────

const createValorSchema = z.object({
  categoriaId: z.string().uuid().optional().nullable(),
  vigenteDesde: z.string().datetime(),
  vigenteHasta: z.string().datetime().optional().nullable(),
  monto: z.number().optional().nullable(),
  porcentaje: z.number().optional().nullable(),
});

router.patch('/conceptos/:id/valor', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createValorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const concepto = await prisma.conceptoSalarial.findFirst({
      where: { id: req.params.id },
      include: { convenio: { select: { empresaId: true } } },
    });
    if (!concepto || concepto.convenio.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Concepto no encontrado' }); return;
    }

    const valor = await prisma.conceptoValor.create({
      data: {
        conceptoId: req.params.id,
        categoriaId: parsed.data.categoriaId ?? null,
        vigenteDesde: new Date(parsed.data.vigenteDesde),
        vigenteHasta: parsed.data.vigenteHasta ? new Date(parsed.data.vigenteHasta) : null,
        monto: parsed.data.monto ?? null,
        porcentaje: parsed.data.porcentaje ?? null,
      },
    });
    res.status(201).json(valor);
  } catch (error) {
    console.error('Error creating valor:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.get('/conceptos/:id/historial', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const valores = await prisma.conceptoValor.findMany({
      where: { conceptoId: req.params.id },
      include: { categoria: { select: { codigo: true, nombre: true } } },
      orderBy: { vigenteDesde: 'desc' },
    });
    res.json(valores);
  } catch (error) {
    console.error('Error listing historial:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
