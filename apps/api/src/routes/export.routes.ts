import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
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

// ─── GET /export/pendientes — Excel of users without approved planilla, grouped by sector ─────
router.get('/pendientes', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const empresaId = req.user!.empresaId;

    const usuarios = await prisma.usuario.findMany({
      where: { empresaId, activo: true },
      select: {
        id: true, nombre: true, apellido: true, legajo: true, rol: true,
        sector: { select: { nombre: true } },
      },
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
    });

    const planillas = await prisma.planilla.findMany({
      where: {
        usuarioId: { in: usuarios.map(u => u.id) },
        estado: { in: ['APROBADA', 'CERRADA'] },
      },
      select: { usuarioId: true, estado: true },
    });

    // Also get non-approved planillas for status info
    const allPlanillas = await prisma.planilla.findMany({
      where: { usuarioId: { in: usuarios.map(u => u.id) } },
      select: { usuarioId: true, estado: true },
      orderBy: { updatedAt: 'desc' },
    });

    const approvedIds = new Set(planillas.map(p => p.usuarioId));
    const pendientes = usuarios.filter(u => !approvedIds.has(u.id));

    if (pendientes.length === 0) {
      res.status(400).json({ error: 'No hay usuarios pendientes' });
      return;
    }

    // Group by sector
    const bySector = new Map<string, typeof pendientes>();
    for (const u of pendientes) {
      const sectorName = u.sector?.nombre ?? 'Sin Sector';
      if (!bySector.has(sectorName)) bySector.set(sectorName, []);
      bySector.get(sectorName)!.push(u);
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Planilla de Horas';
    workbook.created = new Date();

    const headerStyle: Partial<ExcelJS.Style> = {
      font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0392B' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      },
    };

    // One sheet per sector
    for (const [sectorName, users] of bySector) {
      const sheetName = sectorName.substring(0, 31);
      const sheet = workbook.addWorksheet(sheetName);

      const headers = ['Empleado', 'Legajo', 'Rol', 'Estado Planilla'];
      const headerRow = sheet.addRow(headers);
      headerRow.eachCell(cell => { Object.assign(cell, { style: headerStyle }); });
      sheet.columns = [{ width: 30 }, { width: 15 }, { width: 18 }, { width: 20 }];

      for (const u of users) {
        const userPlanilla = allPlanillas.find(p => p.usuarioId === u.id);
        const estado = userPlanilla?.estado ?? 'SIN PLANILLA';

        const row = sheet.addRow([
          `${u.apellido}, ${u.nombre}`,
          u.legajo ?? '—',
          u.rol,
          estado,
        ]);
        row.eachCell(cell => {
          cell.border = {
            top: { style: 'thin' }, bottom: { style: 'thin' },
            left: { style: 'thin' }, right: { style: 'thin' },
          };
        });
      }

      // Count row
      const countRow = sheet.addRow([`Total: ${users.length} pendiente(s)`, '', '', '']);
      countRow.getCell(1).font = { bold: true, italic: true };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const now = new Date();
    const monthStr = now.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    const filename = `Pendientes de aprobacion - ${monthStr}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(Buffer.from(buffer as ArrayBuffer));
  } catch (error) {
    console.error('Error exporting pendientes:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── Vianda calculation helper ─────
// Uses configurable thresholds from EmpresaConfig.
// Francos/ausencias without hours = 0.
function calcViandas(
  registro: { bloqueado: boolean; horasNormales: any; horasExtra50: any; horasExtra100: any; esFrancoTrabajado: boolean },
  config: { viandaUmbral1: number; viandaUmbral2: number; viandaCantidad1: number; viandaCantidad2: number }
): number {
  if (registro.bloqueado && !registro.esFrancoTrabajado) return 0;
  const totalHs = Number(registro.horasNormales) + Number(registro.horasExtra50) + Number(registro.horasExtra100);
  if (totalHs >= config.viandaUmbral2) return config.viandaCantidad2;
  if (totalHs >= config.viandaUmbral1) return config.viandaCantidad1;
  return 0;
}

// ─── POST /export/cierre — Excel export for period closing ─────
router.post('/cierre', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const empresaId = req.user!.empresaId;
    const { sectorIds, exportarTodos, forzar } = req.body;

    // Load vianda config
    const empresaConfig = await prisma.empresaConfig.findUnique({ where: { empresaId } });
    const viandaConfig = {
      viandaUmbral1: empresaConfig?.viandaUmbral1 ?? 6,
      viandaUmbral2: empresaConfig?.viandaUmbral2 ?? 10,
      viandaCantidad1: empresaConfig?.viandaCantidad1 ?? 1,
      viandaCantidad2: empresaConfig?.viandaCantidad2 ?? 2,
    };

    // Determine which users to include
    let userFilter: any = { empresaId, activo: true };
    if (!exportarTodos && sectorIds?.length) {
      userFilter.sectorId = { in: sectorIds };
    }

    const usuarios = await prisma.usuario.findMany({
      where: userFilter,
      select: {
        id: true, nombre: true, apellido: true, legajo: true, rol: true,
        sector: { select: { id: true, nombre: true } },
        categoria: { select: { nombre: true } },
        convenio: { select: { nombre: true } },
      },
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
    });

    const userIds = usuarios.map(u => u.id);

    // Find planillas for current period (APROBADA or CERRADA)
    const planillas = await prisma.planilla.findMany({
      where: {
        usuarioId: { in: userIds },
        estado: { in: ['APROBADA', 'CERRADA'] },
      },
      include: {
        usuario: {
          select: {
            id: true, nombre: true, apellido: true, legajo: true, rol: true,
            sector: { select: { id: true, nombre: true } },
          },
        },
        registros: { orderBy: { fecha: 'asc' } },
      },
      orderBy: { usuario: { apellido: 'asc' } },
    });

    // Check for users without approved planillas
    const usersWithPlanilla = new Set(planillas.map(p => p.usuarioId));
    const usersSinPlanilla = usuarios.filter(u => !usersWithPlanilla.has(u.id));

    if (usersSinPlanilla.length > 0 && !forzar) {
      res.status(409).json({
        error: 'Hay usuarios sin planilla aprobada',
        pendientes: usersSinPlanilla.map(u => ({
          id: u.id,
          nombre: u.nombre,
          apellido: u.apellido,
          legajo: u.legajo,
          sector: u.sector?.nombre ?? '—',
          rol: u.rol,
        })),
        totalAprobadas: planillas.length,
        totalPendientes: usersSinPlanilla.length,
      });
      return;
    }

    if (planillas.length === 0) {
      res.status(400).json({ error: 'No hay planillas para exportar' });
      return;
    }

    // Group planillas by sector
    const bySector = new Map<string, typeof planillas>();
    for (const p of planillas) {
      const sectorName = p.usuario.sector?.nombre ?? 'Sin Sector';
      if (!bySector.has(sectorName)) bySector.set(sectorName, []);
      bySector.get(sectorName)!.push(p);
    }

    // Build Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Planilla de Horas';
    workbook.created = new Date();

    // ─── RESUMEN sheet ───
    const resumenSheet = workbook.addWorksheet('Resumen');

    const headerStyle: Partial<ExcelJS.Style> = {
      font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D5F8A' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      },
    };

    const resumenHeaders = [
      'Empleado', 'Legajo', 'Sector', 'Estado',
      'Hs Normales', 'Hs Extra 50%', 'Hs Extra 100%',
      'Hs Viaje (maneja)', 'Hs Viaje (no maneja)',
      'Días Campo', 'Días Base',
      'Feriados Trab.', 'Francos Trab.', 'Días Ausencia',
      'Viandas',
    ];

    const headerRow = resumenSheet.addRow(resumenHeaders);
    headerRow.eachCell(cell => { Object.assign(cell, { style: headerStyle }); });
    resumenSheet.columns = resumenHeaders.map((h, i) => ({
      width: i === 0 ? 30 : i === 2 ? 20 : 15,
    }));

    for (const p of planillas) {
      const regs = p.registros;
      const hsViajeManeja = regs.filter(r => r.maneja).reduce((s, r) => s + Number(r.horasViajeCalc), 0);
      const hsViajeNoManeja = regs.filter(r => !r.maneja && Number(r.horasViajeCalc) > 0).reduce((s, r) => s + Number(r.horasViajeCalc), 0);
      const feriadosTrab = regs.filter(r => r.esFeriado && Number(r.horasTrabajadas ?? 0) > 0).length;
      const francosTrab = regs.filter(r => r.esFrancoTrabajado).length;
      const diasAusencia = regs.filter(r => r.bloqueado).length;
      const totalViandas = regs.reduce((s, r) => s + calcViandas(r, viandaConfig), 0);

      const row = resumenSheet.addRow([
        `${p.usuario.apellido}, ${p.usuario.nombre}`,
        p.usuario.legajo ?? '—',
        p.usuario.sector?.nombre ?? '—',
        p.estado,
        Number(p.totalHorasNormales).toFixed(2),
        Number(p.totalHorasExtra50).toFixed(2),
        Number(p.totalHorasExtra100).toFixed(2),
        hsViajeManeja.toFixed(2),
        hsViajeNoManeja.toFixed(2),
        p.totalDiasCampo,
        p.totalDiasBase,
        feriadosTrab,
        francosTrab,
        diasAusencia,
        totalViandas,
      ]);
      row.eachCell(cell => {
        cell.border = {
          top: { style: 'thin' }, bottom: { style: 'thin' },
          left: { style: 'thin' }, right: { style: 'thin' },
        };
      });
    }

    // ─── Per-employee sheets ───
    for (const p of planillas) {
      const sheetName = `${p.usuario.apellido}, ${p.usuario.nombre}`.substring(0, 31);
      const sheet = workbook.addWorksheet(sheetName);

      const dayHeaders = [
        'Fecha', 'Lugar', 'Entrada', 'Salida',
        'Hs Normales', 'Hs Extra 50%', 'Hs Extra 100%',
        'Hs Viaje', 'Maneja', 'Feriado', 'Franco Comp.', 'Franco Trab.',
        'Pernocte', 'Viandas', 'Observaciones',
      ];

      const dayHeaderRow = sheet.addRow(dayHeaders);
      dayHeaderRow.eachCell(cell => { Object.assign(cell, { style: headerStyle }); });
      sheet.columns = dayHeaders.map((_h, i) => ({
        width: i === 0 ? 12 : i === 14 ? 30 : i === 1 ? 10 : 12,
      }));

      for (const r of p.registros) {
        const fmtTime = (d: Date | null) => d ? new Date(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
        const fmtDate = (d: Date) => new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });

        const lugar = r.bloqueado ? (r.motivoBloqueo ?? 'AUSENCIA') : (r.lugarTrabajo ?? '');

        const viandas = calcViandas(r, viandaConfig);

        const row = sheet.addRow([
          fmtDate(r.fecha),
          lugar,
          fmtTime(r.entradaTurno1),
          fmtTime(r.salidaTurno1),
          Number(r.horasNormales).toFixed(2),
          Number(r.horasExtra50).toFixed(2),
          Number(r.horasExtra100).toFixed(2),
          Number(r.horasViajeCalc).toFixed(2),
          r.maneja ? 'Sí' : '',
          r.esFeriado ? 'Sí' : '',
          r.esFrancoCompensatorio ? 'Sí' : '',
          r.esFrancoTrabajado ? 'Sí' : '',
          r.pernocte !== 'NO' ? r.pernocte : '',
          viandas > 0 ? viandas : '',
          r.bloqueado ? (r.motivoBloqueo ?? '') : (r.observaciones ?? ''),
        ]);

        row.eachCell(cell => {
          cell.border = {
            top: { style: 'thin' }, bottom: { style: 'thin' },
            left: { style: 'thin' }, right: { style: 'thin' },
          };
          if (r.bloqueado) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF0E0' } };
          } else if (r.esFeriado) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
          } else if (r.esFrancoTrabajado) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE7F6' } };
          }
        });
      }

      // Totals row
      const totalViandas = p.registros.reduce((s, r) => s + calcViandas(r, viandaConfig), 0);
      const totalsRow = sheet.addRow([
        'TOTALES', '', '', '',
        Number(p.totalHorasNormales).toFixed(2),
        Number(p.totalHorasExtra50).toFixed(2),
        Number(p.totalHorasExtra100).toFixed(2),
        Number(p.totalHorasViaje).toFixed(2),
        '', '', '', '', '',
        totalViandas,
        `Campo: ${p.totalDiasCampo}d | Base: ${p.totalDiasBase}d`,
      ]);
      totalsRow.eachCell(cell => {
        cell.font = { bold: true };
        cell.border = {
          top: { style: 'medium' }, bottom: { style: 'medium' },
          left: { style: 'thin' }, right: { style: 'thin' },
        };
      });
    }

    // Generate buffer and send
    const buffer = await workbook.xlsx.writeBuffer();

    const now = new Date();
    const monthStr = now.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    let filename: string;
    if (exportarTodos || !sectorIds?.length) {
      filename = `Cierre planillas - Todos - ${monthStr}.xlsx`;
    } else if (sectorIds.length === 1) {
      const sectorName = bySector.keys().next().value ?? 'sector';
      filename = `Cierre planillas - ${sectorName} - ${monthStr}.xlsx`;
    } else {
      filename = `Cierre planillas - ${sectorIds.length} sectores - ${monthStr}.xlsx`;
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(Buffer.from(buffer as ArrayBuffer));
  } catch (error) {
    console.error('Error exporting cierre:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
