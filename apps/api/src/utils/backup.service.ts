import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

// pg_dump/pg_restore may not be on PATH (common on Windows).
// Resolution order: PG_BIN env var → standard install dirs → bare name (PATH).
function resolvePgTool(tool: string): string {
  const exe = process.platform === 'win32' ? `${tool}.exe` : tool;
  if (process.env.PG_BIN) {
    const candidate = path.join(process.env.PG_BIN, exe);
    if (existsSync(candidate)) return candidate;
  }
  if (process.platform === 'win32') {
    for (const base of ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL']) {
      try {
        const versions = readdirSync(base).sort().reverse();
        for (const v of versions) {
          const candidate = path.join(base, v, 'bin', exe);
          if (existsSync(candidate)) return candidate;
        }
      } catch { /* base dir not present */ }
    }
  }
  return tool;
}

const PG_DUMP = resolvePgTool('pg_dump');
const PG_RESTORE = resolvePgTool('pg_restore');

// ─── Config ──────────────────────────────────────────────────
const DB_URL = process.env.DATABASE_URL ?? '';
const ROOT = path.resolve(process.cwd(), 'backups');
const PRIMARY_DIR = path.join(ROOT, 'primary');
const SECONDARY_DIR = path.join(ROOT, 'secondary');
const MAX_BACKUPS = 14; // keep 14 backups per location (~14 days)

interface BackupResult {
  ok: boolean;
  file?: string;
  primaryPath?: string;
  secondaryPath?: string;
  sizeBytes?: number;
  error?: string;
  durationMs?: number;
}

interface BackupInfo {
  name: string;
  location: 'primary' | 'secondary';
  path: string;
  sizeBytes: number;
  createdAt: Date;
}

interface RestoreResult {
  ok: boolean;
  backup?: string;
  /** Dump tomado justo antes del --clean, para poder volver atrás */
  dumpPrevio?: string;
  advertencias?: string;
  error?: string;
}

/** Estado del monitor de salud de la base (solo observación, ver healthCheckDatabase) */
interface EstadoSaludDb {
  ok: boolean;
  ultimoChequeo: Date | null;
  fallosConsecutivos: number;
  ultimoError: string | null;
  ultimoFalloAt: Date | null;
}

// ─── Helpers ─────────────────────────────────────────────────

function parseDatabaseUrl(url: string) {
  const m = url.match(
    /^postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)$/,
  );
  if (!m) throw new Error('DATABASE_URL inválida');
  return {
    user: m[1],
    password: m[2],
    host: m[3],
    port: m[4],
    database: m[5],
  };
}

