import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH } from '../middleware/roles.middleware.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);
router.use(requireLevel(LEVEL_RRHH));

// ─── POST /liquidacion/tango — Export for Tango ──

router.post('/tango', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { periodoInicio, periodoFin, sectorId, usuarioId } = req.body;
    if (!periodoInicio || !periodoFin) {
      res.status(400).json({ error: 'Período requerido' });
      return;
    }

    const empresaId = req.user!.empresaId;
    const where: any = {
      usuario: { empresaId },
      periodoInicio: { gte: new Date(periodoInicio) },
      periodoFin: { lte: new Date(periodoFin) },
      estado: { in: ['APROBADA', 'CERRADA'] },
    };
    if (sectorId) where.usuario.sectorId = sectorId;
    if (usuarioId) where.usuarioId = usuarioId;

    const planillas = await prisma.planilla.findMany({
      where,
      include: {
        usuario: {
          select: {
            legajo: true, nombre: true, apellido: true, cuil: true, dni: true,
            categoria: { select: { nombre: true } },
            sector: { select: { nombre: true } },
          },
        },
      },
      orderBy: { usuario: { apellido: 'asc' } },
    });

    // Build Tango-format lines (pipe-delimited)
    // Format: LEGAJO|CUIL|APELLIDO_NOMBRE|CONCEPTO|CANTIDAD|MONTO|SECTOR
    const lines: string[] = [];
    lines.push('LEGAJO|CUIL|EMPLEADO|CONCEPTO|CANTIDAD|MONTO|SECTOR');

    for (const p of planillas) {
      const u = p.usuario;
      const emp = `${u.apellido} ${u.nombre}`;
      const sector = u.sector?.nombre ?? '';

      // Horas normales
      const hn = Number(p.totalHorasNormales);
      if (hn > 0) lines.push(`${u.legajo}|${u.cuil ?? ''}|${emp}|HORAS_NORM|${hn.toFixed(2)}||${sector}`);

      // Extra 50%
      const he50 = Number(p.totalHorasExtra50);
      if (he50 > 0) lines.push(`${u.legajo}|${u.cuil ?? ''}|${emp}|HORAS_EXT50|${he50.toFixed(2)}||${sector}`);

      // Extra 100%
      const he100 = Number(p.totalHorasExtra100);
      if (he100 > 0) lines.push(`${u.legajo}|${u.cuil ?? ''}|${emp}|HORAS_EXT100|${he100.toFixed(2)}||${sector}`);

      // Viaje
      const hv = Number(p.totalHorasViaje);
      if (hv > 0) lines.push(`${u.legajo}|${u.cuil ?? ''}|${emp}|HORAS_VIAJE|${hv.toFixed(2)}||${sector}`);

      // Días campo
      if (p.totalDiasCampo > 0) lines.push(`${u.legajo}|${u.cuil ?? ''}|${emp}|DIAS_CAMPO|${p.totalDiasCampo}||${sector}`);

      // Días base
      if (p.totalDiasBase > 0) lines.push(`${u.legajo}|${u.cuil ?? ''}|${emp}|DIAS_BASE|${p.totalDiasBase}||${sector}`);
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="liquidacion_tango_${periodoInicio.slice(0,10)}.txt"`);
    res.send(lines.join('\r\n'));
  } catch (err) {
    console.error('Error exporting Tango:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /liquidacion/bejerman — Export for Bejerman ──

router.post('/bejerman', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { periodoInicio, periodoFin, sectorId, usuarioId } = req.body;
    if (!periodoInicio || !periodoFin) {
      res.status(400).json({ error: 'Período requerido' });
      return;
    }

    const empresaId = req.user!.empresaId;
    const where: any = {
      usuario: { empresaId },
      periodoInicio: { gte: new Date(periodoInicio) },
      periodoFin: { lte: new Date(periodoFin) },
      estado: { in: ['APROBADA', 'CERRADA'] },
    };
    if (sectorId) where.usuario.sectorId = sectorId;
    if (usuarioId) where.usuarioId = usuarioId;

    const planillas = await prisma.planilla.findMany({
      where,
      include: {
        usuario: {
          select: {
            legajo: true, nombre: true, apellido: true, cuil: true,
            sector: { select: { nombre: true } },
          },
        },
      },
      orderBy: { usuario: { apellido: 'asc' } },
    });

    // Bejerman format: semicolon-delimited CSV
    // CUIL;LEGAJO;CONCEPTO;CANTIDAD;IMPORTE
    const lines: string[] = [];
    lines.push('CUIL;LEGAJO;CONCEPTO;CANTIDAD;IMPORTE');

    for (const p of planillas) {
      const u = p.usuario;
      const cuil = u.cuil ?? '';
      const legajo = u.legajo ?? '';

      const hn = Number(p.totalHorasNormales);
      if (hn > 0) lines.push(`${cuil};${legajo};001;${hn.toFixed(2)};`);

      const he50 = Number(p.totalHorasExtra50);
      if (he50 > 0) lines.push(`${cuil};${legajo};002;${he50.toFixed(2)};`);

      const he100 = Number(p.totalHorasExtra100);
      if (he100 > 0) lines.push(`${cuil};${legajo};003;${he100.toFixed(2)};`);

      const hv = Number(p.totalHorasViaje);
      if (hv > 0) lines.push(`${cuil};${legajo};004;${hv.toFixed(2)};`);

      if (p.totalDiasCampo > 0) lines.push(`${cuil};${legajo};005;${p.totalDiasCampo};`);
      if (p.totalDiasBase > 0) lines.push(`${cuil};${legajo};006;${p.totalDiasBase};`);
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="liquidacion_bejerman_${periodoInicio.slice(0,10)}.csv"`);
    res.send(lines.join('\r\n'));
  } catch (err) {
    console.error('Error exporting Bejerman:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /liquidacion/general — Generic CSV for any payroll software ──

router.post('/general', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { periodoInicio, periodoFin, sectorId, usuarioId } = req.body;
    if (!periodoInicio || !periodoFin) {
      res.status(400).json({ error: 'Período requerido' });
      return;
    }

    const empresaId = req.user!.empresaId;
    const where: any = {
      usuario: { empresaId },
      periodoInicio: { gte: new Date(periodoInicio) },
      periodoFin: { lte: new Date(periodoFin) },
      estado: { in: ['APROBADA', 'CERRADA'] },
    };
    if (sectorId) where.usuario.sectorId = sectorId;
    if (usuarioId) where.usuarioId = usuarioId;

    const planillas = await prisma.planilla.findMany({
      where,
      include: {
        usuario: {
          select: {
            legajo: true, nombre: true, apellido: true, cuil: true, dni: true,
            fechaIngreso: true,
            categoria: { select: { nombre: true } },
            sector: { select: { nombre: true } },
            convenio: { select: { nombre: true } },
          },
        },
        reciboSueldo: { select: { id: true, firmadoEmpleadoAt: true } },
      },
      orderBy: { usuario: { apellido: 'asc' } },
    });

    const header = [
      'Legajo', 'CUIL', 'DNI', 'Apellido', 'Nombre', 'Sector', 'Categoría', 'Convenio',
      'Fecha Ingreso', 'Período Inicio', 'Período Fin', 'Estado',
      'Hs Normales', 'Hs Extra 50%', 'Hs Extra 100%', 'Hs Viaje',
      'Días Campo', 'Días Base', 'Neto Estimado', 'Recibo Firmado',
    ].join(',');

    const rows = planillas.map((p) => {
      const u = p.usuario;
      return [
        u.legajo ?? '', u.cuil ?? '', u.dni ?? '',
        `"${u.apellido}"`, `"${u.nombre}"`,
        `"${u.sector?.nombre ?? ''}"`, `"${u.categoria?.nombre ?? ''}"`, `"${u.convenio?.nombre ?? ''}"`,
        u.fechaIngreso ? new Date(u.fechaIngreso).toLocaleDateString('es-AR') : '',
        new Date(p.periodoInicio).toLocaleDateString('es-AR'),
        new Date(p.periodoFin).toLocaleDateString('es-AR'),
        p.estado,
        Number(p.totalHorasNormales).toFixed(2),
        Number(p.totalHorasExtra50).toFixed(2),
        Number(p.totalHorasExtra100).toFixed(2),
        Number(p.totalHorasViaje).toFixed(2),
        p.totalDiasCampo, p.totalDiasBase,
        p.netoEstimado ? Number(p.netoEstimado).toFixed(2) : '',
        p.reciboSueldo?.firmadoEmpleadoAt ? 'Sí' : 'No',
      ].join(',');
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="liquidacion_general_${periodoInicio.slice(0,10)}.csv"`);
    res.send([header, ...rows].join('\r\n'));
  } catch (err) {
    console.error('Error exporting general:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
