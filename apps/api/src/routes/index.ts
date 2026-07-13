import { Router } from 'express';
import authRoutes from './auth.routes.js';
import usuariosRoutes from './usuarios.routes.js';
import adminSectoresRoutes from './admin.sectores.routes.js';
import adminDiagramasRoutes from './admin.diagramas.routes.js';
import planillasRoutes from './planillas.routes.js';
import adminFlujosRoutes from './admin.flujos.routes.js';
import vacacionesRoutes from './vacaciones.routes.js';
import ausenciasRoutes from './ausencias.routes.js';
import analyticsRoutes from './analytics.routes.js';
import adminConfigRoutes from './admin.config.routes.js';
import adminRolesRoutes from './admin.roles.routes.js';
import exportRoutes from './export.routes.js';
import notificacionesRoutes from './notificaciones.routes.js';
import exportacionesRoutes from './exportaciones.routes.js';
import vacacionSaldosRoutes from './vacacion-saldos.routes.js';
import aprobacionesRoutes from './aprobaciones.routes.js';
import backupRoutes from './backup.routes.js';
import mensajesRoutes from './mensajes.routes.js';
import adminAlertasRoutes from './admin.alertas.routes.js';
import capacitacionesRoutes from './capacitaciones.routes.js';
import sesionesCapacitacionRoutes from './sesiones-capacitacion.routes.js';
import auditoriaRoutes from './auditoria.routes.js';
import cambiosDiagramaRoutes from './cambios-diagrama.routes.js';
import misSolicitudesRoutes from './mis-solicitudes.routes.js';
import wentopRoutes from './wentop.routes.js';

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
router.use('/cambios-diagrama', cambiosDiagramaRoutes);
router.use('/mis-solicitudes', misSolicitudesRoutes);

// Mensajes
router.use('/mensajes', mensajesRoutes);

// Analytics
router.use('/analytics', analyticsRoutes);

// Export
router.use('/export', exportRoutes);

// Notificaciones
router.use('/notificaciones', notificacionesRoutes);

// Exportaciones
router.use('/exportaciones', exportacionesRoutes);

// Admin
router.use('/admin/sectores', adminSectoresRoutes);
router.use('/admin/diagramas', adminDiagramasRoutes);
router.use('/admin/flujos', adminFlujosRoutes);
router.use('/admin/config', adminConfigRoutes);
router.use('/admin/roles', adminRolesRoutes);
router.use('/admin/alertas', adminAlertasRoutes);

// Capacitaciones
router.use('/capacitaciones', capacitacionesRoutes);
router.use('/sesiones-capacitacion', sesionesCapacitacionRoutes);

// Auditoría
router.use('/auditoria', auditoriaRoutes);

// WENTOP (observation cards)
router.use('/wentop', wentopRoutes);

// Backup
router.use('/backup', backupRoutes);

export default router;
