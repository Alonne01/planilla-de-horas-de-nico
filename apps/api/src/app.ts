import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import routes from './routes/index.js';
import { startBackupScheduler, stopBackupScheduler } from './utils/backup.service.js';

const prisma = new PrismaClient();

const app = express();
const PORT = parseInt(process.env.PORT ?? '4000', 10);
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000';

const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? FRONTEND_URL)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ─── Middlewares globales ────────────────────────

app.use(helmet());

app.use(cors({
  origin: (origin, callback) => {
    // Allow no-origin requests (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    // En desarrollo, permitir IPs privadas RFC-1918 y localhost
    if (process.env.NODE_ENV === 'development') {
      try {
        const host = new URL(origin).hostname;
        const isPrivate =
          host === 'localhost' || host === '127.0.0.1' ||
          /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
          /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
          /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host);
        if (isPrivate) return callback(null, true);
      } catch {
        // origin inválido, cae al check normal
      }
    }

    // Check against whitelist
    if (CORS_ORIGINS.some((allowed) => {
      if (allowed.includes('ngrok')) return origin.includes('ngrok');
      if (allowed.includes('trycloudflare')) return origin.includes('trycloudflare.com');
      return origin === allowed;
    })) {
      return callback(null, true);
    }
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Access-Control-Request-Private-Network'],
}));

// Private Network Access: Chrome requires this header for LAN → localhost requests
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(morgan('dev'));

// Rate limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Demasiados intentos, intente nuevamente en 15 minutos' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/v1/auth/login', authLimiter);

// Stricter rate limiter for password reset requests
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3,
  message: { error: 'Demasiados intentos, intente nuevamente en 15 minutos' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/v1/auth/forgot-password', forgotPasswordLimiter);

// ─── Archivos estáticos (uploads) ────────────────

app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

// ─── Rutas ───────────────────────────────────────

app.use('/api/v1', routes);

// ─── Error handler global ────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error no manejado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ─── Iniciar servidor ────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 API Planilla de Horas corriendo en http://0.0.0.0:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/api/v1/health`);
  console.log(`🔑 Login: POST http://localhost:${PORT}/api/v1/auth/login\n`);

  // Start backup scheduler with DB health monitoring
  startBackupScheduler(prisma);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  stopBackupScheduler();
  prisma.$disconnect();
  process.exit(0);
});
process.on('SIGINT', () => {
  stopBackupScheduler();
  prisma.$disconnect();
  process.exit(0);
});

export default app;
