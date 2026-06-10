import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_RRHH, LEVEL_CMASS } from '../middleware/roles.middleware.js';
import { upload } from '../middleware/upload.middleware.js';
import { unlink } from 'fs/promises';
import path from 'path';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// ─── Constants ───────────────────────────────────

const VALID_TIPOS = ['DETENCION_TAREAS', 'CONDICION_INSEGURA', 'ACTO_INSEGURO', 'CASI_ACCIDENTE', 'OBSERVACION_POSITIVA'] as const;

// ─── Helper ──────────────────────────────────────

async function canManageWentop(
  userId: string,
  rol: string,
  rolNivel: number,
  sectorObservacionId: string | null,
): Promise<boolean> {
  if (rol === 'CMASS' || rolNivel >= 90) return true;

  if (rolNivel >= 70 && sectorObservacionId) {
    const user = await prisma.usuario.findUnique({
      where: { id: userId },
      select: { sectorId: true },
    });
    if (user?.sectorId === sectorObservacionId) return true;
  }

  if (sectorObservacionId) {
    const gestor = await prisma.wentopGestor.findFirst({
      where: { usuarioId: userId, sectorId: sectorObservacionId, activo: true },
    });
    if (gestor) return true;
  }

  return false;
}

// Build visibility filter for tarjetas — based on observation sector
async function buildVisibilityWhere(user: { userId: string; empresaId: string; rol: string; rolNivel: number }) {
  const base: any = { empresaId: user.empresaId };

  if (user.rol === 'CMASS' || user.rolNivel >= 90) {
    return base;
  }

  const usuario = await prisma.usuario.findUnique({
    where: { id: user.userId },
    select: { sectorId: true },
  });

  const gestorSectors = await prisma.wentopGestor.findMany({
    where: { usuarioId: user.userId, activo: true },
    select: { sectorId: true },
  });

  const sectorIds: string[] = [];
  if (usuario?.sectorId) sectorIds.push(usuario.sectorId);
  for (const g of gestorSectors) {
    if (!sectorIds.includes(g.sectorId)) sectorIds.push(g.sectorId);
  }

  return {
    ...base,
    OR: [
      { sectorObservacionId: { in: sectorIds } },
      { creadorId: user.userId },
    ],
  };
}

const tarjetaInclude = {
  creador: { select: { nombre: true, apellido: true, legajo: true, sector: { select: { id: true, nombre: true } } } },
  sectorObservacion: { select: { id: true, nombre: true } },
  _count: { select: { fotos: true } },
};

const tarjetaDetailInclude = {
  creador: { select: { nombre: true, apellido: true, legajo: true, sector: { select: { id: true, nombre: true } } } },
  sectorObservacion: { select: { id: true, nombre: true } },
  fotos: true,
};

// ─── GET /wentop/analytics ───────────────────────

