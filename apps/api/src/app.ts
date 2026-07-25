import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import routes from './routes/index.js';
import { startBackupScheduler, stopBackupScheduler } from './utils/backup.service.js';
import { pruneExpiredRefreshTokens, verifyRefreshToken } from './utils/jwt.utils.js';
import { puedeVerUpload, type ActorUpload } from './utils/upload-access.utils.js';
import { DEBUG_AUTH, avisarModoDebug } from './utils/debug-auth.utils.js';
import { startFeriadosSync, stopFeriadosSync } from './utils/feriados-sync.service.js';
import { instalarMensajesEnCastellano } from './utils/zod-es.js';

// El override de zod se guarda en un módulo singleton (zod/v3/errors.js) y se
// consulta recién cuando se genera un issue durante el parseo, no cuando se
// define el schema — así que da igual que los routers de arriba ya hayan
// construido sus schemas de zod al importarse: nadie los parsea todavía.
instalarMensajesEnCastellano();

const prisma = new PrismaClient();

const app = express();
const PORT = parseInt(process.env.PORT ?? '4000', 10);
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000';

const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? FRONTEND_URL)
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, '')) // el header Origin nunca trae barra final
  .filter(Boolean);

// ─── Middlewares globales ────────────────────────

// El API nunca queda expuesto directo: siempre hay un proxy adelante (nginx en
// producción, el proxy de Vite en desarrollo, cloudflared en el túnel). Sin esto
// req.ip es la IP del proxy para todo el mundo y los rate limiters por IP pasan a
// ser un único balde compartido por toda la empresa. Se confía en un solo salto
// (nunca `true`, que aceptaría cualquier X-Forwarded-For falsificado); si el
// despliegue tiene más proxies encadenados se ajusta con TRUST_PROXY.
const TRUST_PROXY_HOPS = Number.parseInt(process.env.TRUST_PROXY ?? '1', 10);
app.set('trust proxy', Number.isNaN(TRUST_PROXY_HOPS) ? 1 : TRUST_PROXY_HOPS);

app.use(helmet());

function origenPermitido(origin: string): boolean {
  // En desarrollo, permitir IPs privadas RFC-1918, localhost y túneles
  if (process.env.NODE_ENV === 'development') {
    try {
      const host = new URL(origin).hostname;
      const isPrivate =
        host === 'localhost' || host === '127.0.0.1' ||
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host);
      const isTunnel =
        host.endsWith('.trycloudflare.com') || host.includes('ngrok');
      if (isPrivate || isTunnel) return true;
    } catch {
      // origin inválido, cae al check normal
    }
  }

  // Whitelist por igualdad exacta: comparar por substring convertía cualquier
  // entrada de túnel en un comodín (*.trycloudflare.com se levanta en segundos).
  return CORS_ORIGINS.includes(origin);
}

// Private Network Access: Chrome requires this header for LAN → localhost requests.
// Va antes de cors() porque el preflight lo termina de responder cors() mismo.
// Solo en el preflight, fuera de producción y para un origen ya autorizado:
// emitirlo siempre y en todos los entornos renuncia para siempre a la protección
// PNA del navegador.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (
    req.method === 'OPTIONS' &&
    process.env.NODE_ENV !== 'production' &&
    origin && origenPermitido(origin)
  ) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    // Allow no-origin requests (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (origenPermitido(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // x-debug-clave: la manda el selector de usuarios de debug del login. En el
  // despliegue normal el front es del mismo origen y no hay preflight, pero sin
  // esto el modo debug muere sin explicación si alguna vez queda cross-origin.
  allowedHeaders: ['Content-Type', 'Authorization', 'Access-Control-Request-Private-Network', 'x-debug-clave'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(morgan('dev'));

// Rate limiter for auth endpoints — disabled in DEBUG_AUTH mode so integration tests can run freely

// Respaldo global: tope amplio por IP para que ninguna ruta quede sin freno.
// Está calibrado muy por encima del uso normal (el front hace polling de
// notificaciones y carga adjuntos), así que solo corta abusos evidentes.
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: DEBUG_AUTH ? 100000 : 600,
  message: { error: 'Demasiadas solicitudes, espere un momento' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: DEBUG_AUTH ? 1000 : 10,
  message: { error: 'Demasiados intentos, intente nuevamente en 15 minutos' },
  standardHeaders: true,
  legacyHeaders: false,
  // Los logins exitosos no gastan cupo: si no, en un cambio de turno el
  // empleado 11 de la ventana queda afuera sin que haya ningún ataque.
  skipSuccessfulRequests: true,
});

