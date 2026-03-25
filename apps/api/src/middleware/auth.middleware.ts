import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt.utils.js';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    empresaId: string;
    rol: string;
    rolNivel: number;
    email: string;
  };
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token de acceso requerido' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = verifyAccessToken(token);
    if (!payload.userId || !payload.empresaId || !payload.rol || typeof payload.rolNivel !== 'number') {
      res.status(401).json({ error: 'Token inválido: claims incompletos' });
      return;
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}
