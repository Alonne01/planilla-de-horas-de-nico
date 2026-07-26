# Propiedad de la planilla, cancelaciones y visibilidad — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la planilla sea editable solo por su dueño, que el dueño pueda cancelar sus solicitudes sin firmar, que solo los aprobadores de nivel superior vean planillas ajenas, y dejar el plan B implementado pero apagado detrás de un flag por empresa.

**Architecture:** Backend Express + Prisma sobre PostgreSQL, front React + React Query. El plan B (marca manual) deja de ser un mini-flujo de aprobación propio y pasa a viajar con la planilla: se aprueba cuando se aprueba la planilla. La cancelación se centraliza en un endpoint único en `mis-solicitudes.routes.ts` que despacha por tipo. La visibilidad se arregla en un solo lugar (`visibility.utils.ts`) y se propaga a sus cuatro llamadores.

**Tech Stack:** TypeScript, Express 4, Prisma 5, Zod, React 18, TanStack Query, Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-26-propiedad-planilla-y-cancelaciones-design.md`

---

## Cómo correr los tests

Las suites QA son scripts black-box contra la API viva. Antes de correr cualquiera:

1. El server tiene que estar levantado en `http://localhost:4000` (`start-dev.bat` o `cd apps/api && npm run dev`).
2. `tsx watch` **no recarga** cambios en las rutas de forma confiable — tocá `apps/api/src/app.ts` (guardalo sin cambios) para forzar el reload después de editar una ruta.
3. Correr: `cd "apps/api" && npx tsx tests/qa/<nombre>.qa.ts`

El baseline de eslint del repo es 31 warnings: no hace falta bajarlo, sí no subirlo.

---

## Mapa de archivos

**Backend — modifica:**
- `apps/api/prisma/schema.prisma` — enums `AusenciaEstado`/`VacacionEstado` (+`CANCELADA`), `EmpresaConfig.marcaManualActiva`
- `apps/api/src/utils/visibility.utils.ts` — filtro de nivel
- `apps/api/src/utils/upload-access.utils.ts` — rama `ausencia` alineada con el filtro de nivel
- `apps/api/src/routes/planillas.routes.ts` — marcar-dia, DELETE marcas, avanzar, PATCH compensatorio; se van validar/validar-todo
- `apps/api/src/routes/ausencias.routes.ts` — guarda en `POST /:id/archivo`, `revocar` → `CANCELADA`
- `apps/api/src/routes/mis-solicitudes.routes.ts` — endpoint de cancelación, excluir marcas manuales, campo `cancelable`
- `apps/api/src/routes/config.routes.ts` — `GET /config/modulos`
- `apps/api/src/routes/admin.config.routes.ts` — `marcaManualActiva` en el schema de update

**Backend — crea:**
- `apps/api/src/utils/marca-manual.utils.ts` — helpers compartidos de saldo/limpieza de marcas

**Front — modifica:**
- `apps/web/src/pages/planillas/PlanillaDetailPage.tsx`
- `apps/web/src/pages/MisSolicitudesPage.tsx`
- `apps/web/src/pages/ausencias/AusenciasPage.tsx`
- `apps/web/src/pages/admin/ConfigPage.tsx`

**Tests — crea:**
- `apps/api/tests/qa/cancelaciones.qa.ts`
- `apps/api/tests/qa/visibilidad-nivel.qa.ts`

**Tests — modifica:**
- `apps/api/tests/qa/marca-manual.qa.ts` — reescrito para el modelo nuevo

---

## Task 1: Migración de base

**Files:**
- Modify: `apps/api/prisma/schema.prisma:40-46` (AusenciaEstado), `:24-30` (VacacionEstado), `:668-697` (EmpresaConfig)

- [ ] **Step 1: Agregar CANCELADA a los dos enums**

En `apps/api/prisma/schema.prisma`, dejar los enums así:

```prisma
enum VacacionEstado {
  BORRADOR
  PENDIENTE
  EN_REVISION
  APROBADA
  RECHAZADA
  CANCELADA
}
```

```prisma
enum AusenciaEstado {
  BORRADOR
  PENDIENTE
  EN_REVISION
  APROBADA
  RECHAZADA
  CANCELADA
}
```

- [ ] **Step 2: Agregar el flag del plan B a EmpresaConfig**

En el modelo `EmpresaConfig`, después de `moduloAnalyticsActivo`:

```prisma
  marcaManualActiva      Boolean  @default(false) @map("marca_manual_activa")
```

Nace en `false` a propósito: el plan B se entrega apagado.

- [ ] **Step 3: Correr la migración**

```bash
cd "apps/api" && npx prisma migrate dev --name cancelada-y-flag-marca-manual
```

Esperado: crea la migración, la aplica y regenera el cliente. Si pide confirmación por pérdida de datos, **parar**: agregar un valor a un enum y una columna con default no debería pedirla.

- [ ] **Step 4: Verificar que el cliente Prisma tiene los tipos nuevos**

```bash
cd "apps/api" && npx tsc --noEmit
```