// Cupo por cuenta además del cupo por IP: sin esto la fuerza bruta contra un
// usuario puntual sale gratis rotando de IP, y con esto quemar el cupo de una
// cuenta no bloquea al resto del personal.
const loginCuentaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: DEBUG_AUTH ? 1000 : 10,
  message: { error: 'Demasiados intentos, intente nuevamente en 15 minutos' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return email ? `cuenta:${email}` : `sin-email:${req.ip ?? 'desconocida'}`;
  },
});

app.use('/api/v1/auth/login', authLimiter, loginCuentaLimiter);

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

// En /uploads viven certificados médicos, fotos de tarjetas WENTOP y avatares:
// servirlos en abierto es publicar datos de salud a cualquiera que tenga el link.
// No se puede exigir el header Authorization porque las <img>/<a download> del
// front no lo mandan; se usa la cookie httpOnly 'refreshToken', que el navegador
// sí manda sola porque /uploads pasa por el mismo origen (proxy de Vite en
// desarrollo, nginx en producción).
//
// La autorización es por persona, no por empresa: ver puedeVerUpload(). Comparar
// tenants dejaba el certificado de un compañero a un UUID adivinado de distancia.

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
const CACHE_UPLOADS_MS = 60 * 1000;

/** Cache chico con TTL para no pegarle a la base una vez por imagen del listado. */
function cacheConTtl<T>(maxEntradas = 500) {
  const datos = new Map<string, { valor: T; expira: number }>();
  return {
    obtener(clave: string): T | undefined {
      const hit = datos.get(clave);
      if (!hit) return undefined;
      if (Date.now() > hit.expira) {
        datos.delete(clave);
        return undefined;
      }
      return hit.valor;
    },
    guardar(clave: string, valor: T): void {
      if (datos.size >= maxEntradas) datos.clear();
      datos.set(clave, { valor, expira: Date.now() + CACHE_UPLOADS_MS });
    },
  };
}

const cacheSesionUpload = cacheConTtl<ActorUpload | null>();
const cachePermisoArchivo = cacheConTtl<boolean>();

async function sesionDesdeCookie(token: string): Promise<ActorUpload | null> {
  // La cookie se guarda hasheada para no dejar el token en claro en memoria.
  const clave = crypto.createHash('sha256').update(token).digest('hex');
  const cacheada = cacheSesionUpload.obtener(clave);
  if (cacheada !== undefined) return cacheada;

  const usuarioId = await verifyRefreshToken(token);
  const usuario = usuarioId
    ? await prisma.usuario.findUnique({
        where: { id: usuarioId },
        select: { id: true, empresaId: true, activo: true, rol: true, sectorId: true },
      })
    : null;

  let sesion: ActorUpload | null = null;
  if (usuario?.activo) {
    // El nivel vive en RolConfig por empresa, igual que en el login: sin él la
    // autorización por rol de acá abajo trataría a un RRHH como a un operador.
    const rolConfig = await prisma.rolConfig.findFirst({
      where: { empresaId: usuario.empresaId, codigo: usuario.rol, activo: true },
      select: { nivel: true },
    });
    sesion = {
      userId: usuario.id,
      empresaId: usuario.empresaId,
      rol: usuario.rol,
      rolNivel: rolConfig?.nivel ?? 0,
      sectorId: usuario.sectorId,
    };
  }

  cacheSesionUpload.guardar(clave, sesion);
  return sesion;
}

