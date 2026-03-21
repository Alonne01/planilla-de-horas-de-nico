import { Router, Response } from 'express';
import { authenticate, requireLevel, AuthRequest, LEVEL_ADMIN } from '../middleware/auth.middleware.js';
import {
  runBackup,
  listBackups,
  restoreFromLatest,
  restoreFromFile,
} from '../utils/backup.service.js';

const router = Router();
router.use(authenticate);

// ─── GET /backup/status — List backups + last backup info ────
router.get('/status', requireLevel(LEVEL_ADMIN), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const backups = await listBackups();
    const primaryCount = backups.filter((b) => b.location === 'primary').length;
    const secondaryCount = backups.filter((b) => b.location === 'secondary').length;
    const latest = backups[0] ?? null;

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
      backups: backups.map((b) => ({
        name: b.name,
        location: b.location,
        sizeMB: (b.sizeBytes / 1024 / 1024).toFixed(2),
        createdAt: b.createdAt,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /backup/trigger — Run manual backup ───────────────
router.post('/trigger', requireLevel(LEVEL_ADMIN), async (_req: AuthRequest, res: Response): Promise<void> => {
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
      res.status(500).json({ error: result.error });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /backup/restore — Restore from latest backup ──────
router.post('/restore', requireLevel(LEVEL_ADMIN), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { fileName } = req.body ?? {};
    let result;
    if (fileName) {
      // Restore from specific file — search in both locations
      const backups = await listBackups();
      const target = backups.find((b) => b.name === fileName);
      if (!target) {
        res.status(404).json({ error: `Backup "${fileName}" no encontrado` });
        return;
      }
      result = await restoreFromFile(target.path);
    } else {
      result = await restoreFromLatest();
    }

    if (result.ok) {
      res.json({ message: `Base de datos restaurada desde: ${result.backup}` });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
