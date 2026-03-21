import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH } from '../middleware/roles.middleware.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// ─── Helper: calculate vacation days by LCT seniority ─────────
function diasPorAntiguedad(fechaIngreso: Date, anio: number): number {
  // Seniority computed as of Dec 31 of the year
  const alDic31 = new Date(anio, 11, 31);
  let anios = alDic31.getFullYear() - fechaIngreso.getFullYear();
  // If they haven't reached their anniversary yet this year, subtract 1
  const aniv = new Date(anio, fechaIngreso.getMonth(), fechaIngreso.getDate());
  if (alDic31 < aniv) anios--;
  if (anios < 0) anios = 0;

  if (anios <= 5) return 14;
  if (anios <= 10) return 21;
  if (anios <= 20) return 28;
  return 35;
}

// ─── GET /vacacion-saldos (admin: all users for a year) ───────
router.get('/', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const anio = parseInt(req.query.anio as string) || new Date().getFullYear();
    const empresaId = req.user!.empresaId;

    const saldos = await prisma.vacacionSaldo.findMany({
      where: {
        anio,
        usuario: { empresaId, activo: true },
      },
      include: {
        usuario: {
          select: {
            id: true, nombre: true, apellido: true, legajo: true,
            fechaIngreso: true, rol: true, activo: true,
            sector: { select: { nombre: true } },
          },
        },
      },
      orderBy: { usuario: { apellido: 'asc' } },
    });

    res.json(saldos);
  } catch (error) {
    console.error('Error listing vacacion saldos:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /vacacion-saldos/generar (generate saldos for a year) ──
router.post('/generar', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { anio } = req.body;
    if (!anio || typeof anio !== 'number') {
      res.status(400).json({ error: 'Se requiere el año' });
      return;
    }
    const empresaId = req.user!.empresaId;

    // Get all active users
    const usuarios = await prisma.usuario.findMany({
      where: { empresaId, activo: true },
      select: { id: true, fechaIngreso: true },
    });

    let created = 0;
    let skipped = 0;

    for (const u of usuarios) {
      // Check if saldo already exists
      const existing = await prisma.vacacionSaldo.findUnique({
        where: { usuarioId_anio: { usuarioId: u.id, anio } },
      });

      if (existing) {
        skipped++;
        continue;
      }

      const dias = diasPorAntiguedad(u.fechaIngreso, anio);

      await prisma.vacacionSaldo.create({
        data: {
          usuarioId: u.id,
          anio,
          diasCorrespondientes: dias,
        },
      });
      created++;
    }

    res.json({ created, skipped, total: usuarios.length });
  } catch (error) {
    console.error('Error generating saldos:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── PUT /vacacion-saldos/:id (adjust a specific saldo) ───────
const updateSaldoSchema = z.object({
  diasCorrespondientes: z.number().int().min(0).optional(),
  diasAjuste: z.number().int().optional(),
  override: z.boolean().optional(),
  observaciones: z.string().max(500).optional().nullable(),
});

router.put('/:id', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = updateSaldoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const saldo = await prisma.vacacionSaldo.findUnique({
      where: { id: req.params.id as string },
      include: { usuario: { select: { empresaId: true } } },
    });

    if (!saldo || saldo.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Saldo no encontrado' });
      return;
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.diasCorrespondientes !== undefined) {
      data.diasCorrespondientes = parsed.data.diasCorrespondientes;
      data.override = true;
    }
    if (parsed.data.diasAjuste !== undefined) data.diasAjuste = parsed.data.diasAjuste;
    if (parsed.data.override !== undefined) data.override = parsed.data.override;
    if (parsed.data.observaciones !== undefined) data.observaciones = parsed.data.observaciones;

    const updated = await prisma.vacacionSaldo.update({
      where: { id: saldo.id },
      data,
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating saldo:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /vacacion-saldos/mi-saldo (current user's saldo for current year) ──
router.get('/mi-saldo', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const anio = new Date().getFullYear();

    let saldo = await prisma.vacacionSaldo.findUnique({
      where: { usuarioId_anio: { usuarioId: userId, anio } },
    });

    // Auto-create if doesn't exist
    if (!saldo) {
      const usuario = await prisma.usuario.findUnique({
        where: { id: userId },
        select: { fechaIngreso: true },
      });
      if (!usuario) {
        res.status(404).json({ error: 'Usuario no encontrado' });
        return;
      }
      const dias = diasPorAntiguedad(usuario.fechaIngreso, anio);
      saldo = await prisma.vacacionSaldo.create({
        data: { usuarioId: userId, anio, diasCorrespondientes: dias },
      });
    }

    const disponible = saldo.diasCorrespondientes + saldo.diasAjuste - saldo.diasUsados - saldo.diasPendientes;

    res.json({
      disponible: Math.max(0, disponible),
      usados: saldo.diasUsados,
      pendiente: saldo.diasPendientes,
      total: saldo.diasCorrespondientes + saldo.diasAjuste,
      diasCorrespondientes: saldo.diasCorrespondientes,
      diasAjuste: saldo.diasAjuste,
    });
  } catch (error) {
    console.error('Error getting mi saldo:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