app.use('/uploads', (req, res, next) => {
  const token = req.cookies?.refreshToken;
  if (typeof token !== 'string' || !token) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  let nombre: string;
  try {
    const pedido = decodeURIComponent(req.path).replace(/^\/+/, '');
    // El directorio de uploads es plano: multer escribe el archivo ahí mismo. Si
    // llega una ruta con subcarpetas, el guard autorizaría el basename mientras
    // express.static sirve otra cosa — se rechaza antes de que haya discrepancia.
    if (pedido !== path.basename(pedido)) {
      res.status(404).json({ error: 'Archivo no encontrado' });
      return;
    }
    nombre = pedido;
  } catch {
    res.status(400).json({ error: 'Nombre de archivo inválido' });
    return;
  }

  sesionDesdeCookie(token)
    .then(async (sesion) => {
      if (!sesion) {
        res.status(401).json({ error: 'No autenticado' });
        return;
      }

      // La decisión es por persona, así que la cache va por (usuario, archivo):
      // con la clave sólo en la URL el primer autorizado habilitaba a los demás.
      const url = `/uploads/${nombre}`;
      const claveCache = `${sesion.userId}|${url}`;
      let permitido = cachePermisoArchivo.obtener(claveCache);
      if (permitido === undefined) {
        permitido = await puedeVerUpload(url, sesion);
        cachePermisoArchivo.guardar(claveCache, permitido);
      }

      if (!permitido) {
        // 404 y no 403: que no se pueda usar la respuesta para confirmar que el
        // archivo existe ni de quién es.
        res.status(404).json({ error: 'Archivo no encontrado' });
        return;
      }
      next();
    })
    .catch(next);
});

app.use('/uploads', express.static(UPLOADS_DIR, {
  // Adjuntos privados: que no queden en caches compartidas ni de proxies.
  setHeaders: (res) => res.setHeader('Cache-Control', 'private, max-age=300'),
}));

// ─── Rutas ───────────────────────────────────────

app.use('/api/v1', routes);

// ─── Error handler global ────────────────────────

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // body-parser (JSON malformado) y errores tipados adjuntan status/statusCode 4xx
  const status = err?.status ?? err?.statusCode;
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'JSON inválido en el cuerpo de la solicitud' });
    return;
  }
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: err.message ?? 'Solicitud inválida' });
    return;
  }
  // Multer: campo inesperado, límite de tamaño, etc. Los mensajes propios de
  // multer vienen en inglés, así que se traducen los casos que puede ver un usuario.
  if (err?.name === 'MulterError') {
    const mensajes: Record<string, string> = {
      LIMIT_FILE_SIZE: 'El archivo supera el tamaño máximo permitido (5 MB)',
      LIMIT_FILE_COUNT: 'Se enviaron demasiados archivos a la vez',
      LIMIT_UNEXPECTED_FILE: 'Campo de archivo inesperado',
      LIMIT_FIELD_COUNT: 'El formulario tiene demasiados campos',
    };
    res.status(400).json({ error: mensajes[err.code] ?? `Error de carga de archivo: ${err.message}` });
    return;
  }
  // Prisma: referencia inválida / dato fuera de rango → 400, no encontrado → 404
  if (err?.code === 'P2003' || err?.code === 'P2000' || err?.code === 'P2011') {
    res.status(400).json({ error: 'Referencia o dato inválido' });
    return;
  }
  if (err?.code === 'P2025') {
    res.status(404).json({ error: 'Recurso no encontrado' });
    return;
  }
  console.error('Error no manejado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ─── Iniciar servidor ────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 API Planilla de Horas corriendo en http://0.0.0.0:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/api/v1/health`);
  console.log(`🔑 Login: POST http://localhost:${PORT}/api/v1/auth/login\n`);

  avisarModoDebug();

  // Start backup scheduler with DB health monitoring
  startBackupScheduler(prisma);

  // Feriados nacionales al día: sin esto el recargo del 100% depende de una lista
  // escrita a mano que envejece con cada año nuevo.
  startFeriadosSync();

  // Prune expired refresh tokens daily
  setInterval(() => {
    pruneExpiredRefreshTokens().catch((err) => console.error('Error pruning refresh tokens:', err));
  }, 24 * 60 * 60 * 1000);
});

// Graceful shutdown
function apagar(codigo: number): void {
  stopBackupScheduler();
  stopFeriadosSync();
  prisma.$disconnect();
  process.exit(codigo);
}

process.on('SIGTERM', () => apagar(0));
process.on('SIGINT', () => apagar(0));

// Red de seguridad para los timers de fondo (backups, prune): un rechazo suelto
// no puede tirar abajo las sesiones de todo el personal. Se loguea y se sigue.
process.on('unhandledRejection', (reason) => {
  console.error('Promesa rechazada sin manejar:', reason);
});

// Una excepción no capturada sí deja el proceso en estado indefinido: se loguea
// y se cierra ordenado para que el supervisor (Docker restart: always) lo levante.
process.on('uncaughtException', (err) => {
  console.error('Excepción no capturada:', err);
  apagar(1);
});

export default app;
