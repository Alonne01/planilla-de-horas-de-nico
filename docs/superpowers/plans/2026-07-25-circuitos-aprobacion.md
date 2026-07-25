# Circuitos de aprobación por nivel — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la cadena de aprobación dependa del nivel de quien envía, que se congele al enviar, y que cada sector tenga un solo flujo — arreglando de paso los problemas de consistencia entre los cuatro tipos de documento.

**Architecture:** Un módulo nuevo (`circuito.utils.ts`) concentra las tres decisiones que hoy están copiadas y divergidas en cuatro archivos de rutas: qué flujo aplica, qué pasos quedan según el nivel del solicitante, y cuál es el paso vigente. Al enviar, el circuito resuelto se guarda como JSON en el documento, así que editar un flujo deja de reescribir el recorrido de lo que ya está en curso.

**Tech Stack:** TypeScript, Express 4, Prisma, PostgreSQL 16, React 19, tsx.

**Spec:** `docs/superpowers/specs/2026-07-25-circuitos-aprobacion-design.md`

---

## Convenciones de este proyecto

- **No hay framework de tests.** Scripts sueltos con `node:assert` + `run()`, corridos con `npx tsx`. Referencia: `apps/api/tests/calendario-access.test.ts`. **No propongas vitest/jest.**
- Imports relativos con extensión `.js` aunque el archivo sea `.ts` (ESM).
- **`apps/api/tsconfig.json` solo incluye `src/**/*`**, así que `npx tsc --noEmit` NO chequea `prisma/` ni `tests/`. Para esos, apuntar directo:
  `npx tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --esModuleInterop --skipLibCheck <archivo>`
- Baseline de `eslint` en `apps/web`: **exactamente `✖ 32 problems (30 errors, 2 warnings)`**.
- Los servidores pueden estar apagados. Si hace falta levantarlos, `tsx watch` no siempre recarga con archivos nuevos: tocar `app.ts` y revertir.
- Comentarios y mensajes en castellano rioplatense.

---

## Estructura de archivos

**Nuevos:**

| Archivo | Responsabilidad |
|---|---|
| `apps/api/src/utils/circuito.utils.ts` | Resolver flujo, construir circuito por nivel, leer paso vigente |
| `apps/api/tests/circuito.test.ts` | Tests unitarios de la regla (sin base) |
| `apps/api/prisma/limpiar-asignaciones-duplicadas.ts` | Deja una sola asignación por (tipo, sector) antes de la migración |
| `apps/api/tests/circuito-integracion.qa.ts` | Verificación end-to-end contra `:4000` |

**Modificados de fondo:** `apps/api/prisma/schema.prisma`, los 4 archivos de rutas de documento, `admin.flujos.routes.ts`, `admin.roles.routes.ts`, `aprobaciones.routes.ts`, `mis-solicitudes.routes.ts`, `notificacion.utils.ts`, `apps/api/prisma/seed.ts`, `apps/web/src/pages/admin/FlujosPage.tsx`.

---

## Fase 1 — El motor

### Task 1: La regla por nivel

**Files:**
- Create: `apps/api/src/utils/circuito.utils.ts`
- Create: `apps/api/tests/circuito.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// apps/api/tests/circuito.test.ts
import assert from 'node:assert';
import { construirCircuito, type PasoCircuito } from '../src/utils/circuito.utils.js';

/** La cadena del spec: Supervisor → Coordinador → Gerente → RRHH. */
const CADENA: PasoCircuito[] = [
  { orden: 1, nombrePaso: 'Revisión Supervisor', rolAprobador: 'SUPERVISOR', usuarioEspecificoId: null, requiereComentarioRechazo: true, tiempoLimiteHoras: null, notificarRoles: [] },
  { orden: 2, nombrePaso: 'Aprobación Coordinador', rolAprobador: 'COORDINADOR', usuarioEspecificoId: null, requiereComentarioRechazo: true, tiempoLimiteHoras: 48, notificarRoles: ['OPERADOR'] },
  { orden: 3, nombrePaso: 'Visto Gerencia', rolAprobador: 'GERENTE', usuarioEspecificoId: null, requiereComentarioRechazo: false, tiempoLimiteHoras: null, notificarRoles: [] },
  { orden: 4, nombrePaso: 'Cierre RRHH', rolAprobador: 'RRHH', usuarioEspecificoId: null, requiereComentarioRechazo: true, tiempoLimiteHoras: null, notificarRoles: [] },
];

const NIVELES: Record<string, number> = {
  ADMIN: 100, RRHH: 90, GERENTE: 80, CMASS: 75, COORDINADOR: 70, SUPERVISOR: 60, OPERADOR: 10,
};

const roles = (ps: PasoCircuito[]) => ps.map((p) => p.rolAprobador);

async function run() {
  // 1. OPERADOR (10): no se saltea nada
  {
    const c = construirCircuito(CADENA, 10, NIVELES);
    assert.deepStrictEqual(roles(c), ['SUPERVISOR', 'COORDINADOR', 'GERENTE', 'RRHH']);
  }
  // 2. SUPERVISOR (60): se saltea su propio nivel
  {
    const c = construirCircuito(CADENA, 60, NIVELES);
    assert.deepStrictEqual(roles(c), ['COORDINADOR', 'GERENTE', 'RRHH']);
  }
  // 3. COORDINADOR (70): el caso del pedido
  {
    const c = construirCircuito(CADENA, 70, NIVELES);
    assert.deepStrictEqual(roles(c), ['GERENTE', 'RRHH']);
  }
  // 4. GERENTE (80)
  {
    const c = construirCircuito(CADENA, 80, NIVELES);
    assert.deepStrictEqual(roles(c), ['RRHH']);
  }
  // 5. RRHH (90): no queda nadie por nivel, pero se conserva el último paso
  {
    const c = construirCircuito(CADENA, 90, NIVELES);
    assert.deepStrictEqual(roles(c), ['RRHH'], 'nunca puede quedar en cero');
  }
  // 6. ADMIN (100): idem
  {
    const c = construirCircuito(CADENA, 100, NIVELES);
    assert.deepStrictEqual(roles(c), ['RRHH']);
  }
  // 7. El circuito se renumera 1..N: pasoActual indexa el snapshot, no la cadena original
  {
    const c = construirCircuito(CADENA, 70, NIVELES);
    assert.deepStrictEqual(c.map((p) => p.orden), [1, 2], 'los ordenes deben ser contiguos desde 1');
  }
  // 8. Se conservan los datos del paso, no solo el rol
  {
    const c = construirCircuito(CADENA, 60, NIVELES);
    assert.strictEqual(c[0].nombrePaso, 'Aprobación Coordinador');
    assert.strictEqual(c[0].tiempoLimiteHoras, 48);
    assert.deepStrictEqual(c[0].notificarRoles, ['OPERADOR']);
  }
  // 9. Rol sin nivel conocido (borrado o desactivado): no entra al filtro por
  //    nivel, así que nunca se saltea
  {
    const conHuerfano: PasoCircuito[] = [
      { ...CADENA[0], rolAprobador: 'CAPATAZ_BORRADO' },
      CADENA[3],
    ];
    const c = construirCircuito(conHuerfano, 90, NIVELES);
    assert.deepStrictEqual(roles(c), ['CAPATAZ_BORRADO', 'RRHH'], 'el paso huerfano tiene que verse, no esconderse');
  }
  // 10. Cadena vacía: devuelve vacío, no explota
  {
    assert.deepStrictEqual(construirCircuito([], 10, NIVELES), []);
  }
  // 11. No muta la entrada
  {
    const copia = JSON.parse(JSON.stringify(CADENA));
    construirCircuito(CADENA, 70, NIVELES);
    assert.deepStrictEqual(CADENA, copia, 'construirCircuito no puede mutar los pasos que recibe');
  }
  console.log('✓ circuito: 11/11 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Correr y verificar que FALLA**

```
cd apps/api && npx tsx tests/circuito.test.ts
```

Esperado: falla con `Cannot find module '../src/utils/circuito.utils.js'`.

- [ ] **Step 3: Implementar**

```ts
// apps/api/src/utils/circuito.utils.ts

