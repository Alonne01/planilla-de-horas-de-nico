import { PrismaClient, LugarTrabajo } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();

interface CalculoInput {
  entradaTurno1: Date | null;
  salidaTurno1: Date | null;
  entradaTurno2: Date | null;
  salidaTurno2: Date | null;
  lugarTrabajo: LugarTrabajo | null;
  esFeriado: boolean;
  esFrancoTrabajado: boolean;
  horasViajeInput: number;
  maneja: boolean;
}

interface EmpresaConfigCalc {
  horasJornadaNormal: number;
  umbralExtra50: number;
  umbralExtra100: number;
  redondeoMinutos: number;
  descuentoAlmuerzoBase: boolean;
  descuentoAlmuerzoCampo: boolean;
}

interface CalculoResult {
  horasTrabajadas: number;
  horasNormales: number;
  horasExtra50: number;
  horasExtra100: number;
  horasViajeCalc: number;
}

function roundToNearest(minutes: number, roundTo: number): number {
  return Math.round(minutes / roundTo) * roundTo;
}

function diffMinutes(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / (1000 * 60);
}

export function calcularHorasRegistro(
  input: CalculoInput,
  config: EmpresaConfigCalc
): CalculoResult {
  let totalMinutos = 0;

  // Turno 1
  if (input.entradaTurno1 && input.salidaTurno1) {
    let mins = diffMinutes(input.entradaTurno1, input.salidaTurno1);
    if (mins < 0) mins += 24 * 60; // Cruza medianoche
    mins = roundToNearest(mins, config.redondeoMinutos);
    totalMinutos += mins;
  }

  // Turno 2
  if (input.entradaTurno2 && input.salidaTurno2) {
    let mins = diffMinutes(input.entradaTurno2, input.salidaTurno2);
    if (mins < 0) mins += 24 * 60;
    mins = roundToNearest(mins, config.redondeoMinutos);
    totalMinutos += mins;
  }

  // Descuento almuerzo (1 hora)
  const lugar = input.lugarTrabajo ?? 'BASE';
  if (
    (lugar === 'BASE' && config.descuentoAlmuerzoBase) ||
    (lugar === 'CAMPO' && config.descuentoAlmuerzoCampo)
  ) {
    if (totalMinutos > config.horasJornadaNormal * 60) {
      totalMinutos -= 60; // Descuenta 1 hora de almuerzo
    }
  }

  if (totalMinutos < 0) totalMinutos = 0;

  const horasTrabajadas = totalMinutos / 60;

  // Clasificación de horas
  let horasNormales = 0;
  let horasExtra50 = 0;
  let horasExtra100 = 0;

  if (input.esFeriado || input.esFrancoTrabajado) {
    // Feriado o franco trabajado: todas al 100%
    horasExtra100 = horasTrabajadas;
  } else {
    // Distribución normal
    if (horasTrabajadas <= config.umbralExtra50) {
      horasNormales = horasTrabajadas;
    } else if (horasTrabajadas <= config.umbralExtra100) {
      horasNormales = config.umbralExtra50;
      horasExtra50 = horasTrabajadas - config.umbralExtra50;
    } else {
      horasNormales = config.umbralExtra50;
      horasExtra50 = config.umbralExtra100 - config.umbralExtra50;
      horasExtra100 = horasTrabajadas - config.umbralExtra100;
    }
  }

  // Horas de viaje
  let horasViajeCalc = 0;
  if (lugar === 'CAMPO' && input.maneja && input.horasViajeInput > 0) {
    horasViajeCalc = input.horasViajeInput;
  }

  return {
    horasTrabajadas: Math.round(horasTrabajadas * 100) / 100,
    horasNormales: Math.round(horasNormales * 100) / 100,
    horasExtra50: Math.round(horasExtra50 * 100) / 100,
    horasExtra100: Math.round(horasExtra100 * 100) / 100,
    horasViajeCalc: Math.round(horasViajeCalc * 100) / 100,
  };
}

export async function getEmpresaConfig(empresaId: string): Promise<EmpresaConfigCalc> {
  const config = await prisma.empresaConfig.findUnique({
    where: { empresaId },
  });

  return {
    horasJornadaNormal: config?.horasJornadaNormal ?? 8,
    umbralExtra50: config?.umbralExtra50 ?? 8,
    umbralExtra100: config?.umbralExtra100 ?? 12,
    redondeoMinutos: config?.redondeoMinutos ?? 15,
    descuentoAlmuerzoBase: config?.descuentoAlmuerzoBase ?? true,
    descuentoAlmuerzoCampo: config?.descuentoAlmuerzoCampo ?? false,
  };
}

export async function recalcularTotalesPlanilla(planillaId: string): Promise<void> {
  const registros = await prisma.registroHoras.findMany({
    where: { planillaId },
  });

  let totalHorasNormales = 0;
  let totalHorasExtra50 = 0;
  let totalHorasExtra100 = 0;
  let totalHorasViaje = 0;
  let totalDiasCampo = 0;
  let totalDiasBase = 0;

  for (const r of registros) {
    totalHorasNormales += Number(r.horasNormales);
    totalHorasExtra50 += Number(r.horasExtra50);
    totalHorasExtra100 += Number(r.horasExtra100);
    totalHorasViaje += Number(r.horasViajeCalc);
    if (r.lugarTrabajo === 'CAMPO') totalDiasCampo++;
    if (r.lugarTrabajo === 'BASE') totalDiasBase++;
  }

  await prisma.planilla.update({
    where: { id: planillaId },
    data: {
      totalHorasNormales: new Decimal(totalHorasNormales.toFixed(2)),
      totalHorasExtra50: new Decimal(totalHorasExtra50.toFixed(2)),
      totalHorasExtra100: new Decimal(totalHorasExtra100.toFixed(2)),
      totalHorasViaje: new Decimal(totalHorasViaje.toFixed(2)),
      totalDiasCampo,
      totalDiasBase,
    },
  });
}

export function getPeriodoActual(diaInicio: number, diaFin: number): { inicio: Date; fin: Date } {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mes = hoy.getMonth(); // 0-indexed

  let inicio: Date;
  let fin: Date;

  if (hoy.getDate() >= diaInicio) {
    // Estamos en la segunda mitad del período
    inicio = new Date(anio, mes, diaInicio);
    // Fin es el diaFin del MES SIGUIENTE
    const nextMonth = mes + 1;
    fin = new Date(anio, nextMonth, diaFin);
  } else {
    // Estamos en la primera mitad del período
    const prevMonth = mes - 1;
    inicio = new Date(anio, prevMonth, diaInicio);
    fin = new Date(anio, mes, diaFin);
  }

  return { inicio, fin };
}