router.get('/analytics', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const where = await buildVisibilityWhere(req.user!);

    const tarjetas = await prisma.wentopTarjeta.findMany({
      where,
      select: {
        estado: true,
        tipoTarjeta: true,
        sectorObservacionId: true,
        sectorObservacion: { select: { nombre: true } },
        fechaReporte: true,
        calidad: true,
        medioambiente: true,
        seguridadSalud: true,
      },
    });

    const total = tarjetas.length;
    const abierta = tarjetas.filter((t) => t.estado === 'ABIERTA').length;
    const enProgreso = tarjetas.filter((t) => t.estado === 'EN_PROGRESO').length;
    const cerrada = tarjetas.filter((t) => t.estado === 'CERRADA').length;

    // Por tipo
    const tipoMap = new Map<string, number>();
    for (const t of tarjetas) {
      tipoMap.set(t.tipoTarjeta, (tipoMap.get(t.tipoTarjeta) || 0) + 1);
    }
    const porTipo = Array.from(tipoMap.entries()).map(([tipo, count]) => ({ tipo, count }));

    // Por sector
    const sectorMap = new Map<string, { sectorNombre: string; count: number }>();
    for (const t of tarjetas) {
      if (t.sectorObservacionId) {
        const existing = sectorMap.get(t.sectorObservacionId);
        if (existing) {
          existing.count++;
        } else {
          sectorMap.set(t.sectorObservacionId, {
            sectorNombre: t.sectorObservacion?.nombre || '',
            count: 1,
          });
        }
      }
    }
    const porSector = Array.from(sectorMap.entries()).map(([sectorId, v]) => ({
      sectorId,
      sectorNombre: v.sectorNombre,
      count: v.count,
    }));

    // Por mes
    const mesMap = new Map<string, number>();
    for (const t of tarjetas) {
      const d = new Date(t.fechaReporte);
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      mesMap.set(mes, (mesMap.get(mes) || 0) + 1);
    }
    const porMes = Array.from(mesMap.entries())
      .map(([mes, count]) => ({ mes, count }))
      .sort((a, b) => a.mes.localeCompare(b.mes));

    // Por categoría — parse JSON arrays and count label occurrences
    function countLabels(items: any[], field: string): { label: string; count: number }[] {
      const map = new Map<string, number>();
      for (const item of items) {
        const arr = item[field];
        if (Array.isArray(arr)) {
          for (const label of arr) {
            if (typeof label === 'string') {
              map.set(label, (map.get(label) || 0) + 1);
            }
          }
        }
      }
      return Array.from(map.entries()).map(([label, count]) => ({ label, count }));
    }

    const porCategoria = {
      calidad: countLabels(tarjetas, 'calidad'),
      medioambiente: countLabels(tarjetas, 'medioambiente'),
      seguridadSalud: countLabels(tarjetas, 'seguridadSalud'),
    };

    res.json({
      totales: { total, abierta, enProgreso, cerrada },
      porTipo,
      porSector,
      porMes,
      porCategoria,
    });
  } catch (error) {
    console.error('Error fetching wentop analytics:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── GET /wentop/mis-gestores ────────────────────
// Returns the current user's gestor sector assignments (no role guard)

router.get('/mis-gestores', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const gestores = await prisma.wentopGestor.findMany({
      where: { usuarioId: req.user!.userId, activo: true },
      select: { sectorId: true },
    });
    res.json(gestores.map((g) => g.sectorId));
  } catch (error) {
    console.error('Error fetching mis gestores:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── GET /wentop/gestores ────────────────────────

router.get('/gestores', requireLevel(LEVEL_CMASS), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const gestores = await prisma.wentopGestor.findMany({
      where: { empresaId: req.user!.empresaId, activo: true },
      include: {
        usuario: { select: { nombre: true, apellido: true, email: true, legajo: true } },
        sector: { select: { nombre: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(gestores);
  } catch (error) {
    console.error('Error listing wentop gestores:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /wentop/gestores ───────────────────────

router.post('/gestores', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { usuarioId, sectorId } = req.body;

    if (!usuarioId || !sectorId) {
      res.status(400).json({ error: 'usuarioId y sectorId son requeridos' });
      return;
    }

    // Validate both IDs belong to the same empresa
    const [usuario, sector] = await Promise.all([
      prisma.usuario.findFirst({ where: { id: usuarioId, empresaId: req.user!.empresaId }, select: { id: true } }),
      prisma.sector.findFirst({ where: { id: sectorId, empresaId: req.user!.empresaId }, select: { id: true } }),
    ]);

    if (!usuario) {
      res.status(400).json({ error: 'Usuario no encontrado en esta empresa' });
      return;
    }
    if (!sector) {
      res.status(400).json({ error: 'Sector no encontrado en esta empresa' });
      return;
    }

    const gestor = await prisma.wentopGestor.upsert({
      where: { usuarioId_sectorId: { usuarioId, sectorId } },
      update: { activo: true, empresaId: req.user!.empresaId },
      create: {
        empresaId: req.user!.empresaId,
        usuarioId,
        sectorId,
      },
      include: {
        usuario: { select: { nombre: true, apellido: true, email: true, legajo: true } },
        sector: { select: { nombre: true } },
      },
    });

    res.status(201).json(gestor);
  } catch (error) {
    console.error('Error creating wentop gestor:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── DELETE /wentop/gestores/:id ─────────────────

router.delete('/gestores/:id', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.wentopGestor.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Gestor no encontrado' });
      return;
    }

    await prisma.wentopGestor.update({
      where: { id: req.params.id },
      data: { activo: false },
    });

    res.status(204).send();
  } catch (error) {
    console.error('Error removing wentop gestor:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── GET /wentop ─────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { estado, tipoTarjeta, sectorId, desde, hasta } = req.query;

    const where: any = await buildVisibilityWhere(req.user!);

    if (estado) where.estado = estado as string;
    if (tipoTarjeta) where.tipoTarjeta = tipoTarjeta as string;
    if (sectorId) where.sectorObservacionId = sectorId as string;
    if (desde || hasta) {
      where.fechaReporte = {};
      if (desde) where.fechaReporte.gte = new Date(desde as string);
      if (hasta) where.fechaReporte.lte = new Date(hasta as string);
    }

    const tarjetas = await prisma.wentopTarjeta.findMany({
      where,
      include: tarjetaInclude,
      orderBy: { fechaReporte: 'desc' },
    });

    res.json(tarjetas);
  } catch (error) {
    console.error('Error listing wentop tarjetas:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── GET /wentop/:id ────────────────────────────

router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const where: any = await buildVisibilityWhere(req.user!);
    where.id = req.params.id;

    const tarjeta = await prisma.wentopTarjeta.findFirst({
      where,
      include: tarjetaDetailInclude,
    });

    if (!tarjeta) {
      res.status(404).json({ error: 'Tarjeta no encontrada' });
      return;
    }

    res.json(tarjeta);
  } catch (error) {
    console.error('Error fetching wentop tarjeta:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /wentop ────────────────────────────────

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      fechaReporte,
      sectorObservacionId,
      sectorTercero,
      cliente,
      lugarPozoLocacion,
      tipoTarjeta,
      calidad,
      medioambiente,
      seguridadSalud,
      descripcion,
      accionesInmediatas,
      recomendaciones,
      justificacionAbierta,
    } = req.body;

    if (!fechaReporte || !tipoTarjeta || !descripcion) {
      res.status(400).json({ error: 'fechaReporte, tipoTarjeta y descripcion son requeridos' });
      return;
    }

    if (!VALID_TIPOS.includes(tipoTarjeta)) {
      res.status(400).json({ error: `tipoTarjeta inválido. Valores válidos: ${VALID_TIPOS.join(', ')}` });
      return;
    }

    const tarjeta = await prisma.wentopTarjeta.create({
      data: {
        empresaId: req.user!.empresaId,
        creadorId: req.user!.userId,
        estado: 'ABIERTA',
        fechaReporte: new Date(fechaReporte),
        sectorObservacionId: sectorObservacionId || null,
        sectorTercero: sectorTercero ?? false,
        cliente: cliente || null,
        lugarPozoLocacion: lugarPozoLocacion || null,
        tipoTarjeta,
        calidad: calidad ?? [],
        medioambiente: medioambiente ?? [],
        seguridadSalud: seguridadSalud ?? [],
        descripcion,
        accionesInmediatas: accionesInmediatas || null,
        recomendaciones: recomendaciones || null,
        justificacionAbierta: justificacionAbierta || null,
      },
      include: tarjetaDetailInclude,
    });

    res.status(201).json(tarjeta);
  } catch (error) {
    console.error('Error creating wentop tarjeta:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── PUT /wentop/:id ─────────────────────────────

router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tarjeta = await prisma.wentopTarjeta.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
    });

    if (!tarjeta) {
      res.status(404).json({ error: 'Tarjeta no encontrada' });
      return;
    }

    const isCreator = tarjeta.creadorId === req.user!.userId;
    const canManage = await canManageWentop(req.user!.userId, req.user!.rol, req.user!.rolNivel, tarjeta.sectorObservacionId);

    if (!isCreator && !canManage) {
      res.status(403).json({ error: 'No tiene permisos para editar esta tarjeta' });
      return;
    }

    if (tarjeta.estado === 'CERRADA' && req.user!.rolNivel < 90) {
      res.status(400).json({ error: 'No se puede editar una tarjeta cerrada' });
      return;
    }

    const {
      fechaReporte,
      sectorObservacionId,
      sectorTercero,
      cliente,
      lugarPozoLocacion,
      tipoTarjeta,
      calidad,
      medioambiente,
      seguridadSalud,
      descripcion,
      accionesInmediatas,
      recomendaciones,
      justificacionAbierta,
    } = req.body;

    const updated = await prisma.wentopTarjeta.update({
      where: { id: req.params.id },
      data: {
        ...(fechaReporte !== undefined && { fechaReporte: new Date(fechaReporte) }),
        ...(sectorObservacionId !== undefined && { sectorObservacionId: sectorObservacionId || null }),
        ...(sectorTercero !== undefined && { sectorTercero }),
        ...(cliente !== undefined && { cliente: cliente || null }),
        ...(lugarPozoLocacion !== undefined && { lugarPozoLocacion: lugarPozoLocacion || null }),
        ...(tipoTarjeta !== undefined && { tipoTarjeta }),
        ...(calidad !== undefined && { calidad }),
        ...(medioambiente !== undefined && { medioambiente }),
        ...(seguridadSalud !== undefined && { seguridadSalud }),
        ...(descripcion !== undefined && { descripcion }),
        ...(accionesInmediatas !== undefined && { accionesInmediatas: accionesInmediatas || null }),
        ...(recomendaciones !== undefined && { recomendaciones: recomendaciones || null }),
        ...(justificacionAbierta !== undefined && { justificacionAbierta: justificacionAbierta || null }),
      },
      include: tarjetaDetailInclude,
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating wentop tarjeta:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── PATCH /wentop/:id/estado ────────────────────

router.patch('/:id/estado', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tarjeta = await prisma.wentopTarjeta.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
    });

    if (!tarjeta) {
      res.status(404).json({ error: 'Tarjeta no encontrada' });
      return;
    }

    const isCreator = tarjeta.creadorId === req.user!.userId;
    const canManage = await canManageWentop(req.user!.userId, req.user!.rol, req.user!.rolNivel, tarjeta.sectorObservacionId);

    if (!isCreator && !canManage) {
      res.status(403).json({ error: 'No tiene permisos para cambiar el estado' });
      return;
    }

    const { estado, accionCierre, fechaCierre } = req.body;

    if (!estado || !['ABIERTA', 'EN_PROGRESO', 'CERRADA'].includes(estado)) {
      res.status(400).json({ error: 'Estado inválido' });
      return;
    }

    const data: any = { estado };

    if (estado === 'CERRADA') {
      if (!accionCierre) {
        res.status(400).json({ error: 'accionCierre es requerido para cerrar la tarjeta' });
        return;
      }
      data.accionCierre = accionCierre;
      data.fechaCierre = fechaCierre ? new Date(fechaCierre) : new Date();
    } else {
      // Clear closure data when reopening
      data.accionCierre = null;
      data.fechaCierre = null;
    }

    const updated = await prisma.wentopTarjeta.update({
      where: { id: req.params.id },
      data,
      include: tarjetaDetailInclude,
    });

    res.json(updated);
  } catch (error) {
    console.error('Error changing wentop tarjeta estado:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── DELETE /wentop/:id ──────────────────────────

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tarjeta = await prisma.wentopTarjeta.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
    });

    if (!tarjeta) {
      res.status(404).json({ error: 'Tarjeta no encontrada' });
      return;
    }

    const isCreator = tarjeta.creadorId === req.user!.userId;
    const isAdmin = req.user!.rolNivel >= 90;

    if (!isAdmin && (!isCreator || tarjeta.estado !== 'ABIERTA')) {
      res.status(403).json({ error: 'Solo puede eliminar sus propias tarjetas en estado ABIERTA' });
      return;
    }

    // Collect photo URLs for cleanup after DB delete
    const fotos = await prisma.wentopFoto.findMany({
      where: { tarjetaId: tarjeta.id },
      select: { url: true },
    });

    // DB delete first (cascade deletes WentopFoto records)
    await prisma.wentopTarjeta.delete({ where: { id: req.params.id } });

    // Then clean up files from disk (best-effort)
    for (const foto of fotos) {
      const filename = foto.url.replace('/uploads/', '');
      const filePath = path.resolve(process.cwd(), 'uploads', filename);
      try {
        await unlink(filePath);
      } catch {
        // File may already be deleted
      }
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting wentop tarjeta:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── POST /wentop/:id/fotos ─────────────────────

router.post('/:id/fotos', upload.array('fotos', 10), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tarjeta = await prisma.wentopTarjeta.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
    });

    if (!tarjeta) {
      res.status(404).json({ error: 'Tarjeta no encontrada' });
      return;
    }

    const isCreator = tarjeta.creadorId === req.user!.userId;
    const canManage = await canManageWentop(req.user!.userId, req.user!.rol, req.user!.rolNivel, tarjeta.sectorObservacionId);

    if (!isCreator && !canManage) {
      res.status(403).json({ error: 'No tiene permisos para subir fotos a esta tarjeta' });
      return;
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No se enviaron archivos' });
      return;
    }

    const fotos = await Promise.all(
      files.map((file) =>
        prisma.wentopFoto.create({
          data: {
            tarjetaId: tarjeta.id,
            url: `/uploads/${file.filename}`,
          },
        }),
      ),
    );

    res.status(201).json(fotos);
  } catch (error) {
    console.error('Error uploading wentop fotos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── DELETE /wentop/:id/fotos/:fotoId ────────────

router.delete('/:id/fotos/:fotoId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tarjeta = await prisma.wentopTarjeta.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
    });

    if (!tarjeta) {
      res.status(404).json({ error: 'Tarjeta no encontrada' });
      return;
    }

    const isCreator = tarjeta.creadorId === req.user!.userId;
    const canManage = await canManageWentop(req.user!.userId, req.user!.rol, req.user!.rolNivel, tarjeta.sectorObservacionId);

    if (!isCreator && !canManage) {
      res.status(403).json({ error: 'No tiene permisos para eliminar fotos de esta tarjeta' });
      return;
    }

    const foto = await prisma.wentopFoto.findFirst({
      where: { id: req.params.fotoId, tarjetaId: tarjeta.id },
    });

    if (!foto) {
      res.status(404).json({ error: 'Foto no encontrada' });
      return;
    }

    const filename = foto.url.replace('/uploads/', '');
    const filePath = path.resolve(process.cwd(), 'uploads', filename);
    try {
      await unlink(filePath);
    } catch {
      // File may already be deleted
    }

    await prisma.wentopFoto.delete({ where: { id: foto.id } });

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting wentop foto:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
