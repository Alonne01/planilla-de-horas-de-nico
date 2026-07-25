import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import {
  getCurrentPeriod,
  DIA_INICIO_POR_DEFECTO,
  DIA_FIN_POR_DEFECTO,
} from '@/utils/periodos';

export interface Periodo {
  inicio: string;
  fin: string;
}

/**
 * Mensaje único para las 5 pantallas que muestran el aviso de "estoy usando
 * los valores por defecto". Vive acá (y no repetido en cada pantalla) para
 * que no queden textos desincronizados si el día de inicio/fin por defecto
 * cambia alguna vez.
 */
export const AVISO_PERIODO_POR_DEFECTO =
  `No se pudo leer la configuración de períodos, se están usando valores por defecto (${DIA_INICIO_POR_DEFECTO} al ${DIA_FIN_POR_DEFECTO}).`;

/**
 * Días de inicio y fin del ciclo de planilla, según la configuración de la
 * empresa. Cacheado 5 minutos: cambia muy de vez en cuando y lo consultan
 * cinco pantallas.
 *
 * `listo` se pone en `true` cuando la query TERMINA, ya sea con éxito o con
 * error — no cuando hay `data`. Antes se calculaba como `!!data`, así que si
 * `GET /config/periodo` fallaba (404 sin fila en `empresa_config`, 500, etc.)
 * `listo` nunca pasaba a `true` y las 5 pantallas que hacen
 * `if (!listo) return <spinner>` quedaban con un spinner eterno, dejando
 * inalcanzable el fallback a los defaults de más abajo. Usamos `isPending`
 * (v5 de react-query): es `true` solo mientras no hay data Y todavía no
 * terminaron los reintentos; se pone en `false` apenas hay data o apenas el
 * status pasa a `error` (reintentos agotados), que es exactamente "la query
 * terminó" con éxito o con error.
 */
export function usePeriodoConfig() {
  const { data, error, isPending } = useQuery({
    queryKey: ['config', 'periodo'],
    queryFn: async () => {
      const { data } = await api.get('/config/periodo');
      return data as { periodoDiaInicio: number; periodoDiaFin: number };
    },
    staleTime: 5 * 60 * 1000,
  });

  const listo = !isPending;
  // Si la query terminó pero no hay `data`, terminó en error: estamos
  // sirviendo los defaults, no lo que configuró la empresa.
  const usandoValoresPorDefecto = listo && !data;

  return {
    diaInicio: data?.periodoDiaInicio ?? DIA_INICIO_POR_DEFECTO,
    diaFin: data?.periodoDiaFin ?? DIA_FIN_POR_DEFECTO,
    listo,
    usandoValoresPorDefecto,
    error,
  };
}

/**
 * Período seleccionado en una pantalla. Arranca en `null` a propósito: si
 * devolviera un período calculado con los defaults, la primera query saldría
 * con las fechas equivocadas antes de que llegue la configuración.
 *
 * `periodo` es derivado, no efecto: mientras el usuario no eligió un período a
 * mano (`override`), se calcula a partir de los días de ciclo ya resueltos.
 * Así evita el patrón "setState dentro de useEffect" (que dispara un render
 * en cascada) y de paso reacciona sola si la config tarda en llegar.
 *
 * El cálculo está memoizado a propósito: `getCurrentPeriod` construye un
 * objeto nuevo cada vez que se lo invoca, y sin `useMemo` `periodo` cambiaría
 * de identidad en cada render aunque los valores sean iguales. Las 5 páginas
 * consumidoras usan `periodo` en arrays de dependencias de sus propios
 * `useEffect`/`useMemo`: una identidad inestable ahí es un bucle de renders.
 * No lo "simplifiques" quitando el `useMemo`.
 *
 * Las pantallas deben gatear su query con `enabled: !!periodo`.
 *
 * Si `listo` se puso en `true` porque la query de config terminó en error,
 * `diaInicio`/`diaFin` ya vienen con los defaults (ver `usePeriodoConfig`), así
 * que `getCurrentPeriod` calcula el período de siempre pero con esas fechas:
 * fechas equivocadas y visibles en pantalla en vez de un spinner eterno.
 */
export function usePeriodoActual() {
  const { diaInicio, diaFin, listo, usandoValoresPorDefecto } = usePeriodoConfig();
  const [override, setOverride] = useState<Periodo | null>(null);

  const calculado = useMemo(
    () => (listo ? getCurrentPeriod(diaInicio, diaFin) : null),
    [listo, diaInicio, diaFin],
  );

  const periodo = override ?? calculado;

  return { periodo, setPeriodo: setOverride, listo, usandoValoresPorDefecto };
}
