import crypto from 'crypto';

/**
 * Modo debug de autenticación: saltea la comparación de contraseña y habilita
 * /auth/debug-users (la nómina completa) para poder probar cada rol sin conocer
 * las claves reales.
 *
 * Está pensado para el testing remoto por túnel, así que no puede quedar abierto
 * a cualquiera que descubra la URL. Se exige una clave compartida:
 *
 *   DEBUG_AUTH=true
 *   DEBUG_AUTH_PASSWORD=<la clave que usa el equipo de testing>
 *
 * Sin DEBUG_AUTH_PASSWORD el modo NO se activa: es preferible que el testing
 * falle ruidosamente a dejar la nómina publicada por un .env incompleto.
 *
 * En producción es inerte por construcción (NODE_ENV === 'production'), sin
 * depender de que nadie se acuerde de bajar la variable en el deploy.
 */
const PEDIDO = process.env.DEBUG_AUTH === 'true';
const EN_PRODUCCION = process.env.NODE_ENV === 'production';
const CLAVE = (process.env.DEBUG_AUTH_PASSWORD ?? '').trim();

export const DEBUG_AUTH = PEDIDO && !EN_PRODUCCION && CLAVE.length > 0;

/** Comparación en tiempo constante: la clave no se filtra por cuánto tarda el no. */
function igualSinFiltrarTiempo(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual exige el mismo largo; se compara el hash para no revelarlo.
  const hashA = crypto.createHash('sha256').update(bufA).digest();
  const hashB = crypto.createHash('sha256').update(bufB).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/** Si el valor recibido es la clave de debug (y el modo está realmente activo). */
export function claveDebugValida(valor: unknown): boolean {
  if (!DEBUG_AUTH) return false;
  if (typeof valor !== 'string' || valor.length === 0) return false;
  return igualSinFiltrarTiempo(valor, CLAVE);
}

/** Aviso de arranque: que el modo nunca pase inadvertido en los logs. */
export function avisarModoDebug(): void {
  if (DEBUG_AUTH) {
    console.warn(
      '\n⚠️  DEBUG_AUTH ACTIVO — quien tenga la clave de debug entra a cualquier cuenta\n' +
        '    sin la contraseña real. Aceptable para testing; jamás con datos reales.\n' +
        '    Se apaga solo con NODE_ENV=production.\n',
    );
    return;
  }
  if (PEDIDO && EN_PRODUCCION) {
    console.warn('⚠️  DEBUG_AUTH pedido pero ignorado: NODE_ENV=production.');
    return;
  }
  if (PEDIDO && CLAVE.length === 0) {
    console.error(
      '\n❌ DEBUG_AUTH=true pero falta DEBUG_AUTH_PASSWORD, así que queda APAGADO.\n' +
        '    Sin clave, el selector de usuarios de debug dejaría entrar a cualquiera\n' +
        '    que abra la URL. Definí DEBUG_AUTH_PASSWORD en el .env para usarlo.\n',
    );
  }
}
