import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH } from '../middleware/roles.middleware.js';
import ExcelJS from 'exceljs';

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

// ─── POST /liquidacion/planillas-excel — Excel with one sheet per person ──

router.post('/planillas-excel', async (req: AuthRequest, res: Response): Promise<void> => {
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
      estado: 'CERRADA',
    };
    if (sectorId) where.usuario = { ...where.usuario, sectorId };
    if (usuarioId) where.usuarioId = usuarioId;

    const planillas = await prisma.planilla.findMany({
      where,
      include: {
        usuario: {
          select: {
            legajo: true, nombre: true, apellido: true, cuil: true, dni: true,
            categoria: { select: { nombre: true } },
            sector: { select: { nombre: true } },
            convenio: { select: { nombre: true } },
          },
        },
        registros: {
          orderBy: { fecha: 'asc' },
        },
      },
      orderBy: [{ usuario: { apellido: 'asc' } }, { periodoInicio: 'asc' }],
    });

    if (planillas.length === 0) {
      res.status(404).json({ error: 'No se encontraron planillas cerradas en el período indicado' });
      return;
    }

    // Group planillas by usuarioId
    const byUser = new Map<string, typeof planillas>();
    for (const p of planillas) {
      const arr = byUser.get(p.usuarioId) ?? [];
      arr.push(p);
      byUser.set(p.usuarioId, arr);
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Planilla de Horas';
    workbook.created = new Date();

    const fmt = (d: Date | null | undefined) =>
      d ? new Date(d).toLocaleDateString('es-AR') : '';
    const fmtTime = (d: Date | null | undefined) => {
      if (!d) return '';
      const dt = new Date(d);
      return `${String(dt.getUTCHours()).padStart(2, '0')}:${String(dt.getUTCMinutes()).padStart(2, '0')}`;
    };
    const num = (v: any) => Number(v ?? 0);

    const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    const SUB_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F7' } };
    const TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE9AA' } };
    const WHITE_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFFFF' }, bold: true };
    const BOLD: Partial<ExcelJS.Font> = { bold: true };

    const usedSheetNames = new Set<string>();

    const uniqueSheetName = (base: string): string => {
      // Strip illegal Excel sheet name chars and trim to 31
      const clean = base.replace(/[:\\/?*[\]]/g, '').slice(0, 31).trim();
      if (!usedSheetNames.has(clean)) {
        usedSheetNames.add(clean);
        return clean;
      }
      for (let i = 2; i < 1000; i++) {
        const suffix = ` (${i})`;
        const candidate = clean.slice(0, 31 - suffix.length) + suffix;
        if (!usedSheetNames.has(candidate)) {
          usedSheetNames.add(candidate);
          return candidate;
        }
      }
      throw new Error('No se pudo generar un nombre de hoja único');
    };

    for (const [, userPlanillas] of byUser) {
      const u = userPlanillas[0].usuario;
      const baseName = u.legajo
        ? `${u.apellido} ${u.nombre} (${u.legajo})`
        : `${u.apellido} ${u.nombre}`;

      const ws = workbook.addWorksheet(uniqueSheetName(baseName));
      ws.columns = [
        { key: 'fecha',    width: 12 },
        { key: 'e1',       width: 8  },
        { key: 's1',       width: 8  },
        { key: 'e2',       width: 8  },
        { key: 's2',       width: 8  },
        { key: 'htrab',    width: 9  },
        { key: 'hnorm',    width: 9  },
        { key: 'hext50',   width: 9  },
        { key: 'hext100',  width: 9  },
        { key: 'hviaje',   width: 9  },
        { key: 'lugar',    width: 14 },
        { key: 'pernocte', width: 10 },
        { key: 'obs',      width: 30 },
      ];

      // ── Person header ──
      const title = ws.addRow([`${u.apellido}, ${u.nombre}${u.legajo ? `  —  Legajo: ${u.legajo}` : ''}`]);
      ws.mergeCells(`A${title.number}:M${title.number}`);
      title.font = { size: 13, bold: true, color: { argb: 'FF1E3A5F' } };
      title.height = 22;

      const infoRow = ws.addRow([
        `Sector: ${u.sector?.nombre ?? '-'}   |   Categoría: ${u.categoria?.nombre ?? '-'}   |   Convenio: ${u.convenio?.nombre ?? '-'}   |   CUIL: ${u.cuil ?? '-'}`,
      ]);
      ws.mergeCells(`A${infoRow.number}:M${infoRow.number}`);
      infoRow.font = { size: 10, color: { argb: 'FF555555' } };

      ws.addRow([]); // spacer

      for (const planilla of userPlanillas) {
        // Period title row
        const periodoRow = ws.addRow([
          `Período: ${fmt(planilla.periodoInicio)} — ${fmt(planilla.periodoFin)}   |   Estado: ${planilla.estado}   |   Cerrada: ${fmt(planilla.cerradaAt ?? undefined)}`,
        ]);
        ws.mergeCells(`A${periodoRow.number}:M${periodoRow.number}`);
        periodoRow.fill = HEADER_FILL;
        periodoRow.font = { ...WHITE_FONT, size: 11 };
        periodoRow.height = 18;

        // Column headers
        const colRow = ws.addRow([
          'Fecha', 'Entrada 1', 'Salida 1', 'Entrada 2', 'Salida 2',
          'Hs. Trab.', 'Hs. Norm.', 'Hs. Ext 50%', 'Hs. Ext 100%', 'Hs. Viaje',
          'Lugar', 'Pernocte', 'Observaciones',
        ]);
        colRow.fill = SUB_FILL;
        colRow.font = BOLD;
        colRow.alignment = { horizontal: 'center' };

        let totHtrab = 0, totHnorm = 0, totHext50 = 0, totHext100 = 0, totHviaje = 0;

        for (const r of planilla.registros) {
          const htrab = num(r.horasTrabajadas);
          const hnorm = num(r.horasNormales);
          const hext50 = num(r.horasExtra50);
          const hext100 = num(r.horasExtra100);
          const hviaje = num(r.horasViajeCalc);

          totHtrab += htrab; totHnorm += hnorm; totHext50 += hext50;
          totHext100 += hext100; totHviaje += hviaje;

          const dataRow = ws.addRow([
            fmt(r.fecha),
            fmtTime(r.entradaTurno1),
            fmtTime(r.salidaTurno1),
            fmtTime(r.entradaTurno2),
            fmtTime(r.salidaTurno2),
            htrab > 0 ? htrab.toFixed(2) : '',
            hnorm > 0 ? hnorm.toFixed(2) : '',
            hext50 > 0 ? hext50.toFixed(2) : '',
            hext100 > 0 ? hext100.toFixed(2) : '',
            hviaje > 0 ? hviaje.toFixed(2) : '',
            r.lugarTrabajo ?? '',
            r.pernocte !== 'NO' ? r.pernocte : '',
            r.observaciones ?? '',
          ]);
          dataRow.alignment = { horizontal: 'center' };
          // Left-align obs column
          dataRow.getCell('obs').alignment = { horizontal: 'left' };
        }

        // Totals row
        const totalRow = ws.addRow([
          'TOTALES', '', '', '', '',
          totHtrab.toFixed(2),
          totHnorm.toFixed(2),
          totHext50.toFixed(2),
          totHext100.toFixed(2),
          totHviaje.toFixed(2),
          '', '', '',
        ]);
        totalRow.fill = TOTAL_FILL;
        totalRow.font = BOLD;
        totalRow.alignment = { horizontal: 'center' };

        // Summary line
        const sumRow = ws.addRow([
          `Días Campo: ${planilla.totalDiasCampo}   |   Días Base: ${planilla.totalDiasBase}`,
        ]);
        ws.mergeCells(`A${sumRow.number}:M${sumRow.number}`);
        sumRow.font = { italic: true, size: 10 };

        ws.addRow([]); // spacer between planillas
      }
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="planillas_cerradas_${periodoInicio.slice(0, 10)}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error exporting planillas Excel:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
