import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH } from '../middleware/roles.middleware.js';
// Todo de fecha-dia.utils.js, la autoridad de la convención: `claveFecha` venía
// de contexto-dia.utils.js, que sólo la re-exporta por compatibilidad.
import { claveFecha, diaDesdeEntrada, finDelDia, fmtFechaDia, fmtFechaDiaCorta } from '../utils/fecha-dia.utils.js';
import { fechaDia } from '../utils/zod.utils.js';
import { periodoQuerySchema, filtroPeriodoPlanilla } from '../utils/periodo-query.utils.js';
import { getPeriodoActual } from '../utils/calculo.utils.js';

const prisma = new PrismaClient();
const router = Router();

/**
 * Ventana [inicio, fin] del ciclo de planilla que las tres exportaciones usan
 * para acotar las planillas APROBADA/CERRADA.
 *
 * Se normaliza SIEMPRE por `filtroPeriodoPlanilla`, que resuelve las dos puntas
 * por su cuenta: el front manda la medianoche del ciclo y en la base conviven
 * las convenciones viejas (`00:00Z`, `03:00Z`, `15:00Z`) hasta que corra la
 * migración. Comparar por timestamp exacto acá devolvería cero filas apenas el
 * cliente y la fila se hayan escrito con convenciones distintas.
 */
type VentanaPeriodo = { periodoInicio: Date; periodoFin: Date };

/**
 * Período VIGENTE según la configuración de ciclo de la empresa, derivado en el
 * servidor. Sólo lo usa `GET /export/sector/:sid`, que conserva los parámetros
 * de período como opcionales (ver el comentario de esa ruta).
 *
 * Mismos defaults 21/20 que `POST /planillas` cuando no hay `EmpresaConfig`.
 */
async function periodoVigente(empresaId: string): Promise<VentanaPeriodo> {
  const config = await prisma.empresaConfig.findUnique({ where: { empresaId } });
  const { inicio, fin } = getPeriodoActual(config?.periodoDiaInicio ?? 21, config?.periodoDiaFin ?? 20);
  return { periodoInicio: inicio, periodoFin: fin };
}

/**
 * Sufijo `"<desde> al <hasta>"` con que se nombran los archivos exportados.
 *
 * Va en clave YYYY-MM-DD (`claveFecha`) y NO en formato es-AR: `fmtFechaDia`
 * devuelve `D/M/YYYY`, y una barra en el nombre de archivo sale del servidor
 * como `%2F` (por el `encodeURIComponent` del Content-Disposition), el navegador
 * la vuelve a decodificar y queda un nombre inválido en Windows. De paso
 * YYYY-MM-DD ordena alfabéticamente igual que cronológicamente, que es lo que
 * uno quiere en la carpeta donde se guardan los cierres.
 *
 * `claveFecha` lee la clave UTC, que es exactamente lo correcto acá: las dos
 * puntas ya vienen normalizadas por `fechaDia` / `getPeriodoActual`.
 */
function rangoArchivo(periodoInicio: Date, periodoFin: Date): string {
  return `${claveFecha(periodoInicio)} al ${claveFecha(periodoFin)}`;
}

/**
 * Deja un texto libre (hoy sólo el nombre de un sector, que lo escribe RRHH) en
 * condiciones de ser parte de un nombre de archivo. Misma razón que
 * `rangoArchivo`: un sector llamado "Almacén/Depósito" metía una barra en el
 * Content-Disposition y el archivo bajaba con un nombre inválido.
 */
