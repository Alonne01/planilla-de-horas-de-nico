/**
 * Clave del modo debug, guardada por dispositivo.
 *
 * Con DEBUG_AUTH el API deja entrar a cualquier cuenta con esta clave y publica
 * la nómina en /auth/debug-users, así que no puede quedar al alcance de
 * cualquiera que abra la URL del túnel: el selector de usuarios sólo aparece en
 * el dispositivo que la trajo una vez en la dirección.
 *
 *   https://…/?debug=LA_CLAVE
 *
 * Se lee al arrancar la app y NO en la pantalla de login: el router redirige a
 * /login con <Navigate replace>, que descarta el query string, así que para
 * cuando se monta el login el parámetro ya no existe.
 */
const CLAVE_KEY = 'planilla-debug-clave';

/** Toma la clave de la URL si vino, la guarda y la saca de la barra de direcciones. */
export function capturarClaveDebug(): void {
  try {
    const url = new URL(window.location.href);
    const clave = url.searchParams.get('debug');
    if (!clave) return;

    localStorage.setItem(CLAVE_KEY, clave);
    // Que no quede en el historial ni en lo que se comparte al copiar el link.
    url.searchParams.delete('debug');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  } catch {
    // localStorage bloqueado (modo privado): el login se ve como el normal
  }
}

export function claveDebug(): string | null {
  try {
    return localStorage.getItem(CLAVE_KEY);
  } catch {
    return null;
  }
}

export function olvidarClaveDebug(): void {
  try {
    localStorage.removeItem(CLAVE_KEY);
  } catch {
    /* nada que hacer */
  }
}
