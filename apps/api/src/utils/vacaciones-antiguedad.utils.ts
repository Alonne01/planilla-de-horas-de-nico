/**
 * Días de vacaciones que corresponden por antigüedad — LCT art. 150.
 *
 * Autoridad única del cálculo. Antes estaba duplicado textualmente en
 * `vacacion-saldos.routes.ts` y `vacaciones.routes.ts`, con cinco call sites
 * entre los dos: dos copias de una cuenta con efecto legal es exactamente donde
 * un arreglo parcial se convierte en un problema peor que el bug original.
 */

import { diaDesdeEntrada } from './fecha-dia.utils.js';

/**
 * Años de antigüedad cumplidos AL 31 DE DICIEMBRE del año de las vacaciones,
 * que es el momento en que la LCT manda medirla (art. 150, último párrafo:
 * "la antigüedad se computará al 31 de diciembre del año al que correspondan
 * las vacaciones").
 *
 * Medida en ese momento, la cuenta es la resta de los años a secas: el
 * aniversario de cualquier fecha de ingreso cae siempre en o antes del 31 de
 * diciembre del mismo año, así que a esa altura el año ya está cumplido. La
 * implementación anterior arrastraba un `if (alDic31 < aniv) anios--` que por
 * eso mismo NO PODÍA dispararse nunca — código muerto que además hacía parecer
 * intencional la lectura de `getMonth()`/`getDate()` que causaba el bug.
 *
 * `fechaIngreso` es una FECHA-DÍA. Se normaliza con `diaDesdeEntrada` y se lee
 * con getters UTC, nunca locales: el proceso corre con
 * TZ=America/Argentina/Buenos_Aires (Dockerfile:45) y una medianoche UTC leída
 * en local es el día anterior. Ése era el bug: un ingreso del 1 de enero se
 * leía como el 31 de diciembre del año anterior, sumaba un año de antigüedad
 * inexistente y en cada límite de la escala regalaba 7 días.
 *
 * Piso en 0: el alta de usuarios acepta fechas de ingreso futuras, y una
 * antigüedad negativa se saldría de la escala por abajo.
 */
export function aniosAntiguedadAlCierre(fechaIngreso: Date, anio: number): number {
  const anioIngreso = diaDesdeEntrada(fechaIngreso).getUTCFullYear();
  return Math.max(0, anio - anioIngreso);
}

/**
 * Días corridos de vacaciones según la antigüedad, escala del art. 150 LCT.
 *
 * Los tramos son CERRADOS ARRIBA, tal como los redacta la ley ("cuando la
 * antigüedad no exceda de cinco años"): 5 años exactos son 14 días, no 21. Cada
 * escalón vale 7 días, así que confundir el `<=` con un `<` cuesta una semana
 * por persona y por año.
 *
 * La escala está acá y no en `vacaciones_config.reglasAntiguedad`: esa columna
 * existe en el schema pero no la escribe ni la lee nadie salvo el seed (no hay
 * endpoint ni pantalla para editarla), así que atarle el cálculo sería moverlo
 * a un dato que nadie puede mantener.
 */
export function diasPorAntiguedad(fechaIngreso: Date, anio: number): number {
  const anios = aniosAntiguedadAlCierre(fechaIngreso, anio);
  if (anios <= 5) return 14;   // no excede de 5
  if (anios <= 10) return 21;  // mayor de 5, no excede de 10
  if (anios <= 20) return 28;  // mayor de 10, no excede de 20
  return 35;                   // excede de 20
}
