# PLANILLA DE HORAS — ADDENDUM v2.1
## Exportación Excel Avanzada + Funcionalidades Adicionales

**Complemento de:** `PLANILLA_HORAS_SPEC.md v2.0`  
**Fecha:** Marzo 2025

---

## ÍNDICE

1. [Exportación Excel avanzada — diseño completo](#1-exportación-excel-avanzada--diseño-completo)
2. [Estructura del archivo Excel exportado](#2-estructura-del-archivo-excel-exportado)
3. [Nuevas tablas de base de datos](#3-nuevas-tablas-de-base-de-datos)
4. [API endpoints de exportación](#4-api-endpoints-de-exportación)
5. [Funcionalidades adicionales sugeridas](#5-funcionalidades-adicionales-sugeridas)
6. [Schema Prisma — modelos adicionales](#6-schema-prisma--modelos-adicionales)

---

## 1. EXPORTACIÓN EXCEL AVANZADA — DISEÑO COMPLETO

### 1.1 Acceso y permisos

| Rol | Puede exportar |
|---|---|
| OPERADOR | Solo su propia planilla individual |
| SUPERVISOR | Su propia planilla + las de su equipo |
| COORDINADOR | Todos los usuarios de su sector |
| GERENTE | Todos los sectores (solo vista resumen, sin montos) |
| RRHH | Todo — con todos los campos, incluyendo montos salariales |
| ADMIN | Todo |

### 1.2 Panel de exportación (UI)

La pantalla de exportación (`ExportacionPage`) tiene tres secciones:

#### Sección A — Filtros de selección

```
┌─────────────────────────────────────────────────────────────────┐
│  PERÍODO                                                        │
│  [Mes/Año inicio ▼]  hasta  [Mes/Año fin ▼]                    │
│  ☑ Período actual   ○ Rango personalizado   ○ Año completo     │
├─────────────────────────────────────────────────────────────────┤
│  SECTORES                                                       │
│  ☑ Todos    ○ Seleccionar:                                      │
│  [ ] Fractura  [ ] Well Testing  [ ] END  [ ] Wireline         │
│  [ ] Servicios Well Head  [ ] Mant. Mecánico  [ ] Wireline     │
├─────────────────────────────────────────────────────────────────┤
│  PERSONAS                                                       │
│  ☑ Todos los del filtro anterior                               │
│  ○ Solo supervisores     ○ Solo operadores                     │
│  ○ Selección manual: [buscar persona...] [+ agregar]           │
│                                                                 │
│  Personas seleccionadas:                                        │
│  [x] García, Juan — Well Testing — Supervisor                  │
│  [x] López, María — Fractura — Operador                        │
├─────────────────────────────────────────────────────────────────┤
│  ESTADO DE PLANILLAS                                            │
│  ☑ Aprobadas   ☑ Cerradas   [ ] En revisión   [ ] Borrador    │
└─────────────────────────────────────────────────────────────────┘
```

#### Sección B — Selección de datos a incluir

```
┌─────────────────────────────────────────────────────────────────┐
│  HOJAS A GENERAR                                               │
│                                                                 │
│  ☑ Resumen consolidado         (1 fila por persona por mes)   │
│  ☑ Planilla individual         (1 hoja por persona)           │
│  ☑ Resumen por sector          (agrupado por sector)          │
│  ☑ Ausencias y licencias       (detalle de todas las ausencias)│
│  ☑ Vacaciones del período      (solicitudes y saldos)         │
│  ☑ Horas extras detalladas     (desglose día por día, extras) │
│  [ ] Desglose salarial         (solo RRHH — conceptos CCT)    │
│  [ ] Comparativa de períodos   (hasta 12 meses lado a lado)   │
│                                                                 │
│  COLUMNAS EN PLANILLA INDIVIDUAL                               │
│  ☑ Fecha y día de semana                                      │
│  ☑ Lugar de trabajo (Base/Campo/Franco)                        │
│  ☑ Horarios entrada/salida                                     │
│  ☑ Horas trabajadas brutas                                     │
│  ☑ Clasificación (Normal / 50% / 100%)                        │
│  ☑ Horas de viaje                                             │
│  ☑ Pernocte (Hotel/Trailer)                                   │
│  ☑ Maneja                                                     │
│  ☑ Feriado / Franco trabajado                                  │
│  ☑ Observaciones                                               │
│  [ ] Valor monetario por día   (solo RRHH)                    │
│  [ ] Acumulado mensual en $    (solo RRHH)                    │
└─────────────────────────────────────────────────────────────────┘
```

#### Sección C — Opciones de formato

```
┌─────────────────────────────────────────────────────────────────┐
│  FORMATO                                                        │
│  ○ Un archivo con todas las hojas  (recomendado)               │
│  ○ Un archivo por persona (descarga como .zip)                 │
│  ○ Un archivo por sector                                        │
│                                                                 │
│  ☑ Aplicar formato de colores por tipo de día                  │
│  ☑ Incluir totales y subtotales                                │
│  ☑ Incluir gráficos en hoja resumen                           │
│  ☑ Incluir datos de contacto del empleado en cabecera          │
│  [ ] Proteger hojas con contraseña: [__________]              │
│                                                                 │
│  [PREVISUALIZAR]          [EXPORTAR EXCEL]                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. ESTRUCTURA DEL ARCHIVO EXCEL EXPORTADO

### Nombre del archivo

```
Planilla_Horas_{empresa}_{sector_o_todos}_{mes_inicio}_{mes_fin}.xlsx
Ejemplo: Planilla_Horas_TechOil_WellTesting_Feb2025_Mar2025.xlsx
Ejemplo: Planilla_Horas_TechOil_TODOS_Mar2025.xlsx
```

### 2.1 Hoja 1 — RESUMEN CONSOLIDADO

Esta hoja tiene **una fila por persona por mes** y es la más útil para RRHH en liquidación.

**Cabecera del archivo (filas 1-4):**
```
Fila 1: [Logo empresa] | PLANILLA DE HORAS — RESUMEN CONSOLIDADO
Fila 2: Período: 21/02/2025 al 20/03/2025
Fila 3: Generado por: García, Adriana (RRHH) | Fecha: 20/03/2025 14:32
Fila 4: [vacía — separador]
```

**Columnas (desde fila 5):**

| # | Columna | Descripción | Solo RRHH |
|---|---|---|---|
| A | Legajo | Número de legajo | |
| B | Apellido y Nombre | | |
| C | Sector | | |
| D | Categoría | Ej: OF.1A | |
| E | CCT | 637/11 / Jerárquico | |
| F | Tipo Contrato | Prueba / Indefinido | |
| G | Antigüedad (años) | | |
| H | Período | "Feb-Mar 2025" | |
| I | Días en período | Total días del período (generalmente 28-31) | |
| J | Días trabajados | Días con registro cargado | |
| K | Días BASE | Días trabajados en base | |
| L | Días CAMPO | Días trabajados en campo | |
| M | Días franco | Días de descanso | |
| N | Días feriado | Feriados del período | |
| O | Días franco trabajado | Francos con horas cargadas | |
| P | Días ausencia certif. médico | | |
| Q | Días falta justificada | | |
| R | Días falta injustificada | | |
| S | Días vacaciones gozadas | | |
| T | Total horas brutas | Antes de clasificar | |
| U | Horas normales | | |
| V | Horas extra 50% | | |
| W | Horas extra 100% | | |
| X | Horas viaje (maneja) | Sumadas a jornada | |
| Y | Horas viaje (no maneja) | Pagadas al 47% | |
| Z | Noches hotel | Count de pernoctes Hotel | |
| AA | Noches trailer | Count de pernoctes Trailer | |
| AB | Días con manejo | | |
| AC | Estado planilla | APROBADA / CERRADA | |
| AD | Saldo vacaciones actual | Días disponibles | |
| AE | Básico vigente | ✓ Solo RRHH |
| AF | Neto estimado | ✓ Solo RRHH |
| AG | Total remunerativo | ✓ Solo RRHH |
| AH | Total no remunerativo | ✓ Solo RRHH |
| AI | Total retenciones | ✓ Solo RRHH |

**Formato visual:**
- Filas pares: fondo blanco; filas impares: fondo gris muy claro (#F9F9F9)
- Columnas K-S (ausencias y tipos de día): fondo amarillo suave (#FFFBEB)
- Columnas T-AB (horas): fondo azul suave (#EFF6FF)
- Columnas AE-AI (salarial, solo RRHH): fondo verde suave (#F0FDF4), protegidas con contraseña si se configuró
- Totales al final de cada sector (fila de subtotal con fondo de color del sector)
- Fila TOTAL GENERAL al final con fondo oscuro y letras blancas

### 2.2 Hojas de planilla individual (una por persona)

**Nombre de la hoja:** `{Apellido} {Nombre inicial}` ej: `Garcia J.`  
Si hay más de un García, J.: `Garcia J. (2)`

**Cabecera de la hoja:**
```
Fila 1:  PLANILLA DE HORAS
Fila 2:  Nombre: García, Juan Manuel         Legajo: 00432
Fila 3:  Sector: Well Testing                Categoría: OF.1A
Fila 4:  CCT: 637/11 Petroleros Privados     Tipo contrato: Indefinido
Fila 5:  Diagrama: 7×7                       Antigüedad: 3 años 2 meses
Fila 6:  Período: 21/02/2025 — 20/03/2025    Estado: APROBADA
Fila 7:  [vacía]
```

**Columnas de datos (desde fila 8):**

| Col | Nombre | Notas |
|---|---|---|
| A | Fecha | DD/MM/YYYY |
| B | Día | Lun / Mar / Mié / Jue / Vie / Sáb / Dom |
| C | Tipo día diagrama | Laboral / Franco (según diagrama asignado) |
| D | Lugar | BASE / CAMPO / FRANCO |
| E | Entrada T1 | HH:MM |
| F | Salida T1 | HH:MM |
| G | Entrada T2 | HH:MM |
| H | Salida T2 | HH:MM |
| I | Hs. brutas | Suma de ambos turnos |
| J | Hs. normales | Clasificadas como normales |
| K | Hs. extra 50% | |
| L | Hs. extra 100% | |
| M | Hs. viaje | |
| N | Pernocte | NO / HOTEL / TRAILER |
| O | Maneja | SI / NO |
| P | Feriado | SI / NO |
| Q | Franco trab. | SI / NO |
| R | Ausencia | tipo o vacío |
| S | Observaciones | |

**Formato visual por tipo de día:**
- Día laborable trabajado: sin color especial
- Franco trabajado (sábado/domingo con horas): fondo azul claro (#DBEAFE)
- Feriado trabajado: fondo naranja (#FED7AA)
- Ausencia por cert. médico: fondo amarillo (#FEF9C3)
- Falta injustificada: fondo rojo claro (#FEE2E2)
- Vacaciones: fondo verde claro (#DCFCE7)
- Franco sin horas (día libre): fondo gris claro (#F3F4F6)

**Fila de totales (al final de los datos):**
```
Fila N+1:  [vacía]
Fila N+2:  TOTALES DEL PERÍODO   [suma de cada columna numérica]
Fila N+3:  [vacía]
Fila N+4:  Días trabajados: XX   Días campo: XX   Días base: XX
Fila N+5:  Horas normales: XX    Horas extra 50%: XX    Horas extra 100%: XX
Fila N+6:  Pernoctes hotel: XX   Pernoctes trailer: XX  Días con manejo: XX
Fila N+7:  [vacía]
Fila N+8:  ESTIMACIÓN SALARIAL   [solo si rol tiene permiso]
Fila N+9:  Concepto             Cantidad    Valor Unit.    Total
Fila N+10: Sueldo Básico        —           —              $XXX.XXX
Fila N+11: Antigüedad (X años)  —           —              $XX.XXX
...y así por cada concepto del CCT...
Fila N+X:  NETO ESTIMADO        —           —              $XXX.XXX
```

### 2.3 Hoja RESUMEN POR SECTOR

Una sección por sector. Cada sección tiene:
- Nombre del sector como título (en el color del sector)
- Tabla con una fila por persona con los mismos datos del resumen consolidado
- Subtotales del sector al final de la sección
- Promedio del sector (horas promedio por persona, días promedio)

### 2.4 Hoja AUSENCIAS Y LICENCIAS

Datos útiles para control de ausentismo:

| Col | Nombre |
|---|---|
| A | Legajo |
| B | Apellido y Nombre |
| C | Sector |
| D | Tipo de ausencia |
| E | Fecha inicio |
| F | Fecha fin |
| G | Días |
| H | Descripción |
| I | Nro. certificado |
| J | Estado (aprobada/pendiente) |
| K | Impacto salarial (SI/NO) |
| L | % descuento aplicado |

**Al final:** tabla resumen de ausencias por tipo y por sector (como mini-pivote).

### 2.5 Hoja VACACIONES

| Col | Nombre |
|---|---|
| A | Legajo |
| B | Apellido y Nombre |
| C | Sector |
| D | Fecha ingreso |
| E | Antigüedad |
| F | Días ganados (según CCT) |
| G | Saldo al inicio del período |
| H | Días tomados en el período |
| I | Saldo actual |
| J | Días pendientes de aprobación |
| K | Fecha próxima acumulación |
| L | Días a acumular próxima vez |

### 2.6 Hoja HORAS EXTRAS DETALLADAS

Foco: qué personas generaron más horas extras y por qué motivo (campo, feriado, fin de semana).

| Col | Nombre |
|---|---|
| A | Legajo |
| B | Apellido y Nombre |
| C | Sector |
| D | Fecha |
| E | Día |
| F | Motivo extra | FERIADO / FIN DE SEMANA / JORNADA EXTENDIDA |
| G | Horas extra 50% |
| H | Horas extra 100% |
| I | Lugar |
| J | Observaciones |

**Al final:** tabla resumen — total extras por persona y por sector.

### 2.7 Hoja DESGLOSE SALARIAL (solo RRHH/ADMIN)

Una tabla por persona con todos los conceptos del CCT desglosados:

```
GARCIA, JUAN MANUEL — OF.1A — CCT 637/11 — Período: Feb-Mar 2025

CONCEPTO                    | CANTIDAD   | VALOR UNIT.  | SUBTOTAL
─────────────────────────── | ────────── | ──────────── | ─────────
REMUNERATIVOS FIJOS
Sueldo Básico               |            |              | $850.000
Antigüedad (3 años)         | 3%         | $850.000     | $25.500
Presentismo                 |            |              | $8.500
Bono Paz Social             |            |              | $12.000
Adicional Torre             |            |              | $35.000
─────────────────────────── | ────────── | ──────────── | ─────────
Subtotal Remunerativo Fijo  |            |              | $931.000

REMUNERATIVOS VARIABLES
Horas Extra 50%             | 24 hs      | $6.640       | $159.375
Horas Extra 100%            | 8 hs       | $8.854       | $70.833
Horas Viaje (no maneja)     | 12 hs      | $4.157       | $49.882
Desarraigo (14 noches)      |            | $2.500       | $35.000
─────────────────────────── | ────────── | ──────────── | ─────────
Subtotal Remunerativo Var.  |            |              | $315.090

TOTAL REMUNERATIVO          |            |              | $1.246.090

NO REMUNERATIVOS
Vianda (14 días campo)      |            | $2.200       | $30.800
Desayuno (17 días)          |            | $800         | $13.600
Vaca Muerta                 |            |              | $45.000
─────────────────────────── | ────────── | ──────────── | ─────────
Subtotal No Remunerativo    |            |              | $89.400

RETENCIONES
Jubilación (11%)            | 11%        | $1.246.090   | -$137.070
PAMI (3%)                   | 3%         | $1.246.090   | -$37.383
Obra Social (3%)            | 3%         | $1.246.090   | -$37.383
Sindical (2.65%)            | 2.65%      | $1.246.090   | -$33.021
Mutual (3.97%)              | 3.97%      | $1.246.090   | -$49.470
Ganancias                   | 1.8%       | $1.246.090   | -$22.430
─────────────────────────── | ────────── | ──────────── | ─────────
Total Retenciones           |            |              | -$316.757

Descuentos por ausencias    |            |              | $0

══════════════════════════════════════════════════════════════════
NETO ESTIMADO               |            |              | $1.018.733
══════════════════════════════════════════════════════════════════
```

### 2.8 Hoja COMPARATIVA DE PERÍODOS (opcional)

Si se seleccionan múltiples meses, genera una comparativa lado a lado:

| Persona | Feb-Mar | Mar-Abr | Abr-May | Tendencia |
|---|---|---|---|---|
| García, J. | 176 hs | 184 hs | 192 hs | ↑ |
| López, M. | 160 hs | 152 hs | 168 hs | → |

Incluye flecha de tendencia (↑ sube, ↓ baja, → estable) calculada con la variación porcentual.

---

## 3. NUEVAS TABLAS DE BASE DE DATOS

### 3.1 Historial de exportaciones

```sql
CREATE TABLE exportaciones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES empresas(id),
  generada_por_id   UUID NOT NULL REFERENCES usuarios(id),

  -- Parámetros de la exportación
  periodo_inicio    DATE NOT NULL,
  periodo_fin       DATE NOT NULL,
  sectores_ids      UUID[],           -- NULL = todos
  usuarios_ids      UUID[],           -- NULL = todos los del filtro
  roles_filtro      TEXT[],           -- ['OPERADOR','SUPERVISOR'] o NULL = todos
  hojas_incluidas   TEXT[],           -- lista de hojas generadas
  incluye_salarial  BOOLEAN DEFAULT FALSE,
  estado_planillas  TEXT[],           -- ['APROBADA','CERRADA']

  -- Archivo generado
  nombre_archivo    TEXT NOT NULL,
  tamanio_bytes     INTEGER,
  archivo_url       TEXT,             -- ruta en el servidor o S3
  total_personas    INTEGER,
  total_registros   INTEGER,

  creado_at         TIMESTAMP DEFAULT NOW()
);
```

### 3.2 Plantillas de exportación guardadas

```sql
CREATE TABLE exportaciones_plantillas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES empresas(id),
  creada_por_id     UUID NOT NULL REFERENCES usuarios(id),
  nombre            VARCHAR(80) NOT NULL,  -- "Cierre mensual Well Testing"
  descripcion       TEXT,
  configuracion     JSONB NOT NULL,        -- toda la config del panel de exportación
  es_publica        BOOLEAN DEFAULT FALSE, -- visible para todos los RRHH
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);
```

Ejemplo de `configuracion` JSONB:
```json
{
  "sectores": ["uuid-well-testing"],
  "roles": ["OPERADOR", "SUPERVISOR"],
  "estado_planillas": ["APROBADA", "CERRADA"],
  "hojas": ["resumen_consolidado", "planilla_individual", "ausencias"],
  "columnas_incluidas": ["horas_normales", "horas_extra_50", "horas_extra_100", "pernocte"],
  "incluye_salarial": false,
  "formato": "un_archivo",
  "con_colores": true,
  "con_totales": true,
  "con_graficos": false
}
```

---

## 4. API ENDPOINTS DE EXPORTACIÓN

```
POST   /exportaciones/preview         → { total_personas, total_registros, hojas[] }
POST   /exportaciones/generar         → { job_id }  (async para archivos grandes)
GET    /exportaciones/status/:job_id  → { status, progreso, archivo_url? }
GET    /exportaciones/historial       → [Exportacion]
GET    /exportaciones/descargar/:id   → .xlsx file stream
DELETE /exportaciones/:id             → 204

GET    /exportaciones/plantillas      → [Plantilla]
POST   /exportaciones/plantillas      → Plantilla
PUT    /exportaciones/plantillas/:id  → Plantilla
DELETE /exportaciones/plantillas/:id  → 204
```

### 4.1 Request body de POST /exportaciones/generar

```typescript
interface ExportacionRequest {
  periodo_inicio: string;          // "2025-02-21"
  periodo_fin: string;             // "2025-03-20"
  sectores_ids?: string[];         // undefined = todos
  usuarios_ids?: string[];         // undefined = todos del filtro
  roles_filtro?: Rol[];            // undefined = todos
  estado_planillas: PlanillaEstado[];

  hojas: {
    resumen_consolidado: boolean;
    planilla_individual: boolean;
    resumen_por_sector: boolean;
    ausencias: boolean;
    vacaciones: boolean;
    horas_extras: boolean;
    desglose_salarial: boolean;    // solo RRHH/ADMIN
    comparativa_periodos: boolean;
  };

  columnas_planilla: {
    fechas: boolean;
    horarios: boolean;
    horas_clasificadas: boolean;
    pernocte: boolean;
    maneja: boolean;
    observaciones: boolean;
    valor_monetario: boolean;      // solo RRHH/ADMIN
  };

  formato: 'un_archivo' | 'por_persona' | 'por_sector';
  con_colores: boolean;
  con_totales: boolean;
  con_graficos: boolean;
  password?: string;
}
```

### 4.2 Implementación asíncrona con job queue

Para exportaciones grandes (>50 personas o múltiples meses), la generación debe ser asíncrona:

```typescript
// En el controller
async function generarExportacion(req: Request, res: Response) {
  // Validar permisos
  const job = await exportQueue.add('generar-excel', {
    params: req.body,
    usuarioId: req.user.id,
    empresaId: req.user.empresaId,
  });

  res.json({ job_id: job.id, status: 'procesando' });
  // El cliente hace polling a GET /exportaciones/status/:job_id
  // Cuando termina, emite socket: 'exportacion:lista' con la URL de descarga
}
```

---

## 5. FUNCIONALIDADES ADICIONALES SUGERIDAS

Las siguientes funcionalidades amplían el sistema y agregan valor real para empresas del sector oil & gas. Están ordenadas por **impacto vs esfuerzo de implementación**.

---

### 5.1 🟢 ALTA PRIORIDAD — Recibo de sueldo digital

**Qué es:** Generar un recibo de sueldo en PDF o Excel a partir del snapshot del cálculo salarial de la planilla aprobada. El empleado puede descargarlo y firmarlo digitalmente.

**Funcionalidades:**
- Generar PDF con formato de recibo oficial (doble ejemplar: empleador y empleado)
- Firma digital del empleado (puede ser un click "Recibido" con timestamp y IP)
- Historial de recibos por empleado
- El empleado puede ver todos sus recibos desde su perfil
- RRHH puede descargar recibos masivos en ZIP

**Impacto:** Elimina la impresión y circulación física de recibos. Cumple con normativa de recibos digitales (ley de contrato de trabajo permite este formato).

**Nuevas tablas:** `recibos_sueldo` con campos: planilla_id, usuario_id, pdf_url, firmado_empleado_at, ip_firma

---

### 5.2 🟢 ALTA PRIORIDAD — Gestión de proyectos / costeo por proyecto

**Qué es:** Cada registro de horas puede asociarse a un proyecto activo. Esto permite saber exactamente cuántas horas y qué costo laboral tuvo cada proyecto.

**Funcionalidades:**
- CRUD de proyectos con código, nombre, cliente, fechas de inicio/fin
- Asignar usuarios a proyectos activos
- Al cargar horas en campo, el operador selecciona el proyecto del día
- En analytics: gráfico de horas por proyecto, costo laboral por proyecto
- Exportación Excel con hoja adicional "Costeo por Proyecto"
- RRHH ve el costo hora-hombre de cada proyecto

**Nuevas tablas:** `proyectos` (código, nombre, cliente, activo), `registros_horas.proyecto_id`

**Nota:** Este campo ya aparece como "Observaciones con autocompletado de proyectos" en la spec original — este módulo lo formaliza con su propia tabla y reportes.

---

### 5.3 🟢 ALTA PRIORIDAD — Dashboard de KPIs en tiempo real

**Qué es:** Un dashboard en la home del sistema con métricas clave actualizadas en tiempo real para cada rol.

**KPIs por rol:**

| Rol | KPIs |
|---|---|
| OPERADOR | Horas del período, neto estimado, días restantes, saldo vacaciones |
| SUPERVISOR | Estado planillas de su equipo, horas promedio del sector, ausencias activas |
| COORDINADOR | Planillas pendientes de revisión (con tiempo en cola), % planillas aprobadas del mes, ausencias del sector |
| GERENTE | Horas por sector este mes (gráfico de barras), headcount activo, costo laboral estimado total |
| RRHH | Planillas pendientes de cierre, nómina estimada del período, desvíos de horas por sector |

---

### 5.4 🟡 MEDIA PRIORIDAD — Gestión de capacitaciones y vencimientos

**Qué es:** Registro de capacitaciones obligatorias (Seguridad, Primeros auxilios, Manejo defensivo, etc.) y vencimientos de habilitaciones (licencia de conducir, HNBR, curso de altura, etc.)

**Funcionalidades:**
- Definir tipos de capacitación y su duración de vigencia (ej: "Trabajo en altura — 1 año")
- Registrar fecha de realización por empleado
- Alertas automáticas a RRHH cuando un vencimiento se acerca (30 días antes)
- En la ficha del empleado: lista de habilitaciones vigentes y vencidas
- Exportación de vencimientos críticos

**Nuevas tablas:** `tipos_capacitacion` (nombre, vigencia_dias, obligatoria), `empleado_capacitaciones` (usuario_id, tipo_id, fecha_realizacion, vencimiento, archivo_url)

---

### 5.5 🟡 MEDIA PRIORIDAD — Gestión de equipamiento / EPP

**Qué es:** Control de entrega de Equipos de Protección Personal (EPP) y herramientas por empleado.

**Funcionalidades:**
- Catálogo de items (casco, guantes, botas, arnés, etc.)
- Registro de entrega por empleado con firma digital
- Devolución al egreso del empleado
- Alertas de vencimiento de EPP (arneses, extintores)
- Historial de entregas por empleado

---

### 5.6 🟡 MEDIA PRIORIDAD — Portal del empleado mejorado

**Qué es:** Una sección "Mi perfil" más completa donde el empleado puede ver y descargar todo su historial.

**Funcionalidades:**
- Ver y descargar todos sus recibos de sueldo históricos
- Ver su evolución salarial en gráfico (desde el inicio)
- Ver resumen de vacaciones de todos los años
- Ver sus capacitaciones y vencimientos
- Ver su historial de sectores y categorías
- Actualizar datos personales no sensibles (teléfono, dirección)
- Solicitar certificado laboral (PDF generado automáticamente con datos de la empresa)

**Certificado laboral automático:** PDF con: nombre, CUIL, empresa, fecha ingreso, categoría, jornada, sueldo básico y leyenda "A pedido del interesado".

---

### 5.7 🟡 MEDIA PRIORIDAD — Alertas y recordatorios configurables

**Qué es:** Sistema de alertas automáticas por email o notificación push, configurables por ADMIN.

**Alertas disponibles:**
- Recordatorio de carga de planilla (X días antes del cierre del período)
- Alerta a coordinador cuando hay planillas sin revisar hace más de X horas
- Alerta a RRHH cuando quedan Y días para el cierre sin planillas aprobadas
- Notificación de vencimiento de contrato a prueba
- Aviso de cumpleaños del empleado (para coordinador)
- Alerta cuando el saldo de vacaciones de un empleado supera X días sin tomar
- Recordatorio de próxima acumulación de vacaciones

**Nueva tabla:** `alertas_config` (empresa_id, tipo, activa, dias_anticipacion, roles_destino)

---

### 5.8 🟠 IMPLEMENTACIÓN FUTURA — Firma digital de planillas

**Qué es:** El empleado firma digitalmente su planilla antes de enviarla. El coordinador firma digitalmente al aprobar.

**Tecnología:** Web Crypto API (disponible en todos los browsers modernos) o firma simple con hash + timestamp.

**Modelo simple:** Al enviar una planilla, generar un hash SHA-256 del contenido serializado + timestamp + IP + user-agent. Al aprobar, generar otro hash del aprobador. Ambos se guardan en `planillas.firma_emisor` y `planillas.firma_aprobador`. Esto no es firma criptográfica certificada, pero deja trazabilidad legal suficiente para uso interno.

---

### 5.9 🟠 IMPLEMENTACIÓN FUTURA — App móvil nativa (React Native)

**Qué es:** Aunque la PWA funciona en móvil, una app nativa React Native permitiría:
- GPS automático al cargar horas en campo (geolocalización)
- Foto del parte diario como adjunto al registro
- Notificaciones nativas más confiables en iOS
- Acceso offline más robusto

**Nota:** Compartir toda la lógica de negocio con la PWA vía un paquete compartido (`packages/shared`).

---

### 5.10 🟠 IMPLEMENTACIÓN FUTURA — Integración con sistemas externos

**Posibles integraciones:**
- **AFIP / ARCA:** Exportar declaración jurada F.931 (cargas sociales)
- **Sistema contable (Tango, BEJERMAN):** Exportar asiento de sueldos en formato compatible
- **Google Calendar / Outlook:** Sincronizar diagrama de trabajo como calendario
- **WhatsApp Business API:** Enviar notificaciones de aprobación/rechazo por WhatsApp

---

## 6. SCHEMA PRISMA — MODELOS ADICIONALES

### Exportaciones y plantillas

```prisma
model Exportacion {
  id               String   @id @default(uuid())
  empresaId        String   @map("empresa_id")
  generadaPorId    String   @map("generada_por_id")
  periodoInicio    DateTime @map("periodo_inicio")
  periodoFin       DateTime @map("periodo_fin")
  sectoresIds      String[] @map("sectores_ids")
  usuariosIds      String[] @map("usuarios_ids")
  rolesFiltro      String[] @map("roles_filtro")
  hojasIncluidas   String[] @map("hojas_incluidas")
  incluyeSalarial  Boolean  @default(false) @map("incluye_salarial")
  estadoPlanillas  String[] @map("estado_planillas")
  nombreArchivo    String   @map("nombre_archivo")
  tamanioBytes     Int?     @map("tamanio_bytes")
  archivoUrl       String?  @map("archivo_url")
  totalPersonas    Int?     @map("total_personas")
  totalRegistros   Int?     @map("total_registros")
  creadoAt         DateTime @default(now()) @map("creado_at")

  empresa      Empresa  @relation(fields: [empresaId], references: [id])
  generadaPor  Usuario  @relation(fields: [generadaPorId], references: [id])

  @@map("exportaciones")
}

model ExportacionPlantilla {
  id             String   @id @default(uuid())
  empresaId      String   @map("empresa_id")
  creadaPorId    String   @map("creada_por_id")
  nombre         String
  descripcion    String?
  configuracion  Json
  esPublica      Boolean  @default(false) @map("es_publica")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  empresa   Empresa @relation(fields: [empresaId], references: [id])
  creadaPor Usuario @relation(fields: [creadaPorId], references: [id])

  @@map("exportaciones_plantillas")
}
```

### Proyectos (sugerido en 5.2)

```prisma
model Proyecto {
  id          String    @id @default(uuid())
  empresaId   String    @map("empresa_id")
  codigo      String
  nombre      String
  cliente     String?
  descripcion String?
  fechaInicio DateTime? @map("fecha_inicio")
  fechaFin    DateTime? @map("fecha_fin")
  activo      Boolean   @default(true)
  createdAt   DateTime  @default(now()) @map("created_at")

  empresa   Empresa         @relation(fields: [empresaId], references: [id])
  registros RegistroHoras[]

  @@map("proyectos")
}
```

Agregar a `RegistroHoras`:
```prisma
proyectoId  String?   @map("proyecto_id")
proyecto    Proyecto? @relation(fields: [proyectoId], references: [id])
```

### Recibos de sueldo (sugerido en 5.1)

```prisma
model ReciboSueldo {
  id                 String    @id @default(uuid())
  planillaId         String    @unique @map("planilla_id")
  usuarioId          String    @map("usuario_id")
  pdfUrl             String?   @map("pdf_url")
  firmadoEmpleadoAt  DateTime? @map("firmado_empleado_at")
  ipFirma            String?   @map("ip_firma")
  userAgentFirma     String?   @map("user_agent_firma")
  hashContenido      String?   @map("hash_contenido")
  createdAt          DateTime  @default(now()) @map("created_at")

  planilla Planilla @relation(fields: [planillaId], references: [id])
  usuario  Usuario  @relation(fields: [usuarioId], references: [id])

  @@map("recibos_sueldo")
}
```

### Capacitaciones (sugerido en 5.4)

```prisma
model TipoCapacitacion {
  id              String   @id @default(uuid())
  empresaId       String   @map("empresa_id")
  nombre          String
  descripcion     String?
  vigenciaDias    Int?     @map("vigencia_dias")    // NULL = no vence
  esObligatoria   Boolean  @default(false) @map("es_obligatoria")
  alertaDias      Int      @default(30) @map("alerta_dias") // avisar X días antes del vencimiento
  activo          Boolean  @default(true)

  empresa       Empresa              @relation(fields: [empresaId], references: [id])
  capacitaciones EmpleadoCapacitacion[]

  @@map("tipos_capacitacion")
}

model EmpleadoCapacitacion {
  id               String    @id @default(uuid())
  usuarioId        String    @map("usuario_id")
  tipoId           String    @map("tipo_id")
  fechaRealizacion DateTime  @map("fecha_realizacion")
  fechaVencimiento DateTime? @map("fecha_vencimiento")
  institucion      String?
  archivoUrl       String?   @map("archivo_url")
  observaciones    String?
  createdAt        DateTime  @default(now()) @map("created_at")

  usuario Usuario          @relation(fields: [usuarioId], references: [id])
  tipo    TipoCapacitacion @relation(fields: [tipoId], references: [id])

  @@map("empleado_capacitaciones")
}
```

### Configuración de alertas (sugerido en 5.7)

```prisma
model AlertaConfig {
  id               String   @id @default(uuid())
  empresaId        String   @map("empresa_id")
  tipo             String
  activa           Boolean  @default(true)
  diasAnticipacion Int?     @map("dias_anticipacion")
  horasLimite      Int?     @map("horas_limite")
  rolesDestino     String[] @map("roles_destino")
  descripcion      String?
  createdAt        DateTime @default(now()) @map("created_at")

  empresa Empresa @relation(fields: [empresaId], references: [id])

  @@map("alertas_config")
}
```

---

## APÉNDICE — RESUMEN DE DATOS ÚTILES PARA RRHH POR HOJA EXCEL

### Qué datos son los más valiosos para el área de RRHH

Basado en las necesidades típicas de liquidación en el sector oil & gas con CCT 637/11:

**Para liquidación mensual:**
- Horas normales, extras 50%, extras 100% por persona → calcula adicionales
- Días campo con pernocte (hotel/trailer) → liquida desarraigo
- Días con manejo en campo → liquida adicional manejo
- Horas de viaje sin manejo → liquida al 47%
- Faltas injustificadas → descuento proporcional del básico

**Para control de ausentismo:**
- Días con certificado médico por persona → evaluar tendencias
- Ratio ausencias/días trabajados por sector → detectar sectores problemáticos
- Ausencias acumuladas en el año → cruce con licencias CCT

**Para proyección de costos:**
- Total horas extras por sector → presupuesto de horas extra
- Comparativa mes a mes de horas → detectar estacionalidad
- Nómina estimada total → provisión de sueldos

**Para administración de personal:**
- Saldos de vacaciones → planificar períodos de descanso
- Contratos en prueba próximos a vencer → decidir continuidad
- Vencimientos de capacitaciones → programar cursos

---

*Fin del Addendum v2.1*  
*Este documento debe leerse en conjunto con PLANILLA_HORAS_SPEC.md v2.0*
