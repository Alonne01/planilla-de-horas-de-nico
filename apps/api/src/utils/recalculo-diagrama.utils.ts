import { PrismaClient, Prisma } from '@prisma/client';
import { calcularConContexto, getEmpresaConfig, recalcularTotalesPlanilla } from './calculo.utils.js';
import { diaDesdeEntrada } from './fecha-dia.utils.js';

const prisma = new PrismaClient();

/** Planillas que todavía se pueden tocar: las demás ya se firmaron. */
const EDITABLES = ['BORRADOR', 'RECHAZADA'];

export type ResultadoRecalculo = {
  /** Días recalculados en planillas editables. */
  diasRecalculados: number;
  /**
   * Planillas ya enviadas/aprobadas/cerradas con días afectados: no se tocan,
   * se informan para que RRHH decida.
   */
  planillasCongeladas: Array<{
    planillaId: string;
    estado: string;
    periodoInicio: Date;
    periodoFin: Date;
    dias: number;
  }>;
};

/**
 * Recalcula los días del usuario desde `desde` en adelante, porque el diagrama
 * que rige esos días cambió y con él el franco —y el recargo del 100% de un
 * franco trabajado—.
 *
 * Sólo toca planillas en BORRADOR o RECHAZADA: las enviadas, aprobadas o
 * cerradas ya se firmaron con esos números y corregirlas por atrás sería peor
 * que informarlas.
 */
export async function recalcularDesde(
  usuarioId: string,
  empresaId: string,
  desde: Date,
): Promise<ResultadoRecalculo> {
  // `RegistroHoras.fecha` siempre se guarda a medianoche UTC del día calendario
  // (misma convención que claveFecha en contexto-dia.utils.ts), pero `desde`
  // puede llegar con hora: los llamadores le pasan `fechaEfectiva` (fecha-día) o
  // un valor de la base que, hasta que corra la migración, puede seguir en
  // `03:00Z`/`15:00Z`. Comparando el Date crudo, "fecha >= desde" da false para
  // el registro de ESE MISMO día (medianoche < la hora guardada), aunque
  // `tramoDelDia` ya considere que el diagrama nuevo rige ese día por clave de
  // día: el día del cambio quedaría afuera del recálculo en silencio. Se
  // normaliza acá adentro (no en el llamador) para que la función sea robusta
  // sin importar qué hora traiga el Date que le pasen.
  //
  // `diaDesdeEntrada` y no los getters UTC a mano: para un instante real de las
  // últimas 3 h del día argentino, el día UTC ya es el siguiente.
  const desdeDia = diaDesdeEntrada(desde);

  const planillas = await prisma.planilla.findMany({
    where: { usuarioId, periodoFin: { gte: desdeDia } },
    select: { id: true, estado: true, periodoInicio: true, periodoFin: true },
  });

  const config = await getEmpresaConfig(empresaId);
  let diasRecalculados = 0;
  const planillasCongeladas: ResultadoRecalculo['planillasCongeladas'] = [];

  for (const p of planillas) {
    const registros = await prisma.registroHoras.findMany({
      where: { planillaId: p.id, fecha: { gte: desdeDia }, bloqueado: false },
    });
    if (registros.length === 0) continue;

    if (!EDITABLES.includes(p.estado)) {
      planillasCongeladas.push({
        planillaId: p.id,
        estado: p.estado,
        periodoInicio: p.periodoInicio,
        periodoFin: p.periodoFin,
        dias: registros.length,
      });
      continue;
    }

    for (const r of registros) {
      // calcularConContexto espera los horarios como string (así llegan del body
      // en el POST/PUT de un registro): se convierten desde los Date que trae
      // Prisma en vez de tocar la firma de la función para este único llamador.
      const { calculo, esFeriado, esFrancoTrabajado } = await calcularConContexto(
        {
          entradaTurno1: r.entradaTurno1?.toISOString() ?? null,
          salidaTurno1: r.salidaTurno1?.toISOString() ?? null,
          entradaTurno2: r.entradaTurno2?.toISOString() ?? null,
          salidaTurno2: r.salidaTurno2?.toISOString() ?? null,
          lugarTrabajo: r.lugarTrabajo,
          esFrancoCompensatorio: r.esFrancoCompensatorio,
          horasViajeInput: Number(r.horasViajeInput),
          maneja: r.maneja,
        },
        r.fecha,
        usuarioId,
        empresaId,
        config,
      );

      await prisma.registroHoras.update({
        where: { id: r.id },
        data: {
          esFeriado,
          esFrancoTrabajado,
          horasTrabajadas: new Prisma.Decimal(calculo.horasTrabajadas),
          horasNormales: new Prisma.Decimal(calculo.horasNormales),
          horasExtra50: new Prisma.Decimal(calculo.horasExtra50),
          horasExtra100: new Prisma.Decimal(calculo.horasExtra100),
          horasViajeCalc: new Prisma.Decimal(calculo.horasViajeCalc),
        },
      });
      diasRecalculados++;
    }

    await recalcularTotalesPlanilla(p.id);
  }

  return { diasRecalculados, planillasCongeladas };
}
