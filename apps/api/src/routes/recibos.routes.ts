import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH } from '../middleware/roles.middleware.js';
import { crearNotificacion } from '../utils/notificacion.utils.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// ─── Salary Calculation Helper ───────────────────
// Shared between preview and generar endpoints

interface ReciboCalculo {
  usuario: { nombre: string; apellido: string; legajo: string | null; categoria: string | undefined; convenio: string | undefined };
  periodo: { inicio: Date; fin: Date };
  horas: { normales: number; extra50: number; extra100: number; viaje: number; diasCampo: number; diasBase: number };
  conceptos: { codigo: string; nombre: string; tipo: string; monto: number; esRemunerativo: boolean }[];
  retenciones: { codigo: string; nombre: string; monto: number }[];
  totales: { remunerativo: number; noRemunerativo: number; bruto: number; retenciones: number; neto: number };
}

async function calcularRecibo(planillaId: string): Promise<ReciboCalculo | null> {
  const planilla = await prisma.planilla.findUnique({
    where: { id: planillaId },
    include: {
      usuario: {
        include: {
          categoria: true,
          convenio: { include: { conceptos: { where: { activo: true }, include: { valores: { orderBy: { vigenteDesde: 'desc' } } }, orderBy: { orden: 'asc' } } } },
        },
      },
      registros: true,
    },
  });

  if (!planilla) return null;

  const u = planilla.usuario;
  const cat = u.categoria;
  const cctConceptos = u.convenio?.conceptos ?? [];
  // Use period end date for value lookup so historical recibos get correct amounts
  const effectiveDate = new Date(planilla.periodoFin);

  const findActiveValor = (valores: typeof cctConceptos[0]['valores']) => {
    const catVal = valores.find((v) => v.categoriaId === u.categoriaId && new Date(v.vigenteDesde) <= effectiveDate);
    const genVal = valores.find((v) => !v.categoriaId && new Date(v.vigenteDesde) <= effectiveDate);
    return catVal ?? genVal;
  };

  let sueldoBasico = 0;
  let basicoNombre = 'Sueldo Básico';

  if (u.sueldoBasicoOverride !== null && u.sueldoBasicoOverride !== undefined) {
    sueldoBasico = Number(u.sueldoBasicoOverride);
  }
  if (!sueldoBasico) {
    const conceptoBasico = cctConceptos.find((c) => c.codigo.startsWith('BASICO_'));
    if (conceptoBasico) {
      const activeVal = findActiveValor(conceptoBasico.valores);
      sueldoBasico = activeVal?.monto ? Number(activeVal.monto) : (conceptoBasico.montoFijo ? Number(conceptoBasico.montoFijo) : 0);
      basicoNombre = conceptoBasico.nombre;
    }
  }

  const horasNormales = Number(planilla.totalHorasNormales);
  const horasExtra50 = Number(planilla.totalHorasExtra50);
  const horasExtra100 = Number(planilla.totalHorasExtra100);
  const horasViaje = Number(planilla.totalHorasViaje);
  const diasCampo = planilla.totalDiasCampo;
  const diasBase = planilla.totalDiasBase;

  const horasJornadaMensual = 176;
  const valorHora = sueldoBasico / horasJornadaMensual;

  const conceptos: ReciboCalculo['conceptos'] = [];
  conceptos.push({ codigo: 'BASICO', nombre: basicoNombre, tipo: 'REMUNERATIVO', monto: sueldoBasico, esRemunerativo: true });

  const fechaIngreso = new Date(u.fechaIngreso);
  const anosAntig = Math.floor((Date.now() - fechaIngreso.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  if (anosAntig > 0) {
    conceptos.push({ codigo: 'ANTIG', nombre: `Antigüedad ${anosAntig} año${anosAntig > 1 ? 's' : ''}`, tipo: 'REMUNERATIVO', monto: sueldoBasico * anosAntig * 0.01, esRemunerativo: true });
  }

  if (horasExtra50 > 0) conceptos.push({ codigo: 'HE50', nombre: 'Horas Extra 50%', tipo: 'REMUNERATIVO', monto: valorHora * 1.5 * horasExtra50, esRemunerativo: true });
  if (horasExtra100 > 0) conceptos.push({ codigo: 'HE100', nombre: 'Horas Extra 100%', tipo: 'REMUNERATIVO', monto: valorHora * 2 * horasExtra100, esRemunerativo: true });
  if (horasViaje > 0) conceptos.push({ codigo: 'VIAJE', nombre: 'Horas de Viaje', tipo: 'REMUNERATIVO', monto: valorHora * horasViaje, esRemunerativo: true });

  const SKIP_CODIGOS = ['BASICO', 'HE50', 'HE100', 'VIAJE', 'ANTIG'];
  for (const cc of cctConceptos) {
    if (SKIP_CODIGOS.includes(cc.codigo) || cc.codigo.startsWith('BASICO_')) continue;
    const activeVal = findActiveValor(cc.valores);
    let monto = 0;
    if (cc.esPorcentual) {
      const pct = activeVal?.porcentaje ? Number(activeVal.porcentaje) : (cc.porcentajeBase ? Number(cc.porcentajeBase) : 0);
      monto = sueldoBasico * pct / 100;
    } else {
      monto = activeVal?.monto ? Number(activeVal.monto) : (cc.montoFijo ? Number(cc.montoFijo) : 0);
    }
    if (monto > 0 || cc.aplicaSiempre) {
      conceptos.push({ codigo: cc.codigo, nombre: cc.nombre, tipo: cc.tipo, monto, esRemunerativo: cc.esRemunerativo });
    }
  }

  const totalRemunerativo = conceptos.filter((c) => c.esRemunerativo).reduce((s, c) => s + c.monto, 0);
  const totalNoRemunerativo = conceptos.filter((c) => !c.esRemunerativo).reduce((s, c) => s + c.monto, 0);
  const ret = [
    { codigo: 'JUB', nombre: 'Jubilación (11%)', monto: totalRemunerativo * 0.11 },
    { codigo: 'OS', nombre: 'Obra Social (3%)', monto: totalRemunerativo * 0.03 },
    { codigo: 'LEY19032', nombre: 'Ley 19.032 (3%)', monto: totalRemunerativo * 0.03 },
  ];
  const totalRetenciones = ret.reduce((s, r) => s + r.monto, 0);
  const neto = totalRemunerativo + totalNoRemunerativo - totalRetenciones;

  return {
    usuario: { nombre: u.nombre, apellido: u.apellido, legajo: u.legajo, categoria: cat?.nombre, convenio: u.convenio?.nombre },
    periodo: { inicio: planilla.periodoInicio, fin: planilla.periodoFin },
    horas: { normales: horasNormales, extra50: horasExtra50, extra100: horasExtra100, viaje: horasViaje, diasCampo, diasBase },
    conceptos,
    retenciones: ret,
    totales: {
      remunerativo: Math.round(totalRemunerativo * 100) / 100,
      noRemunerativo: Math.round(totalNoRemunerativo * 100) / 100,
      bruto: Math.round((totalRemunerativo + totalNoRemunerativo) * 100) / 100,
      retenciones: Math.round(totalRetenciones * 100) / 100,
      neto: Math.round(neto * 100) / 100,
    },
  };
}

// ─── GET /recibos/mis-recibos ────────────────────
// Employee sees their own recibos (no RRHH level needed)

router.get('/mis-recibos', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const recibos = await prisma.reciboSueldo.findMany({
      where: { usuarioId: req.user!.userId },
      include: {
        planilla: { select: { periodoInicio: true, periodoFin: true, estado: true, snapshotCalculo: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(recibos);
  } catch (error) {
    console.error('Error listing mis recibos:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /recibos/detalle/:id ────────────────────
// Employee can see their own recibo detail, RRHH can see any

router.get('/detalle/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const recibo = await prisma.reciboSueldo.findUnique({
      where: { id: req.params.id as string },
      include: {
        usuario: { select: { id: true, nombre: true, apellido: true, legajo: true, empresaId: true } },
        planilla: { select: { id: true, periodoInicio: true, periodoFin: true, estado: true, snapshotCalculo: true } },
      },
    });
    if (!recibo) { res.status(404).json({ error: 'Recibo no encontrado' }); return; }
    // Verify same empresa
    if (recibo.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Recibo no encontrado' }); return;
    }
    // Allow own recibo or RRHH+
    if (recibo.usuarioId !== req.user!.userId && (req.user!.rolNivel ?? 0) < 90) {
      res.status(403).json({ error: 'Sin permisos' }); return;
    }

    // Back-fill snapshotCalculo if missing (recibos created before snapshot was implemented)
    if (!recibo.planilla.snapshotCalculo) {
      const calculo = await calcularRecibo(recibo.planilla.id);
      if (calculo) {
        await prisma.planilla.update({
          where: { id: recibo.planilla.id },
          data: { snapshotCalculo: calculo as unknown as Record<string, unknown>, netoEstimado: calculo.totales.neto },
        });
        recibo.planilla.snapshotCalculo = calculo as unknown as typeof recibo.planilla.snapshotCalculo;
      }
    }

    res.json(recibo);
  } catch (error) {
    console.error('Error fetching recibo:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /recibos/:id/firmar ────────────────────
// Employee signs their own recibo

router.post('/:id/firmar', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const recibo = await prisma.reciboSueldo.findUnique({ where: { id: req.params.id as string } });
    if (!recibo || recibo.usuarioId !== req.user!.userId) {
      res.status(404).json({ error: 'Recibo no encontrado' }); return;
    }
    if (recibo.firmadoEmpleadoAt) {
      res.status(400).json({ error: 'El recibo ya fue firmado' }); return;
    }
    const { firmaImg, conforme, observacion } = req.body || {};
    if (typeof conforme !== 'boolean') {
      res.status(400).json({ error: 'Debe indicar si está conforme o no' }); return;
    }
    if (!conforme && (typeof observacion !== 'string' || !observacion.trim())) {
      res.status(400).json({ error: 'Debe indicar el motivo de la disconformidad' }); return;
    }
    const updated = await prisma.reciboSueldo.update({
      where: { id: recibo.id },
      data: {
        firmadoEmpleadoAt: new Date(),
        conforme,
        observacionFirma: !conforme ? (observacion as string).trim() : null,
        ipFirma: req.ip || req.headers['x-forwarded-for'] as string || null,
        userAgentFirma: req.headers['user-agent'] || null,
        hashContenido: firmaImg || null,
      },
    });
    res.json(updated);
  } catch (error) {
    console.error('Error signing recibo:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── RRHH-only routes below ──────────────────────

// ─── GET /recibos ────────────────────────────────
// List recibos for all or a specific user

router.get('/', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const empresaId = req.user!.empresaId;
    const usuarioId = req.query.usuarioId as string | undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { usuario: { empresaId } };
    if (usuarioId) where.usuarioId = usuarioId;

    const recibos = await prisma.reciboSueldo.findMany({
      where,
      include: {
        usuario: { select: { nombre: true, apellido: true, legajo: true } },
        planilla: { select: { periodoInicio: true, periodoFin: true, estado: true, snapshotCalculo: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(recibos);
  } catch (error) {
    console.error('Error listing recibos:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /recibos/preview/:planillaId ────────────
// Preview salary calculation for a planilla (without saving)

router.get('/preview/:planillaId', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const calculo = await calcularRecibo(req.params.planillaId as string);
    if (!calculo) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }
    res.json(calculo);
  } catch (error) {
    console.error('Error previewing recibo:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /recibos/generar/:planillaId ───────────
// Generate and save a recibo for a closed/approved planilla

router.post('/generar/:planillaId', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.planillaId as string;

    const planilla = await prisma.planilla.findUnique({
      where: { id: planillaId },
      include: { usuario: { select: { id: true, empresaId: true } } },
    });

    if (!planilla) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }
    if (planilla.usuario.empresaId !== req.user!.empresaId) {
      res.status(403).json({ error: 'Sin permisos' });
      return;
    }
    if (!['APROBADA', 'CERRADA'].includes(planilla.estado)) {
      res.status(400).json({ error: 'La planilla debe estar aprobada o cerrada' });
      return;
    }

    // Check if recibo already exists
    const existing = await prisma.reciboSueldo.findUnique({ where: { planillaId } });
    if (existing) {
      res.status(400).json({ error: 'Ya existe un recibo para esta planilla', reciboId: existing.id });
      return;
    }

    // Calculate salary breakdown, persist snapshot + create recibo atomically
    const calculo = await calcularRecibo(planillaId);

    const recibo = await prisma.$transaction(async (tx) => {
      if (calculo) {
        await tx.planilla.update({
          where: { id: planillaId },
          data: { snapshotCalculo: calculo as unknown as Record<string, unknown>, netoEstimado: calculo.totales.neto },
        });
      }
      return tx.reciboSueldo.create({
        data: { planillaId, usuarioId: planilla.usuario.id },
      });
    });

    // Notify the employee about the new recibo
    const d1 = new Date(planilla.periodoInicio);
    const d2 = new Date(planilla.periodoFin);
    const fmtPeriodo = `${d1.getDate()}/${d1.getMonth() + 1} — ${d2.getDate()}/${d2.getMonth() + 1}/${d2.getFullYear()}`;
    await crearNotificacion({
      usuarioId: planilla.usuario.id,
      tipo: 'RECIBO',
      titulo: '📄 Nuevo recibo de sueldo',
      cuerpo: `Tu recibo de sueldo del período ${fmtPeriodo} está disponible para revisión y firma.`,
      link: '/recibos',
    });

    res.status(201).json(recibo);
  } catch (error) {
    console.error('Error generating recibo:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
