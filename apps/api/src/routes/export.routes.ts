import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH } from '../middleware/roles.middleware.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// ─── GET /export/planilla/:id ────────────────────
// Generates an XLSX export of a single planilla matching the company template format

router.get('/planilla/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planilla = await prisma.planilla.findUnique({
      where: { id: req.params.id as string },
      include: {
        usuario: {
          select: {
            id: true, empresaId: true,
            nombre: true, apellido: true, legajo: true,
            sector: { select: { nombre: true } },
            categoria: { select: { nombre: true, codigo: true } },
            diagramas: {
              where: { activo: true },
              take: 1,
              select: { 
                diagrama: { select: { nombre: true, tipo: true, diasTrabajo: true, diasDescanso: true, diasSemana: true } },
                fechaInicio: true,
              },
            },
          },
        },
        registros: { orderBy: { fecha: 'asc' } },
      },
    });

    if (!planilla) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }

    // Authorization: own planilla or RRHH+
    if (planilla.usuario.empresaId !== req.user!.empresaId) {
      res.status(403).json({ error: 'Sin permisos' }); return;
    }
    const nivel = req.user!.rolNivel ?? 0;
    const isOwn = planilla.usuario.id === req.user!.userId;
    if (!isOwn && nivel < 90) {
      res.status(403).json({ error: 'Sin permisos para exportar esta planilla' }); return;
    }

    const u = planilla.usuario;
    const diagramaAsignacion = u.diagramas[0] ?? null;
    const diagramaNombre = diagramaAsignacion?.diagrama?.nombre ?? null;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Planilla de Horas';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Planilla de Horas');

    // Column widths matching template
    sheet.columns = [
      { width: 4 },   // A: row num
      { width: 14 },  // B: Dia (fecha)
      { width: 10 },  // C: Entró
      { width: 10 },  // D: Salió
      { width: 13 },  // E: Hs Trabajadas
      { width: 11 },  // F: Hs de Viaje
      { width: 16 },  // G: Lugar de Trabajo
      { width: 6 },   // H: Pernocte (Hotel)
      { width: 6 },   // I: Pernocte (Trailer)
      { width: 4 },   // J: (spacer for pernocte group)
      { width: 9 },   // K: Maneja
      { width: 30 },  // L: Observaciones
    ];

    const thinBorder: Partial<ExcelJS.Borders> = {
      top: { style: 'thin' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' },
    };

    // ─── Row 2-3: Type indicators ───
    sheet.getCell('Q2').value = 'Base';
    sheet.getCell('Q3').value = 'Campo';

    // ─── Row 5: Employee info ───
    sheet.getCell('B5').value = 'Empleado:';
    sheet.getCell('B5').font = { bold: true, size: 11 };
    sheet.mergeCells('C5:D5');
    sheet.getCell('C5').value = `${u.apellido.toUpperCase()} ${u.nombre.toUpperCase()}`;
    sheet.getCell('C5').font = { bold: true, size: 12 };

    sheet.getCell('F5').value = 'Legajo:';
    sheet.getCell('F5').font = { bold: true, size: 10 };
    sheet.getCell('G5').value = u.legajo ?? '—';
    sheet.getCell('G5').font = { size: 10 };

    sheet.getCell('I5').value = 'Sector:';
    sheet.getCell('I5').font = { bold: true, size: 10 };
    sheet.mergeCells('J5:L5');
    sheet.getCell('J5').value = u.sector?.nombre ?? '—';
    sheet.getCell('J5').font = { size: 10 };

    // ─── Row 7: Period + Diagram ───
    const inicio = new Date(planilla.periodoInicio);
    const fin = new Date(planilla.periodoFin);
    const meses = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
    const mesInicio = meses[inicio.getMonth()];
    const mesFin = meses[fin.getMonth()];

    sheet.getCell('B7').value = 'Mes:';
    sheet.getCell('B7').font = { bold: true, size: 10 };
    sheet.getCell('C7').value = mesInicio === mesFin ? mesInicio : `${mesInicio} - ${mesFin}`;
    sheet.getCell('C7').font = { size: 10 };

    sheet.getCell('G7').value = `Diagrama: ${diagramaNombre ?? '—'}`;
    sheet.getCell('G7').font = { bold: true, size: 10 };

    sheet.getCell('J7').value = 'Categoría:';
    sheet.getCell('J7').font = { bold: true, size: 10 };
    sheet.getCell('K7').value = u.categoria?.codigo ?? '—';
    sheet.getCell('K7').font = { size: 10 };

    // ─── Rows 9-11: Column headers (merged vertically) ───
    const headerFill: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D5F8A' } };
    const headerFont: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
    const headerAlign: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true };

    const headers: { col: string; endCol?: string; label: string; mergeRows?: boolean }[] = [
      { col: 'B', label: 'Día', mergeRows: true },
      { col: 'C', label: 'Entró', mergeRows: true },
      { col: 'D', label: 'Salió', mergeRows: true },
      { col: 'E', label: 'Hs Trabajadas', mergeRows: true },
      { col: 'F', label: 'Hs de Viaje', mergeRows: true },
      { col: 'G', label: 'Lugar de Trabajo', mergeRows: true },
      { col: 'H', label: 'Pernocte', endCol: 'J' },
      { col: 'K', label: 'Maneja', mergeRows: true },
      { col: 'L', label: 'Observaciones', mergeRows: true },
    ];

    for (const h of headers) {
      if (h.mergeRows) {
        sheet.mergeCells(`${h.col}9:${h.col}11`);
      } else if (h.endCol) {
        sheet.mergeCells(`${h.col}9:${h.endCol}9`);
      }
      const cell = sheet.getCell(`${h.col}9`);
      cell.value = h.label;
      cell.fill = headerFill;
      cell.font = headerFont;
      cell.alignment = headerAlign;
      cell.border = thinBorder;
    }

    // Pernocte sub-headers (row 10-11)
    sheet.getCell('H10').value = 'Hotel';
    sheet.mergeCells('H10:H11');
    sheet.getCell('H10').fill = headerFill;
    sheet.getCell('H10').font = headerFont;
    sheet.getCell('H10').alignment = headerAlign;
    sheet.getCell('H10').border = thinBorder;

    sheet.getCell('I10').value = 'Trailer';
    sheet.mergeCells('I10:I11');
    sheet.getCell('I10').fill = headerFill;
    sheet.getCell('I10').font = headerFont;
    sheet.getCell('I10').alignment = headerAlign;
    sheet.getCell('I10').border = thinBorder;

    // J10-J11 empty spacer within pernocte group
    sheet.mergeCells('J10:J11');
    sheet.getCell('J10').fill = headerFill;
    sheet.getCell('J10').border = thinBorder;

    // Set row heights for header
    sheet.getRow(9).height = 16;
    sheet.getRow(10).height = 14;
    sheet.getRow(11).height = 14;

    // ─── Data rows (12+) ───
    const dataStartRow = 12;
    const fmtTime = (d: Date | null) => {
      if (!d) return '';
      const dt = new Date(d);
      return `${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;
    };

    let totalHsTrabajadas = 0;
    let totalHsViaje = 0;

    planilla.registros.forEach((r, idx) => {
      const rowNum = dataStartRow + idx;
      const row = sheet.getRow(rowNum);

      const fecha = new Date(r.fecha);
      const hsTrabajadas = Number(r.horasNormales) + Number(r.horasExtra50) + Number(r.horasExtra100);
      const hsViaje = Number(r.horasViajeCalc);

      totalHsTrabajadas += hsTrabajadas;
      totalHsViaje += hsViaje;

      const lugar = r.bloqueado
        ? (r.motivoBloqueo ?? 'AUSENCIA')
        : (r.lugarTrabajo === 'CAMPO' ? 'Campo' : r.lugarTrabajo === 'BASE' ? 'Base' : r.lugarTrabajo ?? '');

      row.getCell('B').value = fecha;
      row.getCell('B').numFmt = 'DD/MM/YYYY';
      row.getCell('C').value = fmtTime(r.entradaTurno1);
      row.getCell('D').value = fmtTime(r.salidaTurno1);
      row.getCell('E').value = hsTrabajadas > 0 ? hsTrabajadas : '';
      row.getCell('E').numFmt = '0.0';
      row.getCell('F').value = hsViaje > 0 ? hsViaje : '';
      row.getCell('F').numFmt = '0.0';
      row.getCell('G').value = lugar;
      row.getCell('H').value = r.pernocte === 'HOTEL' ? 'SI' : '';
      row.getCell('I').value = r.pernocte === 'TRAILER' ? 'SI' : '';
      row.getCell('K').value = r.maneja ? 'SI' : '';
      row.getCell('L').value = r.bloqueado ? (r.motivoBloqueo ?? '') : (r.observaciones ?? '');

      // Apply borders and conditional formatting
      ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].forEach((col) => {
        const cell = row.getCell(col);
        cell.border = thinBorder;
        cell.alignment = { horizontal: col === 'L' ? 'left' : 'center', vertical: 'middle' };
        cell.font = { size: 9 };
      });

      // Color code: yellow for ausencia, green for feriado, purple for franco trabajado
      if (r.bloqueado) {
        ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].forEach((col) => {
          row.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF0E0' } };
        });
      } else if (r.esFeriado) {
        ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].forEach((col) => {
          row.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
        });
      } else if (r.esFrancoTrabajado) {
        ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].forEach((col) => {
          row.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE7F6' } };
        });
      }
    });

    // ─── Totals row ───
    const totalsRow = dataStartRow + planilla.registros.length;
    sheet.getCell(`B${totalsRow}`).value = 'TOTALES';
    sheet.getCell(`B${totalsRow}`).font = { bold: true, size: 10 };
    sheet.getCell(`E${totalsRow}`).value = totalHsTrabajadas;
    sheet.getCell(`E${totalsRow}`).numFmt = '0.0';
    sheet.getCell(`E${totalsRow}`).font = { bold: true, size: 10 };
    sheet.getCell(`F${totalsRow}`).value = totalHsViaje;
    sheet.getCell(`F${totalsRow}`).numFmt = '0.0';
    sheet.getCell(`F${totalsRow}`).font = { bold: true, size: 10 };
    sheet.getCell(`G${totalsRow}`).value = `Campo: ${planilla.totalDiasCampo}d | Base: ${planilla.totalDiasBase}d`;
    sheet.getCell(`G${totalsRow}`).font = { bold: true, size: 8 };
    ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].forEach((col) => {
      sheet.getCell(`${col}${totalsRow}`).border = {
        top: { style: 'medium' }, bottom: { style: 'medium' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });

    // ─── Signature area (2 rows below totals) ───
    const sigRow = totalsRow + 2;
    sheet.mergeCells(`B${sigRow}:D${sigRow}`);
    sheet.getCell(`B${sigRow}`).value = 'Firma del Trabajador';
    sheet.getCell(`B${sigRow}`).alignment = { horizontal: 'center' };
    sheet.getCell(`B${sigRow}`).font = { size: 9, italic: true };
    sheet.getCell(`B${sigRow}`).border = { top: { style: 'thin' } };

    sheet.mergeCells(`G${sigRow}:I${sigRow}`);
    sheet.getCell(`G${sigRow}`).value = 'Firma del Supervisor';
    sheet.getCell(`G${sigRow}`).alignment = { horizontal: 'center' };
    sheet.getCell(`G${sigRow}`).font = { size: 9, italic: true };
    sheet.getCell(`G${sigRow}`).border = { top: { style: 'thin' } };

    // Generate buffer and send
    const buffer = await workbook.xlsx.writeBuffer();

    const mesInicioStr = inicio.toLocaleDateString('es-AR', { month: 'short' });
    const mesFinStr = fin.toLocaleDateString('es-AR', { month: 'short' });
    const anio = fin.getFullYear();
    const filename = `Planilla de horas ${u.apellido} ${u.nombre} (${mesInicioStr} - ${mesFinStr} - ${anio}).xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(Buffer.from(buffer as ArrayBuffer));
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

    // Bug fix: verify sector belongs to current empresa before exporting its data
    const sector = await prisma.sector.findFirst({
      where: { id: sectorId, empresaId: req.user!.empresaId },
      select: { id: true },
    });
    if (!sector) {
      res.status(404).json({ error: 'Sector no encontrado' });
      return;
    }

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
    resumenSheet.columns = resumenHeaders.map((_h, i) => ({
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
    const usedSheetNames = new Map<string, number>();
    for (const p of planillas) {
      const baseName = `${p.usuario.apellido}, ${p.usuario.nombre}`.substring(0, 28);
      const count = usedSheetNames.get(baseName) ?? 0;
      const sheetName = count === 0 ? baseName : `${baseName} (${count})`.substring(0, 31);
      usedSheetNames.set(baseName, count + 1);
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
