import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware.js';

// ─── Level Constants ─────────────────────────────
export const LEVEL_ADMIN = 100;
export const LEVEL_RRHH = 90;
export const LEVEL_GERENTE = 80;
export const LEVEL_COORDINADOR = 70;
export const LEVEL_SUPERVISOR = 60;
export const LEVEL_OPERADOR = 10;

// ─── Level-based middleware ──────────────────────

export function requireLevel(minLevel: number) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado' });
      return;
    }

    if ((req.user.rolNivel ?? 0) < minLevel) {
      res.status(403).json({ error: 'No tiene permisos para esta acción' });
      return;
    }

    next();
  };
}

// ─── Legacy role-based middleware (deprecated) ───

/** @deprecated Use requireLevel() instead */
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado' });
      return;
    }

    if (!roles.includes(req.user.rol)) {
      res.status(403).json({ error: 'No tiene permisos para esta acción' });
      return;
    }

    next();
  };
}
