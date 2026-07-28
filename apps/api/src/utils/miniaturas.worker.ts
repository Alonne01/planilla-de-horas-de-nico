/**
 * Redimensionado de imágenes, FUERA del hilo principal.
 *
 * `jimp` es JavaScript puro: decodificar un JPEG de 5 MB cuesta entre 300 y 600
 * ms de CPU bloqueante. Una exportación de trescientas fotos son varios minutos
 * con la API sin responder ni el /health — no lenta: caída. Por eso el trabajo
 * vive acá y el proceso principal sólo manda pedidos y espera respuestas.
 *
 * Las dimensiones finales viajan en el NOMBRE del archivo (`<base>_600x338.jpg`)
 * y no en una base de datos ni en un sidecar: quien lee la caché después las
 * necesita para ubicar la foto en la celda del Excel, y sacarlas de la imagen
 * exigiría volver a decodificarla, que es exactamente el trabajo caro que este
 * módulo existe para evitar.
 */
import { parentPort } from 'node:worker_threads';
import { writeFile } from 'node:fs/promises';
import { Jimp } from 'jimp';

export interface PedidoMiniatura {
  id: number;
  origen: string;
  /** Ruta SIN extensión: el worker le agrega `_<ancho>x<alto>.jpg`. */
  destinoBase: string;
  lado: number;
}

export interface RespuestaMiniatura {
  id: number;
  ok: boolean;
  ruta?: string;
  ancho?: number;
  alto?: number;
  error?: string;
}

parentPort?.on('message', async (pedido: PedidoMiniatura) => {
  try {
    const img = await Jimp.read(pedido.origen);
    // `scaleToFit` conserva la proporción: una foto 16:9 y una 9:16 entran las
    // dos en el mismo cuadrado sin deformarse, que es todo el punto.
    img.scaleToFit({ w: pedido.lado, h: pedido.lado });
    const buffer = await img.getBuffer('image/jpeg', { quality: 70 });
    const ancho = img.bitmap.width;
    const alto = img.bitmap.height;
    const ruta = `${pedido.destinoBase}_${ancho}x${alto}.jpg`;
    await writeFile(ruta, buffer);
    parentPort?.postMessage({ id: pedido.id, ok: true, ruta, ancho, alto } satisfies RespuestaMiniatura);
  } catch (e) {
    parentPort?.postMessage({
      id: pedido.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    } satisfies RespuestaMiniatura);
  }
});
