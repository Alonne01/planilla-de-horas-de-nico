/**
 * Utility to inject locked (bloqueado) RegistroHoras entries when an
 * absence or vacation is approved. Also used when a new planilla is
 * created to back-fill any previously-approved absences/vacations.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { diaDesdeEntrada, dentroDelRango, rangoConsultaDia } from './fecha-dia.utils.js';

const { Decimal } = Prisma;

const prisma = new PrismaClient();

const ZERO = new Decimal(0);

interface AusenciaRange {
  usuarioId: string;
  fechaInicio: Date;
  fechaFin: Date;
  motivoBloqueo: string;
  observaciones: string;
  marcaManualId?: string;
}

/**
 * For each day in the range, find the planilla that covers it and upsert
 * a locked RegistroHoras entry. If no planilla exists for a day, that day
 * is silently skipped (it will be back-filled when the planilla is created).
 */
export async function inyectarDiasBloqueados(range: AusenciaRange): Promise<void> {
  const days = buildDaysBetween(range.fechaInicio, range.fechaFin);

  // Find all planillas that overlap the range for this user
  const { desde: desdeDia, hasta: hastaDia } = rangoConsultaDia(range.fechaInicio, range.fechaFin);
  const planillas = await prisma.planilla.findMany({
    where: {
      usuarioId: range.usuarioId,
      periodoInicio: { lte: hastaDia },
      periodoFin: { gte: desdeDia },
    },
    select: { id: true, periodoInicio: true, periodoFin: true },
  });

  for (const day of days) {
    const planilla = planillas.find(
      (p) => dentroDelRango(day, p.periodoInicio, p.periodoFin)
    );
    if (!planilla) continue;

    await prisma.registroHoras.upsert({
      where: {
        planillaId_fecha: { planillaId: planilla.id, fecha: day },
      },
      update: {
        bloqueado: true,
        motivoBloqueo: range.motivoBloqueo,
        marcaManualId: range.marcaManualId ?? null,
        observaciones: range.observaciones,
        // Zero out hours — absence days have no worked hours
        entradaTurno1: null,
        salidaTurno1: null,
        entradaTurno2: null,
        salidaTurno2: null,
        horasTrabajadas: ZERO,
        horasNormales: ZERO,
        horasExtra50: ZERO,
        horasExtra100: ZERO,
        horasViajeCalc: ZERO,
        lugarTrabajo: null,
      },
      create: {
        planillaId: planilla.id,
        fecha: day,
        bloqueado: true,
        motivoBloqueo: range.motivoBloqueo,
        marcaManualId: range.marcaManualId ?? null,
        observaciones: range.observaciones,
        horasTrabajadas: ZERO,
        horasNormales: ZERO,
        horasExtra50: ZERO,
        horasExtra100: ZERO,
        horasViajeCalc: ZERO,
        horasViajeInput: ZERO,
      },
    });
  }
}

/**
 * When a new planilla is created, check for approved ausencias and vacaciones
 * that fall within the period and create locked entries.
 */