async function ensureDirs() {
  await fs.mkdir(PRIMARY_DIR, { recursive: true });
  await fs.mkdir(SECONDARY_DIR, { recursive: true });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** Remove oldest backups keeping only MAX_BACKUPS */
async function pruneBackups(dir: string) {
  try {
    const files = (await fs.readdir(dir))
      .filter((f) => f.endsWith('.dump'))
      .sort();
    while (files.length > MAX_BACKUPS) {
      const oldest = files.shift()!;
      await fs.unlink(path.join(dir, oldest)).catch(() => {});
    }
  } catch {
    // directory might not exist yet
  }
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Run pg_dump → save to primary + copy to secondary (double redundancy).
 * `sufijo` marca dumps fuera del ciclo normal (p. ej. el previo a una restauración).
 */
export async function runBackup(sufijo?: string): Promise<BackupResult> {
  const start = Date.now();
  try {
    const db = parseDatabaseUrl(DB_URL);
    await ensureDirs();

    const fileName = `backup_${timestamp()}${sufijo ? `_${sufijo}` : ''}.dump`;
    const primaryPath = path.join(PRIMARY_DIR, fileName);
    const secondaryPath = path.join(SECONDARY_DIR, fileName);

    await execFileAsync(PG_DUMP, [
      '-h', db.host,
      '-p', db.port,
      '-U', db.user,
      '-d', db.database,
      '-Fc',           // custom format (compressed)
      '-Z', '6',       // compression level
      '-f', primaryPath,
    ], {
      env: { ...process.env, PGPASSWORD: db.password },
      timeout: 120_000,
    });

    const stat = await fs.stat(primaryPath);
    if (stat.size < 100) throw new Error('Backup file too small, likely corrupt');

    // Double redundancy: copy to secondary
    await fs.copyFile(primaryPath, secondaryPath);
    const stat2 = await fs.stat(secondaryPath);
    if (stat2.size !== stat.size) {
      console.warn('⚠️  Secondary backup size mismatch, retrying copy...');
      await fs.copyFile(primaryPath, secondaryPath);
    }

    // Los dumps con sufijo no rotan: el prune podría borrar justo el archivo que el
    // admin eligió restaurar si ya hay MAX_BACKUPS acumulados.
    if (!sufijo) {
      await pruneBackups(PRIMARY_DIR);
      await pruneBackups(SECONDARY_DIR);
    }

    const durationMs = Date.now() - start;
    console.log(`✅ Backup completado: ${fileName} (${(stat.size / 1024 / 1024).toFixed(2)} MB) en ${durationMs}ms`);
    return { ok: true, file: fileName, primaryPath, secondaryPath, sizeBytes: stat.size, durationMs };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    console.error('❌ Backup falló:', err.message);
    return { ok: false, error: err.message, durationMs };
  }
}

/** Find the latest valid backup across both locations */
export async function findLatestBackup(): Promise<BackupInfo | null> {
  await ensureDirs();
  const all: BackupInfo[] = [];

  for (const [dir, loc] of [[PRIMARY_DIR, 'primary'], [SECONDARY_DIR, 'secondary']] as const) {
    try {
      const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.dump'));
      for (const f of files) {
        const fp = path.join(dir, f);
        const stat = await fs.stat(fp);
        if (stat.size > 100) {
          all.push({ name: f, location: loc, path: fp, sizeBytes: stat.size, createdAt: stat.mtime });
        }
      }
    } catch { /* skip */ }
  }

  if (all.length === 0) return null;
  all.sort((a, b) => {
    const diff = b.createdAt.getTime() - a.createdAt.getTime();
    return diff !== 0 ? diff : (a.location === 'primary' ? -1 : 1);
  });
  return all[0];
}

/** List all available backups */
export async function listBackups(): Promise<BackupInfo[]> {
  await ensureDirs();
  const all: BackupInfo[] = [];

  for (const [dir, loc] of [[PRIMARY_DIR, 'primary'], [SECONDARY_DIR, 'secondary']] as const) {
    try {
      const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.dump'));
      for (const f of files) {
        const fp = path.join(dir, f);
        const stat = await fs.stat(fp);
        all.push({ name: f, location: loc, path: fp, sizeBytes: stat.size, createdAt: stat.mtime });
      }
    } catch { /* skip */ }
  }

  all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return all;
}

/** Restore from the latest valid backup */
export async function restoreFromLatest(): Promise<RestoreResult> {
  const backup = await findLatestBackup();
  if (!backup) return { ok: false, error: 'No hay backups disponibles' };
  return restoreFromFile(backup.path);
}

/**
 * pg_restore sale con código != 0 aunque el único problema sean los DROP de objetos
 * que todavía no existen (--clean --if-exists sobre una base vacía). Solo esas líneas
 * cuentan como benignas: si aparece cualquier otra, la restauración quedó a medias y
 * no puede informarse como exitosa.
 */
function soloAdvertencias(stderr: string): boolean {
  const lineas = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lineas.length === 0) return false;
  return lineas.every((l) => /warning:/i.test(l) || /does not exist, skipping/i.test(l));
}

/** Restore from a specific backup file — acción destructiva, siempre explícita */
export async function restoreFromFile(filePath: string): Promise<RestoreResult> {
  try {
    const db = parseDatabaseUrl(DB_URL);
    const fileName = path.basename(filePath);
    console.log(`🔄 Restaurando base de datos desde: ${fileName}...`);

    // Dump de emergencia antes del --clean: si el backup elegido resulta viejo o
    // incompleto, el estado previo sigue siendo recuperable. Si falla (base caída,
    // disco lleno) se continúa igual, porque la restauración se pidió a propósito.
    const previo = await runBackup('pre-restore');
    if (!previo.ok) {
      console.warn('⚠️  No se pudo tomar el dump previo a la restauración:', previo.error);
    }

    await execFileAsync(PG_RESTORE, [
      '-h', db.host,
      '-p', db.port,
      '-U', db.user,
      '-d', db.database,
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      filePath,
    ], {
      env: { ...process.env, PGPASSWORD: db.password },
      timeout: 300_000,
    });

    console.log(`✅ Base de datos restaurada desde: ${fileName}`);
    return { ok: true, backup: fileName, dumpPrevio: previo.file };
  } catch (err: any) {
    const stderr: string = err.stderr ?? '';
    if (soloAdvertencias(stderr)) {
      console.warn('⚠️  pg_restore completó con advertencias:', stderr.slice(0, 500));
      return { ok: true, backup: path.basename(filePath), advertencias: stderr.slice(0, 500) };
    }
    console.error('❌ Restore falló:', err.message, stderr.slice(0, 1000));
    return { ok: false, error: err.message };
  }
}

// ─── Monitor de salud ────────────────────────────────────────

const estadoSalud: EstadoSaludDb = {
  ok: true,
  ultimoChequeo: null,
  fallosConsecutivos: 0,
  ultimoError: null,
  ultimoFalloAt: null,
};

/** Umbral de chequeos fallidos seguidos (~15 min) a partir del cual se grita en el log */
const FALLOS_PARA_ALERTA = 3;

/** Estado del último chequeo de salud, para exponerlo en GET /backup/status */
export function getEstadoSaludDb(): EstadoSaludDb {
  return { ...estadoSalud };
}

/**
 * Chequeo de salud de la base: observa y avisa, nunca restaura.
 * Restaurar es DROP + recreación de todos los objetos con el dump del día anterior,
 * así que dispararlo ante cualquier error de "SELECT 1" (reinicio del contenedor db,
 * pool agotado, timeout de red) borraría todo lo cargado desde el último backup.
 * La restauración es una acción explícita del administrador: POST /backup/restore.
 */
export async function healthCheckDatabase(prisma: any): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    if (estadoSalud.fallosConsecutivos > 0) {
      console.log(`✅ Base de datos respondiendo de nuevo tras ${estadoSalud.fallosConsecutivos} chequeo(s) fallido(s)`);
    }
    estadoSalud.ok = true;
    estadoSalud.fallosConsecutivos = 0;
    estadoSalud.ultimoChequeo = new Date();
    return true;
  } catch (err: any) {
    estadoSalud.ok = false;
    estadoSalud.fallosConsecutivos += 1;
    estadoSalud.ultimoChequeo = new Date();
    estadoSalud.ultimoFalloAt = estadoSalud.ultimoChequeo;
    estadoSalud.ultimoError = err?.message ?? String(err);

    console.error(`🚨 Base de datos no responde (fallo consecutivo #${estadoSalud.fallosConsecutivos}):`, estadoSalud.ultimoError);
    if (estadoSalud.fallosConsecutivos >= FALLOS_PARA_ALERTA) {
      console.error(
        `🚨 ALERTA: la base lleva ${estadoSalud.fallosConsecutivos} chequeos fallidos seguidos. ` +
        'Revisar el servicio de PostgreSQL. Si la base quedó corrupta, restaurar A MANO con POST /api/v1/backup/restore.',
      );
    }
    return false;
  }
}

