/**
 * La ventana de meses del calendario de equipo.
 *
 * Antes todo el calendario estaba expresado en DÍA-DEL-AÑO: `monthOffsets(anio)`,
 * `blockDoyRange(..., year, ...)`, un `Int16Array(366)`. Con ese eje, mirar
 * noviembre y los dos meses siguientes era imposible: enero pertenece a otro año
 * y el eje no lo podía ni nombrar.
 *
 * Acá el eje es una lista CONTIGUA de meses `{anio, mes}` —de 1, 3 o 12— y el
 * índice de un día es su posición dentro de esa lista. El modo "año" pasa a ser
 * `ventanaAnual(anio)`, o sea el mismo cálculo de siempre con otro nombre: por
 * eso la vista anual no cambia de comportamiento.
 *
 * Las fechas que entran son FECHAS-DÍA serializadas por el backend y se leen por
 * componentes con `ymd`. Nunca se construye un `Date` con el ISO: bajo cualquier
 * huso negativo eso corre el día hacia atrás (ver `utils/fechaDia.ts`).
 *
 * El import de abajo es RELATIVO y no `@/utils/fechaDia` a propósito: este módulo
 * tiene un test que corre con tsx, y tsx lee `tsconfig.json`, que acá es un
 * archivo de referencias con `files: []`. Los `paths` del alias viven en
 * `tsconfig.app.json`, que sólo mira Vite. Con el alias, el test no resuelve.
 */
import { ymd } from '../../utils/fechaDia';

export interface MesVentana {
  anio: number;
  /** 1-12, NO el `getMonth()` 0-based de Date. */
  mes: number;
}

export interface Ventana {
  meses: MesVentana[];
  /** Índice del primer día de cada mes de `meses`. */
  offset: number[];
  totalDias: number;
}

/** Días de un mes 1-12. Sólo cuenta días, así que el huso no interviene. */
export function diasDelMes(anio: number, mes: number): number {
  return new Date(anio, mes, 0).getDate();
}

/**
 * Clave ordenable de un mes.
 *
 * Comparar (año, mes) como un solo número evita el error de comparar el mes
 * suelto: marzo de 2025 no está en una ventana de marzo de 2026, aunque el
 * número de mes coincida.
 */
function claveMes(anio: number, mes: number): number {
  return anio * 12 + (mes - 1);
}

export function ventanaDeMeses(anioAncla: number, mesAncla: number, cantidad: number): Ventana {
  const meses: MesVentana[] = [];
  let anio = anioAncla;
  let mes = mesAncla;
  for (let i = 0; i < cantidad; i++) {
    meses.push({ anio, mes });
    mes += 1;
    if (mes > 12) { mes = 1; anio += 1; }
  }
  const offset: number[] = [];
  let acc = 0;
  for (const m of meses) {
    offset.push(acc);
    acc += diasDelMes(m.anio, m.mes);
  }
  return { meses, offset, totalDias: acc };
}

export function ventanaAnual(anio: number): Ventana {
  return ventanaDeMeses(anio, 1, 12);
}

/** Los años distintos que toca la ventana: uno, o dos si cruza diciembre. */
export function aniosDeVentana(v: Ventana): number[] {
  return [...new Set(v.meses.map((m) => m.anio))];
}

/** Índice del día dentro de la ventana, o `null` si ese mes no está en ella. */
export function indiceDeDia(anio: number, mes: number, dia: number, v: Ventana): number | null {
  const i = v.meses.findIndex((m) => m.anio === anio && m.mes === mes);
  if (i === -1) return null;
  return v.offset[i]! + (dia - 1);
}

/**
 * Como `indiceDeDia`, pero un día fuera de la ventana se pega a la punta más
 * cercana en vez de desaparecer. Es lo que necesita el marcador de "hoy": tiene
 * que poder dibujarse aunque se esté mirando otro mes.
 *
 * Para "hoy" hay que pasarle `hoyKey()`, no `new Date().toISOString()`: lo
 * segundo devuelve el día UTC, que entre las 21:00 y las 24:00 en Argentina ya es
 * mañana.
 */
export function indiceDeDiaAcotado(iso: string, v: Ventana): number {
  const [y, m, d] = ymd(iso);
  const clave = claveMes(y, m);
  const primero = v.meses[0]!;
  const ultimo = v.meses[v.meses.length - 1]!;
  if (clave < claveMes(primero.anio, primero.mes)) return 0;
  if (clave > claveMes(ultimo.anio, ultimo.mes)) return v.totalDias - 1;
  return Math.min(indiceDeDia(y, m, d, v)!, v.totalDias - 1);
}

/**
 * Rango `[desde, hasta]` de un bloque dentro de la ventana, recortado a sus
 * puntas. `null` si el bloque no la toca en ningún día.
 */
export function rangoEnVentana(fechaInicio: string, fechaFin: string, v: Ventana): [number, number] | null {
  const [y1, m1, d1] = ymd(fechaInicio);
  const [y2, m2, d2] = ymd(fechaFin);
  const primero = v.meses[0]!;
  const ultimo = v.meses[v.meses.length - 1]!;
  const desdeVentana = claveMes(primero.anio, primero.mes);
  const hastaVentana = claveMes(ultimo.anio, ultimo.mes);
  const inicio = claveMes(y1, m1);
  const fin = claveMes(y2, m2);
  if (inicio > hastaVentana || fin < desdeVentana) return null;
  const desde = inicio < desdeVentana ? 0 : indiceDeDia(y1, m1, d1, v)!;
  const hasta = fin > hastaVentana ? v.totalDias - 1 : indiceDeDia(y2, m2, d2, v)!;
  return [Math.max(0, desde), Math.min(v.totalDias - 1, hasta)];
}