export async function backfillAusenciasEnPlanilla(
  planillaId: string,
  usuarioId: string,
  periodoInicio: Date,
  periodoFin: Date,
): Promise<void> {
  // El filtro en SQL compara timestamps, pero `periodoInicio`/`periodoFin` (y las
  // fechas de ausencias/vacaciones que se comparan contra ellos) pueden traer
  // hora — mismo ensanche que en inyectarDiasBloqueados.
  const { desde: desdeDia, hasta: hastaDia } = rangoConsultaDia(periodoInicio, periodoFin);

  // Approved ausencias in period
  const ausencias = await prisma.ausencia.findMany({
    where: {
      usuarioId,
      estado: 'APROBADA',
      fechaInicio: { lte: hastaDia },
      fechaFin: { gte: desdeDia },
    },
  });

  // Approved vacaciones in period
  const vacaciones = await prisma.vacacion.findMany({
    where: {
      usuarioId,
      estado: 'APROBADA',
      fechaInicio: { lte: hastaDia },
      fechaFin: { gte: desdeDia },
    },
  });

  for (const aus of ausencias) {
    const tipoLabel = formatTipoAusencia(aus.tipo);
    const days = buildDaysBetween(
      clampDia(aus.fechaInicio, periodoInicio),
      clampDia(aus.fechaFin, periodoFin, true),
    );

    for (const day of days) {
      await prisma.registroHoras.upsert({
        where: { planillaId_fecha: { planillaId, fecha: day } },
        update: {
          bloqueado: true,
          motivoBloqueo: aus.tipo,
          observaciones: `${tipoLabel}${aus.descripcion ? ` — ${aus.descripcion}` : ''}`,
          horasTrabajadas: ZERO,
          horasNormales: ZERO,
          horasExtra50: ZERO,
          horasExtra100: ZERO,
          horasViajeCalc: ZERO,
          lugarTrabajo: null,
          entradaTurno1: null,
          salidaTurno1: null,
          entradaTurno2: null,
          salidaTurno2: null,
        },
        create: {
          planillaId,
          fecha: day,
          bloqueado: true,
          motivoBloqueo: aus.tipo,
          observaciones: `${tipoLabel}${aus.descripcion ? ` — ${aus.descripcion}` : ''}`,
          horasTrabajadas: ZERO,
          horasNormales: ZERO,
          horasExtra50: ZERO,
          horasExtra100: ZERO,
          horasViajeCalc: ZERO,
          horasViajeInput: ZERO,
        },
      });
    }
  }

  for (const vac of vacaciones) {
    const days = buildDaysBetween(
      clampDia(vac.fechaInicio, periodoInicio),
      clampDia(vac.fechaFin, periodoFin, true),
    );

    for (const day of days) {
      await prisma.registroHoras.upsert({
        where: { planillaId_fecha: { planillaId, fecha: day } },
        update: {
          bloqueado: true,
          motivoBloqueo: 'VACACION',
          observaciones: `Vacaciones${vac.motivo ? ` — ${vac.motivo}` : ''}`,
          horasTrabajadas: ZERO,
          horasNormales: ZERO,
          horasExtra50: ZERO,
          horasExtra100: ZERO,
          horasViajeCalc: ZERO,
          lugarTrabajo: null,
          entradaTurno1: null,
          salidaTurno1: null,
          entradaTurno2: null,
          salidaTurno2: null,
        },
        create: {
          planillaId,
          fecha: day,
          bloqueado: true,
          motivoBloqueo: 'VACACION',
          observaciones: `Vacaciones${vac.motivo ? ` — ${vac.motivo}` : ''}`,
          horasTrabajadas: ZERO,
          horasNormales: ZERO,
          horasExtra50: ZERO,
          horasExtra100: ZERO,
          horasViajeCalc: ZERO,
          horasViajeInput: ZERO,
        },
      });
    }
  }
}

// ─── Helpers ─────────────────────────────────────

/**
 * Días calendario entre dos fechas, inclusive. Normaliza las puntas: da lo mismo
 * si vienen a medianoche UTC, a medianoche argentina o con la hora de la
 * aprobación. El piso de cada punta es el día calendario ARGENTINO (vía
 * `diaDesdeEntrada`), no el día UTC — importa en la ventana `(00:00Z, 03:00Z)`,
 * donde discrepan.
 *
 * Política de errores: lanza `RangeError` ante un `Date`/string inválido (la
 * misma política que el resto de los helpers puros de `fecha-dia.utils.ts`; ver
 * `spanDiasCalendario` en zod.utils.ts para el contrario, que existe porque a
 * ESA función la consume un `refine` de zod).
 *
 * Exportada para poder testearla sin base de datos.
 */
export function buildDaysBetween(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const cur = diaDesdeEntrada(start);
  const last = diaDesdeEntrada(end);
  while (cur <= last) {
    days.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

/**
 * Recorta un día contra un borde del período, comparando por día calendario
 * ARGENTINO (vía `diaDesdeEntrada`, igual que `buildDaysBetween`).
 *
 * Antes comparaba timestamps: con el período guardado a las 03:00Z y el día a
 * las 00:00Z, el primer día del período quedaba afuera.
 */
export function clampDia(dia: Date, borde: Date, esTecho = false): Date {
  const d = diaDesdeEntrada(dia);
  const b = diaDesdeEntrada(borde);
  if (esTecho) return d > b ? b : d;
  return d < b ? b : d;
}

export function formatTipoAusencia(tipo: string): string {
  const map: Record<string, string> = {
    CERTIFICADO_MEDICO: 'Certificado médico',
    FALTA_JUSTIFICADA: 'Falta justificada',
    FALTA_INJUSTIFICADA: 'Falta injustificada',
    LICENCIA_ESPECIAL: 'Licencia especial',
    FRANCO_COMPENSATORIO: 'Franco compensatorio',
  };
  return map[tipo] ?? tipo;
}
