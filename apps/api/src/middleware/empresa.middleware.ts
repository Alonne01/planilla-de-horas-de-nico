import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export function empresaMiddleware() {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado' });
      return;
    }

    // If a resource ID is in params, verify it belongs to the user's empresa
    // This is a base middleware, specific checks are done in route handlers
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user.userId },
      select: { empresaId: true },
    });

    if (!usuario) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    // Attach empresaId to request for use in route handlers
    req.user.empresaId = usuario.empresaId;
    next();
  };
}