Esperado: sin errores (el `tsconfig` no chequea `prisma/` ni `tests/`, así que esto valida `src/`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(prisma): estado CANCELADA y flag de marca manual"
```

---

## Task 2: Helpers compartidos de marca manual

Hoy la tabla de "qué saldo devolver según el estado de la marca" está escrita en `limpiarMarcasManuales` y en el `DELETE` de marcas, y va a hacer falta en un tercer lugar. Se extrae antes de tocar nada más.

**Files:**
- Create: `apps/api/src/utils/marca-manual.utils.ts`
- Modify: `apps/api/src/routes/planillas.routes.ts:1410-1425`

- [ ] **Step 1: Crear el helper**

Crear `apps/api/src/utils/marca-manual.utils.ts`:

```ts
import { Prisma } from '@prisma/client';
import { borrarUploadPorUrl } from '../middleware/upload.middleware.js';

/** Lo mínimo que hace falta de una marca para saber qué saldo devolver. */
export interface MarcaSaldo {
  usuarioId: string;
  tipo: string;
  estado: string;
  fechaInicio: Date;
}

/**
 * Devuelve al saldo el compensatorio que la marca tenía reservado (PENDIENTE) o
 * consumido (APROBADA). No hace nada para los otros tipos ni para marcas ya
 * canceladas/rechazadas, que no tienen nada reservado.
 *
 * El año se toma con getFullYear() LOCAL a propósito: es el mismo criterio que usan
 * la acumulación en `avanzar` y el flujo formal de compensatorios. Mezclarlo con UTC
 * acá desalinearía esta operación del resto del sistema de saldos.
 */
export async function devolverSaldoDeMarca(
  tx: Prisma.TransactionClient,
  marca: MarcaSaldo,
): Promise<void> {
  if (marca.tipo !== 'FRANCO_COMPENSATORIO') return;
  const anio = new Date(marca.fechaInicio).getFullYear();
  if (marca.estado === 'APROBADA') {
    await tx.vacacionSaldo.updateMany({
      where: { usuarioId: marca.usuarioId, anio },
      data: { compensatoriosUsados: { decrement: 1 } },
    });
  } else if (marca.estado === 'PENDIENTE') {
    await tx.vacacionSaldo.updateMany({
      where: { usuarioId: marca.usuarioId, anio },
      data: { compensatoriosPendientes: { decrement: 1 } },
    });
  }
}

/**
 * Borra del disco los certificados de un conjunto de marcas. Va FUERA de la
 * transacción: el filesystem no participa del rollback, así que se llama recién
 * cuando la transacción confirmó.
 */
export function borrarAdjuntosDeMarcas(urls: Array<string | null>): void {
  for (const url of urls) borrarUploadPorUrl(url);
}
```

- [ ] **Step 2: Reescribir `limpiarMarcasManuales` sobre el helper**

En `apps/api/src/routes/planillas.routes.ts`, reemplazar la función completa (líneas ~1410-1425) por:

```ts
// Libera el saldo comp. reservado/usado por las marcas manuales de una planilla
// y las elimina. Se usa al borrar la planilla (Ausencia.planillaId no tiene FK/cascade).
// Devuelve las URLs de los adjuntos para que el llamador los borre del disco DESPUÉS
// del commit: el filesystem no hace rollback.
async function limpiarMarcasManuales(tx: Prisma.TransactionClient, planillaId: string): Promise<string[]> {
  const marcas = await tx.ausencia.findMany({ where: { planillaId, cargaManual: true } });
  for (const m of marcas) {
    await devolverSaldoDeMarca(tx, m);
  }
  await tx.ausenciaHistorial.deleteMany({ where: { ausenciaId: { in: marcas.map(m => m.id) } } });
  await tx.ausencia.deleteMany({ where: { planillaId, cargaManual: true } });
  return marcas.map(m => m.archivoUrl).filter((u): u is string => u !== null);
}
```

Agregar el import arriba del archivo, junto a los demás de `../utils/`:

```ts
import { devolverSaldoDeMarca, borrarAdjuntosDeMarcas } from '../utils/marca-manual.utils.js';
```

- [ ] **Step 3: Usar el valor de retorno en el DELETE de planilla**

Buscar la llamada a `limpiarMarcasManuales` dentro de `router.delete('/:id', ...)` (~línea 1329). Capturar el retorno y borrar los archivos después del `$transaction`:

```ts
    let adjuntosHuerfanos: string[] = [];
    await prisma.$transaction(async (tx) => {
      adjuntosHuerfanos = await limpiarMarcasManuales(tx, planillaId);
      // ...el resto del cuerpo de la transacción queda igual...
    });
    borrarAdjuntosDeMarcas(adjuntosHuerfanos);
```

- [ ] **Step 4: Verificar que compila**

```bash
cd "apps/api" && npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/utils/marca-manual.utils.ts apps/api/src/routes/planillas.routes.ts
git commit -m "refactor(api): helper unico para el saldo y los adjuntos de las marcas"
```

---

## Task 3: Flag del plan B

**Files:**
- Modify: `apps/api/src/routes/config.routes.ts`, `apps/api/src/routes/admin.config.routes.ts:15-33`
- Test: `apps/api/tests/qa/marca-manual.qa.ts`

- [ ] **Step 1: Escribir el escenario que falla**

En `apps/api/tests/qa/marca-manual.qa.ts`, agregar al final de `main()`, antes del bloque de cleanup:

```ts
  await scenario('GET /config/modulos devuelve marcaManualActiva', async () => {
    const { status, body } = await get('/config/modulos', owner.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(typeof body.marcaManualActiva === 'boolean', `marcaManualActiva no es boolean: ${JSON.stringify(body)}`);
    info(`marcaManualActiva = ${body.marcaManualActiva}`);
  });
```

- [ ] **Step 2: Correr y ver que falla**

```bash
cd "apps/api" && npx tsx tests/qa/marca-manual.qa.ts
```

Esperado: `FAIL GET /config/modulos devuelve marcaManualActiva — HTTP 200 expected, got 404`

- [ ] **Step 3: Agregar el endpoint**

En `apps/api/src/routes/config.routes.ts`, antes del `export default router;`:

```ts
/**
 * GET /config/modulos — Flags de módulo que el front necesita para decidir qué
 * renderizar. Separado de /admin/config, que es ADMIN-only: cualquier usuario
 * autenticado necesita saber si el plan B está encendido.
 */
router.get('/modulos', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const config = await prisma.empresaConfig.findUnique({
      where: { empresaId: req.user!.empresaId },
      select: {
        marcaManualActiva: true,
        moduloVacacionesActivo: true,
        moduloAusenciasActivo: true,
        moduloAnalyticsActivo: true,
      },
    });
    if (!config) {
      res.status(404).json({ error: 'Configuración no encontrada' });
      return;
    }
    res.json(config);
  } catch (error) {
    console.error('Error getting modulos:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});
```

- [ ] **Step 4: Permitir que ADMIN lo cambie**

En `apps/api/src/routes/admin.config.routes.ts`, agregar al `updateConfigSchema`:

```ts
  marcaManualActiva: z.boolean().optional(),
```

- [ ] **Step 5: Tocar app.ts para forzar el reload y correr**

```bash
cd "apps/api" && npx tsx tests/qa/marca-manual.qa.ts
```

Esperado: `PASS GET /config/modulos devuelve marcaManualActiva` con `marcaManualActiva = false`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/config.routes.ts apps/api/src/routes/admin.config.routes.ts apps/api/tests/qa/marca-manual.qa.ts
git commit -m "feat(api): flag de marca manual expuesto y editable"
```

---

## Task 4: La marca es del dueño y se apaga con el flag

**Files:**
- Modify: `apps/api/src/routes/planillas.routes.ts:1427-1583` (marcar-dia)
- Test: `apps/api/tests/qa/marca-manual.qa.ts`

- [ ] **Step 1: Escribir los escenarios que fallan**

En `apps/api/tests/qa/marca-manual.qa.ts`, agregar. `sup` es el supervisor del owner, así que hoy el `POST` le devuelve 201 y tiene que pasar a 403:

```ts
  await scenario('flag apagado: el dueño NO puede marcar (403)', async () => {
    await put('/admin/config', { marcaManualActiva: false }, admin.token);
    const { status, body } = await post(`/planillas/${planillaOwnerId}/marcar-dia`,
      { fecha: diaLibre, tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    assertStatus(status, 403, JSON.stringify(body));
  });

  await scenario('flag encendido: el dueño marca (201)', async () => {
    await put('/admin/config', { marcaManualActiva: true }, admin.token);
    const { status, body } = await post(`/planillas/${planillaOwnerId}/marcar-dia`,
      { fecha: diaLibre, tipo: 'FALTA_JUSTIFICADA', descripcion: 'QA' }, owner.token);
    assertStatus(status, 201, JSON.stringify(body));
    assert(body.marcaManual?.estado === 'PENDIENTE', `nace PENDIENTE, no ${body.marcaManual?.estado}`);
    marcaId = body.marcaManual.id;
  });

  await scenario('el supervisor NO puede marcar en planilla ajena (403)', async () => {
    const { status, body } = await post(`/planillas/${planillaOwnerId}/marcar-dia`,
      { fecha: diaLibre2, tipo: 'FALTA_JUSTIFICADA' }, sup.token);
    assertStatus(status, 403, JSON.stringify(body));
  });

  await scenario('RRHH tampoco puede marcar en planilla ajena (403)', async () => {
    const { status, body } = await post(`/planillas/${planillaOwnerId}/marcar-dia`,
      { fecha: diaLibre2, tipo: 'FALTA_JUSTIFICADA' }, ana.token);
    assertStatus(status, 403, JSON.stringify(body));
  });
```

Declarar arriba de esos escenarios, junto a las otras variables de `main()`:

```ts
  let marcaId = '';
  let planillaOwnerId = '';
  let diaLibre = '';   // yyyy-mm-dd dentro del período, sin bloquear
  let diaLibre2 = '';
```

y crear la planilla del owner con un escenario de setup si no existe ya en el archivo (el archivo actual ya crea una: reusarla y asignarle `planillaOwnerId`).

- [ ] **Step 2: Correr y ver que falla**

```bash
cd "apps/api" && npx tsx tests/qa/marca-manual.qa.ts
```

Esperado: fallan los cuatro (`403 expected, got 201` en los de supervisor y RRHH; `403 expected, got 201` en el del flag apagado).

- [ ] **Step 3: Reescribir la autorización de `marcar-dia`**

En `apps/api/src/routes/planillas.routes.ts`, en `router.post('/:id/marcar-dia', ...)`, reemplazar el bloque de autorización (desde `const isOwner = ...` hasta el `if (!allowed.includes(planilla.estado))` inclusive) por:

```ts
    // La planilla es del dueño: nadie más carga días en ella, ni RRHH ni ADMIN.
    // Un aprobador que ve un error rechaza la planilla y la corrige el dueño.
    if (planilla.usuarioId !== actorId) {
      res.status(403).json({ error: 'Solo el dueño puede marcar días en su planilla' });
      return;
    }

    const config = await prisma.empresaConfig.findUnique({
      where: { empresaId },
      select: { marcaManualActiva: true },
    });
    if (!config?.marcaManualActiva) {
      res.status(403).json({ error: 'La marca manual de días no está habilitada' });
      return;
    }

    if (!ESTADOS_OWNER.includes(planilla.estado)) {
      res.status(400).json({ error: `No se puede marcar días con la planilla en estado ${planilla.estado}` });
      return;
    }
```

- [ ] **Step 4: Sacar la auto-validación**

En el mismo handler, borrar la línea `const autoValidada = isManager;` y reemplazar los usos:

```ts
        const aus = await tx.ausencia.create({
          data: {
            usuarioId: planilla.usuarioId,
            cargadaPorId: actorId,
            planillaId,
            cargaManual: true,
            tipo,
            estado: 'PENDIENTE',
            pasoActual: 0,
            fechaInicio: fecha,
            fechaFin: fecha,
            diasAusencia: 1,
            descripcion: parsed.data.descripcion ?? null,
            descuentaSueldo: tipo === 'FALTA_INJUSTIFICADA',
            porcentajeDescuento: tipo === 'FALTA_INJUSTIFICADA' ? 100 : 0,
            requiereAprobacion: true,
            aprobada: false,
            flujoId: null,
          },
        });

        await tx.ausenciaHistorial.create({
          data: {
            ausenciaId: aus.id,
            usuarioId: actorId,
            estadoNuevo: 'PENDIENTE',
            comentario: 'Marca manual del empleado (se aprueba con la planilla)',
          },
        });

        return aus;
```

Borrar el bloque `if (autoValidada && tipo === 'FRANCO_COMPENSATORIO') { ... }` que movía el saldo de pendientes a usados: ya no hay alta auto-validada.

En el `logAuditoria` de más abajo, reemplazar el texto por:

```ts
      descripcion: `Marca manual ${tipo} ${ymd(fecha)} (a aprobar con la planilla)`,
```

Borrar también la constante `ESTADOS_MANAGER` (línea ~1400) si no queda ningún uso.

- [ ] **Step 5: Correr y ver que pasan**

```bash
cd "apps/api" && npx tsx tests/qa/marca-manual.qa.ts
```

Esperado: los cuatro escenarios en PASS. Los escenarios viejos que probaban el alta por parte del supervisor van a fallar — se borran en el Task 6.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/planillas.routes.ts apps/api/tests/qa/marca-manual.qa.ts
git commit -m "feat(api): la marca manual la pone solo el dueno y detras del flag"
```

---

## Task 5: Borrar la marca cancela la solicitud

**Files:**
- Modify: `apps/api/src/routes/planillas.routes.ts:1712-1811` (DELETE marcas)
- Test: `apps/api/tests/qa/marca-manual.qa.ts`

- [ ] **Step 1: Escribir los escenarios que fallan**

```ts
  await scenario('el dueño borra su marca APROBADA', async () => {
    // La marca queda APROBADA porque la planilla se aprobó; se la rechaza para
    // devolverla a RECHAZADA y que vuelva a ser editable.
    const { status, body } = await del(`/planillas/${planillaOwnerId}/marcas/${marcaAprobadaId}`, owner.token);
    assertStatus(status, 204, JSON.stringify(body));
    const { body: pl } = await get(`/planillas/${planillaOwnerId}`, owner.token);
    const sigue = pl.registros.find((r: any) => r.marcaManual?.id === marcaAprobadaId);
    assert(!sigue, 'el registro del día quedó pegado a una marca borrada');
  });

  await scenario('el supervisor NO puede borrar marcas ajenas (403)', async () => {
    const { status, body } = await del(`/planillas/${planillaOwnerId}/marcas/${marcaId}`, sup.token);
    assertStatus(status, 403, JSON.stringify(body));
  });

  await scenario('con el flag apagado el dueño igual puede borrar', async () => {
    await put('/admin/config', { marcaManualActiva: false }, admin.token);
    const { status } = await del(`/planillas/${planillaOwnerId}/marcas/${marcaId}`, owner.token);
    assertStatus(status, 204, 'borrar debe seguir andando con el flag apagado');
    await put('/admin/config', { marcaManualActiva: true }, admin.token);
  });
```

- [ ] **Step 2: Correr y ver que falla**

```bash
cd "apps/api" && npx tsx tests/qa/marca-manual.qa.ts
```

Esperado: el del supervisor falla con `403 expected, got 200` (hoy el superior la rechaza en vez de recibir 403).

- [ ] **Step 3: Reescribir el handler completo**

Reemplazar `router.delete('/:id/marcas/:ausenciaId', ...)` entero por:

```ts
// ─── DELETE /planillas/:id/marcas/:ausenciaId ────────────
// Solo el dueño, con la planilla editable. Borrar el día cancela la solicitud:
// se va la Ausencia, su historial, el día bloqueado y el certificado adjunto.
// A diferencia de marcar, esto NO depende del flag: si quedaron marcas de cuando
// el plan B estuvo encendido, tienen que poder limpiarse.
router.delete('/:id/marcas/:ausenciaId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.id as string;
    const ausenciaId = req.params.ausenciaId as string;
    const actorId = req.user!.userId;

    const planilla = await prisma.planilla.findUnique({
      where: { id: planillaId },
      include: { usuario: { select: { id: true, empresaId: true } } },
    });
    if (!planilla || planilla.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }

    if (planilla.usuarioId !== actorId) {
      res.status(403).json({ error: 'Solo el dueño puede quitar marcas de su planilla' });
      return;
    }

    if (!ESTADOS_OWNER.includes(planilla.estado)) {
      res.status(400).json({ error: `No se puede quitar marcas con la planilla en estado ${planilla.estado}` });
      return;
    }

    const ausencia = await prisma.ausencia.findFirst({ where: { id: ausenciaId, planillaId, cargaManual: true } });
    if (!ausencia) {
      res.status(404).json({ error: 'Marca no encontrada' });
      return;
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Des-inyectar mientras el link todavía existe.
        await tx.registroHoras.deleteMany({ where: { planillaId, marcaManualId: ausenciaId } });
        await devolverSaldoDeMarca(tx, ausencia);
        await tx.ausenciaHistorial.deleteMany({ where: { ausenciaId } });
        const { count } = await tx.ausencia.deleteMany({ where: { id: ausenciaId } });
        if (count === 0) throw new Error('CONCURRENT_MODIFICATION');
      });
    } catch (err: unknown) {
      if ((err as Error)?.message === 'CONCURRENT_MODIFICATION') {
        res.status(409).json({ error: 'La marca fue modificada simultáneamente. Recargá la página.' });
        return;
      }
      throw err;
    }

    // Recién ahora: el filesystem no participa del rollback.
    borrarAdjuntosDeMarcas([ausencia.archivoUrl]);

    await recalcularTotalesPlanilla(planillaId);
    await logAuditoria({
      entidad: 'Ausencia', entidadId: ausenciaId, accion: 'ELIMINAR',
      descripcion: 'Marca manual quitada por el dueño (solicitud cancelada)', usuarioId: actorId,
    });

    res.status(204).send();
  } catch (error) {
    console.error('Error quitando marca:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});
```

- [ ] **Step 4: Correr y ver que pasan**

```bash
cd "apps/api" && npx tsx tests/qa/marca-manual.qa.ts
```

Esperado: los tres escenarios nuevos en PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/planillas.routes.ts apps/api/tests/qa/marca-manual.qa.ts
git commit -m "feat(api): borrar la marca cancela la solicitud y borra el adjunto"
```

---

## Task 6: Las marcas se aprueban con la planilla

**Files:**
- Modify: `apps/api/src/routes/planillas.routes.ts:615-622` (gate), `:697-725` (bloque APROBADA), borrar `:1586-1710` (validar y validar-todo)
- Test: `apps/api/tests/qa/marca-manual.qa.ts`

- [ ] **Step 1: Escribir el escenario que falla**

```ts
  await scenario('aprobar la planilla aprueba sus marcas', async () => {
    await post(`/planillas/${planillaAprobarId}/marcar-dia`, { fecha: diaParaAprobar, tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    const { status: sEnv } = await post(`/planillas/${planillaAprobarId}/enviar`, {}, owner.token);
    assertStatus(sEnv, 200, 'enviar no debe trabarse por marcas sin validar');

    // Firmar todos los pasos con RRHH/ADMIN hasta que quede APROBADA.
    for (let i = 0; i < 5; i++) {
      const { body: pl } = await get(`/planillas/${planillaAprobarId}`, ana.token);
      if (pl.estado === 'APROBADA') break;
      const { status } = await post(`/planillas/${planillaAprobarId}/avanzar`, {}, ana.token);
      if (status !== 200) break;
    }

    const { body: fin } = await get(`/planillas/${planillaAprobarId}`, owner.token);
    assert(fin.estado === 'APROBADA', `la planilla quedó en ${fin.estado}`);
    const marca = fin.registros.find((r: any) => r.marcaManual)?.marcaManual;
    assert(!!marca, 'no quedó ninguna marca en la planilla');
    assert(marca.estado === 'APROBADA', `la marca quedó en ${marca.estado}, esperaba APROBADA`);
  });

  await scenario('validar/validar-todo ya no existen (404)', async () => {
    const { status: s1 } = await post(`/planillas/${planillaOwnerId}/marcas/${RANDOM_UUID}/validar`, {}, sup.token);
    assertStatus(s1, 404, 'el endpoint validar debería estar eliminado');
    const { status: s2 } = await post(`/planillas/${planillaOwnerId}/marcas/validar-todo`, {}, sup.token);
    assertStatus(s2, 404, 'el endpoint validar-todo debería estar eliminado');
  });
```

Declarar `let planillaAprobarId = ''; let diaParaAprobar = '';` y crearla en un escenario de setup (misma mecánica que la planilla del owner, con otro período).

- [ ] **Step 2: Borrar los escenarios viejos del modelo anterior**

En `apps/api/tests/qa/marca-manual.qa.ts`, borrar todos los escenarios que ejerciten: el alta por parte del supervisor, `marcas/:id/validar`, `marcas/validar-todo`, el rechazo de marcas por el superior, y el gate de "no se puede avanzar con marcas sin validar". Ese modelo ya no existe.

- [ ] **Step 3: Correr y ver que falla**

```bash
cd "apps/api" && npx tsx tests/qa/marca-manual.qa.ts
```

Esperado: `FAIL aprobar la planilla aprueba sus marcas — la marca quedó en PENDIENTE` (o falla antes, en `avanzar`, con el gate de marcas sin validar).

- [ ] **Step 4: Borrar el gate de avanzar**

En `apps/api/src/routes/planillas.routes.ts`, borrar el bloque completo (líneas ~615-622):

```ts
    // Gating plan B: no se puede avanzar/aprobar con marcas manuales sin validar
    const marcasPendientes = await prisma.ausencia.count({ ... });
    if (marcasPendientes > 0) { ... }
```

- [ ] **Step 5: Aprobar las marcas al aprobar la planilla**

Dentro del `$transaction` de `avanzar`, en el bloque `if (nuevoEstado === 'APROBADA') { ... }`, agregar al final del bloque (después del `upsert` de `vacacionSaldo` que ya está):

```ts
          // Las marcas manuales viajan con la planilla: la firma que aprueba la
          // planilla aprueba también los días que el dueño cargó a mano.
          const marcas = await tx.ausencia.findMany({
            where: { planillaId: planilla.id, cargaManual: true, estado: 'PENDIENTE' },
          });
          for (const m of marcas) {
            await tx.ausencia.update({
              where: { id: m.id },
              data: { estado: 'APROBADA', aprobada: true, aprobadaPorId: req.user!.userId, aprobadaAt: new Date() },
            });
            await tx.ausenciaHistorial.create({
              data: {
                ausenciaId: m.id,
                usuarioId: req.user!.userId,
                estadoAnterior: 'PENDIENTE',
                estadoNuevo: 'APROBADA',
                comentario: 'Aprobada junto con la planilla',
              },
            });
            if (m.tipo === 'FRANCO_COMPENSATORIO') {
              const anioMarca = new Date(m.fechaInicio).getFullYear();
              await tx.vacacionSaldo.update({
                where: { usuarioId_anio: { usuarioId: m.usuarioId, anio: anioMarca } },
                data: { compensatoriosPendientes: { decrement: 1 }, compensatoriosUsados: { increment: 1 } },
              });
            }
          }
```

No hay doble conteo con el `upsert` de arriba: ese cuenta por `registro.esFrancoCompensatorio`, y `inyectarDiasBloqueados` no setea esa columna en los días de marca manual.

- [ ] **Step 6: Borrar los endpoints de validación**

Borrar completos `router.post('/:id/marcas/:ausenciaId/validar', ...)` y `router.post('/:id/marcas/validar-todo', ...)` (líneas ~1586-1710).

- [ ] **Step 7: Correr y ver que pasan**

```bash
cd "apps/api" && npx tsx tests/qa/marca-manual.qa.ts
```

Esperado: toda la suite en PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/planillas.routes.ts apps/api/tests/qa/marca-manual.qa.ts
git commit -m "feat(api): las marcas manuales se aprueban junto con la planilla"
```

---

## Task 7: El compensatorio también es del dueño

**Files:**
- Modify: `apps/api/src/routes/planillas.routes.ts:1201-1240` (PATCH compensatorio)
- Test: `apps/api/tests/qa/planillas.qa.ts`

- [ ] **Step 1: Escribir los escenarios que fallan**

En `apps/api/tests/qa/planillas.qa.ts`, agregar (adaptando los nombres de sesión a los que ya usa ese archivo):

```ts
  await scenario('el supervisor NO puede tocar el compensatorio ajeno (403)', async () => {
    const { status, body } = await apiCall('PATCH', `/planillas/${planillaOwnerId}/registros/${registroId}/compensatorio`,
      { token: sup.token, body: { activar: true } });
    assertStatus(status, 403, JSON.stringify(body));
  });

  await scenario('el dueño sí puede, con la planilla en borrador', async () => {
    const { status, body } = await apiCall('PATCH', `/planillas/${planillaOwnerId}/registros/${registroId}/compensatorio`,
      { token: owner.token, body: { activar: true } });
    assertStatus(status, 200, JSON.stringify(body));
  });
```

- [ ] **Step 2: Correr y ver que falla**

```bash
cd "apps/api" && npx tsx tests/qa/planillas.qa.ts
```

Esperado: el del supervisor falla (hoy da 200), el del dueño falla con 403 (hoy exige nivel supervisor).

- [ ] **Step 3: Cambiar la autorización**

En `router.patch('/:id/registros/:rid/compensatorio', ...)`:

Sacar el middleware de nivel de la firma:

```ts
router.patch('/:id/registros/:rid/compensatorio', async (req: AuthRequest, res: Response): Promise<void> => {
```

Reemplazar el bloque de `canManageUser` y el de estado por:

```ts
    // La planilla es del dueño: el franco compensatorio lo declara él, no su jefe.
    if (planilla.usuarioId !== req.user!.userId) {
      res.status(403).json({ error: 'Solo el dueño puede declarar francos compensatorios en su planilla' });
      return;
    }

    if (!ESTADOS_OWNER.includes(planilla.estado)) {
      res.status(400).json({ error: `No se puede modificar la planilla en estado ${planilla.estado}` });
      return;
    }
```

Si `canManageUser` o `LEVEL_SUPERVISOR` quedan sin uso en el archivo, borrar sus imports.

- [ ] **Step 4: Correr y ver que pasan**

```bash
cd "apps/api" && npx tsx tests/qa/planillas.qa.ts
```

Esperado: los dos escenarios en PASS y el resto de la suite sin regresiones.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/planillas.routes.ts apps/api/tests/qa/planillas.qa.ts
git commit -m "feat(api): el franco compensatorio lo declara el dueno de la planilla"
```

---

## Task 8: Adjuntos en marcas manuales

**Files:**
- Modify: `apps/api/src/routes/ausencias.routes.ts:1168-1214`
- Test: `apps/api/tests/qa/marca-manual.qa.ts`

- [ ] **Step 1: Escribir el escenario que falla**

El upload es `multipart`, así que no sirve el helper `post`. Agregar arriba, junto a los otros helpers del archivo:

```ts
async function subirArchivo(path: string, token: string, nombre = 'cert.txt'): Promise<{ status: number; body: any }> {
  const fd = new FormData();
  fd.append('archivo', new Blob(['certificado de prueba'], { type: 'text/plain' }), nombre);
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('application/json') ? await res.json() : await res.text() };
}
```

Y el escenario:

```ts
  await scenario('el dueño adjunta el certificado a una marca ya creada', async () => {
    const { status, body } = await post(`/planillas/${planillaOwnerId}/marcar-dia`,
      { fecha: diaCert, tipo: 'CERTIFICADO_MEDICO' }, owner.token);
    assertStatus(status, 201, JSON.stringify(body));
    const certMarcaId = body.marcaManual.id;

    const up = await subirArchivo(`/ausencias/${certMarcaId}/archivo`, owner.token);
    assertStatus(up.status, 200, JSON.stringify(up.body));
    assert(!!up.body.archivoUrl, 'no quedó archivoUrl');
    marcaCertId = certMarcaId;
  });

  await scenario('el supervisor NO puede adjuntar en una marca ajena (403)', async () => {
    const up = await subirArchivo(`/ausencias/${marcaCertId}/archivo`, sup.token);
    assertStatus(up.status, 403, JSON.stringify(up.body));
  });
```

Declarar `let marcaCertId = ''; let diaCert = '';` arriba.

- [ ] **Step 2: Correr y ver que falla**

```bash
cd "apps/api" && npx tsx tests/qa/marca-manual.qa.ts
```

Esperado: el del supervisor falla con `403 expected, got 200` (hoy `canManageUser` lo habilita).

- [ ] **Step 3: Agregar la guarda**

En `apps/api/src/routes/ausencias.routes.ts`, en `router.post('/:id/archivo', ...)`, reemplazar el bloque de autorización por:

```ts
    const actorId = req.user!.userId;
    const actorNivel = req.user!.rolNivel ?? 0;

    if (ausencia.estado === 'CANCELADA') {
      descartarArchivos([subido]);
      res.status(400).json({ error: 'La solicitud está cancelada' });
      return;
    }

    if (ausencia.cargaManual) {
      // La marca vive dentro de la planilla y sigue sus reglas: solo el dueño, y
      // solo mientras la planilla sea editable. Ni el supervisor ni RRHH.
      if (ausencia.usuarioId !== actorId) {
        descartarArchivos([subido]);
        res.status(403).json({ error: 'Solo el dueño puede adjuntar en su marca' });
        return;
      }
      const planilla = ausencia.planillaId
        ? await prisma.planilla.findUnique({ where: { id: ausencia.planillaId }, select: { estado: true } })
        : null;
      if (planilla && planilla.estado !== 'BORRADOR' && planilla.estado !== 'RECHAZADA') {
        descartarArchivos([subido]);
        res.status(400).json({ error: `No se puede adjuntar con la planilla en estado ${planilla.estado}` });
        return;
      }
    } else if (ausencia.usuarioId !== actorId && !(await canManageUser(actorId, actorNivel, ausencia.usuarioId, req.user!.empresaId))) {
      descartarArchivos([subido]);
      res.status(403).json({ error: 'No autorizado para modificar el archivo de esta ausencia' });
      return;
    }
```

- [ ] **Step 4: Correr y ver que pasan**

```bash
cd "apps/api" && npx tsx tests/qa/marca-manual.qa.ts
```

Esperado: los dos escenarios en PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/ausencias.routes.ts apps/api/tests/qa/marca-manual.qa.ts
git commit -m "feat(api): adjuntar el certificado en una marca ya creada"
```

---

## Task 9: Cancelación de solicitudes

**Files:**
- Modify: `apps/api/src/routes/mis-solicitudes.routes.ts`
- Test: `apps/api/tests/qa/cancelaciones.qa.ts` (crear)

- [ ] **Step 1: Crear la suite**

Crear `apps/api/tests/qa/cancelaciones.qa.ts` copiando el preámbulo completo de `apps/api/tests/qa/marca-manual.qa.ts` (constantes `C`, `col`, `scenario`, `assert`, `assertStatus`, `info`, `apiCall`, `get/post/put/del`, `login`) y cambiando `const KEY = 'cancelaciones';`. Después, en `main()`:

```ts
async function main() {
  console.log(col('CYAN', `\n═══ QA CANCELACIONES suite (ts=${TS}) ═══\n`));
  const admin = await login('admin@wenlen.com');
  const ana = await login('ana.martinez@demo.com');

  const ingreso = new Date('2020-01-01T00:00:00Z').toISOString();
  let opId = '';
  await scenario('SETUP operador', async () => {
    const { status, body } = await post('/usuarios', {
      nombre: 'QAcancel', apellido: `X${TS}`, email: `qa.${KEY}.${TS}.op@demo.com`,
      password: 'Test1234!', rol: 'OPERADOR', fechaIngreso: ingreso,
    }, ana.token);
    assertStatus(status, 201, JSON.stringify(body));
    opId = body.id;
  });
  const op = await login(`qa.${KEY}.${TS}.op@demo.com`);

  let ausId = '';
  await scenario('cancelar una ausencia PENDIENTE la deja CANCELADA', async () => {
    const { status, body } = await post('/ausencias/solicitar', {
      tipo: 'FALTA_JUSTIFICADA',
      fechaInicio: '2026-12-10', fechaFin: '2026-12-10', diasAusencia: 1,
    }, op.token);
    assertStatus(status, 201, JSON.stringify(body));
    ausId = body.id;

    const can = await post(`/mis-solicitudes/ausencia/${ausId}/cancelar`, {}, op.token);
    assertStatus(can.status, 200, JSON.stringify(can.body));
    assert(can.body.estado === 'CANCELADA', `quedó en ${can.body.estado}`);
  });

  await scenario('cancelar dos veces la misma solicitud (400)', async () => {
    const { status } = await post(`/mis-solicitudes/ausencia/${ausId}/cancelar`, {}, op.token);
    assertStatus(status, 400, 'una solicitud ya cancelada no se puede cancelar de nuevo');
  });

  await scenario('otro usuario no puede cancelar una solicitud ajena (403)', async () => {
    const { status, body } = await post('/ausencias/solicitar', {
      tipo: 'FALTA_JUSTIFICADA',
      fechaInicio: '2026-12-11', fechaFin: '2026-12-11', diasAusencia: 1,
    }, op.token);
    assertStatus(status, 201, JSON.stringify(body));
    const { status: sCan } = await post(`/mis-solicitudes/ausencia/${body.id}/cancelar`, {}, ana.token);
    assertStatus(sCan, 403, 'RRHH no es el dueño');
  });

  let planId = '';
  await scenario('cancelar una planilla ENVIADA la devuelve a BORRADOR', async () => {
    const { status, body } = await post('/planillas', {}, op.token);
    assertStatus(status, 201, JSON.stringify(body));
    planId = body.id;

    const inicio = new Date(body.periodoInicio).toISOString().slice(0, 10);
    const { status: sReg } = await post(`/planillas/${planId}/registros`, {
      fecha: inicio, entradaTurno1: '08:00', salidaTurno1: '16:00', lugarTrabajo: 'BASE',
    }, op.token);
    assertStatus(sReg, 201, 'no se pudo cargar el registro');

    const { status: sEnv } = await post(`/planillas/${planId}/enviar`, {}, op.token);
    assertStatus(sEnv, 200, 'no se pudo enviar');

    const can = await post(`/mis-solicitudes/planilla/${planId}/cancelar`, {}, op.token);
    assertStatus(can.status, 200, JSON.stringify(can.body));
    assert(can.body.estado === 'BORRADOR', `quedó en ${can.body.estado}`);
    assert(can.body.pasoActual === 0, `pasoActual quedó en ${can.body.pasoActual}`);

    const { body: pl } = await get(`/planillas/${planId}`, op.token);
    assert(pl.registros.length > 0, 'se perdieron los registros al cancelar');
  });

  await scenario('con una firma encima ya no se puede cancelar (400)', async () => {
    await post(`/planillas/${planId}/enviar`, {}, op.token);
    const { status: sAv } = await post(`/planillas/${planId}/avanzar`, {}, ana.token);
    if (sAv !== 200) { info(`avanzar devolvió ${sAv}, se saltea el escenario`); return; }
    const { body: pl } = await get(`/planillas/${planId}`, op.token);
    if (pl.estado === 'APROBADA') { info('circuito de un solo paso: quedó APROBADA'); }
    const { status } = await post(`/mis-solicitudes/planilla/${planId}/cancelar`, {}, op.token);
    assertStatus(status, 400, 'con firma encima no se cancela');
  });

  await scenario('CLEANUP', async () => {
    await del(`/planillas/${planId}`, admin.token).catch(() => {});
    if (opId) await del(`/usuarios/${opId}`, admin.token).catch(() => {});
  });

  const failed = results.filter(r => !r.passed);
  console.log(col('CYAN', `\n═══ ${results.length - failed.length}/${results.length} OK ═══\n`));
  for (const f of failed) console.log(col('RED', `  ${f.name}: ${f.detail}`));
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Correr y ver que falla**

```bash
cd "apps/api" && npx tsx tests/qa/cancelaciones.qa.ts
```

Esperado: todos los de cancelación fallan con `HTTP 200 expected, got 404` — el endpoint no existe.

- [ ] **Step 3: Escribir el endpoint**

En `apps/api/src/routes/mis-solicitudes.routes.ts`, antes del `export default router;`:

```ts
// ─── POST /mis-solicitudes/:tipo/:id/cancelar ────
//
// El dueño retira su solicitud mientras NADIE la haya firmado. Una firma
// intermedia la traba: a partir de ahí solo se sale por rechazo de la cadena.
// No hay días bloqueados que liberar: `inyectarDiasBloqueados` corre al aprobar,
// y acá solo entran solicitudes sin aprobar.

const TIPOS_CANCELABLES = ['planilla', 'vacacion', 'ausencia', 'cambio-diagrama'] as const;
type TipoCancelable = typeof TIPOS_CANCELABLES[number];

router.post('/:tipo/:id/cancelar', async (req: AuthRequest, res: Response): Promise<void> => {
  const tipo = req.params.tipo as TipoCancelable;
  const id = req.params.id as string;
  const userId = req.user!.userId;
  const empresaId = req.user!.empresaId;

  if (!TIPOS_CANCELABLES.includes(tipo)) {
    res.status(400).json({ error: `Tipo de solicitud desconocido: ${tipo}` });
    return;
  }

  try {
    switch (tipo) {
      case 'planilla': return await cancelarPlanilla(res, id, userId, empresaId);
      case 'vacacion': return await cancelarVacacion(res, id, userId, empresaId);
      case 'ausencia': return await cancelarAusencia(res, id, userId, empresaId);
      case 'cambio-diagrama': return await cancelarCambioDiagrama(res, id, userId, empresaId);
    }
  } catch (error) {
    console.error(`Error cancelando ${tipo}:`, error);
    res.status(500).json({ error: 'Error interno' });
  }
});

async function cancelarPlanilla(res: Response, id: string, userId: string, empresaId: string): Promise<void> {
  const planilla = await prisma.planilla.findUnique({
    where: { id },
    include: { usuario: { select: { empresaId: true } } },
  });
  if (!planilla || planilla.usuario.empresaId !== empresaId) {
    res.status(404).json({ error: 'Planilla no encontrada' }); return;
  }
  if (planilla.usuarioId !== userId) {
    res.status(403).json({ error: 'Solo el solicitante puede cancelar' }); return;
  }
  if (planilla.estado !== 'ENVIADA') {
    res.status(400).json({ error: `No se puede cancelar una planilla en estado ${planilla.estado}` }); return;
  }
  // El estado no alcanza: un circuito de un solo paso podría saltar de ENVIADA a
  // APROBADA sin pasar por EN_REVISION. Lo que decide es si alguien firmó.
  const firma = await prisma.planillaHistorial.findFirst({
    where: { planillaId: id, pasoFlujo: { gte: 1 }, createdAt: { gt: planilla.enviadaAt ?? new Date(0) } },
  });
  if (firma) {
    res.status(400).json({ error: 'La solicitud ya fue firmada por un aprobador' }); return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.planilla.updateMany({
      where: { id, estado: 'ENVIADA' },
      data: { estado: 'BORRADOR', pasoActual: 0, enviadaAt: null, circuitoSnapshot: Prisma.DbNull },
    });
    if (count === 0) throw new Error('CONCURRENT_MODIFICATION');
    await tx.planillaHistorial.create({
      data: { planillaId: id, usuarioId: userId, estadoAnterior: 'ENVIADA', estadoNuevo: 'BORRADOR', comentario: 'Cancelada por el solicitante' },
    });
    return tx.planilla.findUnique({ where: { id } });
  });
  res.json(updated);
}

async function cancelarVacacion(res: Response, id: string, userId: string, empresaId: string): Promise<void> {
  const vac = await prisma.vacacion.findUnique({
    where: { id },
    include: { usuario: { select: { empresaId: true } } },
  });
  if (!vac || vac.usuario.empresaId !== empresaId) {
    res.status(404).json({ error: 'Vacación no encontrada' }); return;
  }
  if (vac.usuarioId !== userId) {
    res.status(403).json({ error: 'Solo el solicitante puede cancelar' }); return;
  }
  if (vac.estado !== 'PENDIENTE') {
    res.status(400).json({ error: `No se puede cancelar una vacación en estado ${vac.estado}` }); return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.vacacion.updateMany({
      where: { id, estado: 'PENDIENTE' },
      data: { estado: 'CANCELADA' },
    });
    if (count === 0) throw new Error('CONCURRENT_MODIFICATION');
    // Mismo año que usó la reserva al crearla (createdAt), no el de las fechas.
    const anio = new Date(vac.createdAt).getFullYear();
    await tx.vacacionSaldo.updateMany({
      where: { usuarioId: userId, anio },
      data: { diasPendientes: { decrement: vac.diasTotales } },
    });
    await tx.vacacionHistorial.create({
      data: { vacacionId: id, usuarioId: userId, estadoAnterior: 'PENDIENTE', estadoNuevo: 'CANCELADA', comentario: 'Cancelada por el solicitante' },
    });
    return tx.vacacion.findUnique({ where: { id } });
  });
  res.json(updated);
}

async function cancelarAusencia(res: Response, id: string, userId: string, empresaId: string): Promise<void> {
  const aus = await prisma.ausencia.findUnique({
    where: { id },
    include: { usuario: { select: { empresaId: true } } },
  });
  if (!aus || aus.usuario.empresaId !== empresaId) {
    res.status(404).json({ error: 'Ausencia no encontrada' }); return;
  }
  if (aus.usuarioId !== userId) {
    res.status(403).json({ error: 'Solo el solicitante puede cancelar' }); return;
  }
  if (aus.cargaManual) {
    res.status(400).json({ error: 'Las marcas manuales se quitan desde la planilla' }); return;
  }
  if (aus.estado !== 'PENDIENTE') {
    res.status(400).json({ error: `No se puede cancelar una ausencia en estado ${aus.estado}` }); return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.ausencia.updateMany({
      where: { id, estado: 'PENDIENTE' },
      data: { estado: 'CANCELADA', aprobada: false },
    });
    if (count === 0) throw new Error('CONCURRENT_MODIFICATION');
    if (aus.tipo === 'FRANCO_COMPENSATORIO') {
      const anio = new Date(aus.fechaInicio).getFullYear();
      await tx.vacacionSaldo.updateMany({
        where: { usuarioId: userId, anio },
        data: { compensatoriosPendientes: { decrement: aus.diasAusencia } },
      });
    }
    await tx.ausenciaHistorial.create({
      data: { ausenciaId: id, usuarioId: userId, estadoAnterior: 'PENDIENTE', estadoNuevo: 'CANCELADA', comentario: 'Cancelada por el solicitante' },
    });
    return tx.ausencia.findUnique({ where: { id } });
  });
  res.json(updated);
}

async function cancelarCambioDiagrama(res: Response, id: string, userId: string, empresaId: string): Promise<void> {
  const sol = await prisma.solicitudCambioDiagrama.findUnique({
    where: { id },
    include: { usuario: { select: { empresaId: true } } },
  });
  if (!sol || sol.usuario.empresaId !== empresaId) {
    res.status(404).json({ error: 'Solicitud no encontrada' }); return;
  }
  if (sol.solicitanteId !== userId) {
    res.status(403).json({ error: 'Solo el solicitante puede cancelar' }); return;
  }
  if (sol.estado !== 'PENDIENTE') {
    res.status(400).json({ error: `No se puede cancelar una solicitud en estado ${sol.estado}` }); return;
  }
  // El cambio de diagrama no tiene estado CANCELADA en su enum: el borrado físico
  // es la semántica que ya tenía y no se cambia acá. `CambioDiagramaHistorial`
  // tiene onDelete: Cascade, así que se va solo.
  await prisma.solicitudCambioDiagrama.delete({ where: { id } });
  res.json({ id, estado: 'CANCELADA' });
}
```

Agregar `Prisma` al import de `@prisma/client` en el encabezado del archivo (hace falta para `Prisma.DbNull`):

```ts
import { PrismaClient, Prisma } from '@prisma/client';
```

- [ ] **Step 4: Correr y ver que pasan**

```bash
cd "apps/api" && npx tsx tests/qa/cancelaciones.qa.ts
```

Esperado: toda la suite en PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/mis-solicitudes.routes.ts apps/api/tests/qa/cancelaciones.qa.ts
git commit -m "feat(api): el dueno cancela su solicitud antes de la primera firma"
```

---

## Task 10: Mis Solicitudes refleja lo nuevo

**Files:**
- Modify: `apps/api/src/routes/mis-solicitudes.routes.ts:75-90` (query de ausencias), `:19-28` (interfaz), `:143-157` (mapeo)

- [ ] **Step 1: Excluir las marcas manuales de la lista**

En el `prisma.ausencia.findMany` del `GET /`, agregar el filtro:

```ts
      prisma.ausencia.findMany({
        where: {
          usuarioId: userId,
          requiereAprobacion: true,
          cargaManual: false,
          estado: { not: 'BORRADOR' },
        },
```

Las marcas manuales viven dentro de la planilla y se aprueban con ella: listarlas acá como
solicitudes sueltas hacía que aparecieran PENDIENTE para siempre, sin circuito y sin nadie
que pudiera aprobarlas desde la bandeja.

- [ ] **Step 2: Agregar el campo `cancelable` a la respuesta**

En la interfaz:

```ts
interface SolicitudUnificada {
  id: string;
  tipo: 'VACACION' | 'AUSENCIA' | 'CAMBIO_DIAGRAMA' | 'PLANILLA';
  estado: string;
  pasoActual: number;
  totalPasos: number;
  createdAt: string;
  detalle: string;
  pasos: PasoRecorrido[];
  obsRechazo?: string | null;
  cancelable: boolean;
}
```

Agregar el helper arriba del handler:

```ts
/** Cancelable = el dueño todavía puede retirarla porque nadie la firmó. */
function esCancelable(tipo: SolicitudUnificada['tipo'], estado: string, pasoActual: number): boolean {
  if (tipo === 'PLANILLA') return estado === 'ENVIADA' && pasoActual <= 1;
  return estado === 'PENDIENTE' && pasoActual <= 1;
}
```

Y en cada uno de los cuatro `combined.push({...})`, agregar la última propiedad:

```ts
        cancelable: esCancelable('PLANILLA', p.estado, p.pasoActual),
```
```ts
        cancelable: esCancelable('VACACION', v.estado, v.pasoActual),
```
```ts
        cancelable: esCancelable('AUSENCIA', a.estado, a.pasoActual),
```
```ts
        cancelable: esCancelable('CAMBIO_DIAGRAMA', c.estado, c.pasoActual),
```

- [ ] **Step 3: Verificar que compila y que la lista responde**

```bash
cd "apps/api" && npx tsc --noEmit && npx tsx tests/qa/cancelaciones.qa.ts
```

Esperado: sin errores de tipos y la suite de cancelaciones sigue en PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/mis-solicitudes.routes.ts
git commit -m "feat(api): mis solicitudes marca cuales son cancelables"
```

---

## Task 11: `revocar` deja CANCELADA

**Files:**
- Modify: `apps/api/src/routes/ausencias.routes.ts:1105-1118`

- [ ] **Step 1: Cambiar el estado resultante**

En `router.post('/:id/revocar', ...)`, reemplazar el `update` y el historial:

```ts
    await prisma.ausencia.update({
      where: { id: ausId },
      data: { estado: 'CANCELADA', obsRechazo: 'Revocado por el usuario', aprobada: false },
    });

    await prisma.ausenciaHistorial.create({
      data: {
        ausenciaId: ausId,
        usuarioId: userId,
        estadoAnterior: ausencia.estado as AusenciaEstado,
        estadoNuevo: 'CANCELADA',
        comentario: req.body?.motivo || 'Revocado por el usuario',
      },
    });
```

`revocar` mantiene su semántica propia — actúa sobre un compensatorio ya `APROBADA` con
fecha futura, que es justo lo que la cancelación no permite. Lo único que se unifica es
que el dueño no vea su propia devolución como un rechazo.

- [ ] **Step 2: Verificar que la suite de ausencias sigue verde**

```bash
cd "apps/api" && npx tsx tests/qa/ausencias.qa.ts
```

Esperado: PASS. Si alguna aserción espera `RECHAZADA` después de revocar, actualizarla a `CANCELADA`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/ausencias.routes.ts apps/api/tests/qa/ausencias.qa.ts
git commit -m "fix(api): revocar deja la ausencia CANCELADA y no RECHAZADA"
```

---

## Task 12: Visibilidad por nivel

**Files:**
- Modify: `apps/api/src/utils/visibility.utils.ts`
- Test: `apps/api/tests/qa/visibilidad-nivel.qa.ts` (crear)

- [ ] **Step 1: Crear la suite**

Crear `apps/api/tests/qa/visibilidad-nivel.qa.ts` con el mismo preámbulo que las otras (`KEY = 'visibilidad'`) y este `main()`:

```ts
async function main() {
  console.log(col('CYAN', `\n═══ QA VISIBILIDAD POR NIVEL suite (ts=${TS}) ═══\n`));
  const admin = await login('admin@wenlen.com');
  const ana = await login('ana.martinez@demo.com');

  const ingreso = new Date('2020-01-01T00:00:00Z').toISOString();
  const creados: string[] = [];
  async function createUser(rol: string, tag: string, extra: Record<string, unknown> = {}): Promise<string> {
    const { status, body } = await post('/usuarios', {
      nombre: `QA${tag}`, apellido: `Vis${TS}`, email: `qa.${KEY}.${TS}.${tag}@demo.com`,
      password: 'Test1234!', rol, fechaIngreso: ingreso, ...extra,
    }, ana.token);
    assertStatus(status, 201, `create ${tag}: ${JSON.stringify(body)}`);
    creados.push(body.id);
    return body.id as string;
  }

  let sectorId = '';
  await scenario('SETUP sector propio', async () => {
    const { status, body } = await post('/admin/sectores', { nombre: `QAVis${TS}` }, admin.token);
    assertStatus(status, 201, JSON.stringify(body));
    sectorId = body.id;
  });

  let supAId = '', supBId = '', opId = '';
  await scenario('SETUP dos supervisores del mismo sector + un operador', async () => {
    supAId = await createUser('SUPERVISOR', 'supA', { sectorId });
    supBId = await createUser('SUPERVISOR', 'supB', { sectorId });
    opId = await createUser('OPERADOR', 'op', { sectorId, supervisorId: supAId });
  });

  const supA = await login(`qa.${KEY}.${TS}.supA@demo.com`);
  const supB = await login(`qa.${KEY}.${TS}.supB@demo.com`);
  const op = await login(`qa.${KEY}.${TS}.op@demo.com`);

  let planillaSupBId = '', planillaOpId = '';
  await scenario('SETUP planillas', async () => {
    const { body: pb } = await post('/planillas', {}, supB.token);
    planillaSupBId = pb.id;
    const { body: po } = await post('/planillas', {}, op.token);
    planillaOpId = po.id;
  });

  await scenario('supA NO ve la planilla de supB (mismo nivel) — GET /:id 403', async () => {
    const { status } = await get(`/planillas/${planillaSupBId}`, supA.token);
    assertStatus(status, 403, 'un par del mismo nivel no debe poder abrir la planilla');
  });

  await scenario('supA NO ve la planilla de supB en el listado', async () => {
    const { status, body } = await get('/planillas', supA.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(!body.some((p: any) => p.id === planillaSupBId), 'la planilla del par aparece en el listado');
  });

  await scenario('supA SÍ ve la planilla de su operador', async () => {
    const { status } = await get(`/planillas/${planillaOpId}`, supA.token);
    assertStatus(status, 200, 'el supervisor debe ver a su subordinado de nivel menor');
  });

  await scenario('RRHH sigue viendo todo', async () => {
    const { status } = await get(`/planillas/${planillaSupBId}`, ana.token);
    assertStatus(status, 200, 'RRHH ve toda la empresa');
  });

  await scenario('CLEANUP', async () => {
    for (const pid of [planillaSupBId, planillaOpId]) if (pid) await del(`/planillas/${pid}`, admin.token).catch(() => {});
    for (const uid of creados) await del(`/usuarios/${uid}`, admin.token).catch(() => {});
    if (sectorId) await del(`/admin/sectores/${sectorId}`, admin.token).catch(() => {});
  });

  const failed = results.filter(r => !r.passed);
  console.log(col('CYAN', `\n═══ ${results.length - failed.length}/${results.length} OK ═══\n`));
  for (const f of failed) console.log(col('RED', `  ${f.name}: ${f.detail}`));
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Correr y ver que falla**

```bash
cd "apps/api" && npx tsx tests/qa/visibilidad-nivel.qa.ts
```

Esperado: los dos escenarios de "supA NO ve" fallan — hoy el mismo sector alcanza.

- [ ] **Step 3: Agregar el filtro de nivel**

En `apps/api/src/utils/visibility.utils.ts`, agregar el helper al final del archivo:

```ts
/**
 * Deja solo a quienes el actor puede mirar: los de nivel estrictamente menor, más
 * sus subordinados directos (que pueden compartir nivel — dos coordinadores donde
 * uno manda al otro) y él mismo.
 *
 * Ser aprobador NO alcanza: sin este filtro, cualquiera cuyo rol figure en un paso
 * del flujo se lleva el sector entero, pares y superiores incluidos.
 *
 * `Usuario.rol` es un string suelto; el nivel vive en `RolConfig` por empresa, así
 * que se resuelve con `nivelesPorRol`. Un rol HUÉRFANO (borrado o desactivado) no
 * tiene nivel con qué comparar y queda FUERA: acá el default seguro es no mostrar.
 * Es el criterio opuesto al de `construirCircuito` a propósito — allá un huérfano
 * que se saltea deja un documento sin aprobador y hay que verlo; acá un huérfano
 * que se cuela filtra la planilla de otro.
 */
async function filtrarPorNivel(
  prisma: PrismaClient,
  ids: string[],
  actorId: string,
  actorNivel: number,
  empresaId: string,
): Promise<string[]> {
  const candidatos = ids.filter((id) => id !== actorId);
  if (candidatos.length === 0) return [actorId];

  const [usuarios, niveles] = await Promise.all([
    prisma.usuario.findMany({
      where: { id: { in: candidatos } },
      select: { id: true, rol: true, supervisorId: true, coordinadorId: true },
    }),
    nivelesPorRol(prisma, empresaId),
  ]);

  const visibles = usuarios
    .filter((u) => {
      if (u.supervisorId === actorId || u.coordinadorId === actorId) return true;
      const nivel = niveles[u.rol];
      if (nivel === undefined) return false; // rol huérfano: no se muestra
      return nivel < actorNivel;
    })
    .map((u) => u.id);

  return [actorId, ...visibles];
}
```

Agregar el import arriba del archivo:

```ts
import { nivelesPorRol } from './circuito.utils.js';
```

Aplicarlo en los tres puntos de salida de `getFlowVisibleUserIds` que no son la rama de RRHH.

El `return [userId]` de "mi rol no está en ningún flujo" (cuando `matchingAssignments.length === 0`) queda como está: ya es el mínimo posible.

El `return` final:

```ts
  return filtrarPorNivel(prisma, [...ids], userId, userNivel, empresaId);
```

Y en `legacyVisibility`, cambiar la firma para que reciba el nivel y filtrar también:

```ts
async function legacyVisibility(
  prisma: PrismaClient,
  userId: string,
  empresaId: string,
  userNivel: number,
): Promise<string[]> {
```

con el `return` final:

```ts
  return filtrarPorNivel(prisma, [...ids], userId, userNivel, empresaId);
```

Y su llamada, en `getFlowVisibleUserIds`:

```ts
  if (!anyAssignment) {
    return legacyVisibility(prisma, userId, empresaId, userNivel);
  }
```

**Ojo:** la rama de `userNivel >= 90` sale antes y no pasa por el filtro. Así queda: RRHH y ADMIN siguen viendo toda la empresa.

- [ ] **Step 4: Correr y ver que pasan**

```bash
cd "apps/api" && npx tsx tests/qa/visibilidad-nivel.qa.ts
```

Esperado: toda la suite en PASS.

- [ ] **Step 5: Verificar que no rompió la bandeja**

```bash
cd "apps/api" && npx tsx tests/qa/flujos.qa.ts && npx tsx tests/qa/planillas.qa.ts
```

Esperado: PASS. Si algún escenario asumía que un par veía documentos de otro par, corregir la **aserción** (el comportamiento nuevo es el correcto), no el filtro.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/utils/visibility.utils.ts apps/api/tests/qa/visibilidad-nivel.qa.ts
git commit -m "fix(api): solo los aprobadores de nivel superior ven planillas ajenas"
```

---

## Task 13: Los adjuntos siguen la misma regla

**Files:**
- Modify: `apps/api/src/utils/upload-access.utils.ts:161-166`
- Test: `apps/api/tests/qa/visibilidad-nivel.qa.ts`

- [ ] **Step 1: Escribir el escenario que falla**

Agregar a `apps/api/tests/qa/visibilidad-nivel.qa.ts`, antes del CLEANUP. Necesita el helper `subirArchivo` (copiarlo del Task 8):

```ts
  await scenario('un par del mismo nivel no puede abrir el certificado ajeno', async () => {
    const { status, body } = await post('/ausencias/solicitar', {
      tipo: 'CERTIFICADO_MEDICO',
      fechaInicio: '2026-12-15', fechaFin: '2026-12-15', diasAusencia: 1,
    }, supB.token);
    assertStatus(status, 201, JSON.stringify(body));
    const up = await subirArchivo(`/ausencias/${body.id}/archivo`, supB.token);
    assertStatus(up.status, 200, JSON.stringify(up.body));

    const res = await fetch(`http://localhost:4000${up.body.archivoUrl}`, {
      headers: { Authorization: `Bearer ${supA.token}` },
    });
    assert(res.status === 403 || res.status === 404, `supA abrió el certificado de supB: HTTP ${res.status}`);
  });
```

- [ ] **Step 2: Correr y ver que falla**

```bash
cd "apps/api" && npx tsx tests/qa/visibilidad-nivel.qa.ts
```

Esperado: `FAIL — supA abrió el certificado de supB: HTTP 200`. `canManageUser` habilita a cualquier nivel ≥ 70 del mismo sector; los supervisores son nivel 60, así que si da 403 acá, **cambiar el escenario a dos coordinadores** (nivel 70) del mismo sector, que es donde el agujero es real.

- [ ] **Step 3: Alinear la rama `ausencia`**

En `apps/api/src/utils/upload-access.utils.ts`, reemplazar el `case 'ausencia'`:

```ts
    case 'ausencia': {
      // El titular siempre. Para el resto rige lo mismo que para la planilla:
      // hace falta que el dueño le quede visible por nivel. Sin esto, la Parte 3
      // le cierra la planilla a un par y le deja el certificado abierto por URL.
      if (dueno.usuarioId === actor.userId) return true;
      if (actor.rolNivel >= LEVEL_RRHH) return true;
      const visibles = await getFlowVisibleUserIds(
        prisma, actor.userId, actor.empresaId, actor.rol, actor.rolNivel, 'AUSENCIA',
      );
      return visibles.includes(dueno.usuarioId);
    }
```

Agregar el import arriba:

```ts
import { getFlowVisibleUserIds } from './visibility.utils.js';
```

Si `canManageUser` queda sin uso en el archivo, borrar su import.

- [ ] **Step 4: Correr y ver que pasa**

```bash
cd "apps/api" && npx tsx tests/qa/visibilidad-nivel.qa.ts
```

Esperado: toda la suite en PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/utils/upload-access.utils.ts apps/api/tests/qa/visibilidad-nivel.qa.ts
git commit -m "fix(api): el certificado medico sigue la visibilidad de la planilla"
```

---

## Task 14: Front — la planilla es del dueño

**Files:**
- Modify: `apps/web/src/pages/planillas/PlanillaDetailPage.tsx`

- [ ] **Step 1: Leer el flag**

Agregar la query junto a las demás del componente:

```tsx
  const { data: modulos } = useQuery({
    queryKey: ['config-modulos'],
    queryFn: async () => (await api.get('/config/modulos')).data as { marcaManualActiva: boolean },
    staleTime: 5 * 60 * 1000,
  });
  const marcaManualActiva = modulos?.marcaManualActiva ?? false;
```

- [ ] **Step 2: Borrar el modelo viejo**

- Borrar `validarMarcaMutation` y `validarTodoMutation` (líneas ~340-349).
- Borrar `canMarkAsManager` (línea ~437) y `marcasPendientes` (línea ~439), junto con el botón "Validar todo" y el cartel de marcas pendientes que los usen.
- Borrar el bloque `{canMarkAsManager && ... }` con los botones Validar / Rechazar (líneas ~1403-1414).

- [ ] **Step 3: Arreglar el botón de quitar**

Reemplazar la condición del botón (línea ~1395) por una que **no** mire el estado de la marca:

```tsx
                      {isOwner && canEdit && (
                        <button
                          onClick={async () => {
                            const ok = await dialog.confirm({
                              title: 'Quitar marca',
                              message: 'Se va a liberar el día y se cancela la solicitud asociada. Si adjuntaste un certificado, también se borra. ¿Continuar?',
                              variant: 'danger',
                            });
                            if (ok) quitarMarcaMutation.mutate(registroMap[selectedDate]!.marcaManual!.id);
                          }}
                          disabled={quitarMarcaMutation.isPending}
                          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted/30 disabled:opacity-50">
                          Quitar marca
                        </button>
                      )}
```

- [ ] **Step 4: Cambiar el badge**

Reemplazar los dos lugares donde dice "sin validar" (líneas ~1280 y ~1386) por "a aprobar con la planilla" — en la celda del calendario, la versión corta "con la planilla" para que entre.

- [ ] **Step 5: Ocultar el bloque de marcar con el flag apagado**

Cambiar la condición del `<details>` "Marcar día especial" (línea ~1424):

```tsx
              {canEdit && marcaManualActiva && (
```

- [ ] **Step 6: Verificar en el navegador**

```bash
npm run dev
```

Abrir una planilla en BORRADOR como dueño. Esperado: **no** aparece "Marcar día especial" (el flag nace apagado). Encenderlo desde Admin → Configuración y recargar: aparece.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/planillas/PlanillaDetailPage.tsx
git commit -m "feat(web): la planilla la edita solo su dueno y el plan B nace oculto"
```

---

## Task 15: Front — confirmar la ausencia al marcarla

**Files:**
- Modify: `apps/web/src/pages/planillas/PlanillaDetailPage.tsx`

- [ ] **Step 1: Estado del diálogo**

Agregar junto a los demás `useState` del componente:

```tsx
  const [marcaPendiente, setMarcaPendiente] = useState<{ tipo: string; label: string; reemplazaHoras: boolean } | null>(null);
  const [marcaDescripcion, setMarcaDescripcion] = useState('');
  const [marcaArchivo, setMarcaArchivo] = useState<File | null>(null);
  const marcaFileRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 2: `handleMarcar` abre el diálogo en vez de disparar**

```tsx
  const handleMarcar = (tipo: string) => {
    if (!selectedDate) return;
    const existing = registroMap[selectedDate];
    const label = TIPOS_MARCA.find(t => t.value === tipo)?.label ?? tipo;
    setMarcaDescripcion('');
    setMarcaArchivo(null);
    setMarcaPendiente({
      tipo,
      label,
      reemplazaHoras: !!(existing && !existing.bloqueado && existing.entradaTurno1),
    });
  };
```

- [ ] **Step 3: La mutation manda la descripción y sube el archivo**

```tsx
  const marcarDiaMutation = useMutation({
    mutationFn: async (vars: { fecha: string; tipo: string; descripcion?: string; archivo?: File | null }) => {
      const { data } = await api.post(`/planillas/${id}/marcar-dia`, {
        fecha: vars.fecha, tipo: vars.tipo, descripcion: vars.descripcion || undefined,
      });
      if (vars.archivo && data?.marcaManual?.id) {
        const fd = new FormData();
        fd.append('archivo', vars.archivo);
        try {
          await api.post(`/ausencias/${data.marcaManual.id}/archivo`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        } catch {
          // La marca ya quedó creada: se avisa y se puede reintentar desde el día.
          toast({ title: 'La marca se creó, pero el certificado no subió', description: 'Probá adjuntarlo de nuevo desde el día marcado.', variant: 'destructive' });
        }
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planilla', id] });
      setSelectedDate(null);
      setMarcaPendiente(null);
    },
    onError: (err: any) => toast({ title: 'No se pudo marcar', description: mensajeDeError(err).mensaje, variant: 'destructive' }),
  });
```

- [ ] **Step 4: El diálogo**

Renderizar al final del componente, junto a los otros modales:

```tsx
      {marcaPendiente && selectedDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setMarcaPendiente(null)}>
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="text-base font-semibold">Confirmar ausencia</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {marcaPendiente.label} — {new Date(`${selectedDate}T00:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit' })}
              </p>
            </div>

            {marcaPendiente.reemplazaHoras && (
              <p className="text-xs rounded-lg border border-amber-500/30 bg-amber-500/10 text-cal-amber px-3 py-2">
                Este día tiene horas cargadas. Se reemplazan por la marca.
              </p>
            )}

            <div>
              <label className="text-xs text-muted-foreground">Descripción (opcional)</label>
              <input
                value={marcaDescripcion}
                onChange={e => setMarcaDescripcion(e.target.value)}
                maxLength={500}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
                placeholder="Motivo o aclaración"
              />
            </div>

            {marcaPendiente.tipo === 'CERTIFICADO_MEDICO' && (
              <div>
                <input ref={marcaFileRef} type="file" accept="image/*,.pdf" className="hidden"
                  onChange={e => setMarcaArchivo(e.target.files?.[0] ?? null)} />
                <button type="button" onClick={() => marcaFileRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-dashed border-border text-sm text-muted-foreground hover:border-primary/30 hover:text-foreground">
                  <Upload className="h-4 w-4" />
                  {marcaArchivo ? marcaArchivo.name : 'Adjuntar certificado (opcional)'}
                </button>
                <p className="text-[10px] text-muted-foreground mt-1">Lo podés adjuntar después desde este mismo día.</p>
              </div>
            )}

            <div className="flex gap-2">
              <button type="button" onClick={() => setMarcaPendiente(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted/30">
                Cancelar
              </button>
              <button type="button" disabled={marcarDiaMutation.isPending}
                onClick={() => marcarDiaMutation.mutate({
                  fecha: selectedDate, tipo: marcaPendiente.tipo,
                  descripcion: marcaDescripcion, archivo: marcaArchivo,
                })}
                className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
```

Agregar `Upload` al import de `lucide-react` y `useRef` al de `react` si no están.

- [ ] **Step 5: Verificar en el navegador**

Con el flag encendido, marcar un día: aparece el diálogo con la fecha y el tipo. Elegir "Certificado médico": aparece el selector de archivo. Confirmar sin archivo: la marca se crea. Confirmar con archivo: la marca se crea con el certificado.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/planillas/PlanillaDetailPage.tsx
git commit -m "feat(web): confirmar la ausencia al marcarla, con descripcion y certificado"
```

---

## Task 16: Front — adjuntar y ver el certificado después

**Files:**
- Modify: `apps/web/src/pages/planillas/PlanillaDetailPage.tsx`, `apps/web/src/pages/ausencias/AusenciasPage.tsx`

- [ ] **Step 1: Exponer `archivoUrl` en el tipo del registro**

En `PlanillaDetailPage.tsx`, en la interfaz `Registro`:

```tsx
  marcaManual?: {
    id: string;
    estado: string;
    tipo: string;
    cargadaPorId: string;
    aprobadaPorId: string | null;
    archivoUrl: string | null;
  } | null;
```

Y en el backend, agregar `archivoUrl: true` a los tres `select` de `marcaManual` en `planillas.routes.ts` (en `GET /:id`, en la respuesta de `marcar-dia`, y donde más aparezca — buscar con `grep -n "marcaManual: { select" apps/api/src/routes/planillas.routes.ts`).

- [ ] **Step 2: Mutation de adjunto**

```tsx
  const adjuntarCertMutation = useMutation({
    mutationFn: async (vars: { ausenciaId: string; archivo: File }) => {
      const fd = new FormData();
      fd.append('archivo', vars.archivo);
      return api.post(`/ausencias/${vars.ausenciaId}/archivo`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planilla', id] });
      toast({ title: 'Certificado adjuntado' });
    },
    onError: (err: any) => toast({ title: 'No se pudo adjuntar', description: mensajeDeError(err).mensaje, variant: 'destructive' }),
  });
  const certFileRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 3: Botones en el detalle del día marcado**

Dentro del bloque `{registroMap[selectedDate]?.marcaManual && (...)}`, arriba del botón "Quitar marca":

```tsx
                      {registroMap[selectedDate]!.marcaManual!.tipo === 'CERTIFICADO_MEDICO' && (
                        <>
                          {registroMap[selectedDate]!.marcaManual!.archivoUrl && (
                            <a href={getUploadUrl(registroMap[selectedDate]!.marcaManual!.archivoUrl!)}
                              target="_blank" rel="noopener noreferrer"
                              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted/30">
                              <FileText className="h-4 w-4" /> Ver certificado
                            </a>
                          )}
                          {isOwner && canEdit && (
                            <>
                              <input ref={certFileRef} type="file" accept="image/*,.pdf" className="hidden"
                                onChange={e => {
                                  const f = e.target.files?.[0];
                                  if (f) adjuntarCertMutation.mutate({ ausenciaId: registroMap[selectedDate]!.marcaManual!.id, archivo: f });
                                  e.target.value = '';
                                }} />
                              <button type="button" onClick={() => certFileRef.current?.click()}
                                disabled={adjuntarCertMutation.isPending}
                                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted/30 disabled:opacity-50">
                                <Upload className="h-4 w-4" />
                                {registroMap[selectedDate]!.marcaManual!.archivoUrl ? 'Reemplazar certificado' : 'Adjuntar certificado'}
                              </button>
                            </>
                          )}
                        </>
                      )}
```

Agregar `FileText` al import de `lucide-react` y `getUploadUrl` desde donde lo importa `AusenciasPage.tsx`.

- [ ] **Step 4: Lo mismo en la sección Ausencias**

En `apps/web/src/pages/ausencias/AusenciasPage.tsx`, en la tarjeta de cada solicitud, al lado del link "Ver archivo" que ya existe (línea ~354), agregar el botón de adjuntar para el dueño cuando la solicitud no esté `CANCELADA`:

```tsx
                    {a.usuarioId === user?.id && a.estado !== 'CANCELADA' && (
                      <>
                        <input id={`cert-${a.id}`} type="file" accept="image/*,.pdf" className="hidden"
                          onChange={e => {
                            const f = e.target.files?.[0];
                            if (f) adjuntarMutation.mutate({ ausenciaId: a.id, archivo: f });
                            e.target.value = '';
                          }} />
                        <label htmlFor={`cert-${a.id}`}
                          className="text-primary hover:underline flex items-center gap-1 cursor-pointer">
                          <Upload className="h-3 w-3" /> {a.archivoUrl ? 'Reemplazar' : 'Adjuntar'}
                        </label>
                      </>
                    )}
```

Con la mutation correspondiente en el componente que renderiza la lista:

```tsx
  const adjuntarMutation = useMutation({
    mutationFn: async (vars: { ausenciaId: string; archivo: File }) => {
      const fd = new FormData();
      fd.append('archivo', vars.archivo);
      return api.post(`/ausencias/${vars.ausenciaId}/archivo`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ausencias'] }),
    onError: (err: any) => toast({ title: 'No se pudo adjuntar', description: mensajeDeError(err).mensaje, variant: 'destructive' }),
  });
```

Verificar el `queryKey` real que usa esa página antes de escribirlo.

- [ ] **Step 5: Verificar en el navegador**

Marcar un día como certificado médico sin archivo, después adjuntarlo desde el detalle del día. Esperado: aparece "Ver certificado" y el botón pasa a decir "Reemplazar".

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/planillas/PlanillaDetailPage.tsx apps/web/src/pages/ausencias/AusenciasPage.tsx apps/api/src/routes/planillas.routes.ts
git commit -m "feat(web): adjuntar el certificado despues de crear la solicitud"
```

---

## Task 17: Front — aviso de certificado faltante al enviar

**Files:**
- Modify: `apps/web/src/pages/planillas/PlanillaDetailPage.tsx`

- [ ] **Step 1: Calcular el faltante**

```tsx
  const certificadosSinArchivo = planilla.registros.filter(
    r => r.marcaManual?.tipo === 'CERTIFICADO_MEDICO' && !r.marcaManual.archivoUrl,
  ).length;
```

- [ ] **Step 2: Advertir en el envío**

En el handler del botón "Enviar", antes de disparar la mutation:

```tsx
    if (certificadosSinArchivo > 0) {
      const ok = await dialog.confirm({
        title: 'Certificados sin adjuntar',
        message: `Hay ${certificadosSinArchivo} día(s) marcados como certificado médico sin el archivo adjunto. Podés enviar igual y adjuntarlo después si te la rechazan. ¿Enviar?`,
      });
      if (!ok) return;
    }
```

Es una advertencia, no un bloqueo: quien todavía no tiene el papel en la mano no queda trabado.

- [ ] **Step 3: Verificar en el navegador**

Marcar un certificado médico sin archivo y enviar. Esperado: aparece la advertencia y, al aceptar, la planilla se envía.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/planillas/PlanillaDetailPage.tsx
git commit -m "feat(web): avisar al enviar si falta algun certificado"
```

---

## Task 18: Front — cancelar desde Mis Solicitudes

**Files:**
- Modify: `apps/web/src/pages/MisSolicitudesPage.tsx`

- [ ] **Step 1: Tipo y estado nuevos**

En la interfaz `Solicitud`, agregar `cancelable: boolean;`.

En `ESTADO_BADGE`, agregar la entrada:

```tsx
  CANCELADA: { bg: 'bg-zinc-500/20 text-zinc-400', icon: XCircle },
```

- [ ] **Step 2: El endpoint por tipo**

Agregar arriba del componente:

```tsx
const TIPO_PATH: Record<Solicitud['tipo'], string> = {
  PLANILLA: 'planilla',
  VACACION: 'vacacion',
  AUSENCIA: 'ausencia',
  CAMBIO_DIAGRAMA: 'cambio-diagrama',
};
```

- [ ] **Step 3: Botón en la tarjeta**

`SolicitudCard` pasa a recibir `onCancelar` y `cancelando`:

```tsx
function SolicitudCard({ solicitud, onNavigate, onCancelar, cancelando }: {
  solicitud: Solicitud;
  onNavigate?: (id: string) => void;
  onCancelar: (s: Solicitud) => void;
  cancelando: boolean;
}) {
```

Y dentro, al final del cuerpo de la tarjeta:

```tsx
      {solicitud.cancelable && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCancelar(solicitud); }}
          disabled={cancelando}
          className="mt-3 w-full inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted/30 disabled:opacity-50"
        >
          {cancelando ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Cancelar solicitud
        </button>
      )}
```

- [ ] **Step 4: La mutation en la página**

```tsx
  const cancelarMutation = useMutation({
    mutationFn: (s: Solicitud) => api.post(`/mis-solicitudes/${TIPO_PATH[s.tipo]}/${s.id}/cancelar`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mis-solicitudes'] });
      toast({ title: 'Solicitud cancelada' });
    },
    onError: (err: any) => toast({ title: 'No se pudo cancelar', description: mensajeDeError(err).mensaje, variant: 'destructive' }),
  });

  const handleCancelar = async (s: Solicitud) => {
    const extra = s.tipo === 'PLANILLA'
      ? ' La planilla vuelve a borrador y podés corregirla.'
      : '';
    const ok = await dialog.confirm({
      title: 'Cancelar solicitud',
      message: `Se va a retirar la solicitud del circuito de aprobación.${extra} ¿Continuar?`,
      variant: 'danger',
    });
    if (ok) cancelarMutation.mutate(s);
  };
```

Verificar el `queryKey` real que usa la página para la lista antes de escribirlo, e importar `useMutation`, `useQueryClient`, `api`, `useDialog` y `useToast` según los patrones del resto del front.

- [ ] **Step 5: Pasar las props**

En el render de la lista:

```tsx
              <SolicitudCard
                key={s.id}
                solicitud={s}
                onNavigate={...}
                onCancelar={handleCancelar}
                cancelando={cancelarMutation.isPending && cancelarMutation.variables?.id === s.id}
              />
```

- [ ] **Step 6: Verificar en el navegador**

Enviar una planilla y abrir Mis Solicitudes. Esperado: aparece "Cancelar solicitud"; al confirmar, la planilla vuelve a BORRADOR y el botón desaparece de la tarjeta.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/MisSolicitudesPage.tsx
git commit -m "feat(web): cancelar solicitudes desde mis solicitudes"
```

---

## Task 19: Front — toggle del plan B en Configuración

**Files:**
- Modify: `apps/web/src/pages/admin/ConfigPage.tsx`

- [ ] **Step 1: Agregar el campo al tipo y al form**

Agregar `marcaManualActiva: boolean;` a la interfaz `EmpresaConfig` de la página y un switch en la sección de módulos (o al final del formulario si no hay una), siguiendo el patrón de los otros campos booleanos del archivo:

```tsx
        <label className="flex items-center justify-between gap-4 py-3 border-b border-border">
          <div>
            <span className="text-sm font-medium">Marca manual de días (plan B)</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Permite cargar faltas y compensatorios directo en la planilla, sin pasar por el circuito de solicitudes.
              Dejalo apagado mientras la gente se acostumbra a solicitar y aprobar.
            </p>
          </div>
          <input
            type="checkbox"
            checked={form.marcaManualActiva ?? false}
            onChange={e => setForm({ ...form, marcaManualActiva: e.target.checked })}
            className="h-5 w-9 shrink-0"
          />
        </label>
```

Ajustar `form`/`setForm` a los nombres reales que usa el archivo.

- [ ] **Step 2: Verificar en el navegador**

Entrar como ADMIN a Admin → Configuración, encender el toggle, guardar y recargar. Esperado: queda encendido, y en la planilla aparece "Marcar día especial".

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/admin/ConfigPage.tsx
git commit -m "feat(web): toggle del plan B en la configuracion de la empresa"
```

---

## Task 20: Verificación final

- [ ] **Step 1: Tipos y lint**

```bash
cd "apps/api" && npx tsc --noEmit
cd "apps/web" && npx tsc --noEmit && npm run lint
```

Esperado: sin errores de tipos; eslint no supera los 31 warnings del baseline.

- [ ] **Step 2: Todas las suites QA**

```bash
cd "apps/api" && for s in marca-manual cancelaciones visibilidad-nivel planillas ausencias vacaciones flujos; do echo "=== $s ==="; npx tsx tests/qa/$s.qa.ts; done
```

Esperado: todas en PASS. Cualquier fallo que venga de una aserción vieja que asumía el modelo anterior (superior marcando días, par viendo planillas ajenas, revocar dejando RECHAZADA) se corrige en la **aserción**.

- [ ] **Step 3: Recorrido manual**

Con el flag **apagado** (estado de entrega):
1. Como operador: crear planilla, cargar horas, enviar. No debe existir "Marcar día especial".
2. Ir a Mis Solicitudes, cancelar la planilla. Vuelve a BORRADOR con los registros intactos.
3. Pedir una ausencia desde Ausencias y cancelarla desde Mis Solicitudes.
4. Como supervisor: intentar abrir la planilla de otro supervisor del mismo sector. Debe dar "Sin permisos".
5. Como supervisor: abrir la planilla de un subordinado. Debe funcionar.

- [ ] **Step 4: Commit final**

```bash
git add -A
git commit -m "chore: verificacion final de propiedad de planilla y cancelaciones"
```
