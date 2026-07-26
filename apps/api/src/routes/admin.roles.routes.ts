import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { requireLevel, LEVEL_ADMIN, LEVEL_RRHH } from '../middleware/roles.middleware.js';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// GET /roles — list all roles for the empresa (RRHH+ only; used by user/role admin screens)
router.get('/', requireLevel(LEVEL_RRHH), async (req: AuthRequest, res: Response): Promise<void> => {
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

    // System roles (ADMIN, RRHH, …) must never be deactivated or have their level
    // changed — doing so could lock every user out of privileged actions.
    if (existing.esSistema) {
      if (parsed.data.activo === false) {
        res.status(403).json({ error: 'No se puede desactivar un rol del sistema' });
        return;
      }
      if (parsed.data.nivel !== undefined && parsed.data.nivel !== existing.nivel) {
        res.status(403).json({ error: 'No se puede cambiar el nivel de un rol del sistema' });
        return;
      }
    }

    // Desactivar un rol lo vuelve huérfano igual que borrarlo: `nivelesPorRol`
    // solo trae los activos, y un paso cuyo aprobador no tiene nivel no se
    // saltea nunca ni lo puede firmar nadie más que un ADMIN.
    //
    // Aun así NO se bloquea, a diferencia del borrado: desactivar es reversible
    // y es la salida natural para un rol que ya no se usa pero tiene histórico.
    // Un 409 acá dejaría al admin sin ninguna forma de sacarlo de circulación
    // mientras siga nombrado en un flujo viejo. Lo que sí corresponde es que no
    // pase en silencio, así que la respuesta lo avisa.
    let advertencia: string | undefined;
    if (parsed.data.activo === false && existing.activo) {
      const pasos = await prisma.flujoPaso.findMany({
        where: {
          flujo: { empresaId: existing.empresaId },
          OR: [{ rolAprobador: existing.codigo }, { notificarRoles: { has: existing.codigo } }],
        },
        include: { flujo: { select: { nombre: true } } },
      });
      if (pasos.length > 0) {
        const flujos = [...new Set(pasos.map((p) => p.flujo.nombre))].join(', ');
        advertencia = `El rol se usa en pasos de los flujos ${flujos}. Desactivado, esos pasos quedan sin nivel: no se saltean nunca y solo los puede aprobar un ADMIN. Cambiá esos pasos.`;
      }
    }

    const rol = await prisma.rolConfig.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json(advertencia ? { ...rol, advertencia } : rol);
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

    // Un rol borrado que seguía nombrado en un paso de flujo dejaba ese paso
    // huérfano: `nivelesPorRol` no lo trae, el circuito no lo puede saltear por
    // nivel y nadie salvo un ADMIN lo puede firmar. FlujoPaso no tiene empresa
    // propia, así que el filtro va por el flujo (dos empresas pueden usar el
    // mismo código de rol y el de la otra no tiene por qué bloquear este borrado).
    const pasos = await prisma.flujoPaso.findMany({
      where: {
        flujo: { empresaId: rol.empresaId },
        OR: [{ rolAprobador: rol.codigo }, { notificarRoles: { has: rol.codigo } }],
      },
      include: { flujo: { select: { nombre: true } } },
    });
    if (pasos.length > 0) {
      const flujos = [...new Set(pasos.map((p) => p.flujo.nombre))].join(', ');
      res.status(409).json({
        error: `No se puede eliminar: el rol se usa en pasos de los flujos ${flujos}. Cambiá esos pasos antes de borrarlo.`,
      });
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
