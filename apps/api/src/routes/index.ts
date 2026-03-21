import { Router } from 'express';
import authRoutes from './auth.routes.js';
import usuariosRoutes from './usuarios.routes.js';
import adminSectoresRoutes from './admin.sectores.routes.js';
import adminDiagramasRoutes from './admin.diagramas.routes.js';
import adminConveniosRoutes from './admin.convenios.routes.js';
import planillasRoutes from './planillas.routes.js';
import adminFlujosRoutes from './admin.flujos.routes.js';
import vacacionesRoutes from './vacaciones.routes.js';
import ausenciasRoutes from './ausencias.routes.js';
import analyticsRoutes from './analytics.routes.js';
import adminConfigRoutes from './admin.config.routes.js';
import adminConceptosRoutes from './admin.conceptos.routes.js';
import adminRolesRoutes from './admin.roles.routes.js';
import exportRoutes from './export.routes.js';
import notificacionesRoutes from './notificaciones.routes.js';
import recibosRoutes from './recibos.routes.js';
import exportacionesRoutes from './exportaciones.routes.js';
import vacacionSaldosRoutes from './vacacion-saldos.routes.js';
import aprobacionesRoutes from './aprobaciones.routes.js';
import backupRoutes from './backup.routes.js';
import mensajesRoutes from './mensajes.routes.js';

const router = Router();

// Health check
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth
router.use('/auth', authRoutes);

// Usuarios
router.use('/usuarios', usuariosRoutes);

// Planillas + Registros
router.use('/planillas', planillasRoutes);

// Vacaciones + Ausencias
router.use('/vacaciones', vacacionesRoutes);
router.use('/vacacion-saldos', vacacionSaldosRoutes);
router.use('/aprobaciones', aprobacionesRoutes);
router.use('/ausencias', ausenciasRoutes);

// Mensajes
router.use('/mensajes', mensajesRoutes);

// Analytics
router.use('/analytics', analyticsRoutes);

// Export
router.use('/export', exportRoutes);

// Notificaciones
router.use('/notificaciones', notificacionesRoutes);

// Recibos + Exportaciones
router.use('/recibos', recibosRoutes);
router.use('/exportaciones', exportacionesRoutes);

// Admin
router.use('/admin/sectores', adminSectoresRoutes);
router.use('/admin/diagramas', adminDiagramasRoutes);
router.use('/admin/flujos', adminFlujosRoutes);
router.use('/admin/config', adminConfigRoutes);
router.use('/admin/conceptos', adminConceptosRoutes);
router.use('/admin', adminConveniosRoutes);
router.use('/admin/roles', adminRolesRoutes);

// Backup
router.use('/backup', backupRoutes);

export default router;
