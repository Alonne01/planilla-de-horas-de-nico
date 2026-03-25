import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_ADMIN } from '../middleware/roles.middleware.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// GET /roles — list all roles for the empresa
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const empresaId = req.user!.empresaId;
    const roles = await prisma.rolConfig.findMany({
      where: { empresaId },
      orderBy: { nivel: 'desc' },
    });
    res.json(roles);
  } catch (error) {
    console.error('Error listing roles:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /roles — create a new role (ADMIN only)
router.post('/', requireLevel(LEVEL_ADMIN), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const schema = z.object({
      codigo: z.string().min(2).max(30).transform(s => s.toUpperCase().replace(/\s+/g, '_')),
      nombre: z.string().min(2).max(50),
      descripcion: z.string().max(200).optional(),
      color: z.string().max(7).optional(),
      nivel: z.number().int().min(0).max(99).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const empresaId = req.user!.empresaId;

    const existing = await prisma.rolConfig.findUnique({
      where: { empresaId_codigo: { empresaId, codigo: parsed.data.codigo } },
    });
    if (existing) {
      res.status(409).json({ error: `Ya existe un rol con código "${parsed.data.codigo}"` });
      return;
    }

    const rol = await prisma.rolConfig.create({
      data: {
        empresaId,
        codigo: parsed.data.codigo,
        nombre: parsed.data.nombre,
        descripcion: parsed.data.descripcion ?? null,
        color: parsed.data.color ?? '#6B7280',
        nivel: parsed.data.nivel ?? 50,
        esSistema: false,
      },
    });
    res.status(201).json(rol);
  } catch (error) {
    console.error('Error creating rol:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// PUT /roles/:id — update a role (ADMIN only)
router.put('/:id', requireLevel(LEVEL_ADMIN), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const schema = z.object({
      nombre: z.string().min(2).max(50).optional(),
      descripcion: z.string().max(200).optional(),
      color: z.string().max(7).optional(),
      nivel: z.number().int().min(0).max(99).optional(),
      activo: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    const existing = await prisma.rolConfig.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Rol no encontrado' });
      return;
    }

    const rol = await prisma.rolConfig.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json(rol);
  } catch (error) {
    console.error('Error updating rol:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// DELETE /roles/:id — delete a custom role (ADMIN only, cannot delete system roles)
router.delete('/:id', requireLevel(LEVEL_ADMIN), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rol = await prisma.rolConfig.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
    });
    if (!rol) {
      res.status(404).json({ error: 'Rol no encontrado' });
      return;
    }
    if (rol.esSistema) {
      res.status(403).json({ error: 'No se puede eliminar un rol del sistema' });
      return;
    }

    // Check if any users have this role
    const usersWithRole = await prisma.usuario.count({ where: { rol: rol.codigo, empresaId: rol.empresaId } });
    if (usersWithRole > 0) {
      res.status(409).json({ error: `No se puede eliminar: ${usersWithRole} usuario(s) tienen este rol asignado` });
      return;
    }

    await prisma.rolConfig.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting rol:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