/**
 * Un paso del circuito de aprobación, ya desprendido del flujo que lo originó.
 *
 * Esta es la forma que se guarda en `circuitoSnapshot` del documento: una vez
 * enviado, el recorrido es de ese documento y no vuelve a depender de la
 * configuración, que puede cambiar mientras el documento circula.
 */
export interface PasoCircuito {
  orden: number;
  nombrePaso: string;
  rolAprobador: string;
  usuarioEspecificoId: string | null;
  requiereComentarioRechazo: boolean;
  tiempoLimiteHoras: number | null;
  notificarRoles: string[];
}

/**
 * Arma el circuito que le corresponde a quien envía, según su nivel.
 *
 * Regla: se saltea todo paso cuyo aprobador tenga nivel MENOR O IGUAL al del
 * solicitante. Un coordinador no necesita que lo aprueben un supervisor ni otro
 * coordinador; sí un gerente y RRHH.
 *
 * Garantía: nunca devuelve cero pasos si la cadena tenía alguno. Si el nivel
 * del solicitante saltea todo paso de nivel CONOCIDO (por ejemplo, RRHH en una
 * cadena que termina en RRHH), se conserva el ÚLTIMO paso de la cadena
 * original. Así nadie se aprueba a sí mismo y siempre queda una firma ajena.
 * La guarda que impide que el propio solicitante firme ese paso vive en las
 * rutas, no acá.
 *
 * Un rol SIN entrada en `nivelPorRol` (borrado, o desactivado — `nivelesPorRol`
 * solo trae roles activos) no tiene nivel con el que compararlo: no entra en
 * el filtro por nivel y queda SIEMPRE en el circuito, sin condición. Si se le
 * asignara un nivel arbitrario (por ejemplo 0) terminaría salteado por el
 * mismo filtro normal en cuanto el solicitante tuviera nivel > 0, que es
 * exactamente lo contrario de "nunca se saltea": el problema tiene que verse,
 * no esconderse.
 *
 * Devuelve pasos RENUMERADOS desde 1: `pasoActual` del documento indexa este
 * circuito, no la cadena configurada.
 */
export function construirCircuito(
  pasos: PasoCircuito[],
  nivelSolicitante: number,
  nivelPorRol: Record<string, number>,
): PasoCircuito[] {
  if (pasos.length === 0) return [];

  const enOrden = [...pasos].sort((a, b) => a.orden - b.orden);

  // Distingue "el rol tiene nivel conocido" de "vale 0": son cosas distintas.
  // Un huérfano no participa del filtro por nivel en absoluto.
  const tieneNivelConocido = (rol: string) =>
    Object.prototype.hasOwnProperty.call(nivelPorRol, rol);

  const conocidos = enOrden.filter((p) => tieneNivelConocido(p.rolAprobador));
  const huerfanos = enOrden.filter((p) => !tieneNivelConocido(p.rolAprobador));

  const sobrevivientesConocidos = conocidos.filter(
    (p) => nivelPorRol[p.rolAprobador] > nivelSolicitante,
  );

  // La garantía del último paso se evalúa solo contra los pasos de nivel
  // conocido: si ninguno sobrevive, se agrega el último paso de la cadena
  // ORIGINAL completa (aunque sea un huérfano, en cuyo caso ya está incluido
  // más abajo y el Map de más adelante lo deduplica sin problema).
  const garantia = sobrevivientesConocidos.length === 0 ? [enOrden[enOrden.length - 1]] : [];

  // Dedupe por `orden` original y se reordena para no depender del orden de
  // concatenación de los tres grupos.
  const porOrdenOriginal = new Map<number, PasoCircuito>();
  for (const p of [...sobrevivientesConocidos, ...huerfanos, ...garantia]) {
    porOrdenOriginal.set(p.orden, p);
  }
  const final = [...porOrdenOriginal.values()].sort((a, b) => a.orden - b.orden);

  return final.map((p, i) => ({ ...p, orden: i + 1 }));
}
```

- [ ] **Step 4: Correr y verificar que PASA**

```
cd apps/api && npx tsx tests/circuito.test.ts
```

Esperado: `✓ circuito: 11/11 OK`. Si algún caso falla, arreglá la IMPLEMENTACIÓN, nunca el test.

- [ ] **Step 5: Typecheck**

```
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/utils/circuito.utils.ts apps/api/tests/circuito.test.ts
git commit -m "feat(api): regla de circuito de aprobacion por nivel del solicitante"
```

---

### Task 2: Resolver el flujo y leer el paso vigente

**Files:**
- Modify: `apps/api/src/utils/circuito.utils.ts`
- Modify: `apps/api/tests/circuito.test.ts`

**Contexto:** hoy la resolución del flujo está copiada en 4 archivos y divergió: planillas y vacaciones ordenan por `createdAt desc`, ausencias y cambios de diagrama no ordenan (lo decide Postgres), y compensatorio colapsa la prioridad usuario→sector→global en un `OR` plano. El patrón correcto es el de `planillas.routes.ts:270-299`.

- [ ] **Step 1: Agregar las funciones**

```ts
import { PrismaClient } from '@prisma/client';

