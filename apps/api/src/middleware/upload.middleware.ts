import multer from 'multer';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'crypto';
import { mkdirSync, unlinkSync, statSync } from 'fs';
import type { AuthRequest } from './auth.middleware.js';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

const fileFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'];
  const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExts.includes(ext) && allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    const err: any = new Error('Solo se permiten imágenes (jpg, png, gif, webp) y PDF');
    err.status = 400;
    cb(err);
  }
};

// ─── Límites ────────────────────────────────────────────────────────────────
// El front avisa con estos mismos números, pero la verdad está acá: sin esto
// alcanza con repetir el request para llenar el disco del servidor.

export const MAX_BYTES_POR_ARCHIVO = 5 * 1024 * 1024;
export const MAX_FOTOS_POR_TARJETA = 10;
export const MAX_BYTES_POR_TARJETA = 25 * 1024 * 1024;

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_BYTES_POR_ARCHIVO,
    files: MAX_FOTOS_POR_TARJETA,
    fields: 20,
  },
});

export const UPLOAD_DIR_PATH = UPLOAD_DIR;

/**
 * Borra archivos que multer ya escribió en disco pero que la ruta terminó
 * rechazando. Sin esto, cada intento fallido deja basura acumulándose.
 */
export function descartarArchivos(files: Express.Multer.File[] | undefined): void {
  if (!files) return;
  for (const file of files) {
    try {
      unlinkSync(file.path);
    } catch {
      /* ya no está: nada que hacer */
    }
  }
}

/** Borra un archivo del directorio de uploads a partir de su URL pública. */
export function borrarUploadPorUrl(url: string | null | undefined): void {
  if (!url) return;
  const nombre = path.basename(url);
  // Nunca salir de UPLOAD_DIR, por más que la URL venga manipulada
  const destino = path.join(UPLOAD_DIR, nombre);
  if (path.dirname(destino) !== UPLOAD_DIR) return;
  try {
    unlinkSync(destino);
  } catch {
    /* el archivo ya no existe */
  }
}

/** Suma el peso en disco de una lista de URLs de uploads. */
export function pesoTotalDeUploads(urls: string[]): number {
  let total = 0;
  for (const url of urls) {
    const destino = path.join(UPLOAD_DIR, path.basename(url));
    if (path.dirname(destino) !== UPLOAD_DIR) continue;
    try {
      total += statSync(destino).size;
    } catch {
      /* el archivo no está: no suma */
    }
  }
  return total;
}

/**
 * Tope de subidas por usuario. Va por usuario y no por IP a propósito: detrás
 * de nginx todas las peticiones comparten la IP del proxy, así que limitar por
 * IP dejaría que un solo usuario bloquee al resto.
 */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as AuthRequest).user?.userId ?? 'anonimo',
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Demasiadas subidas en poco tiempo. Esperá un rato antes de seguir cargando archivos.',
    });
  },
});
