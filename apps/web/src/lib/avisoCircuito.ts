import { toast } from '@/stores/toastStore';

/**
 * El back devuelve `avisoSinCircuito` cuando un documento se envía y su sector no
 * tiene circuito configurado: queda esperando una aprobación MANUAL de RRHH o
 * superior, no aparece en la bandeja de nadie más.
 *
 * Es algo que el usuario tiene que saber al enviar y no cuando nota que nadie se
 * lo aprueba, así que las cuatro pantallas que envían (planilla, vacación,
 * ausencia, cambio de diagrama) lo muestran igual desde acá.
 *
 * El texto lo escribe el servidor —cambia según el tipo de documento— y acá solo
 * se presenta. Variante `default` a propósito: el envío SÍ funcionó, y en rojo se
 * leería como un error.
 */
export function avisarSinCircuito(data: unknown): void {
  const aviso = (data as { avisoSinCircuito?: string } | null | undefined)?.avisoSinCircuito;
  if (!aviso) return;
  toast({
    title: 'Sin circuito de aprobación',
    description: aviso,
    // Más que el default de 4 s: es un párrafo, y perderlo implica no enterarse.
    duration: 10000,
  });
}
