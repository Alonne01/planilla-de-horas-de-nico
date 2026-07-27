/**
 * Utility to inject locked (bloqueado) RegistroHoras entries when an
 * absence or vacation is approved. Also used when a new planilla is
 * created to back-fill any previously-approved absences/vacations.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { claveFecha, diaDesdeEntrada, dentroDelRango, fmtFechaDia, rangoConsultaDia } from './fecha-dia.utils.js';
import { recalcularTotalesPlanilla } from './calculo.utils.js';
import { crearNotificacion } from './notificacion.utils.js';

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

/** Estados en los que la planilla todavía se puede tocar. */
const ESTADOS_EDITABLES = ['BORRADOR', 'RECHAZADA'];

export interface ResultadoInyeccion {
  /** Claves 'YYYY-MM-DD' que quedaron bloqueadas. */
  aplicados: string[];
  /** Días que tenían horas cargadas y fueron reemplazados. */
  pisados: string[];
  /** Días que NO se aplicaron porque la planilla ya salió del borrador. */
  omitidos: Array<{ dia: string; planillaId: string; estado: string }>;
}

/** Un resultado vacío, para los llamadores que no llegaron a inyectar nada. */
export function resultadoInyeccionVacio(): ResultadoInyeccion {
  return { aplicados: [], pisados: [], omitidos: [] };
}

/**
 * Materializa un rango de ausencia/vacación como días bloqueados.
 *
 * Si la planilla del día es editable (BORRADOR/RECHAZADA), el bloqueo **pisa** lo
 * que hubiera cargado. Si ya está ENVIADA/EN_REVISION/APROBADA no se toca nada:
 * un documento firmado no se modifica por atrás. El llamador avisa con la lista
 * de `omitidos` para que se rechace y reenvíe.
 *
 * Los días sin planilla se saltean: los repone `backfillAusenciasEnPlanilla`
 * cuando la planilla se cree. Es también lo que hace que el escenario de "borro
 * la planilla y la creo de nuevo" reponga los días ya aprobados.
 */
export async function inyectarDiasBloqueados(range: AusenciaRange): Promise<ResultadoInyeccion> {
  const days = buildDaysBetween(range.fechaInicio, range.fechaFin);
  const resultado = resultadoInyeccionVacio();

  // Find all planillas that overlap the range for this user
  const { desde: desdeDia, hasta: hastaDia } = rangoConsultaDia(range.fechaInicio, range.fechaFin);
  const planillas = await prisma.planilla.findMany({
    where: {
      usuarioId: range.usuarioId,
      periodoInicio: { lte: hastaDia },
      periodoFin: { gte: desdeDia },
    },
    select: { id: true, periodoInicio: true, periodoFin: true, estado: true },
  });

  const planillasTocadas = new Set<string>();

  for (const day of days) {
    const planilla = planillas.find(
      (p) => dentroDelRango(day, p.periodoInicio, p.periodoFin)
    );
    if (!planilla) continue;

    if (!ESTADOS_EDITABLES.includes(planilla.estado)) {
      resultado.omitidos.push({ dia: claveFecha(day), planillaId: planilla.id, estado: planilla.estado });
      continue;
    }

    // Se lee ANTES del upsert: después ya está en cero y no hay forma de saber si
    // había algo que reemplazar. Un día ya bloqueado no cuenta como pisado —
    // reescribir un bloqueo con otro no le borra horas a nadie.
    const previo = await prisma.registroHoras.findUnique({
      where: { planillaId_fecha: { planillaId: planilla.id, fecha: day } },
      select: { entradaTurno1: true, horasTrabajadas: true, bloqueado: true },
    });
    const teniaHoras = !!previo && !previo.bloqueado
      && (!!previo.entradaTurno1 || Number(previo.horasTrabajadas) > 0);

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

    resultado.aplicados.push(claveFecha(day));
    if (teniaHoras) resultado.pisados.push(claveFecha(day));
    planillasTocadas.add(planilla.id);
  }

  // Los totales de la cabecera se recalculan una vez por planilla tocada: pisar
  // horas cargadas las cambia, y sin esto la planilla sigue sumando horas que ya
  // no están en ningún registro.
  for (const planillaId of planillasTocadas) {
    await recalcularTotalesPlanilla(planillaId);
  }

  return resultado;
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

/**
 * Los días de un `ResultadoInyeccion` como los lee una persona (D/M/YYYY).
 *
 * Las claves vienen de `claveFecha`, así que el round-trip por `diaDesdeEntrada`
 * es exacto; se pasa por ahí y no por `new Date(clave)` para no depender del
 * parseo implícito.
 */
function listaDias(claves: string[]): string {
  return claves.map((c) => fmtFechaDia(diaDesdeEntrada(c))).join(', ');
}

/**
 * Traduce el resultado de la inyección en notificaciones para el dueño de la
 * planilla y para quien aprobó. Sin esto, el operador se entera de que le
 * borraron las horas (o de que la ausencia no se aplicó) sólo si mira.
 *
 * `aprobadorId` en null apaga la copia para quien aprobó. Lo usa el cierre de una
 * sesión de capacitación, que bloquea el día de cada asistente dentro de un
 * bucle: avisarle ahí adentro le mandaría al organizador una notificación por
 * asistente, así que arma una sola agregada al final. Si el aprobador ES el
 * dueño (por ejemplo, quien carga un certificado médico propio) la copia también
 * se saltea: son dos notificaciones idénticas para la misma persona.
 *
 * OJO: descartar la copia al aprobador NO silencia el aviso al dueño, que es el
 * de `pisados`. `POST /planillas/:id/marcar-dia` no llama a este helper por eso
 * mismo — ahí el dueño es el actor y el dato le llega en la respuesta HTTP; ver
 * el comentario en planillas.routes.ts.
 */
export async function avisarResultadoInyeccion(params: {
  resultado: ResultadoInyeccion;
  usuarioId: string;
  aprobadorId: string | null;
  etiqueta: string;
}): Promise<void> {
  const { resultado, usuarioId, aprobadorId, etiqueta } = params;

  if (resultado.pisados.length > 0) {
    await crearNotificacion({
      usuarioId,
      tipo: 'PLANILLA',
      titulo: 'Se reemplazaron horas cargadas',
      cuerpo: `${etiqueta}: se aprobó y los días ${listaDias(resultado.pisados)} quedaron bloqueados. Las horas que tenías cargadas ahí se reemplazaron.`,
      link: '/planillas',
    });
  }

  if (resultado.omitidos.length > 0) {
    const dias = listaDias(resultado.omitidos.map((o) => o.dia));
    const estado = resultado.omitidos[0]!.estado;
    const cuerpo = `${etiqueta}: se aprobó, pero la planilla del período ya está ${estado} y no se modificó. Para que los días ${dias} queden bloqueados hay que rechazarla y reenviarla.`;
    await crearNotificacion({
      usuarioId, tipo: 'PLANILLA', titulo: 'La ausencia aprobada no se aplicó a la planilla', cuerpo, link: '/planillas',
    });
    if (aprobadorId && aprobadorId !== usuarioId) {
      await crearNotificacion({
        usuarioId: aprobadorId, tipo: 'PLANILLA', titulo: 'Ausencia aprobada sin aplicar a la planilla', cuerpo, link: '/aprobaciones',
      });
    }
  }
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
