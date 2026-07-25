import { Router, Response, NextFunction } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_ADMIN } from '../middleware/roles.middleware.js';
import { logAuditoria } from '../lib/auditoria.js';
import {
  runBackup,
  listBackups,
  restoreFromLatest,
  restoreFromFile,
  getEstadoSaludDb,
} from '../utils/backup.service.js';

const router = Router();
router.use(authMiddleware);
router.use(requireLevel(LEVEL_ADMIN));

/**
 * Backup y restore operan sobre la base completa, con los datos de TODAS las empresas,
 * así que ser ADMIN de un tenant no alcanza para autorizarlos. Si BACKUP_OPERADORES
 * está definida (emails separados por coma), solo esas cuentas pueden usar el router.
 * Si no está definida se mantiene el comportamiento actual (ADMIN), para no dejar sin
 * backup a las instalaciones ya desplegadas.
 */
function requireOperadorDeInstancia(req: AuthRequest, res: Response, next: NextFunction): void {
  const allowlist = (process.env.BACKUP_OPERADORES ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (allowlist.length === 0) {
    next();
    return;
  }
  if (!allowlist.includes((req.user?.email ?? '').toLowerCase())) {
    res.status(403).json({ error: 'No tiene permisos para esta acción' });
    return;
  }
  next();
}

router.use(requireOperadorDeInstancia);

/** El detalle de pg_dump/pg_restore incluye la línea de comando (host, usuario, rutas): solo al log */
function fallo(res: Response, contexto: string, detalle: unknown, codigo: string): void {
  console.error(`Error en backup (${contexto}):`, detalle);
  res.status(500).json({ error: 'Error interno del servidor', codigo });
}

// ─── GET /backup/status — List backups + last backup info ────
router.get('/status', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const backups = await listBackups();
    const primaryCount = backups.filter((b) => b.location === 'primary').length;
    const secondaryCount = backups.filter((b) => b.location === 'secondary').length;
    const latest = backups[0] ?? null;
    const salud = getEstadoSaludDb();

    res.json({
      totalBackups: backups.length,
      primaryCount,
      secondaryCount,
      latestBackup: latest
        ? {
            name: latest.name,
            location: latest.location,
            sizeMB: (latest.sizeBytes / 1024 / 1024).toFixed(2),
            createdAt: latest.createdAt,
          }
        : null,
      // El monitor de salud solo avisa; restaurar es manual y explícito
      salud: {
        ok: salud.ok,
        ultimoChequeo: salud.ultimoChequeo,
        fallosConsecutivos: salud.fallosConsecutivos,
        ultimoFalloAt: salud.ultimoFalloAt,
      },
      backups: backups.map((b) => ({
        name: b.name,
        location: b.location,
        sizeMB: (b.sizeBytes / 1024 / 1024).toFixed(2),
        createdAt: b.createdAt,
      })),
    });
  } catch (err: any) {
    fallo(res, 'status', err, 'BACKUP_STATUS_FAILED');
  }
});

// ─── POST /backup/trigger — Run manual backup ───────────────
router.post('/trigger', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await runBackup();
    if (result.ok) {
      res.json({
        message: 'Backup completado exitosamente',
        file: result.file,
        sizeMB: ((result.sizeBytes ?? 0) / 1024 / 1024).toFixed(2),
        durationMs: result.durationMs,
      });
    } else {
      fallo(res, 'trigger', result.error, 'BACKUP_FAILED');
    }
  } catch (err: any) {
    fallo(res, 'trigger', err, 'BACKUP_FAILED');
  }
});

// ─── POST /backup/restore — Restore from a backup ───────────
router.post('/restore', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { fileName, confirmar } = req.body ?? {};

    // Restaurar es DROP + recreación de toda la base: se pierde todo lo cargado
    // desde el backup elegido. No puede dispararse por una request de un solo campo.
    if (confirmar !== true) {
      res.status(400).json({
        error: 'Restaurar reemplaza la base completa y descarta todo lo cargado desde ese backup. Reenviar con "confirmar": true.',
      });
      return;
    }

    let target: { name: string; path: string } | null = null;
    if (fileName) {
      // Restore from specific file — search in both locations
      const backups = await listBackups();
      const encontrado = backups.find((b) => b.name === fileName);
      if (!encontrado) {
        res.status(404).json({ error: `Backup "${fileName}" no encontrado` });
        return;
      }
      target = { name: encontrado.name, path: encontrado.path };
    }

    // Se audita antes y después: el --clean borra el registro previo, pero queda
    // dentro del dump de emergencia que toma el propio restore.
    const descripcionBase = `Restauración de la base desde ${target?.name ?? 'el último backup'} por ${req.user!.email}`;
    await logAuditoria({
      entidad: 'Backup',
      entidadId: target?.name ?? 'latest',
      accion: 'EDITAR',
      descripcion: `${descripcionBase} — iniciada`,
      usuarioId: req.user!.userId,
    });
    console.warn(`⚠️  ${descripcionBase}`);

    const result = target ? await restoreFromFile(target.path) : await restoreFromLatest();

    if (result.ok) {
      await logAuditoria({
        entidad: 'Backup',
        entidadId: result.backup ?? (target?.name ?? 'latest'),
        accion: 'EDITAR',
        descripcion: `${descripcionBase} — completada (dump previo: ${result.dumpPrevio ?? 'no disponible'})`,
        usuarioId: req.user!.userId,
      });
      res.json({
        message: `Base de datos restaurada desde: ${result.backup}`,
        dumpPrevio: result.dumpPrevio ?? null,
        advertencias: result.advertencias ?? null,
      });
    } else {
      fallo(res, 'restore', result.error, 'RESTORE_FAILED');
    }
  } catch (err: any) {
    fallo(res, 'restore', err, 'RESTORE_FAILED');
  }
});

export default router;
