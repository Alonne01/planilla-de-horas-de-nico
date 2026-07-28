/**
 * Miniaturas de las fotos de las tarjetas WENTOP, con caché en disco.
 *
 * Una foto pesa hasta 5 MB y una tarjeta lleva hasta 10. Incrustar los originales
 * en el Excel de trescientas tarjetas daría un archivo de varios GB, así que se
 * incrustan miniaturas de lado ≤ 600 px (~40-60 KB cada una).
 *
 * El redimensionado en sí corre en un WORKER (ver miniaturas.worker.ts): jimp es
 * JavaScript puro y hacerlo acá dejaría la API entera sin responder durante la
 * exportación.
 *
 * Los archivos subidos son inmutables —el nombre lleva un uuid—, así que la caché
 * no necesita invalidarse por contenido; sólo hay que borrarla cuando se borra la
 * foto.
 */
import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { stat, mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { UPLOAD_DIR_PATH } from '../middleware/upload.middleware.js';
import type { PedidoMiniatura, RespuestaMiniatura } from './miniaturas.worker.js';

export const LADO_MINIATURA = 600;
const DIR_MINIATURAS = path.join(UPLOAD_DIR_PATH, 'thumbs');

export interface Miniatura {
  ruta: string;
  ancho: number;
  alto: number;
}

// ── Índice de lo ya generado ────────────────────────────────────────────────
// Las dimensiones salen del NOMBRE (`<base>_600x338.jpg`), así que alcanza un
// readdir por arranque para saber qué hay y cuánto mide, sin abrir una sola
// imagen.
const indice = new Map<string, Miniatura>();
let indiceListo = false;

async function cargarIndice(): Promise<void> {
  if (indiceListo) return;
  await mkdir(DIR_MINIATURAS, { recursive: true });
  for (const archivo of await readdir(DIR_MINIATURAS)) {
    const m = /^(.+)_(\d+)x(\d+)\.jpg$/.exec(archivo);
    if (!m) continue;
    indice.set(m[1]!, {
      ruta: path.join(DIR_MINIATURAS, archivo),
      ancho: Number(m[2]),
      alto: Number(m[3]),
    });
  }
  indiceListo = true;
}

// ── El worker ───────────────────────────────────────────────────────────────
let worker: Worker | null = null;
let siguienteId = 1;
const pendientes = new Map<number, (r: RespuestaMiniatura) => void>();

/**
 * Dónde está el archivo del worker, y si el hilo nuevo necesita el loader de tsx.
 *
 * No se puede resolver con `import.meta.url`: el tsconfig es `module: NodeNext`
 * sin `"type": "module"` en el package.json, así que la salida es CommonJS y tsc
 * rechaza `import.meta` (TS1470). Tampoco con `__dirname`: en desarrollo tsx
 * carga estos archivos como ES module y ahí no existe.
 *
 * Queda ubicarlo desde el directorio de trabajo, que es lo que ya hace
 * `upload.middleware.ts` para `uploads/`. El criterio no es ambiguo: la imagen
 * de producción copia SÓLO `dist` (ver apps/api/Dockerfile), nunca `src`, así
 * que si el `.ts` existe estamos en desarrollo — aunque haya quedado un `dist`
 * viejo de un build anterior.
 */
function ubicacionDelWorker(): { ruta: string; necesitaTsx: boolean } {
  const fuente = path.resolve(process.cwd(), 'src', 'utils', 'miniaturas.worker.ts');
  if (existsSync(fuente)) return { ruta: fuente, necesitaTsx: true };
  return { ruta: path.resolve(process.cwd(), 'dist', 'utils', 'miniaturas.worker.js'), necesitaTsx: false };
}

function obtenerWorker(): Worker {
  if (worker) return worker;
  const { ruta, necesitaTsx } = ubicacionDelWorker();
  // El hilo nuevo NO hereda el loader del padre: sin esto, en desarrollo el
  // worker recibe un .ts que node no sabe leer.
  const w = new Worker(ruta, { execArgv: necesitaTsx ? ['--import', 'tsx'] : [] });

  w.on('message', (r: RespuestaMiniatura) => {
    pendientes.get(r.id)?.(r);
    pendientes.delete(r.id);
    ajustarRef(w);
  });
  w.on('error', (e) => {
    console.error('Worker de miniaturas caído:', e);
    // Se descarta para que el próximo pedido levante uno nuevo, y se destraban
    // los que estaban esperando: sin esto, una exportación queda colgada para
    // siempre en el `await` de una promesa que ya nadie va a resolver.
    worker = null;
    for (const [id, resolver] of pendientes) {
      resolver({ id, ok: false, error: 'el worker de miniaturas se cayó' });
    }
    pendientes.clear();
    ajustarRef(w);
  });
  // Arranca sin retener el proceso; `ajustarRef` lo retiene mientras haya
  // trabajo en vuelo.
  w.unref();

  worker = w;
  return w;
}

/**
 * El worker retiene el proceso SÓLO mientras tiene pedidos en vuelo.
 *
 * Un `unref()` permanente parece lo correcto —no querés que un worker ocioso
 * impida cerrar el proceso— pero deja una trampa silenciosa: si lo único que
 * queda pendiente en el event loop es esperar su respuesta, Node se cierra con
 * código 0 sin ejecutar nada de lo que venía después. En la API no se nota
 * porque el servidor HTTP mantiene el loop vivo; en un script suelto (una
 * exportación por línea de comandos, una migración de miniaturas) el trabajo
 * desaparece sin error ni mensaje.
 */
function ajustarRef(w: Worker): void {
  if (pendientes.size > 0) w.ref();
  else w.unref();
}

/**
 * La miniatura de una foto, generándola si hace falta.
 *
 * `null` si el original no está o si no se pudo procesar: una foto perdida o
 * corrupta no puede tumbar una exportación entera.
 */
export async function miniaturaDe(urlPublica: string): Promise<Miniatura | null> {
  await cargarIndice();
  const nombre = path.basename(urlPublica);
  const base = path.parse(nombre).name;

  const cacheada = indice.get(base);
  if (cacheada) return cacheada;

  const origen = path.join(UPLOAD_DIR_PATH, nombre);
  try {
    await stat(origen);
  } catch {
    return null;
  }

  const id = siguienteId++;
  const pedido: PedidoMiniatura = {
    id,
    origen,
    destinoBase: path.join(DIR_MINIATURAS, base),
    lado: LADO_MINIATURA,
  };
  const respuesta = await new Promise<RespuestaMiniatura>((resolve) => {
    const w = obtenerWorker();
    pendientes.set(id, resolve);
    ajustarRef(w);
    w.postMessage(pedido);
  });

  if (!respuesta.ok || !respuesta.ruta) {
    console.warn(`No se pudo generar la miniatura de ${nombre}: ${respuesta.error}`);
    return null;
  }
  const entrada: Miniatura = { ruta: respuesta.ruta, ancho: respuesta.ancho!, alto: respuesta.alto! };
  indice.set(base, entrada);
  return entrada;
}

/**
 * Encola la miniatura sin esperarla.
 *
 * Para el alta de fotos: la subida se contesta y la miniatura se genera después,
 * así el que carga desde el campo con datos móviles no espera de más. Si falla,
 * la exportación la vuelve a intentar.
 */
export function calentarMiniatura(urlPublica: string): void {
  miniaturaDe(urlPublica).catch(() => { /* se generará al exportar */ });
}

/** Borra la miniatura de una foto que se elimina, y la saca del índice. */
export async function borrarMiniatura(urlPublica: string): Promise<void> {
  await cargarIndice();
  const base = path.parse(path.basename(urlPublica)).name;
  const entrada = indice.get(base);
  indice.delete(base);
  if (!entrada) return;
  try {
    await unlink(entrada.ruta);
  } catch {
    /* ya no está: nada que hacer */
  }
}
