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
 * Días de inicio y fin del ciclo de planilla, según la configuración de la
 * empresa. Cacheado 5 minutos: cambia muy de vez en cuando y lo consultan
 * cinco pantallas.
 */
export function usePeriodoConfig() {
  const { data } = useQuery({
    queryKey: ['config', 'periodo'],
    queryFn: async () => {
      const { data } = await api.get('/config/periodo');
      return data as { periodoDiaInicio: number; periodoDiaFin: number };
    },
    staleTime: 5 * 60 * 1000,
  });

  return {
    diaInicio: data?.periodoDiaInicio ?? DIA_INICIO_POR_DEFECTO,
    diaFin: data?.periodoDiaFin ?? DIA_FIN_POR_DEFECTO,
    listo: !!data,
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
 */
export function usePeriodoActual() {
  const { diaInicio, diaFin, listo } = usePeriodoConfig();
  const [override, setOverride] = useState<Periodo | null>(null);

  const calculado = useMemo(
    () => (listo ? getCurrentPeriod(diaInicio, diaFin) : null),
    [listo, diaInicio, diaFin],
  );

  const periodo = override ?? calculado;

  return { periodo, setPeriodo: setOverride, listo };
}