// ─── Scheduler ───────────────────────────────────────────────

let backupTimer: ReturnType<typeof setInterval> | null = null;
let healthTimer: ReturnType<typeof setInterval> | null = null;

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const FIVE_MINUTES = 5 * 60 * 1000;

/** Start automatic backup (every 24h) + health monitor (every 5min) */
export function startBackupScheduler(prisma?: any) {
  // Los callbacks de los timers no tienen a quién propagar un rechazo: sin este catch,
  // un fallo del volumen de backups tumba el proceso entero por unhandledRejection.
  const seguro = (fn: () => Promise<unknown>) => () => {
    fn().catch((err) => console.error('Error en el scheduler de backups:', err));
  };

  // First backup 10 seconds after startup
  setTimeout(seguro(async () => {
    console.log('📦 Ejecutando backup inicial...');
    await runBackup();
  }), 10_000);

  backupTimer = setInterval(seguro(async () => {
    console.log('⏰ Backup automático programado...');
    await runBackup();
  }), TWENTY_FOUR_HOURS);

  console.log('🕐 Backup automático: cada 24 horas');

  if (prisma) {
    healthTimer = setInterval(seguro(async () => {
      await healthCheckDatabase(prisma);
    }), FIVE_MINUTES);
    console.log('🏥 Monitor de salud de la base: cada 5 minutos (solo alerta, no restaura)');
  }
}

/** Stop the scheduler (for graceful shutdown) */
export function stopBackupScheduler() {
  if (backupTimer) { clearInterval(backupTimer); backupTimer = null; }
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
  console.log('🛑 Backup scheduler detenido');
}