function nombreArchivoSeguro(texto: string): string {
  return texto.replace(/[\\/:*?"<>|]/g, '-').trim() || 'sector';
}

router.use(authMiddleware);

// ─── GET /export/periodos ────────────────────────
//
// Los períodos que EXISTEN de verdad en la base, con cuántas planillas hay en
// cada uno y en qué estado.
//
// Para qué: las tres exportaciones acotan por `filtroPeriodoPlanilla`, que exige
// que la planilla ANIDE en el ciclo pedido (`periodoInicio >= X` y
// `periodoFin <= Y`). Eso es lo correcto —filtrar por solapamiento haría que una
// misma planilla caiga en dos ciclos y se cuente/cierre dos veces—, pero tiene
// un efecto que hay que hacer visible: la pantalla de Cierre ofrece los ciclos
// derivados de la configuración VIGENTE, así que una planilla guardada bajo una
// configuración anterior (esta empresa pasó de 21/20 a 16/15, y quedaron
// planillas de `2026-01-21 → 2026-02-20`) no anida en ninguno de los ciclos
// ofrecidos: no se lista, no entra al Excel y su dueño cuenta como "pendiente"
// en el 409 que bloquea el cierre. Sin este endpoint eso pasa EN SILENCIO.
//
// El front ya sabe generar los ciclos (`generateCycles`); lo único que le
// faltaba era saber qué períodos hay. La comparación queda de su lado a
// propósito: así el aviso habla exactamente de los ciclos que el selector
// ofrece, sin que el servidor tenga que replicar (y desincronizar) esa
// generación.
//
// `desde`/`hasta` son OPCIONALES y acotan por SOLAPAMIENTO —no por anidamiento,
// que es justo lo que este endpoint viene a diagnosticar—: el front manda el
// tramo que cubre el selector para no traerse (ni gritar por) historia de hace
// años, que no es lo que esta pantalla está por cerrar.
const fechaDiaQueryOpcional = z.preprocess(
  (v) => (v === '' ? undefined : v),
  fechaDia.optional(),
);
const periodosExistentesQuerySchema = z.object({
  desde: fechaDiaQueryOpcional,
  hasta: fechaDiaQueryOpcional,
});

router.get('/periodos', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = periodosExistentesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'desde/hasta inválido', details: parsed.error.flatten() });
      return;
    }
    const { desde, hasta } = parsed.data;
    if (desde && hasta && hasta < desde) {
      res.status(400).json({ error: 'hasta debe ser mayor o igual a desde' });
      return;
    }

    // Solape con [desde, hasta]: el período empieza antes de que termine la
    // ventana y termina después de que empiece. Las dos puntas se ensanchan al
    // día completo por la misma razón que en `filtroPeriodoPlanilla`: mientras
    // la migración de datos no corra, en la base conviven `00:00Z`, `03:00Z` y
    // `15:00Z` para el mismo día calendario.
    const where: {
      usuario: { empresaId: string };
      periodoFin?: { gte: Date };
      periodoInicio?: { lte: Date };
    } = { usuario: { empresaId: req.user!.empresaId } };
    if (desde) where.periodoFin = { gte: diaDesdeEntrada(desde) };
    if (hasta) where.periodoInicio = { lte: finDelDia(hasta) };

    const grupos = await prisma.planilla.groupBy({
      by: ['periodoInicio', 'periodoFin', 'estado'],
      where,
      _count: { _all: true },
    });

    // Se reagrupa por CLAVE DE DÍA y no por el timestamp que devuelve el
    // groupBy: dos filas del mismo ciclo escritas con convenciones distintas
    // (`00:00Z` y `03:00Z`) son grupos separados en SQL y el front las vería
    // como dos períodos distintos que además no anidan en el mismo ciclo.
    const porPeriodo = new Map<string, {
      periodoInicio: Date;
      periodoFin: Date;
      total: number;
      porEstado: Record<string, number>;
    }>();
    for (const g of grupos) {
      const periodoInicio = diaDesdeEntrada(g.periodoInicio);
      const periodoFin = diaDesdeEntrada(g.periodoFin);
      const clave = `${claveFecha(periodoInicio)}|${claveFecha(periodoFin)}`;
      let entrada = porPeriodo.get(clave);
      if (!entrada) {
        entrada = { periodoInicio, periodoFin, total: 0, porEstado: {} };
        porPeriodo.set(clave, entrada);
      }
      const n = g._count._all;
      entrada.total += n;
      entrada.porEstado[g.estado] = (entrada.porEstado[g.estado] ?? 0) + n;
    }

    const periodos = [...porPeriodo.values()]
      .sort((a, b) =>
        b.periodoInicio.getTime() - a.periodoInicio.getTime()
        || b.periodoFin.getTime() - a.periodoFin.getTime())
      .map((p) => ({
        // Ya normalizados a medianoche UTC del día argentino: el front los
        // compara con `diaKey`, que saca la clave del STRING.
        periodoInicio: p.periodoInicio.toISOString(),
        periodoFin: p.periodoFin.toISOString(),
        total: p.total,
        porEstado: p.porEstado,
      }));

    res.json(periodos);
  } catch (error) {
    console.error('Error listing periodos:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

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
            diagramas: {
              select: {
                diagrama: { select: { nombre: true } },
                fechaInicio: true,
                fechaFin: true,
              },
              orderBy: { fechaInicio: 'asc' },
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
    // Los tramos que tocan el período. Con un cambio a mitad de ciclo, poner un
    // solo nombre en el encabezado contradice los francos de la propia planilla.
    const fmt = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/');
    // Comparar el Date crudo es el mismo bug que ya se corrigió en
    // diagrama-vigencia.utils.ts (tramoDelDia) y en recalculo-diagrama.utils.ts:
    // `fechaInicio`/`fechaFin` guardan la hora real de la aprobación, no
    // medianoche UTC, así que un tramo que arranca a las 15:32 del último día
    // del período quedaría afuera aunque por día calendario corresponda. Se
    // compara por clave de día ('YYYY-MM-DD'), la misma convención que usa
    // `RegistroHoras.fecha`.
    const periodoInicioClave = claveFecha(planilla.periodoInicio);
    const periodoFinClave = claveFecha(planilla.periodoFin);
    const tramosPeriodo = u.diagramas.filter(
      (a) => claveFecha(a.fechaInicio) <= periodoFinClave
        && (!a.fechaFin || claveFecha(a.fechaFin) >= periodoInicioClave),
    );
    const diagramaNombre = tramosPeriodo.length === 0
      ? null
      : tramosPeriodo.length === 1
        ? tramosPeriodo[0]!.diagrama.nombre
        : tramosPeriodo
            .map((a, i) =>
              i === 0 && a.fechaFin
                ? `${a.diagrama.nombre} hasta ${fmt(a.fechaFin)}`
                : `${a.diagrama.nombre} desde ${fmt(a.fechaInicio)}`,
            )
            .join(' · ');
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
    const inicio = planilla.periodoInicio;
    const fin = planilla.periodoFin;
    const meses = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
    const mesInicio = meses[inicio.getUTCMonth()];
    const mesFin = meses[fin.getUTCMonth()];

    sheet.getCell('B7').value = 'Mes:';
    sheet.getCell('B7').font = { bold: true, size: 10 };
    sheet.getCell('C7').value = mesInicio === mesFin ? mesInicio : `${mesInicio} - ${mesFin}`;
    sheet.getCell('C7').font = { size: 10 };

    sheet.getCell('G7').value = `Diagrama: ${diagramaNombre ?? '—'}`;
    sheet.getCell('G7').font = { bold: true, size: 10 };


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

    // `timeZone: 'UTC'` fuerza a leer el mes calendario que ya está codificado en
    // la fecha-día (medianoche UTC), no el que resulta de aplicar el huso del
    // proceso (TZ=America/Argentina/Buenos_Aires — ver Dockerfile): sin esto,
    // el 1 de agosto se lee como julio.
    const mesInicioStr = inicio.toLocaleDateString('es-AR', { month: 'short', timeZone: 'UTC' });
    const mesFinStr = fin.toLocaleDateString('es-AR', { month: 'short', timeZone: 'UTC' });
    const anio = fin.getUTCFullYear();
    const filename = `Planilla de horas ${u.apellido} ${u.nombre} (${mesInicioStr} - ${mesFinStr} - ${anio}).xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(Buffer.from(buffer as ArrayBuffer));
  } catch (error) {
    console.error('Error exporting planilla:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── CSV cell escaping ───────────────────────────
// Siempre entre comillas: un apellido con coma ('DE LA CRUZ, JUAN') corría todas las
// columnas del reporte de liquidación. Y prefijo apóstrofo cuando el valor arranca con
// un carácter que Excel/LibreOffice evalúan como fórmula (los nombres y legajos los
// carga RRHH, así que son texto controlado por el usuario). Los números se dejan
// intactos para que sigan entrando como números en la planilla de cálculo.
function csvCell(valor: unknown): string {
  const s = String(valor ?? '');
  // Un solo carácter (el '-' con que se rellena el legajo vacío) no puede ser fórmula
  const esNumero = /^-?\d+([.,]\d+)?$/.test(s);
  const seguro = s.length > 1 && !esNumero && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${seguro.replace(/"/g, '""')}"`;
}

// ─── GET /export/sector/:sid ─────────────────────
// CSV con las planillas APROBADA/CERRADA de un sector, acotado a UN período.
//
// A diferencia de /cierre y /pendientes, acá `periodoInicio`/`periodoFin` son
// OPCIONALES y por defecto se usa el ciclo vigente resuelto en el servidor: esta
// ruta no tiene ningún llamador en el front (sólo las suites QA, que la invocan
// sin parámetros), así que exigirlos rompería a los únicos clientes que tiene
// sin arreglarle nada a nadie. Antes el "período" del comentario era mentira:
// no filtraba nada y el CSV traía el histórico completo del sector.
router.get('/sector/:sid', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sectorId = req.params.sid as string;

    const periodo = periodoQuerySchema.safeParse(req.query);
    if (!periodo.success) {
      res.status(400).json({ error: 'periodoInicio/periodoFin inválido', details: periodo.error.flatten() });
      return;
    }
    // Una sola punta deja la ventana abierta del otro lado y devuelve historia
    // entera: es justo el defecto que esta ruta viene a cerrar, así que se pide
    // explícito en vez de completarlo con el ciclo vigente por la mitad.
    if (!periodo.data.periodoInicio !== !periodo.data.periodoFin) {
      res.status(400).json({ error: 'periodoInicio y periodoFin deben venir juntos' });
      return;
    }
    if (periodo.data.periodoInicio && periodo.data.periodoFin && periodo.data.periodoFin < periodo.data.periodoInicio) {
      res.status(400).json({ error: 'periodoFin debe ser mayor o igual a periodoInicio' });
      return;
    }
    const ventana: VentanaPeriodo = periodo.data.periodoInicio && periodo.data.periodoFin
      ? { periodoInicio: periodo.data.periodoInicio, periodoFin: periodo.data.periodoFin }
      : await periodoVigente(req.user!.empresaId);

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
      where: {
        usuarioId: { in: userIds },
        estado: { in: ['APROBADA', 'CERRADA'] },
        ...filtroPeriodoPlanilla(ventana),
      },
      include: {
        usuario: { select: { nombre: true, apellido: true, legajo: true } },
      },
      orderBy: [{ periodoInicio: 'desc' }, { usuarioId: 'asc' }],
    });

    const BOM = '\uFEFF';
    const header = [
      'Empleado', 'Legajo', 'Período', 'Estado', 'Hs Normales', 'Hs Extra50',
      'Hs Extra100', 'Hs Viaje', 'Días Campo', 'Días Base',
    ].map(csvCell).join(',');
    const rows = planillas.map((p) => [
      `${p.usuario.apellido} ${p.usuario.nombre}`,
      p.usuario.legajo ?? '-',
      `${fmtFechaDia(p.periodoInicio)} - ${fmtFechaDia(p.periodoFin)}`,
      p.estado,
      Number(p.totalHorasNormales).toFixed(1),
      Number(p.totalHorasExtra50).toFixed(1),
      Number(p.totalHorasExtra100).toFixed(1),
      Number(p.totalHorasViaje).toFixed(1),
      p.totalDiasCampo.toString(),
      p.totalDiasBase.toString(),
    ].map(csvCell).join(','));

    const csv = BOM + [header, ...rows].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Reporte sector.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting sector:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── GET /export/pendientes — Excel of users without approved planilla, grouped by sector ─────
//
// `periodoInicio`/`periodoFin` son OBLIGATORIOS (query string, es un GET): sin
// ellos "pendiente" se calculaba contra el histórico entero, así que alguien con
// una planilla aprobada de hace seis meses no aparecía en el listado aunque no
// hubiera entregado nada del ciclo vigente.
router.get('/pendientes', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const empresaId = req.user!.empresaId;

    const periodo = periodoQuerySchema.safeParse(req.query);
    if (!periodo.success) {
      res.status(400).json({ error: 'periodoInicio/periodoFin inválido', details: periodo.error.flatten() });
      return;
    }
    const { periodoInicio, periodoFin } = periodo.data;
    if (!periodoInicio || !periodoFin) {
      res.status(400).json({ error: 'periodoInicio y periodoFin son requeridos' });
      return;
    }
    if (periodoFin < periodoInicio) {
      res.status(400).json({ error: 'periodoFin debe ser mayor o igual a periodoInicio' });
      return;
    }
    const filtroPeriodo = filtroPeriodoPlanilla({ periodoInicio, periodoFin });

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
        ...filtroPeriodo,
      },
      select: { usuarioId: true, estado: true },
    });

    // Also get non-approved planillas for status info. Mismo período que el
    // filtro de arriba: con el histórico entero la columna "Estado Planilla"
    // mostraba el estado de una planilla de otro ciclo al lado de un usuario
    // que en ÉSTE no entregó nada.
    const allPlanillas = await prisma.planilla.findMany({
      where: { usuarioId: { in: usuarios.map(u => u.id) }, ...filtroPeriodo },
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
    // El PERÍODO consultado, no el mes de hoy: ahora que el contenido se acota
    // al ciclo elegido, un nombre con la fecha de descarga miente sobre lo que
    // hay adentro apenas se exporta un ciclo que no es el vigente.
    const filename = `Pendientes de aprobacion - ${rangoArchivo(periodoInicio, periodoFin)}.xlsx`;

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

/**
 * Body de `POST /export/cierre`.
 *
 * `periodoInicio`/`periodoFin` son OBLIGATORIOS: son el ciclo que se está
 * cerrando, la pantalla ya lo tiene elegido y lo muestra, y sin ellos el Excel
 * (y peor, el chequeo de pendientes que devuelve 409) miraba todo el histórico.
 * Pasan por `fechaDia`, así que da igual si el cliente manda `"2026-07-21"`,
 * medianoche UTC o medianoche argentina.
 *
 * `sectorIds` se valida acá y no a mano: crudo desde `req.body` hacía reventar a
 * Prisma con un 500 que tapaba el diagnóstico real del cierre.
 */
const cierreExportSchema = z
  .object({
    periodoInicio: fechaDia,
    periodoFin: fechaDia,
    sectorIds: z.array(z.string()).optional(),
    exportarTodos: z.boolean().optional(),
    forzar: z.boolean().optional(),
  })
  .refine(
    (d) => d.periodoFin >= d.periodoInicio,
    { message: 'periodoFin debe ser mayor o igual a periodoInicio', path: ['periodoFin'] },
  );

// ─── POST /export/cierre — Excel export for period closing ─────
router.post('/cierre', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const empresaId = req.user!.empresaId;

    const parsed = cierreExportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }
    const { sectorIds, exportarTodos, forzar, periodoInicio, periodoFin } = parsed.data;

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
      },
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
    });

    const userIds = usuarios.map(u => u.id);

    // Las planillas APROBADA/CERRADA de esos usuarios EN EL CICLO QUE SE CIERRA.
    // Misma ventana que usa `GET /planillas?periodoInicio=&periodoFin=`, que es
    // lo que lista la pantalla de Cierre: el Excel tiene que coincidir con lo
    // que el usuario ve arriba, no traer el histórico entero.
    const planillas = await prisma.planilla.findMany({
      where: {
        usuarioId: { in: userIds },
        estado: { in: ['APROBADA', 'CERRADA'] },
        ...filtroPeriodoPlanilla({ periodoInicio, periodoFin }),
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

    // Usuarios sin planilla aprobada EN ESTE período. Se deriva de `planillas`
    // a propósito, no de una segunda consulta: si el listado del Excel y este
    // chequeo pudieran mirar ventanas distintas volvería el defecto que
    // bloquea/deja pasar el cierre con gente faltando.
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
        const fmtDate = fmtFechaDiaCorta;

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

    // El PERÍODO exportado, no el mes de hoy. Un cierre se guarda y se busca
    // meses después: con la fecha de descarga en el nombre, exportar un ciclo
    // viejo producía un archivo que mentía sobre su propio contenido.
    const rango = rangoArchivo(periodoInicio, periodoFin);
    let filename: string;
    if (exportarTodos || !sectorIds?.length) {
      filename = `Cierre planillas - Todos - ${rango}.xlsx`;
    } else if (sectorIds.length === 1) {
      const sectorName = bySector.keys().next().value ?? 'sector';
      filename = `Cierre planillas - ${nombreArchivoSeguro(sectorName)} - ${rango}.xlsx`;
    } else {
      filename = `Cierre planillas - ${sectorIds.length} sectores - ${rango}.xlsx`;
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