export type TipoDocumentoFlujo = 'PLANILLA' | 'VACACION' | 'AUSENCIA' | 'COMPENSATORIO' | 'CAMBIO_DIAGRAMA';

/**
 * Qué flujo le corresponde a un documento, con prioridad usuario → sector →
 * global. Devuelve null si no hay ninguno configurado.
 *
 * El `orderBy` es obligatorio: sin él, con dos asignaciones el resultado lo
 * decide el orden físico de Postgres y puede cambiar entre consultas. La
 * restricción única de la migración hace que el empate no ocurra, pero el orden
 * queda igual para que el comportamiento no dependa de esa garantía.
 */
export async function resolverFlujo(
  prisma: PrismaClient,
  tipoDocumento: TipoDocumentoFlujo,
  usuario: { userId: string; empresaId: string; sectorId: string | null },
): Promise<{ id: string } | null> {
  const base = { empresaId: usuario.empresaId, tipoDocumento, activo: true };
  const buscar = (asignacion: Record<string, unknown>) =>
    prisma.flujoAprobacion.findFirst({
      where: { ...base, asignaciones: { some: { ...asignacion, activo: true, tipoDocumento } } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

  const porUsuario = await buscar({ usuarioId: usuario.userId });
  if (porUsuario) return porUsuario;

  if (usuario.sectorId) {
    const porSector = await buscar({ sectorId: usuario.sectorId });
    if (porSector) return porSector;
  }

  return buscar({ sectorId: null, usuarioId: null });
}

/** Los niveles de cada código de rol de la empresa, para `construirCircuito`. */
export async function nivelesPorRol(
  prisma: PrismaClient,
  empresaId: string,
): Promise<Record<string, number>> {
  const roles = await prisma.rolConfig.findMany({
    where: { empresaId, activo: true },
    select: { codigo: true, nivel: true },
  });
  return Object.fromEntries(roles.map((r) => [r.codigo, r.nivel]));
}

/**
 * Los pasos que rigen un documento.
 *
 * Prioriza el snapshot congelado al enviarlo. Cae a los pasos vivos del flujo
 * solo para documentos anteriores a este cambio, que no tienen snapshot: sin
 * ese fallback, todo lo que estuviera en curso al desplegar quedaría trabado.
 */
export function pasosDe(documento: {
  circuitoSnapshot: unknown;
  flujo?: { pasos: PasoCircuito[] } | null;
}): PasoCircuito[] {
  if (Array.isArray(documento.circuitoSnapshot)) {
    return documento.circuitoSnapshot as PasoCircuito[];
  }
  const vivos = documento.flujo?.pasos ?? [];
  return [...vivos].sort((a, b) => a.orden - b.orden);
}

/** El paso vigente según `pasoActual` (1-based). `null` si está fuera de rango. */
export function pasoActualDe(
  documento: { circuitoSnapshot: unknown; pasoActual: number; flujo?: { pasos: PasoCircuito[] } | null },
): PasoCircuito | null {
  return pasosDe(documento).find((p) => p.orden === documento.pasoActual) ?? null;
}
```

- [ ] **Step 2: Agregar tests de `pasosDe` y `pasoActualDe`**

Agregar al final de `run()` en `apps/api/tests/circuito.test.ts`, antes del `console.log`, y actualizar el contador a `15/15`:

```ts
  // 12. pasosDe prioriza el snapshot sobre el flujo vivo
  {
    const doc = { circuitoSnapshot: [CADENA[3]], flujo: { pasos: CADENA } };
    assert.deepStrictEqual(roles(pasosDe(doc)), ['RRHH'], 'el snapshot manda');
  }
  // 13. pasosDe cae al flujo vivo si no hay snapshot (documentos viejos)
  {
    const doc = { circuitoSnapshot: null, flujo: { pasos: CADENA } };
    assert.strictEqual(pasosDe(doc).length, 4);
  }
  // 14. pasosDe sin snapshot ni flujo devuelve vacío, no explota
  {
    assert.deepStrictEqual(pasosDe({ circuitoSnapshot: null, flujo: null }), []);
  }
  // 15. pasoActualDe devuelve null si el paso quedó fuera de rango
  {
    const doc = { circuitoSnapshot: [CADENA[3]], pasoActual: 3, flujo: null };
    assert.strictEqual(pasoActualDe(doc), null);
  }
```

y agregar `pasosDe, pasoActualDe` al import de la línea 2.

- [ ] **Step 3: Correr**

```
cd apps/api && npx tsx tests/circuito.test.ts
```

Esperado: `✓ circuito: 15/15 OK`

- [ ] **Step 4: Typecheck y commit**

```
cd apps/api && npx tsc --noEmit
git add apps/api/src/utils/circuito.utils.ts apps/api/tests/circuito.test.ts
git commit -m "feat(api): resolucion de flujo y lectura de paso unificadas"
```

---

## Fase 2 — Base de datos

### Task 3: Limpiar las asignaciones duplicadas

**Files:**
- Create: `apps/api/prisma/limpiar-asignaciones-duplicadas.ts`

**Contexto:** el sector `Testing` tiene hoy DOS asignaciones `PLANILLA` activas. La migración de la Task 4 falla si quedan duplicados.

- [ ] **Step 1: Escribir el script**

```ts
/**
 * Deja una sola asignación de flujo por (tipoDocumento, alcance).
 *
 * Corre ANTES de la migración que agrega la restricción única: con duplicados,
 * la migración falla al aplicarse. Es idempotente, así que se puede reintentar.
 *
 * Criterio: se conserva la asignación MÁS ANTIGUA. Es la que venía del seed o
 * la que el sector viene usando; la nueva suele ser un agregado por error, que
 * además hoy le roba el sector a la vieja en silencio.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const todas = await prisma.flujoAsignacion.findMany({
    orderBy: { id: 'asc' },
    include: { flujo: { select: { nombre: true, createdAt: true } }, sector: { select: { nombre: true } } },
  });

  const porClave = new Map<string, typeof todas>();
  for (const a of todas) {
    const clave = `${a.tipoDocumento}|${a.sectorId ?? '-'}|${a.usuarioId ?? '-'}`;
    porClave.set(clave, [...(porClave.get(clave) ?? []), a]);
  }

  const aBorrar: string[] = [];
  for (const [clave, grupo] of porClave) {
    if (grupo.length < 2) continue;
    const ordenado = [...grupo].sort(
      (x, y) => x.flujo.createdAt.getTime() - y.flujo.createdAt.getTime(),
    );
    const conserva = ordenado[0];
    const sobran = ordenado.slice(1);
    console.log(`${clave}  (${conserva.sector?.nombre ?? 'global'})`);
    console.log(`   conserva: ${conserva.flujo.nombre}`);
    for (const s of sobran) {
      console.log(`   borra:    ${s.flujo.nombre}`);
      aBorrar.push(s.id);
    }
  }

  if (aBorrar.length === 0) {
    console.log('No hay asignaciones duplicadas.');
    return;
  }
  if (dryRun) {
    console.log(`\n*** DRY RUN — se borrarían ${aBorrar.length} asignaciones ***`);
    return;
  }
  const { count } = await prisma.flujoAsignacion.deleteMany({ where: { id: { in: aBorrar } } });
  console.log(`\nBorradas ${count} asignaciones duplicadas.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Simulacro**

```
cd apps/api && npx tsx prisma/limpiar-asignaciones-duplicadas.ts --dry-run
```

Esperado: reporta `PLANILLA|<id de Testing>|-` con una conservada y una borrada.

- [ ] **Step 3: Ejecutar y verificar**

```
cd apps/api && npx tsx prisma/limpiar-asignaciones-duplicadas.ts
cd apps/api && npx tsx prisma/limpiar-asignaciones-duplicadas.ts --dry-run
```

La segunda corrida tiene que decir `No hay asignaciones duplicadas.`

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/limpiar-asignaciones-duplicadas.ts
git commit -m "chore(prisma): script para dejar una sola asignacion de flujo por sector"
```

---

### Task 4: Migración de schema

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: una migración nueva en `apps/api/prisma/migrations/`

- [ ] **Step 1: Agregar `circuitoSnapshot` a los 4 modelos**

En `schema.prisma`, junto a `pasoActual` de cada uno (líneas ~371, ~469, ~556, ~894 — verificá el contenido, no el número):

```prisma
  /// Circuito congelado al enviar: el recorrido es de este documento y no
  /// vuelve a depender de la configuración, que puede cambiar mientras circula.
  circuitoSnapshot   Json?          @map("circuito_snapshot")
```

Los modelos son `Planilla`, `Vacacion`, `Ausencia` y `SolicitudCambioDiagrama`.

- [ ] **Step 2: Agregar las restricciones únicas**

En `model FlujoAsignacion`, antes del `@@map`:

```prisma
  @@unique([tipoDocumento, sectorId])
```

En `model FlujoPaso`, antes del `@@map`:

```prisma
  @@unique([flujoId, orden])
```

- [ ] **Step 3: Generar la migración**

```
cd apps/api && npx prisma migrate dev --name circuitos_aprobacion
```

Si falla por datos duplicados, volvé a la Task 3.

- [ ] **Step 4: Agregar los índices parciales a mano**

Prisma no expresa índices únicos parciales. Editá el `.sql` que acaba de generar y agregá al final:

```sql
-- Un solo flujo global por tipo: la restriccion de arriba no lo cubre porque
-- Postgres no considera iguales a dos NULL.
CREATE UNIQUE INDEX "flujos_asignaciones_global_unico"
  ON "flujos_asignaciones" ("tipo_documento")
  WHERE "sector_id" IS NULL AND "usuario_id" IS NULL;

-- Un solo flujo por usuario y tipo.
CREATE UNIQUE INDEX "flujos_asignaciones_usuario_unico"
  ON "flujos_asignaciones" ("tipo_documento", "usuario_id")
  WHERE "usuario_id" IS NOT NULL;
```

Y aplicala:

```
cd apps/api && npx prisma migrate dev
```

- [ ] **Step 5: Verificar que la base rechaza un duplicado**

```
cd apps/api && npx tsx -e "import {PrismaClient} from '@prisma/client'; const p=new PrismaClient(); (async()=>{ const a=await p.flujoAsignacion.findFirst({where:{tipoDocumento:'PLANILLA',sectorId:{not:null}}}); const f=await p.flujoAprobacion.findFirst({where:{tipoDocumento:'PLANILLA',id:{not:a.flujoId}}}); try { await p.flujoAsignacion.create({data:{flujoId:f.id,tipoDocumento:'PLANILLA',sectorId:a.sectorId}}); console.log('MAL: la base acepto el duplicado'); } catch(e){ console.log('OK: la base lo rechazo ->', e.code); } finally { await p.\$disconnect(); } })()"
```

Esperado: `OK: la base lo rechazo -> P2002`

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(prisma): circuito congelado por documento y un flujo por sector"
```

---

## Fase 3 — Cablear los cuatro tipos

### Task 5: Planillas

**Files:**
- Modify: `apps/api/src/routes/planillas.routes.ts`

**Contexto:** hoy el flujo se resuelve al CREAR el borrador (`:270-312`), a veces semanas antes de enviarse, y `/enviar` (`:524-527`) no lo re-resuelve. El avance lee los pasos vivos (`:564-570`) y busca por número (`:612`).

- [ ] **Step 1: Sacar la resolución del alta**

Reemplazar el bloque de resolución de `:270-299` y el `flujoId` del `create`: el borrador ya no ata ningún flujo. Dejar `flujoId: null` en la creación. Borrar también el `console.log` de `DEBUG_APPROVALS` que reportaba el flujo elegido al crear, porque deja de aplicar ahí.

- [ ] **Step 2: Resolver y congelar al enviar**

En el handler de `/enviar`, antes del `update`:

```ts
const usuario = await prisma.usuario.findUnique({
  where: { id: planilla.usuarioId },
  select: { sectorId: true, rol: true },
});
const flujo = await resolverFlujo(prisma, 'PLANILLA', {
  userId: planilla.usuarioId,
  empresaId: req.user!.empresaId,
  sectorId: usuario?.sectorId ?? null,
});
const niveles = await nivelesPorRol(prisma, req.user!.empresaId);
const nivelSolicitante = niveles[usuario?.rol ?? ''] ?? 0;

let circuito: PasoCircuito[] = [];
if (flujo) {
  const pasos = await prisma.flujoPaso.findMany({
    where: { flujoId: flujo.id },
    orderBy: { orden: 'asc' },
  });
  circuito = construirCircuito(pasos as unknown as PasoCircuito[], nivelSolicitante, niveles);
}

await prisma.planilla.update({
  where: { id: planilla.id },
  data: {
    estado: 'ENVIADA',
    pasoActual: 1,
    enviadaAt: new Date(),
    obsRechazo: null,
    flujoId: flujo?.id ?? null,
    circuitoSnapshot: circuito.length > 0 ? circuito : undefined,
  },
});
```

Y en la respuesta, avisar cuando no hay circuito:

```ts
res.json({
  ...planillaActualizada,
  avisoSinCircuito: circuito.length === 0
    ? 'Tu sector no tiene circuito de aprobación configurado: la planilla va a requerir una aprobación manual de RRHH o superior.'
    : undefined,
});
```

- [ ] **Step 3: Que avanzar y rechazar lean el snapshot**

Reemplazar `const pasos = planilla.flujo?.pasos ?? []` por `const pasos = pasosDe(planilla)` en el handler de avanzar, y `pasos.find(p => p.orden === planilla.pasoActual)` por `pasoActualDe(planilla)` tanto en avanzar como en rechazar. El `include` del `findUnique` tiene que seguir trayendo `flujo: { include: { pasos: ... } }` para el fallback de documentos viejos, y además seleccionar `circuitoSnapshot`.

- [ ] **Step 4: Guarda general de autoaprobación**

Hoy solo existe en la rama de escape (`:602`). Agregar al principio de los handlers de avanzar y rechazar, después de cargar la planilla:

```ts
// Nadie aprueba lo suyo, ni siquiera un ADMIN. Con la regla por nivel esto es
// crítico: un RRHH que envía conserva el paso RRHH en su circuito.
if (planilla.usuarioId === req.user!.userId) {
  res.status(403).json({ error: 'No podés aprobar ni rechazar tu propia planilla' });
  return;
}
```

- [ ] **Step 5: La guarda de aprobación duplicada compara el paso aprobado**

`:646-656` compara contra `nuevoPaso` (el destino). Cambiar a comparar contra `planilla.pasoActual` (el que se está aprobando).

- [ ] **Step 6: Verificar**

```
cd apps/api && npx tsc --noEmit && npx tsx tests/circuito.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/planillas.routes.ts
git commit -m "feat(api): congelar el circuito de la planilla al enviarla"
```

---

### Task 6: Vacaciones

**Files:**
- Modify: `apps/api/src/routes/vacaciones.routes.ts`

**El código a escribir es el mismo de la Task 5, Steps 1 a 5** — abrila y copiá de ahí los bloques, cambiando el modelo de Prisma y los textos. Lo que cambia en este archivo son las líneas donde va cada cosa:

- [ ] **Step 1:** la resolución de `:425-454` pasa a `resolverFlujo`, y se ejecuta al enviar, no al crear.
- [ ] **Step 2:** congelar el circuito con `construirCircuito` en `circuitoSnapshot`, igual que Task 5 Step 2 pero con `prisma.vacacion.update`.
- [ ] **Step 3:** el avance y el rechazo leen con `pasosDe` / `pasoActualDe` (hoy `:704`, `:718-720`, `:878-883`).
- [ ] **Step 4:** guarda general de autoaprobación (Task 5 Step 4) con el mensaje `'No podés aprobar ni rechazar tu propia solicitud de vacaciones'`.
- [ ] **Step 5:** la guarda de aprobación duplicada tiene que comparar contra el paso **aprobado**, no el destino — el mismo arreglo de Task 5 Step 5. Buscá en este archivo el `findFirst` sobre el historial que compara `pasoFlujo`; si no existe, decilo en el reporte en vez de inventarlo.
- [ ] **Step 6:** conservar el comentario de `:702-703`, que documenta el escape de flujo acortado, ajustándolo: con el snapshot ese caso ya no se produce por edición del flujo, pero sigue cubriendo documentos viejos sin snapshot.
- [ ] **Step 7:** `cd apps/api && npx tsc --noEmit`
- [ ] **Step 8:** commit `feat(api): congelar el circuito de vacaciones al enviarlas`

---

### Task 7: Ausencias y compensatorios

**Files:**
- Modify: `apps/api/src/routes/ausencias.routes.ts`

**Contexto:** este archivo tiene DOS problemas propios además de los comunes. Las ausencias que carga un superior nacen sin `flujoId` y lo resuelven en `/enviar`, **sobreescribiéndolo en cada reenvío** (`:643`). Y COMPENSATORIO resuelve con un `OR` plano sin prioridad (`:352-363`) más un fallback que agarra cualquier flujo de la empresa ignorando el sector (`:367-371`).

- [ ] **Step 1:** unificar las dos vías de alta: ninguna ata flujo al crear.
- [ ] **Step 2:** `/enviar` resuelve con `resolverFlujo` y congela. Al reenviar un documento rechazado, **se vuelve a resolver y congelar**: es un envío nuevo.
- [ ] **Step 3:** reemplazar la resolución de COMPENSATORIO (`:352-371`) por `resolverFlujo(prisma, 'COMPENSATORIO', ...)`. Borrar el fallback que ignora el sector: con la prioridad correcta ya no hace falta y hoy enmascara una configuración faltante.
- [ ] **Step 4:** avance y rechazo con `pasosDe` / `pasoActualDe` (hoy `:728-739`, `:899-904`).
- [ ] **Step 5:** guarda general de autoaprobación (Task 5 Step 4), mensaje `'No podés aprobar ni rechazar tu propia ausencia'`.
- [ ] **Step 6:** la guarda de aprobación duplicada compara contra el paso **aprobado**, no el destino (Task 5 Step 5). Si en este archivo no existe esa guarda, reportalo en vez de inventarla.
- [ ] **Step 7:** `cd apps/api && npx tsc --noEmit`
- [ ] **Step 8:** commit `feat(api): congelar el circuito de ausencias y compensatorios`

---

### Task 8: Cambios de diagrama

**Files:**
- Modify: `apps/api/src/routes/cambios-diagrama.routes.ts`

- [ ] **Step 1:** reemplazar la resolución de `:155-187` (tres `findFirst` **sin `orderBy`**) por `resolverFlujo`.
- [ ] **Step 2:** congelar el circuito al crear la solicitud, que en este tipo es el mismo acto que enviarla.
- [ ] **Step 3:** avance y rechazo con `pasosDe` / `pasoActualDe` (hoy `:250-262`, `:416`).
- [ ] **Step 4:** guarda general de autoaprobación (Task 5 Step 4), mensaje `'No podés aprobar ni rechazar tu propia solicitud de cambio de diagrama'`.
- [ ] **Step 5:** la guarda de aprobación duplicada compara contra el paso **aprobado**, no el destino (Task 5 Step 5). Si en este archivo no existe esa guarda, reportalo en vez de inventarla.
- [ ] **Step 6:** `cd apps/api && npx tsc --noEmit`
- [ ] **Step 7:** commit `feat(api): congelar el circuito de los cambios de diagrama`

---

## Fase 4 — ABM y guardas

### Task 9: Asignar, editar y borrar flujos

**Files:**
- Modify: `apps/api/src/routes/admin.flujos.routes.ts`

- [ ] **Step 1: Asignación duplicada → 409**

`:344-356` incluye `flujoId` en el `WHERE` de duplicados, así que solo bloquea el mismo flujo dos veces. Sacar `flujoId` de esa comparación y responder:

```ts
const ocupado = await prisma.flujoAsignacion.findFirst({
  where: { tipoDocumento, sectorId: sectorId ?? null, usuarioId: usuarioId ?? null, activo: true },
  include: { flujo: { select: { nombre: true } } },
});
if (ocupado) {
  res.status(409).json({
    error: `Ese alcance ya usa el flujo "${ocupado.flujo.nombre}". Cada sector puede tener un solo flujo por tipo de documento.`,
  });
  return;
}
```

- [ ] **Step 2: Borrar un flujo → 409 o forzar**

`:201-218` no borra las asignaciones y la FK es `RESTRICT`, así que hoy tira un 500 opaco:

```ts
const asignaciones = await prisma.flujoAsignacion.findMany({
  where: { flujoId: id },
  include: { sector: { select: { nombre: true } } },
});
const forzar = req.query.forzarDesasignacion === 'true';
if (asignaciones.length > 0 && !forzar) {
  const alcances = asignaciones.map((a) => a.sector?.nombre ?? 'global').join(', ');
  res.status(409).json({
    error: `El flujo está asignado a: ${alcances}. Repetí la operación con forzarDesasignacion=true para desasignarlo y borrarlo.`,
    asignaciones: asignaciones.length,
  });
  return;
}
await prisma.$transaction([
  prisma.flujoAsignacion.deleteMany({ where: { flujoId: id } }),
  prisma.flujoPaso.deleteMany({ where: { flujoId: id } }),
  prisma.flujoAprobacion.delete({ where: { id } }),
]);
res.status(204).end();
```

- [ ] **Step 3: Informar el alcance al editar**

En el `PUT`, después de actualizar, contar los documentos en curso que nacieron de ese flujo y devolverlo en la respuesta:

```ts
const enCurso = await prisma.planilla.count({ where: { flujoId: id, estado: { in: ['ENVIADA', 'EN_REVISION'] } } });
```

Sumar los otros tres tipos y devolver `documentosEnCurso`. **No bloquea**: con el snapshot esos documentos ya no se ven afectados; es información para el admin.

- [ ] **Step 4: Auditoría**

El archivo no tiene un solo `logAuditoria` (grep vacío). Agregar en alta, edición, borrado y asignación, siguiendo el patrón de `apps/api/src/lib/auditoria.ts` — abrilo y copiá cómo lo llaman otras rutas.

- [ ] **Step 5: Renumerar al borrar un paso suelto**

`DELETE /:id/pasos/:pid` (`:288-305`) no renumera, y ahora hay `@@unique([flujoId, orden])`. Tras borrar, renumerar los restantes 1..N en la misma transacción.

- [ ] **Step 6: Habilitar CAMBIO_DIAGRAMA en el schema de creación**

`:28` solo acepta `['PLANILLA','VACACION','AUSENCIA','COMPENSATORIO']`. Agregar `'CAMBIO_DIAGRAMA'`. Sin esto, un admin que borre uno de los tres del seed no puede recrearlo.

- [ ] **Step 7:** `cd apps/api && npx tsc --noEmit` y commit `fix(api): guardas y auditoria en el ABM de flujos`

---

### Task 10: Borrar un rol usado como aprobador

**Files:**
- Modify: `apps/api/src/routes/admin.roles.routes.ts`

**Contexto:** `:135-139` solo verifica que ningún usuario tenga el rol. No mira los pasos de flujo, así que deja pasos apuntando a un código huérfano que nadie puede aprobar salvo un ADMIN.

- [ ] **Step 1: Agregar el chequeo**

```ts
const pasos = await prisma.flujoPaso.findMany({
  where: { OR: [{ rolAprobador: rol.codigo }, { notificarRoles: { has: rol.codigo } }] },
  include: { flujo: { select: { nombre: true } } },
});
if (pasos.length > 0) {
  const flujos = [...new Set(pasos.map((p) => p.flujo.nombre))].join(', ');
  res.status(409).json({
    error: `No se puede borrar: el rol se usa en pasos de los flujos ${flujos}. Cambiá esos pasos antes de borrarlo.`,
  });
  return;
}
```

- [ ] **Step 2:** `cd apps/api && npx tsc --noEmit` y commit `fix(api): no borrar un rol que se usa como aprobador en un flujo`

---

## Fase 5 — Trazabilidad

### Task 11: Historial reconstruible

**Files:**
- Modify: los 4 archivos de rutas de documento
- Modify: `apps/api/src/routes/mis-solicitudes.routes.ts`
- Modify: `apps/api/prisma/schema.prisma` + migración

- [ ] **Step 1: Agregar `rolAprobador` a los 4 historiales**

En `PlanillaHistorial`, `VacacionHistorial`, `AusenciaHistorial` y `CambioDiagramaHistorial`:

```prisma
  rolAprobador String? @map("rol_aprobador")
```

Generar la migración: `cd apps/api && npx prisma migrate dev --name historial_rol_aprobador`

- [ ] **Step 2: Guardar el paso APROBADO, no el destino**

Hoy `pasoFlujo: nuevoPaso` (`planillas.routes.ts:694` y equivalentes). Cambiar a `pasoFlujo: <pasoActual antes de avanzar>` y sumar `rolAprobador: <el rol del paso aprobado>`.

- [ ] **Step 3: El rechazo también guarda el paso**

En los 4 tipos el rechazo no guarda `pasoFlujo` (`planillas.routes.ts:786-793` y equivalentes), así que se pierde dónde se cortó. Agregarlo, más el `rolAprobador`.

- [ ] **Step 4: La reconstrucción lee el snapshot**

`mis-solicitudes.routes.ts:53-67` (`enriquecerPasos`) arma el recorrido contra los pasos ACTUALES del flujo y los cruza por `h.pasoFlujo === paso.orden + 1`. Con la cadena cambiada, le atribuye a alguien la aprobación de un paso que no existía.

Cambiar para que use `pasosDe(documento)` y cruce por `h.pasoFlujo === paso.orden` (el ajuste del `+ 1` deja de hacer falta porque el Step 2 ahora guarda el paso aprobado).

- [ ] **Step 5:** `cd apps/api && npx tsc --noEmit` y commit `fix(api): historial que permite reconstruir el recorrido real`

---

## Fase 6 — CAMBIO_DIAGRAMA al nivel de los demás

### Task 12: Bandeja, notificaciones y visibilidad

**Files:**
- Modify: `apps/api/src/routes/aprobaciones.routes.ts`
- Modify: `apps/api/src/utils/notificacion.utils.ts`
- Modify: `apps/api/src/routes/cambios-diagrama.routes.ts`

- [ ] **Step 1: Sumarlo a la bandeja unificada**

`GET /aprobaciones` (`:89-191`) consulta planillas, vacaciones, ausencias y compensatorios, pero no cambios de diagrama. Agregar la consulta siguiendo el mismo patrón de los otros cuatro, incluido el filtro `matchesCurrentStep`, y sumarlo a la respuesta de `:357-368`.

- [ ] **Step 2: Que notifique**

`notificarAprobadoresPaso` (`notificacion.utils.ts:131`) solo tipa `'PLANILLA'|'VACACION'|'AUSENCIA'`. Agregar `'CAMBIO_DIAGRAMA'` y llamarla desde `cambios-diagrama.routes.ts` al crear la solicitud y al avanzar de paso, como hacen los otros tres.

- [ ] **Step 3: Filtrar los pendientes por responsable**

`GET /cambios-diagrama/pendientes` (`:77-99`) no filtra por paso ni por aprobador: cualquier nivel ≥60 ve todas las solicitudes de la empresa, incluidos sectores ajenos. Aplicar el mismo criterio que la bandeja: solo las que están en un paso cuyo `rolAprobador` matchea al usuario.

- [ ] **Step 4:** `cd apps/api && npx tsc --noEmit` y commit `feat(api): cambios de diagrama en la bandeja y con notificaciones`

---

## Fase 7 — Seed y panel

### Task 13: Flujos COMPENSATORIO en el seed

**Files:**
- Modify: `apps/api/prisma/seed.ts`

**Contexto:** no existe ningún flujo `COMPENSATORIO` en la base, así que todo franco compensatorio nace sin circuito.

- [ ] **Step 1:** agregar los tres patrones `COMPENSATORIO` a `flujosConfig`, con los mismos pasos que los de `AUSENCIA`, y sus asignaciones por sector en el bloque de asignaciones.
- [ ] **Step 2:** correr el seed sobre la base actual: `cd apps/api && npm run db:seed`. Como es idempotente, solo tiene que crear los flujos nuevos.
- [ ] **Step 3:** verificar: `SELECT tipo_documento, count(*) FROM flujos_aprobacion GROUP BY 1;` tiene que incluir `COMPENSATORIO`.
- [ ] **Step 4:** commit `feat(prisma): flujos de aprobacion para compensatorios`

---

### Task 14: Vista previa por nivel en el panel

**Files:**
- Modify: `apps/web/src/pages/admin/FlujosPage.tsx`

**Contexto:** el punto flojo de una regla automática es que es implícita. Esto la hace visible.

- [ ] **Step 1: Traer los niveles**

La página ya consulta `/admin/roles` (agregado en un cambio anterior) y tiene `roles` con `codigo` y `nivel`.

- [ ] **Step 2: Calcular la vista previa**

Replicar la regla en el front. **No la reimplementes de memoria**: es la misma de `construirCircuito` — saltear los pasos de nivel ≤ al del solicitante, conservar el último si no queda ninguno.

```tsx
function circuitoPara(pasos: Paso[], nivelSolicitante: number, nivelPorRol: Record<string, number>) {
  if (pasos.length === 0) return [];
  const sobreviven = pasos.filter((p) => (nivelPorRol[p.rolAprobador] ?? 0) > nivelSolicitante);
  return sobreviven.length > 0 ? sobreviven : [pasos[pasos.length - 1]];
}
```

- [ ] **Step 3: Mostrarla**

Debajo de la cadena, una tabla con una fila por rol activo de la empresa (ordenados por nivel ascendente) y el recorrido que le toca. Reusar el estilo de chips que ya usa el pipeline.

- [ ] **Step 4: Marcar los sectores ocupados**

En el selector de sectores de la asignación, marcar los que ya tienen un flujo de ese tipo, para que el 409 no sea una sorpresa.

- [ ] **Step 5: Verificar**

```
cd apps/web && npx tsc -b --noEmit && npx eslint . && npm run test:unit
```

Esperado: sin errores de tipos, eslint en `✖ 32 problems (30 errors, 2 warnings)`, tests en verde.

- [ ] **Step 6:** commit `feat(web): vista previa del circuito por nivel en el panel de flujos`

---

## Fase 8 — Verificación

### Task 15: Verificación integral

**Files:**
- Create: `apps/api/tests/circuito-integracion.qa.ts`

- [ ] **Step 1: Escribir la verificación end-to-end**

Requiere el servidor en `:4000` y los usuarios de prueba creados por `prisma/crear-usuarios-prueba.ts` (contraseña `Prueba2026!`, dominio `@test.wenlen.com`, con `op1/sup1/coord1.<sector>` y `rrhh1` transversal).

Andamiaje, copiado de `apps/api/tests/config-periodo.qa.ts`:

```ts
const BASE = 'http://localhost:4000/api/v1';
function assert(c: boolean, m: string): asserts c { if (!c) throw new Error(m); }

async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('application/json') ? await res.json() : await res.text() };
}

async function login(email: string, password: string) {
  const r = await api('POST', '/auth/login', { body: { email, password } });
  assert(r.status === 200, `login ${email} → ${r.status}`);
  return r.body.accessToken as string;
}
```

**Antes de escribir los escenarios, resolvé el prerrequisito**: la cadena del spec (`Supervisor → Coordinador → Gerente → RRHH`) no existe en el seed, que trae como máximo 3 pasos y sin `GERENTE`. Creá ese flujo desde la API como admin y asignalo a un sector de prueba (por ejemplo `Fractura`), o adaptá los escenarios a la cadena real del sector que uses. **Documentá cuál elegiste**: los conteos esperados dependen de eso.

Escenarios obligatorios:
1. `op1.<sector>` envía una planilla → su `circuitoSnapshot` tiene los 4 roles de la cadena, con `orden` 1..4.
2. `coord1.<sector>` envía → su snapshot tiene exactamente `['GERENTE', 'RRHH']`.
3. `rrhh1` envía → su snapshot tiene 1 paso, y al intentar aprobarlo **él mismo recibe 403**.
4. Se envía una planilla, se edita el flujo sacando un paso, y esa planilla sigue con su snapshot original de 4 pasos.
5. Asignar un segundo flujo `PLANILLA` al mismo sector → 409 con el nombre del flujo que ya lo ocupa.
6. Poner `circuitoSnapshot = NULL` a mano en una planilla enviada (por Prisma) y verificar que sigue avanzando con el flujo vivo, sin 500.

- [ ] **Step 2: Correr**

```
cd apps/api && npx tsx tests/circuito-integracion.qa.ts
```

**Limpiá lo que crees**: `DELETE /usuarios/:id` es borrado lógico, no saca la fila.

- [ ] **Step 3: Suite completa**

```
cd apps/api && npx tsc --noEmit
cd apps/api && npx tsx tests/circuito.test.ts && npx tsx tests/zod-es.test.ts && npx tsx tests/calendario-access.test.ts && npx tsx tests/seed-idempotente.test.ts && npx tsx tests/periodo-actual.test.ts
cd apps/web && npx tsc -b --noEmit && npx eslint . && npm run test:unit
cd apps/web && npm run build
cd apps/api && npm run build
```

- [ ] **Step 4:** commit `test(api): verificacion integral de los circuitos de aprobacion`

---

## Notas para quien ejecute

- **La Task 3 va antes que la 4**, sí o sí: la migración de la restricción única falla con datos duplicados.
- **Las Tasks 5 a 8 son el mismo patrón cuatro veces.** Hacelas en orden y usá la 5 como referencia; si divergen, se reproduce exactamente el problema que este trabajo viene a arreglar.
- **No reimplementes la regla de nivel en el front de memoria** (Task 14): tiene que dar lo mismo que `construirCircuito`. Si diverge, el panel le miente al admin.
- **Verificá los números de línea antes de editar.** Varios de estos archivos se modificaron hoy y los números del spec pueden haberse corrido.
