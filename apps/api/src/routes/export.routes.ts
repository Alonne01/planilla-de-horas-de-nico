import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH } from '../middleware/roles.middleware.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// ─── GET /export/planilla/:id ────────────────────
// Generates a CSV export of a single planilla (Excel-compatible)

router.get('/planilla/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planilla = await prisma.planilla.findUnique({
      where: { id: req.params.id as string },
      include: {
        usuario: { select: { nombre: true, apellido: true, legajo: true } },
        registros: { orderBy: { fecha: 'asc' } },
      },
    });

    if (!planilla) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }

    // Build CSV
    const BOM = '\uFEFF';
    const header = 'Fecha,Entrada T1,Salida T1,Entrada T2,Salida T2,Lugar,Horas Normales,Extra 50%,Extra 100%,Viaje,Total,Feriado,Franco Trab.,Motivo Ausencia,Observaciones';
    const rows = planilla.registros.map((r) => {
      const total = Number(r.horasNormales) + Number(r.horasExtra50) + Number(r.horasExtra100);
      const fmt = (d: Date | null) => d ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';
      return [
        new Date(r.fecha).toLocaleDateString('es-AR'),
        fmt(r.entradaTurno1),
        fmt(r.salidaTurno1),
        fmt(r.entradaTurno2),
        fmt(r.salidaTurno2),
        r.lugarTrabajo ?? (r.bloqueado ? 'AUSENCIA' : 'BASE'),
        Number(r.horasNormales).toFixed(1),
        Number(r.horasExtra50).toFixed(1),
        Number(r.horasExtra100).toFixed(1),
        Number(r.horasViajeCalc).toFixed(1),
        total.toFixed(1),
        r.esFeriado ? 'Sí' : '',
        r.esFrancoTrabajado ? 'Sí' : '',
        (r.motivoBloqueo ?? '').replace(/,/g, ';'),
        (r.observaciones ?? '').replace(/,/g, ';'),
      ].join(',');
    });

    // Totals row
    rows.push([
      'TOTALES', '', '', '', '', '',
      Number(planilla.totalHorasNormales).toFixed(1),
      Number(planilla.totalHorasExtra50).toFixed(1),
      Number(planilla.totalHorasExtra100).toFixed(1),
      Number(planilla.totalHorasViaje).toFixed(1),
      (Number(planilla.totalHorasNormales) + Number(planilla.totalHorasExtra50) + Number(planilla.totalHorasExtra100)).toFixed(1),
      '', '', '', '',
    ].join(','));

    const csv = BOM + [header, ...rows].join('\n');

    const inicio = new Date(planilla.periodoInicio);
    const fin = new Date(planilla.periodoFin);
    const mesInicio = inicio.toLocaleDateString('es-AR', { month: 'short' });
    const mesFin = fin.toLocaleDateString('es-AR', { month: 'short' });
    const anio = fin.getFullYear();
    const filename = `Planilla de horas ${planilla.usuario.apellido} ${planilla.usuario.nombre} (${mesInicio} - ${mesFin} - ${anio}).csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting planilla:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /export/sector/:sid ─────────────────────
// Generates a CSV with all planillas for a sector in a period

router.get('/sector/:sid', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sectorId = req.params.sid as string;

    const usuarios = await prisma.usuario.findMany({
      where: { sectorId, activo: true },
      select: { id: true, nombre: true, apellido: true, legajo: true },
    });

    const userIds = usuarios.map((u) => u.id);

    const planillas = await prisma.planilla.findMany({
      where: { usuarioId: { in: userIds }, estado: { in: ['APROBADA', 'CERRADA'] } },
      include: {
        usuario: { select: { nombre: true, apellido: true, legajo: true } },
      },
      orderBy: [{ periodoInicio: 'desc' }, { usuarioId: 'asc' }],
    });

    const BOM = '\uFEFF';
    const header = 'Empleado,Legajo,Período,Estado,Hs Normales,Hs Extra50,Hs Extra100,Hs Viaje,Días Campo,Días Base';
    const rows = planillas.map((p) => [
      `${p.usuario.apellido} ${p.usuario.nombre}`,
      p.usuario.legajo ?? '-',
      `${new Date(p.periodoInicio).toLocaleDateString('es-AR')} - ${new Date(p.periodoFin).toLocaleDateString('es-AR')}`,
      p.estado,
      Number(p.totalHorasNormales).toFixed(1),
      Number(p.totalHorasExtra50).toFixed(1),
      Number(p.totalHorasExtra100).toFixed(1),
      Number(p.totalHorasViaje).toFixed(1),
      p.totalDiasCampo.toString(),
      p.totalDiasBase.toString(),
    ].join(','));

    const csv = BOM + [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Reporte sector.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting sector:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
