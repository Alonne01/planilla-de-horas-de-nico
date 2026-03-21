# PLANILLA DE HORAS — ESPECIFICACIÓN TÉCNICA COMPLETA PARA AGENTE IA
**Versión:** 2.0  
**Fecha:** Marzo 2025  
**Tipo:** Progressive Web App — Full Stack  
**Uso:** Instrucción completa para implementación por agente de IA

---

## ÍNDICE

1. [Resumen del sistema](#1-resumen-del-sistema)
2. [Stack tecnológico](#2-stack-tecnológico)
3. [Estructura de directorios](#3-estructura-de-directorios)
4. [Base de datos — Esquema PostgreSQL completo](#4-base-de-datos--esquema-postgresql-completo)
5. [Sistema de autenticación y usuarios](#5-sistema-de-autenticación-y-usuarios)
6. [Roles y permisos](#6-roles-y-permisos)
7. [Sectores](#7-sectores)
8. [Diagramas de trabajo](#8-diagramas-de-trabajo)
9. [Flujo de aprobación configurable](#9-flujo-de-aprobación-configurable)
10. [Registro de horas — Core](#10-registro-de-horas--core)
11. [Motor de cálculo salarial CCT — Expandido](#11-motor-de-cálculo-salarial-cct--expandido)
12. [Conceptos salariales configurables](#12-conceptos-salariales-configurables)
13. [Vacaciones](#13-vacaciones)
14. [Ausencias y certificados médicos](#14-ausencias-y-certificados-médicos)
15. [Analytics y dashboards](#15-analytics-y-dashboards)
16. [Notificaciones real-time](#16-notificaciones-real-time)
17. [Exportación Excel](#17-exportación-excel)
18. [PWA — Progressive Web App](#18-pwa--progressive-web-app)
19. [API REST — Endpoints completos](#19-api-rest--endpoints-completos)
20. [Infraestructura Docker](#20-infraestructura-docker)
21. [Seguridad](#21-seguridad)
22. [Plan de implementación por fases](#22-plan-de-implementación-por-fases)
23. [Notas de migración desde Android](#23-notas-de-migración-desde-android)

---

## 1. RESUMEN DEL SISTEMA

Planilla de Horas es una PWA multi-usuario, multi-sector y multi-empresa que permite:

- Registrar jornadas laborales diarias con turnos, lugar, pernocte y viáticos
- Calcular automáticamente horas extras según CCT 637/11 (Petroleros Privados) y CCT Jerárquicos
- Gestionar vacaciones con cadena de aprobación configurable
- Registrar ausencias con certificado médico y faltas injustificadas
- Enviar planillas mensuales a través de un flujo de aprobación completamente configurable
- Calcular y proyectar sueldos con todos los conceptos del CCT desglosados y editables
- Visualizar analytics de horas, días trabajados y salarios por usuario, sector y empresa
- Funcionar offline e instalarse como app nativa en Android, iOS y escritorio

El período de liquidación es **del día 21 del mes anterior al día 20 del mes actual**, alineado con el ciclo del CCT.

---

## 2. STACK TECNOLÓGICO

### Frontend
| Librería | Versión | Uso |
|---|---|---|
| React | 18 | Framework UI |
| TypeScript | 5 | Tipado estático |
| Vite | 5 | Build tool + Dev server |
| Tailwind CSS | 3 | Estilos utilitarios |
| shadcn/ui | latest | Componentes accesibles |
| React Query (TanStack) | 5 | Cache, sincronización de datos |
| Zustand | 4 | Estado global del cliente |
| React Hook Form | 7 | Formularios |
| Zod | 3 | Validación de esquemas |
| Recharts | 2 | Gráficos y visualizaciones |
| Socket.io-client | 4 | Notificaciones real-time |
| Vite PWA Plugin | latest | Service Worker y manifest |
| Workbox | 7 | Estrategias de cache offline |
| Dexie.js | 3 | IndexedDB para offline |
| date-fns | 3 | Manipulación de fechas |
| react-router-dom | 6 | Navegación SPA |

### Backend
| Librería | Versión | Uso |
|---|---|---|
| Node.js | 20 LTS | Runtime |
| Express | 4 | HTTP Framework |
| TypeScript | 5 | Tipado |
| Prisma | 5 | ORM y migraciones |
| bcrypt | 5 | Hashing de passwords |
| jsonwebtoken | 9 | JWT access + refresh tokens |
| Socket.io | 4 | WebSocket real-time |
| ExcelJS | 4 | Generación de planillas .xlsx |
| node-cron | 3 | Tareas programadas (acumulación de vacaciones) |
| Zod | 3 | Validación de request bodies |
| multer | 1 | Upload de archivos (certificados médicos) |
| nodemailer | 6 | Emails de notificación (opcional) |

### Base de datos
| Tecnología | Uso |
|---|---|
| PostgreSQL 16 | Base de datos principal |
| Redis 7 | Cache, refresh tokens, sesiones Socket.io |

### Infraestructura
| Tecnología | Uso |
|---|---|
| Docker + Docker Compose | Contenedorización |
| Nginx | Proxy reverso, SSL termination |
| Let's Encrypt (certbot) | Certificados SSL automáticos |

---

## 3. ESTRUCTURA DE DIRECTORIOS

```
planilla-horas/
├── apps/
│   ├── web/                              ← React PWA
│   │   ├── public/
│   │   │   ├── manifest.json
│   │   │   ├── icon-192.png
│   │   │   └── icon-512.png
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   │   ├── auth/
│   │   │   │   │   ├── LoginPage.tsx
│   │   │   │   │   └── ChangePasswordPage.tsx
│   │   │   │   ├── dashboard/
│   │   │   │   │   └── DashboardPage.tsx
│   │   │   │   ├── planillas/
│   │   │   │   │   ├── PlanillasPage.tsx
│   │   │   │   │   ├── PlanillaDetallePage.tsx
│   │   │   │   │   └── RegistroHorasDialog.tsx
│   │   │   │   ├── vacaciones/
│   │   │   │   │   ├── VacacionesPage.tsx
│   │   │   │   │   └── SolicitudVacacionesDialog.tsx
│   │   │   │   ├── ausencias/
│   │   │   │   │   └── AusenciasPage.tsx
│   │   │   │   ├── analytics/
│   │   │   │   │   ├── AnalyticsPage.tsx           ← visible todos
│   │   │   │   │   └── SalarialDetailPage.tsx      ← solo RRHH/ADMIN
│   │   │   │   └── admin/
│   │   │   │       ├── AdminPage.tsx               ← hub admin
│   │   │   │       ├── UsuariosPage.tsx
│   │   │   │       ├── SectoresPage.tsx
│   │   │   │       ├── DiagramasPage.tsx
│   │   │   │       ├── FlujosAprobacionPage.tsx
│   │   │   │       ├── ConveniosPage.tsx           ← CCT configuración
│   │   │   │       ├── ConceptosSalarialesPage.tsx
│   │   │   │       └── VacacionesConfigPage.tsx
│   │   │   ├── components/
│   │   │   │   ├── layout/
│   │   │   │   │   ├── AppShell.tsx
│   │   │   │   │   ├── Sidebar.tsx
│   │   │   │   │   └── TopBar.tsx
│   │   │   │   ├── calendario/
│   │   │   │   │   ├── CalendarioPeriodo.tsx
│   │   │   │   │   └── DiaCelda.tsx
│   │   │   │   ├── planillas/
│   │   │   │   │   ├── PlanillaCard.tsx
│   │   │   │   │   ├── EstadoBadge.tsx
│   │   │   │   │   └── FlujoBadge.tsx
│   │   │   │   ├── analytics/
│   │   │   │   │   ├── HorasChart.tsx
│   │   │   │   │   ├── SalarialChart.tsx
│   │   │   │   │   └── SectorComparativaChart.tsx
│   │   │   │   └── ui/                            ← shadcn/ui components
│   │   │   ├── hooks/
│   │   │   │   ├── useAuth.ts
│   │   │   │   ├── usePlanilla.ts
│   │   │   │   ├── useVacaciones.ts
│   │   │   │   ├── useDiagrama.ts
│   │   │   │   └── useSocket.ts
│   │   │   ├── stores/
│   │   │   │   ├── authStore.ts
│   │   │   │   └── notificacionesStore.ts
│   │   │   ├── services/
│   │   │   │   ├── api.ts                         ← axios instance base
│   │   │   │   ├── planillas.service.ts
│   │   │   │   ├── vacaciones.service.ts
│   │   │   │   ├── usuarios.service.ts
│   │   │   │   └── analytics.service.ts
│   │   │   ├── lib/
│   │   │   │   ├── calculoSalarial.ts             ← motor frontend (preview)
│   │   │   │   ├── diagrama.ts                    ← lógica días laborales
│   │   │   │   └── dates.ts                       ← helpers date-fns
│   │   │   ├── types/
│   │   │   │   └── index.ts                       ← tipos compartidos
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── api/                              ← Node.js + Express
│       ├── src/
│       │   ├── routes/
│       │   │   ├── auth.routes.ts
│       │   │   ├── usuarios.routes.ts
│       │   │   ├── planillas.routes.ts
│       │   │   ├── registros.routes.ts
│       │   │   ├── vacaciones.routes.ts
│       │   │   ├── ausencias.routes.ts
│       │   │   ├── analytics.routes.ts
│       │   │   ├── admin/
│       │   │   │   ├── sectores.routes.ts
│       │   │   │   ├── diagramas.routes.ts
│       │   │   │   ├── flujos.routes.ts
│       │   │   │   ├── convenios.routes.ts
│       │   │   │   └── conceptos.routes.ts
│       │   │   └── index.ts
│       │   ├── services/
│       │   │   ├── calculoSalarial.service.ts
│       │   │   ├── aprobacion.service.ts
│       │   │   ├── notificaciones.service.ts
│       │   │   ├── vacaciones.service.ts
│       │   │   ├── excel.service.ts
│       │   │   └── cron.service.ts
│       │   ├── middleware/
│       │   │   ├── auth.middleware.ts
│       │   │   ├── roles.middleware.ts
│       │   │   ├── empresa.middleware.ts
│       │   │   └── validate.middleware.ts
│       │   ├── utils/
│       │   │   ├── jwt.utils.ts
│       │   │   └── periodo.utils.ts
│       │   ├── socket/
│       │   │   └── socket.handler.ts
│       │   └── app.ts
│       ├── prisma/
│       │   ├── schema.prisma
│       │   └── migrations/
│       └── package.json
│
├── docker-compose.yml
├── docker-compose.prod.yml
├── nginx.conf
└── .env.example
```

---

## 4. BASE DE DATOS — ESQUEMA POSTGRESQL COMPLETO

### 4.1 ENUMs

```sql
CREATE TYPE rol_enum AS ENUM (
  'OPERADOR',
  'SUPERVISOR',
  'COORDINADOR',
  'GERENTE',
  'RRHH',
  'ADMIN'
);

CREATE TYPE planilla_estado_enum AS ENUM (
  'BORRADOR',
  'ENVIADA',
  'EN_REVISION',
  'APROBADA',
  'RECHAZADA',
  'CERRADA'
);

CREATE TYPE vacacion_estado_enum AS ENUM (
  'BORRADOR',
  'PENDIENTE',
  'EN_REVISION',
  'APROBADA',
  'RECHAZADA'
);

CREATE TYPE ausencia_tipo_enum AS ENUM (
  'CERTIFICADO_MEDICO',
  'FALTA_JUSTIFICADA',
  'FALTA_INJUSTIFICADA',
  'LICENCIA_ESPECIAL'
);

CREATE TYPE lugar_enum AS ENUM ('BASE', 'CAMPO', 'FRANCO');
CREATE TYPE pernocte_enum AS ENUM ('NO', 'HOTEL', 'TRAILER');
CREATE TYPE diagrama_tipo_enum AS ENUM ('ROTATIVO', 'FIJO_SEMANA');
CREATE TYPE contrato_tipo_enum AS ENUM ('PRUEBA', 'INDEFINIDO', 'PLAZO_FIJO', 'EVENTUAL');
CREATE TYPE cct_tipo_enum AS ENUM ('PETROLEROS_PRIVADOS_637', 'JERARQUICOS_592', 'PERSONALIZADO');
CREATE TYPE concepto_tipo_enum AS ENUM (
  'REMUNERATIVO_FIJO',
  'REMUNERATIVO_VARIABLE',
  'NO_REMUNERATIVO',
  'RETENCION',
  'DESCUENTO'
);
CREATE TYPE flujo_paso_accion_enum AS ENUM ('APROBAR', 'RECHAZAR', 'NOTIFICAR');
```

### 4.2 Empresas

```sql
CREATE TABLE empresas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          VARCHAR(120) NOT NULL,
  cuit            VARCHAR(13),
  direccion       TEXT,
  logo_url        TEXT,
  activa          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
```

### 4.3 Sectores

```sql
CREATE TABLE sectores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre          VARCHAR(80) NOT NULL,
  descripcion     TEXT,
  color           VARCHAR(7),                    -- hex color para UI
  activo          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT NOW()
);
-- Ejemplos: Fractura, Well Testing, Servicios Well Head,
--           Mantenimiento Mecánico, END, Wireline, Administración
```

### 4.4 Convenios Colectivos (CCT)

```sql
CREATE TABLE convenios (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre          VARCHAR(100) NOT NULL,            -- "CCT 637/11 Petroleros Privados"
  tipo            cct_tipo_enum NOT NULL,
  vigente_desde   DATE NOT NULL,
  vigente_hasta   DATE,
  activo          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT NOW()
);
```

### 4.5 Categorías Laborales

```sql
CREATE TABLE categorias (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convenio_id     UUID NOT NULL REFERENCES convenios(id) ON DELETE CASCADE,
  codigo          VARCHAR(20) NOT NULL,             -- "OF.1A", "OF.2A", "ADM.A"
  nombre          VARCHAR(80) NOT NULL,             -- "Oficial 1ra A"
  descripcion     TEXT,
  orden           INTEGER DEFAULT 0,
  activo          BOOLEAN DEFAULT TRUE
);
```

### 4.6 Conceptos Salariales (completamente configurables)

```sql
CREATE TABLE conceptos_salariales (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convenio_id         UUID NOT NULL REFERENCES convenios(id) ON DELETE CASCADE,
  codigo              VARCHAR(30) NOT NULL,
  nombre              VARCHAR(100) NOT NULL,
  tipo                concepto_tipo_enum NOT NULL,
  descripcion         TEXT,

  -- Valor del concepto
  es_porcentual       BOOLEAN DEFAULT FALSE,
  porcentaje_base     DECIMAL(6,4),                -- ej: 0.11 para 11%
  monto_fijo          DECIMAL(12,2),               -- si no es porcentual
  base_calculo        VARCHAR(100),                -- "BASICO" | "REMUNERATIVO_TOTAL" | "HORA_BASE"

  -- Reglas de aplicación
  aplica_siempre      BOOLEAN DEFAULT TRUE,
  condicion_formula   TEXT,                        -- expresión JS/TS evaluable si aplica_siempre=false

  -- Afecta al cálculo de aportes
  es_remunerativo     BOOLEAN DEFAULT TRUE,

  -- Control
  visible_empleado    BOOLEAN DEFAULT TRUE,        -- si el operador puede verlo en su recibo
  editable_rrhh       BOOLEAN DEFAULT TRUE,        -- si RRHH puede modificarlo manualmente
  orden               INTEGER DEFAULT 0,
  activo              BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);

-- EJEMPLOS DE CONCEPTOS (insertar como seed):
-- REMUNERATIVOS FIJOS:
--   BASICO         - Sueldo básico de convenio         (monto fijo por categoría)
--   ANTIGUEDAD     - 1% por año de antigüedad          (porcentual sobre BASICO)
--   PRESENTISMO    - Adicional presentismo              (monto fijo)
--   BONO_PAZ       - Bono de paz social                 (monto fijo)
--   ADICIONAL_TORRE- Adicional trabajo en torre         (monto fijo)
-- REMUNERATIVOS VARIABLES:
--   HRS_EXTRA_50   - Horas extra al 50%                 (calculado por motor)
--   HRS_EXTRA_100  - Horas extra al 100%                (calculado por motor)
--   HRS_VIAJE      - Horas de viaje (47% hora base)     (calculado por motor)
--   DESARRAIGO      - Viático por pernocte fuera de base (monto por día)
--   MANEJO          - Adicional por conducir en campo   (monto por día)
-- NO REMUNERATIVOS:
--   VIANDA         - Vianda campo                       (monto por día)
--   DESAYUNO       - Desayuno                           (monto por día)
--   VACA_MUERTA    - Adicional Vaca Muerta              (monto fijo)
--   ACUERDO_X      - Acuerdos de empresa               (monto fijo)
-- RETENCIONES:
--   JUBILACION     - 11% sobre remunerativo             (porcentual)
--   PAMI           - 3% sobre remunerativo              (porcentual)
--   OBRA_SOCIAL    - 3% sobre remunerativo              (porcentual)
--   SINDICAL       - 2.65% sobre remunerativo           (porcentual)
--   MUTUAL         - 3.97% sobre remunerativo           (porcentual)
--   GANANCIAS      - Impuesto a las ganancias           (tabla progresiva)
```

### 4.7 Valores de Conceptos por Categoría y Período

```sql
CREATE TABLE conceptos_valores (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concepto_id         UUID NOT NULL REFERENCES conceptos_salariales(id) ON DELETE CASCADE,
  categoria_id        UUID REFERENCES categorias(id),   -- NULL = aplica a todas
  vigente_desde       DATE NOT NULL,
  vigente_hasta       DATE,
  monto               DECIMAL(12,2),
  porcentaje          DECIMAL(6,4),
  created_at          TIMESTAMP DEFAULT NOW()
);
-- Permite registrar historial de actualizaciones paritarias
```

### 4.8 Usuarios

```sql
CREATE TABLE usuarios (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  sector_id             UUID REFERENCES sectores(id),
  categoria_id          UUID REFERENCES categorias(id),
  convenio_id           UUID REFERENCES convenios(id),

  -- Datos personales
  nombre                VARCHAR(80) NOT NULL,
  apellido              VARCHAR(80) NOT NULL,
  email                 VARCHAR(120) UNIQUE NOT NULL,
  password_hash         TEXT NOT NULL,
  legajo                VARCHAR(20),
  dni                   VARCHAR(15),
  cuil                  VARCHAR(15),
  fecha_nacimiento      DATE,
  telefono              VARCHAR(20),
  avatar_url            TEXT,

  -- Datos laborales
  rol                   rol_enum NOT NULL DEFAULT 'OPERADOR',
  tipo_contrato         contrato_tipo_enum NOT NULL DEFAULT 'INDEFINIDO',
  fecha_ingreso         DATE NOT NULL,
  fecha_fin_prueba      DATE,                          -- si tipo_contrato = 'PRUEBA'
  fecha_egreso          DATE,                          -- si ya no trabaja
  antiguedad_anos       INTEGER GENERATED ALWAYS AS   -- calculado automáticamente
    (EXTRACT(YEAR FROM AGE(COALESCE(fecha_egreso, CURRENT_DATE), fecha_ingreso))::INTEGER) STORED,

  -- Jerarquía
  coordinador_id        UUID REFERENCES usuarios(id),  -- quién aprueba sus planillas
  supervisor_id         UUID REFERENCES usuarios(id),  -- supervisor directo (opcional)

  -- Vacaciones
  dias_vacaciones_saldo INTEGER DEFAULT 0,              -- días disponibles actuales
  dias_vacaciones_usados INTEGER DEFAULT 0,

  -- Configuración
  sueldo_basico_override DECIMAL(12,2),                -- override manual de básico (RRHH)
  activo                BOOLEAN DEFAULT TRUE,
  primer_login          BOOLEAN DEFAULT TRUE,           -- forzar cambio de contraseña
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW()
);
```

### 4.9 Diagramas de Trabajo

```sql
CREATE TABLE diagramas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre            VARCHAR(60) NOT NULL,         -- "7x7", "Lun-Vier", "14x14"
  tipo              diagrama_tipo_enum NOT NULL,
  dias_trabajo      INTEGER,                      -- para ROTATIVO
  dias_descanso     INTEGER,                      -- para ROTATIVO
  dias_semana       INTEGER[],                    -- para FIJO_SEMANA [1,2,3,4,5] = Lun-Vie
  descripcion       TEXT,
  activo            BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE TABLE usuarios_diagramas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id        UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  diagrama_id       UUID NOT NULL REFERENCES diagramas(id),
  fecha_inicio      DATE NOT NULL,                -- Día 1 del ciclo en el calendario
  fecha_fin         DATE,                         -- NULL = vigente
  activo            BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMP DEFAULT NOW()
);
```

### 4.10 Flujos de Aprobación (completamente configurables)

```sql
-- Un flujo define la cadena de aprobación para un tipo de documento
CREATE TABLE flujos_aprobacion (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre            VARCHAR(80) NOT NULL,          -- "Flujo Planillas Campo", "Flujo Vacaciones"
  tipo_documento    VARCHAR(30) NOT NULL,           -- 'PLANILLA' | 'VACACION' | 'AUSENCIA'
  descripcion       TEXT,
  activo            BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMP DEFAULT NOW()
);

-- Cada paso del flujo: quién aprueba en qué orden
CREATE TABLE flujos_pasos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flujo_id          UUID NOT NULL REFERENCES flujos_aprobacion(id) ON DELETE CASCADE,
  orden             INTEGER NOT NULL,
  nombre_paso       VARCHAR(60) NOT NULL,           -- "Revisión Coordinador", "Aprobación RRHH"
  rol_aprobador     rol_enum NOT NULL,              -- qué rol puede ejecutar este paso
  -- si es NULL, cualquier usuario con ese rol en el sector puede aprobar
  usuario_especifico_id UUID REFERENCES usuarios(id),
  accion_aprobar    VARCHAR(60) DEFAULT 'APROBAR',  -- label del botón
  accion_rechazar   VARCHAR(60) DEFAULT 'RECHAZAR',
  requiere_comentario_rechazo BOOLEAN DEFAULT TRUE,
  notificar_roles   rol_enum[],                     -- roles que reciben notificación
  tiempo_limite_horas INTEGER,                      -- NULL = sin límite
  created_at        TIMESTAMP DEFAULT NOW()
);

-- Asignación de flujo por sector (por defecto) o por usuario individual
CREATE TABLE flujos_asignaciones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flujo_id          UUID NOT NULL REFERENCES flujos_aprobacion(id),
  tipo_documento    VARCHAR(30) NOT NULL,
  sector_id         UUID REFERENCES sectores(id),   -- NULL = aplica a toda la empresa
  usuario_id        UUID REFERENCES usuarios(id),   -- override por usuario específico
  activo            BOOLEAN DEFAULT TRUE
);
```

### 4.11 Planillas de Horas

```sql
CREATE TABLE planillas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id        UUID NOT NULL REFERENCES usuarios(id),
  flujo_id          UUID REFERENCES flujos_aprobacion(id),

  -- Período
  periodo_inicio    DATE NOT NULL,                  -- día 21 mes anterior
  periodo_fin       DATE NOT NULL,                  -- día 20 mes actual

  -- Estado
  estado            planilla_estado_enum NOT NULL DEFAULT 'BORRADOR',
  paso_actual       INTEGER DEFAULT 0,              -- índice del paso del flujo

  -- Datos de aprobación
  obs_rechazo       TEXT,
  aprobada_por_id   UUID REFERENCES usuarios(id),   -- último aprobador
  enviada_at        TIMESTAMP,
  aprobada_at       TIMESTAMP,
  cerrada_at        TIMESTAMP,

  -- Snapshot de cálculo salarial (guardado al aprobar)
  snapshot_calculo  JSONB,                          -- resultado completo del motor salarial

  -- Totales calculados (cache)
  total_horas_normales   DECIMAL(7,2) DEFAULT 0,
  total_horas_extra_50   DECIMAL(7,2) DEFAULT 0,
  total_horas_extra_100  DECIMAL(7,2) DEFAULT 0,
  total_horas_viaje      DECIMAL(7,2) DEFAULT 0,
  total_dias_campo       INTEGER DEFAULT 0,
  total_dias_base        INTEGER DEFAULT 0,
  neto_estimado     DECIMAL(12,2),

  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

-- Historial de movimientos del flujo
CREATE TABLE planillas_historial (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planilla_id       UUID NOT NULL REFERENCES planillas(id) ON DELETE CASCADE,
  usuario_id        UUID NOT NULL REFERENCES usuarios(id),
  estado_anterior   planilla_estado_enum,
  estado_nuevo      planilla_estado_enum NOT NULL,
  paso_flujo        INTEGER,
  comentario        TEXT,
  created_at        TIMESTAMP DEFAULT NOW()
);
```

### 4.12 Registros de Horas Diarios

```sql
CREATE TABLE registros_horas (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planilla_id               UUID NOT NULL REFERENCES planillas(id) ON DELETE CASCADE,
  fecha                     DATE NOT NULL,

  -- Turnos
  entrada_turno1            TIME,
  salida_turno1             TIME,
  entrada_turno2            TIME,
  salida_turno2             TIME,
  cruza_medianoche          BOOLEAN DEFAULT FALSE,

  -- Clasificación del día
  lugar_trabajo             lugar_enum,
  pernocte                  pernocte_enum DEFAULT 'NO',
  maneja                    BOOLEAN DEFAULT FALSE,
  horas_viaje_input         DECIMAL(4,2) DEFAULT 2.0,

  -- Flags
  es_feriado                BOOLEAN DEFAULT FALSE,
  es_franco_compensatorio   BOOLEAN DEFAULT FALSE,
  es_franco_trabajado       BOOLEAN DEFAULT FALSE,

  -- Resultado del motor de cálculo (guardado al calcular)
  horas_trabajadas_bruto    DECIMAL(5,2),           -- antes de descuentos
  horas_normales            DECIMAL(5,2) DEFAULT 0,
  horas_extra_50            DECIMAL(5,2) DEFAULT 0,
  horas_extra_100           DECIMAL(5,2) DEFAULT 0,
  horas_viaje_calc          DECIMAL(5,2) DEFAULT 0,

  observaciones             TEXT,
  created_at                TIMESTAMP DEFAULT NOW(),
  updated_at                TIMESTAMP DEFAULT NOW(),

  UNIQUE(planilla_id, fecha)
);
```

### 4.13 Vacaciones

```sql
CREATE TABLE vacaciones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id        UUID NOT NULL REFERENCES usuarios(id),
  flujo_id          UUID REFERENCES flujos_aprobacion(id),

  -- Período solicitado
  fecha_inicio      DATE NOT NULL,
  fecha_fin         DATE NOT NULL,
  dias_habiles      INTEGER NOT NULL,              -- calculados excluyendo fines de semana y feriados
  dias_totales      INTEGER NOT NULL,

  -- Estado
  estado            vacacion_estado_enum NOT NULL DEFAULT 'BORRADOR',
  paso_actual       INTEGER DEFAULT 0,

  -- Observaciones
  motivo            TEXT,
  obs_rechazo       TEXT,

  -- Quién aprobó
  aprobada_por_id   UUID REFERENCES usuarios(id),
  aprobada_at       TIMESTAMP,

  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

-- Historial del flujo de vacaciones
CREATE TABLE vacaciones_historial (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vacacion_id       UUID NOT NULL REFERENCES vacaciones(id) ON DELETE CASCADE,
  usuario_id        UUID NOT NULL REFERENCES usuarios(id),
  estado_anterior   vacacion_estado_enum,
  estado_nuevo      vacacion_estado_enum NOT NULL,
  paso_flujo        INTEGER,
  comentario        TEXT,
  created_at        TIMESTAMP DEFAULT NOW()
);

-- Configuración de acumulación de vacaciones
CREATE TABLE vacaciones_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,

  -- Días base según antigüedad (CCT define escalonado)
  -- Se almacena como array de reglas JSON
  reglas_antiguedad JSONB NOT NULL DEFAULT '[]',
  -- Ejemplo:
  -- [
  --   { "desde_anos": 0,  "hasta_anos": 1,  "dias": 14 },
  --   { "desde_anos": 1,  "hasta_anos": 5,  "dias": 14 },
  --   { "desde_anos": 5,  "hasta_anos": 10, "dias": 21 },
  --   { "desde_anos": 10, "hasta_anos": 20, "dias": 28 },
  --   { "desde_anos": 20, "hasta_anos": null, "dias": 35 }
  -- ]

  -- Acumulación automática
  acumulacion_activa        BOOLEAN DEFAULT TRUE,
  acumulacion_dia_del_mes   INTEGER DEFAULT 1,      -- día del mes que se acumulan
  acumulacion_frecuencia    VARCHAR(20) DEFAULT 'MENSUAL', -- 'MENSUAL' | 'ANUAL'
  acumulacion_monto_mensual DECIMAL(5,2),           -- días que se suman por mes si es mensual

  -- Vencimiento
  vencimiento_activo        BOOLEAN DEFAULT FALSE,
  vencimiento_meses         INTEGER DEFAULT 12,

  -- Período en prueba
  bloquear_en_prueba        BOOLEAN DEFAULT TRUE,

  created_at                TIMESTAMP DEFAULT NOW(),
  updated_at                TIMESTAMP DEFAULT NOW()
);
```

### 4.14 Ausencias

```sql
CREATE TABLE ausencias (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id        UUID NOT NULL REFERENCES usuarios(id),
  planilla_id       UUID REFERENCES planillas(id), -- vinculada al período si aplica

  tipo              ausencia_tipo_enum NOT NULL,
  fecha_inicio      DATE NOT NULL,
  fecha_fin         DATE NOT NULL,
  dias_ausencia     INTEGER NOT NULL,

  -- Documentación
  descripcion       TEXT,
  numero_certificado VARCHAR(50),
  archivo_url       TEXT,                          -- upload del certificado médico

  -- Impacto salarial
  descuenta_sueldo  BOOLEAN DEFAULT FALSE,
  porcentaje_descuento DECIMAL(5,2) DEFAULT 0,

  -- Estado y aprobación
  requiere_aprobacion BOOLEAN DEFAULT FALSE,
  aprobada          BOOLEAN DEFAULT TRUE,          -- cert médico: TRUE automático
  aprobada_por_id   UUID REFERENCES usuarios(id),

  created_at        TIMESTAMP DEFAULT NOW()
);
```

### 4.15 Notificaciones

```sql
CREATE TABLE notificaciones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id        UUID NOT NULL REFERENCES usuarios(id),

  tipo              VARCHAR(50) NOT NULL,
  -- 'PLANILLA_ENVIADA' | 'PLANILLA_APROBADA' | 'PLANILLA_RECHAZADA' |
  -- 'VACACION_APROBADA' | 'VACACION_RECHAZADA' | 'VACACIONES_ACUMULADAS' |
  -- 'PERIODO_ABIERTO' | 'CERTIFICADO_CARGADO'

  titulo            VARCHAR(120) NOT NULL,
  cuerpo            TEXT,
  link              TEXT,                          -- URL a donde navegar al hacer clic
  leida             BOOLEAN DEFAULT FALSE,
  metadata          JSONB,                         -- datos extra según tipo

  created_at        TIMESTAMP DEFAULT NOW()
);
```

### 4.16 Configuración general de la empresa

```sql
CREATE TABLE empresa_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,

  -- Período de liquidación
  periodo_dia_inicio    INTEGER DEFAULT 21,        -- día que empieza el período
  periodo_dia_fin       INTEGER DEFAULT 20,

  -- Jornada máxima según CCT
  max_horas_diarias     INTEGER DEFAULT 16,
  horas_jornada_normal  INTEGER DEFAULT 8,
  umbral_extra_50       INTEGER DEFAULT 8,         -- horas desde las que empieza el 50%
  umbral_extra_100      INTEGER DEFAULT 12,        -- horas desde las que empieza el 100%

  -- Reglas de redondeo de horarios
  redondeo_minutos      INTEGER DEFAULT 15,        -- redondear entrada/salida a X minutos

  -- Almuerzo
  descuento_almuerzo_base  BOOLEAN DEFAULT TRUE,   -- descontar 1h en BASE
  descuento_almuerzo_campo BOOLEAN DEFAULT FALSE,

  -- Feriados
  feriados_personalizados JSONB DEFAULT '[]',      -- fechas extra además de los nacionales

  -- Módulos habilitados
  modulo_vacaciones_activo  BOOLEAN DEFAULT TRUE,
  modulo_ausencias_activo   BOOLEAN DEFAULT TRUE,
  modulo_analytics_activo   BOOLEAN DEFAULT TRUE,

  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW()
);
```

---

## 5. SISTEMA DE AUTENTICACIÓN Y USUARIOS

### 5.1 JWT + Refresh Tokens

- **Access token:** JWT firmado, expira en 15 minutos.
- **Refresh token:** UUID aleatorio almacenado en Redis con TTL de 30 días.
- **Rotación:** cada vez que se usa un refresh token se emite uno nuevo y el anterior se invalida.
- **Al hacer login:** se devuelven ambos tokens. El access token va en memoria (no en localStorage). El refresh token va en cookie httpOnly + secure.

### 5.2 Primer login

- Al crear un usuario, `primer_login = TRUE`.
- Al hacer login por primera vez, el frontend detecta el flag y redirige obligatoriamente a cambio de contraseña.
- Hasta que no cambie la contraseña, no puede acceder a ninguna otra pantalla.

### 5.3 Creación de usuarios (solo ADMIN/RRHH)

Campos del formulario de creación:

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| Nombre y Apellido | text | ✓ | |
| Email | email | ✓ | Es el usuario de login |
| Legajo | text | | Código interno |
| DNI / CUIL | text | | |
| Fecha de nacimiento | date | | |
| Teléfono | text | | |
| Sector | select | ✓ | Listado de sectores activos |
| Rol | select | ✓ | |
| CCT / Convenio | select | ✓ | |
| Categoría laboral | select | ✓ | Filtrado por convenio |
| Tipo de contrato | select | ✓ | Prueba / Indefinido / Plazo fijo |
| Fecha de ingreso | date | ✓ | |
| Fecha fin de prueba | date | Si prueba | Solo si tipo = PRUEBA |
| Coordinador asignado | select | | Usuario con rol COORDINADOR |
| Supervisor directo | select | | Usuario con rol SUPERVISOR |
| Diagrama de trabajo | select | | |
| Fecha inicio de ciclo | date | Si diagrama rotativo | |
| Sueldo básico override | number | | Si vacío usa el de la categoría |

### 5.4 Ficha de empleado (pestaña en la vista del usuario)

La ficha debe mostrar y permitir editar (solo ADMIN/RRHH):

- Datos personales
- Datos laborales (categoría, tipo contrato, fechas)
- Diagrama activo + fecha inicio ciclo
- Saldo de vacaciones disponibles
- Historial de ausencias
- Historial de planillas
- Timeline de antigüedad y cambios de categoría

---

## 6. ROLES Y PERMISOS

### 6.1 Matriz de permisos

| Acción | OPERADOR | SUPERVISOR | COORDINADOR | GERENTE | RRHH | ADMIN |
|---|---|---|---|---|---|---|
| Ver propias planillas | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cargar horas propias | ✓ | ✓ | ✓ | | | |
| Enviar planilla propia | ✓ | ✓ | ✓ | | | |
| Ver planillas del sector | | ✓ | ✓ | ✓ | ✓ | ✓ |
| Aprobar/rechazar planillas | | | ✓ | | ✓ | ✓ |
| Cierre de período | | | | | ✓ | ✓ |
| Ver motor salarial completo | | | | | ✓ | ✓ |
| Ver analytics básico | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Ver analytics avanzado | | | ✓ | ✓ | ✓ | ✓ |
| Ver analytics por sector | | | | ✓ | ✓ | ✓ |
| Solicitar vacaciones | ✓ | ✓ | ✓ | ✓ | | |
| Aprobar vacaciones | según flujo | según flujo | según flujo | | ✓ | ✓ |
| Cargar ausencias | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Aprobar ausencias | | | | | ✓ | ✓ |
| Gestionar usuarios | | | | | ✓ | ✓ |
| Gestionar sectores | | | | | | ✓ |
| Gestionar CCT/conceptos | | | | | ✓ | ✓ |
| Gestionar flujos aprobación | | | | | | ✓ |
| Gestionar diagramas | | | | | | ✓ |
| Exportar Excel masivo | | | | | ✓ | ✓ |
| Config empresa | | | | | | ✓ |

### 6.2 Seguridad a nivel de datos

- Todos los queries deben filtrar por `empresa_id` del usuario autenticado.
- Un OPERADOR nunca puede ver datos de otro usuario aunque tenga el UUID.
- Un COORDINADOR solo ve usuarios de su sector (o sectores bajo su cargo).
- Row-level filtering implementado en la capa de servicio, no solo en la UI.

---

## 7. SECTORES

### 7.1 Descripción

Los sectores agrupan a los usuarios de la empresa. Son completamente configurables por el ADMIN.

Ejemplos típicos de la industria oil & gas:
- Fractura
- Well Testing
- Servicios Well Head
- Mantenimiento Mecánico
- END (Ensayos No Destructivos)
- Wireline
- Administración
- Supervisión

### 7.2 Gestión de sectores (ADMIN)

- Crear, editar y desactivar sectores
- Asignar un color de identificación (para UI y reportes)
- Mover usuarios entre sectores
- Asignar flujo de aprobación por defecto al sector
- Un usuario puede estar en un solo sector a la vez
- Historial de cambios de sector por usuario

### 7.3 Vista de sector (COORDINADOR/GERENTE)

- Lista de usuarios del sector con estado de planilla del período actual
- Indicadores: días trabajados promedio, horas extras promedio, ausencias del mes

---

## 8. DIAGRAMAS DE TRABAJO

### 8.1 Tipos

| Tipo | Descripción | Parámetros |
|---|---|---|
| ROTATIVO | Ciclo fijo de N días trabajo + M días franco | dias_trabajo, dias_descanso, fecha_inicio_ciclo |
| FIJO_SEMANA | Días fijos de la semana | dias_semana (array: [1,2,3,4,5] = Lun-Vie) |

### 8.2 Diagramas predefinidos (seed)

- Lunes a Viernes (FIJO_SEMANA, [1,2,3,4,5])
- 7×7 (ROTATIVO, 7 trabajo, 7 franco)
- 10×5 (ROTATIVO, 10 trabajo, 5 franco)
- 14×14 (ROTATIVO, 14 trabajo, 14 franco)
- 8×6 (ROTATIVO, 8 trabajo, 6 franco)
- 21×7 (ROTATIVO, 21 trabajo, 7 franco)

### 8.3 Lógica de cálculo de tipo de día

```typescript
// apps/web/src/lib/diagrama.ts  y  apps/api/src/utils/diagrama.utils.ts

import { differenceInDays, getDay } from 'date-fns';

export type TipoDia = 'LABORAL' | 'FRANCO' | 'NO_APLICA';

export function getTipoDia(
  fecha: Date,
  diagrama: { tipo: string; dias_trabajo?: number; dias_descanso?: number; dias_semana?: number[] },
  fechaInicioCiclo: Date
): TipoDia {
  if (diagrama.tipo === 'FIJO_SEMANA') {
    const dow = getDay(fecha); // 0=Dom, 1=Lun, ..., 6=Sab
    return (diagrama.dias_semana ?? []).includes(dow) ? 'LABORAL' : 'FRANCO';
  }

  if (diagrama.tipo === 'ROTATIVO') {
    const ciclo = (diagrama.dias_trabajo ?? 0) + (diagrama.dias_descanso ?? 0);
    if (ciclo === 0) return 'NO_APLICA';
    const diasDesde = differenceInDays(fecha, fechaInicioCiclo);
    const posEnCiclo = ((diasDesde % ciclo) + ciclo) % ciclo;
    return posEnCiclo < (diagrama.dias_trabajo ?? 0) ? 'LABORAL' : 'FRANCO';
  }

  return 'NO_APLICA';
}
```

### 8.4 Visualización en el calendario

El calendario del período (21 al 20) debe mostrar una banda de color sutil por debajo de cada celda indicando el tipo de día según el diagrama del usuario:

- `LABORAL` → fondo verde muy suave
- `FRANCO` → fondo gris muy suave
- Si además tiene registro cargado → ícono y color de registro encima, con prioridad visual

---

## 9. FLUJO DE APROBACIÓN CONFIGURABLE

### 9.1 Concepto

En lugar de un flujo hardcodeado, el ADMIN puede crear múltiples flujos con los pasos que necesite.

Un flujo se compone de pasos ordenados. Cada paso define:
- Qué rol puede ejecutarlo
- Qué acciones están disponibles (Aprobar / Rechazar)
- Si el rechazo requiere comentario obligatorio
- A qué roles se notifica en cada acción
- Tiempo límite opcional

### 9.2 Flujos sugeridos (seed)

**Flujo estándar planillas:**
1. Paso 1: COORDINADOR — Aprobar/Rechazar — Notifica a RRHH y OPERADOR
2. Paso 2: RRHH — Cerrar — Notifica a OPERADOR

**Flujo simplificado (para administrativos):**
1. Paso 1: RRHH — Aprobar/Rechazar/Cerrar — Notifica a OPERADOR

**Flujo vacaciones estándar:**
1. Paso 1: COORDINADOR — Aprobar/Rechazar — Notifica a RRHH
2. Paso 2: RRHH — Confirmar — Notifica a OPERADOR y descuenta días

### 9.3 Transición de estados

La máquina de estados es determinada por el flujo configurado:

```
BORRADOR
  └─ [usuario envía] → ENVIADA
       └─ [paso 1 inicia revisión] → EN_REVISION
            ├─ [paso 1 aprueba] → (si hay más pasos) → EN_REVISION (paso siguiente)
            │                  → (si es último paso) → APROBADA → CERRADA
            └─ [paso X rechaza] → RECHAZADA
                 └─ [usuario corrige y reenvía] → ENVIADA (reinicia el flujo)
```

### 9.4 Reglas del flujo

- Una planilla CERRADA no puede modificarse nunca.
- Una planilla RECHAZADA vuelve a BORRADOR cuando el usuario abre el formulario de corrección.
- Al rechazar, el motivo es obligatorio y se guarda en `obs_rechazo` y en el historial.
- Al aprobar en un paso intermedio, se notifica automáticamente al aprobador del siguiente paso.
- Si `tiempo_limite_horas` está configurado, se genera una notificación de alerta al aprobador cuando se acerca el límite.

---

## 10. REGISTRO DE HORAS — CORE

### 10.1 Formulario de registro diario

El diálogo `RegistroHorasDialog` debe tener estos campos:

| Campo | Tipo | Reglas |
|---|---|---|
| Fecha | DatePicker | Solo fechas dentro del período actual |
| Lugar de trabajo | Select | BASE / CAMPO / FRANCO |
| Entrada turno 1 | TimePicker | Redondeo a 15 minutos configurable |
| Salida turno 1 | TimePicker | Idem |
| Entrada turno 2 | TimePicker | Opcional (jornada partida) |
| Salida turno 2 | TimePicker | Opcional |
| Pernocte | Select | NO / HOTEL / TRAILER — solo si CAMPO |
| Maneja | Switch | Solo si CAMPO |
| Horas de viaje | Switch + número | Aplica viáticos de viaje |
| Feriado | Switch | Override manual |
| Franco compensatorio | Switch | Para compensar guardia |
| Observaciones | Textarea | Con autocompletado de proyectos activos |

### 10.2 Lógica automática del formulario

- Si lugar = FRANCO: limpiar todos los horarios y switches automáticamente.
- Si lugar = BASE: activar descuento de almuerzo (configurable en empresa_config).
- Si día es sábado o domingo y se cargan horas: activar `es_franco_trabajado` automáticamente.
- Si un turno cruza medianoche (ej: 19:00 → 07:00): dividir automáticamente en dos días.
- Si lugar = CAMPO: mostrar campos pernocte, maneja, horas de viaje.
- El campo observaciones sugiere nombres de proyectos activos cuando lugar = CAMPO.
- Si el usuario tiene contrato en PRUEBA y la configuración lo indica, mostrar advertencia.

### 10.3 Validaciones

- No se puede cargar más de un registro por fecha en la misma planilla.
- No se puede cargar registro en fechas fuera del período de la planilla.
- Salida turno 1 debe ser mayor a Entrada turno 1 (excepto cruce de medianoche).
- Horas máximas por día: tomadas de `empresa_config.max_horas_diarias` (default 16).

---

## 11. MOTOR DE CÁLCULO SALARIAL CCT — EXPANDIDO

### 11.1 Visibilidad

| Vista | Roles que la ven |
|---|---|
| Preview básico (horas + neto estimado) | OPERADOR, SUPERVISOR — versión simplificada, sin desglose |
| Desglose completo por concepto | COORDINADOR, GERENTE — desglose completo |
| Motor completo + edición manual | RRHH, ADMIN — todo el desglose + posibilidad de ajustar manualmente cualquier concepto |

### 11.2 Estructura del cálculo (orden de operaciones)

```
1. CALCULAR HORAS DEL PERÍODO
   Para cada registro_hora del período:
   a. Calcular horas brutas (salidaX - entradaX)
   b. Aplicar descuento almuerzo si corresponde (BASE)
   c. Aplicar cap máximo (max_horas_diarias)
   d. Clasificar horas:
      - Feriado / Franco trabajado / Fin de semana → todas al 100%
      - Día hábil ≤ umbral_extra_50 horas → todas normales
      - Día hábil entre umbral_extra_50 y umbral_extra_100 → normales + extra 50%
      - Día hábil > umbral_extra_100 → normales + extra 50% + extra 100%
   e. Clasificar horas de viaje:
      - Maneja = TRUE → sumar a jornada normal (antes de clasificar)
      - Maneja = FALSE → horas al 47% (tarifa especial viaje)

2. CALCULAR CONCEPTOS REMUNERATIVOS FIJOS
   Para cada concepto activo del CCT del usuario (tipo REMUNERATIVO_FIJO):
   - Si es porcentual → calcular sobre la base configurada
   - Si es monto fijo → tomar el valor de conceptos_valores vigente para la categoría

3. CALCULAR CONCEPTOS REMUNERATIVOS VARIABLES
   - Horas extra 50%: (BASICO / HORAS_MES) * 1.5 * cantidad_horas_extra_50
   - Horas extra 100%: (BASICO / HORAS_MES) * 2.0 * cantidad_horas_extra_100
   - Horas viaje: (BASICO / HORAS_MES) * 0.47 * cantidad_horas_viaje (si no maneja)
   - Desarraigo: valor_diario_pernocte * dias_con_pernocte
   - Demás conceptos variables configurados

4. CALCULAR NO REMUNERATIVOS
   - Vianda: valor_vianda * dias_campo
   - Desayuno: valor_desayuno * dias_totales
   - Vaca Muerta: monto_fijo_mensual (si aplica)
   - Demás conceptos no remunerativos

5. CALCULAR TOTAL REMUNERATIVO = fijos + variables

6. CALCULAR RETENCIONES
   - Jubilación: porcentaje_jubilacion * TOTAL_REMUNERATIVO
   - PAMI: porcentaje_pami * TOTAL_REMUNERATIVO
   - Obra Social: porcentaje_os * TOTAL_REMUNERATIVO
   - Sindical: porcentaje_sindical * TOTAL_REMUNERATIVO
   - Mutual: porcentaje_mutual * TOTAL_REMUNERATIVO
   - Ganancias: tabla progresiva (configurable por tramos)

7. CALCULAR DESCUENTOS POR AUSENCIAS/FALTAS
   - Faltas injustificadas: descuento proporcional del básico
   - Ausencias parciales: según configuración de cada tipo

8. NETO = TOTAL_REMUNERATIVO + NO_REMUNERATIVOS - RETENCIONES - DESCUENTOS
```

### 11.3 Constantes del CCT (configurables)

```typescript
// Estas constantes viven en la tabla conceptos_salariales
// y se calculan a partir de conceptos_valores

const CCT_DEFAULTS = {
  HORAS_MES: 192,                    // horas mensuales base para cálculo de hora
  EXTRA_50_MULTIPLICADOR: 1.5,
  EXTRA_100_MULTIPLICADOR: 2.0,
  VIAJE_NO_MANEJA_COEFICIENTE: 0.47,
};
```

### 11.4 Snapshot del cálculo

Al aprobar una planilla (RRHH/COORD último paso), el resultado completo del motor se guarda en `planillas.snapshot_calculo` como JSONB:

```json
{
  "calculado_at": "2025-03-20T14:30:00Z",
  "calculado_por": "uuid-rrhh",
  "version_motor": "2.0",
  "periodo": { "inicio": "2025-02-21", "fin": "2025-03-20" },
  "usuario": { "id": "uuid", "nombre": "Vazquez Nicolas", "categoria": "OF.1A", "cct": "637/11" },
  "horas": {
    "normales": 152.5,
    "extra_50": 24.0,
    "extra_100": 8.0,
    "viaje": 12.0,
    "dias_campo": 14,
    "dias_base": 3,
    "dias_franco": 7
  },
  "conceptos": [
    { "codigo": "BASICO", "nombre": "Sueldo Básico", "tipo": "REMUNERATIVO_FIJO", "monto": 850000.00 },
    { "codigo": "ANTIGUEDAD", "nombre": "Antigüedad 2 años", "tipo": "REMUNERATIVO_FIJO", "monto": 17000.00 },
    { "codigo": "HRS_EXTRA_50", "nombre": "Horas extra 50%", "tipo": "REMUNERATIVO_VARIABLE", "monto": 66250.00 },
    ...
  ],
  "totales": {
    "remunerativo_fijo": 900000.00,
    "remunerativo_variable": 120000.00,
    "no_remunerativo": 45000.00,
    "total_bruto": 1065000.00,
    "total_retenciones": 262350.00,
    "descuentos_ausencias": 0.00,
    "neto": 802650.00
  }
}
```

---

## 12. CONCEPTOS SALARIALES CONFIGURABLES

### 12.1 Panel de administración (ADMIN / RRHH)

La pantalla `ConceptosSalarialesPage` debe permitir:

- Ver todos los conceptos del CCT activo organizados por tipo (fijo / variable / no remunerativo / retención)
- Crear nuevos conceptos
- Editar montos y porcentajes (con fecha de vigencia para registrar historial paritario)
- Activar/desactivar conceptos individualmente
- Reordenar conceptos (drag & drop) para el orden en que aparecen en el recibo
- Ver el historial de valores (a qué monto estuvo vigente en cada período)

### 12.2 Actualización paritaria

Cuando se actualiza un básico por paritarias:
1. RRHH crea un nuevo registro en `conceptos_valores` con `vigente_desde` = fecha de vigencia
2. El motor usa automáticamente el valor vigente para cada período
3. El historial queda guardado para recalcular períodos anteriores si es necesario

### 12.3 Conceptos por convenio

Cada CCT puede tener sus propios conceptos. El sistema debe soportar como mínimo:

**CCT 637/11 Petroleros Privados:**
- Los detallados en la sección 4.6

**CCT Jerárquicos:**
- Básico jerárquico (distinto monto)
- Adicional función jerárquica
- Gastos de representación (no remunerativo)
- Retenciones iguales estructura base

**Personalizado:**
- ADMIN puede crear desde cero todos los conceptos

---

## 13. VACACIONES

### 13.1 Solicitud de vacaciones

El usuario (todos los roles, excepto RRHH/ADMIN que no aplica) puede solicitar vacaciones desde `VacacionesPage`:

1. Seleccionar rango de fechas en un calendario
2. El sistema calcula automáticamente los días hábiles (excluyendo fines de semana y feriados de Argentina)
3. Muestra el saldo disponible y el saldo que quedaría
4. Si los días solicitados superan el saldo disponible → error bloqueante
5. Si el usuario está en período de prueba y `bloquear_en_prueba = TRUE` → error bloqueante con mensaje explicativo
6. El usuario puede agregar un motivo (opcional)
7. Al confirmar → pasa por el flujo configurado para VACACION

### 13.2 Aprobación de vacaciones

Sigue el mismo motor de flujos configurables. Al aprobar en el último paso:
- `vacaciones.estado` = APROBADA
- `usuarios.dias_vacaciones_saldo` -= `vacaciones.dias_habiles`
- `usuarios.dias_vacaciones_usados` += `vacaciones.dias_habiles`
- Notificación al empleado

Al rechazar:
- `vacaciones.estado` = RECHAZADA
- Saldo no se modifica
- Notificación con motivo

### 13.3 Acumulación automática de vacaciones

Un cron job (`cron.service.ts`) se ejecuta el día configurado en `vacaciones_config.acumulacion_dia_del_mes`:

```typescript
// Pseudocódigo del cron
async function acumularVacaciones() {
  const config = await getVacacionesConfig();
  if (!config.acumulacion_activa) return;

  const usuarios = await getUsuariosActivos(); // excluir inactivos y en prueba

  for (const usuario of usuarios) {
    // Calcular días según antigüedad
    const reglasOrdenadas = config.reglas_antiguedad
      .sort((a, b) => a.desde_anos - b.desde_anos);

    const regla = reglasOrdenadas
      .filter(r => usuario.antiguedad_anos >= r.desde_anos)
      .pop(); // última regla que aplica

    if (!regla) continue;

    let diasAagregar: number;
    if (config.acumulacion_frecuencia === 'MENSUAL') {
      diasAagregar = config.acumulacion_monto_mensual ?? (regla.dias / 12);
    } else {
      diasAagregar = regla.dias; // acumulación anual
    }

    await actualizarSaldoVacaciones(usuario.id, diasAagregar);
    await crearNotificacion(usuario.id, 'VACACIONES_ACUMULADAS', `Se acreditaron ${diasAagregar} días de vacaciones`);
  }
}
```

### 13.4 Vista de saldo en el perfil del usuario

- Días disponibles (número grande destacado)
- Días usados en el año
- Días pendientes de aprobación
- Próxima acumulación (fecha y cantidad)
- Historial de solicitudes con estado

---

## 14. AUSENCIAS Y CERTIFICADOS MÉDICOS

### 14.1 Tipos de ausencia

| Tipo | Descripción | Descuenta sueldo | Requiere archivo |
|---|---|---|---|
| CERTIFICADO_MEDICO | Ausencia con certificado médico | No (hasta X días según CCT) | Sí (PDF/imagen) |
| FALTA_JUSTIFICADA | Ausencia con justificativo no médico | Configurable | Opcional |
| FALTA_INJUSTIFICADA | Sin justificativo | Sí (proporcional) | No |
| LICENCIA_ESPECIAL | Por matrimonio, fallecimiento, etc. | No | Sí |

### 14.2 Formulario de carga de ausencia

- Tipo de ausencia (select)
- Fecha inicio y fin
- Descripción
- Número de certificado (si aplica)
- Upload de archivo (PDF o imagen, máximo 5MB)
- El sistema calcula días automáticamente

### 14.3 Impacto en el motor salarial

Las ausencias del período se vinculan a la planilla correspondiente y afectan el cálculo:

```typescript
// En el motor salarial
const ausencias = await getAusenciasPeriodo(usuario_id, periodo_inicio, periodo_fin);

for (const ausencia of ausencias) {
  if (ausencia.descuenta_sueldo && ausencia.tipo === 'FALTA_INJUSTIFICADA') {
    const diasHabiles = calcularDiasHabilesAusencia(ausencia);
    const descuentoPorDia = BASICO / diasHabilesDelMes;
    descuentoAusencias += descuentoPorDia * diasHabiles;
  }
}
```

### 14.4 Visibilidad

- El empleado ve sus propias ausencias y puede cargarlas.
- COORDINADOR ve ausencias de su sector.
- RRHH ve todas y puede aprobar/rechazar.
- Las ausencias aprobadas aparecen marcadas en el calendario del período.

---

## 15. ANALYTICS Y DASHBOARDS

### 15.1 Dashboard general (todos los roles, contenido filtrado por rol)

Métricas del período actual:
- Días activos / Días totales del período
- Total horas trabajadas
- Horas extra 50% y 100%
- Neto estimado (solo si tiene acceso al módulo salarial)
- Estado de la planilla actual (con ícono de estado del flujo)
- Saldo de vacaciones

### 15.2 Analytics de horas (todos los roles)

Gráficos disponibles para el usuario sobre sus propios datos:

| Gráfico | Tipo | Descripción |
|---|---|---|
| Horas trabajadas mes a mes | Barras | Últimos 12 meses, comparando normales vs extras |
| Días trabajados vs francos | Donut | Del período actual |
| Distribución horas por lugar | Donut | BASE vs CAMPO del período |
| Horas extras tendencia | Línea | Evolución de extras por mes |

### 15.3 Analytics salarial (RRHH y ADMIN — completo; COORDINADOR/GERENTE — desglose sin edición)

Gráficos adicionales:

| Gráfico | Tipo | Descripción |
|---|---|---|
| Evolución del neto mes a mes | Línea + área | Últimos 12 meses con marcador de aumentos paritarios |
| Composición del sueldo | Barras apiladas | Fijo vs Variable vs No remunerativo por mes |
| Retenciones vs Bruto | Barras | Comparativa mensual |
| Top conceptos variables | Barras horizontal | Qué conceptos variables más generó |

### 15.4 Analytics por sector (COORDINADOR, GERENTE, RRHH, ADMIN)

| Gráfico | Tipo | Descripción |
|---|---|---|
| Horas trabajadas por sector | Barras agrupadas | Comparativa entre sectores, por mes |
| Días trabajados promedio por sector | Barras | Productividad por sector |
| Horas extra por sector | Barras agrupadas | Qué sector genera más extras |
| Comparativa mes a mes por sector | Líneas múltiples | Evolución de cada sector en 12 meses |
| Distribución de empleados por sector | Donut | Headcount actual |
| Ausencias por sector | Barras | Cantidad de días de ausencia por sector por mes |

### 15.5 Tabla de usuarios (RRHH, ADMIN)

Tabla expandible con:
- Nombre, sector, categoría, diagrama
- Horas del período actual
- Neto estimado
- Estado de planilla
- Días de vacaciones disponibles
- Filtros: por sector, por estado de planilla, por período

### 15.6 Implementación de gráficos ocultos

Los datos de analytics se calculan **para todos** los usuarios en el backend y se guardan en la respuesta del API. La visibilidad de cada sección es controlada por el rol en el frontend:

```typescript
// En el componente de analytics
const { user } = useAuth();

// Siempre se buscan los datos
const { data: analyticsData } = useQuery(['analytics', userId], fetchAnalytics);

return (
  <>
    {/* Siempre visible */}
    <HorasChart data={analyticsData.horas} />

    {/* Solo RRHH y ADMIN ven el desglose completo */}
    {(user.rol === 'RRHH' || user.rol === 'ADMIN') && (
      <SalarialDetalleCompleto data={analyticsData.salarial} />
    )}

    {/* COORDINADOR y GERENTE ven el desglose pero sin edición */}
    {(['COORDINADOR', 'GERENTE', 'RRHH', 'ADMIN'].includes(user.rol)) && (
      <SalarialDetalleSector data={analyticsData.sector} />
    )}
  </>
);
```

**Importante:** El backend NO envía datos sensibles (montos exactos de sueldo) a usuarios sin permiso, independientemente de lo que haga el frontend. La restricción existe en los dos niveles.

---

## 16. NOTIFICACIONES REAL-TIME

### 16.1 Eventos Socket.io (servidor → cliente)

| Evento | Descripción | Destinatarios |
|---|---|---|
| `planilla:enviada` | Nueva planilla esperando revisión | Aprobador del paso 1 del flujo |
| `planilla:aprobada_paso` | Paso intermedio aprobado | Aprobador del siguiente paso |
| `planilla:aprobada` | Aprobación final | Emisor (operador) |
| `planilla:rechazada` | Planilla rechazada con motivo | Emisor (operador) |
| `planilla:cerrada` | Período cerrado por RRHH | Emisor (operador) |
| `vacacion:enviada` | Nueva solicitud de vacaciones | Aprobador según flujo |
| `vacacion:aprobada` | Vacaciones aprobadas | Solicitante |
| `vacacion:rechazada` | Vacaciones rechazadas | Solicitante |
| `vacaciones:acreditadas` | Acumulación automática | Usuario |
| `ausencia:nueva` | Nueva ausencia cargada | RRHH del sector |
| `sistema:periodo_abierto` | Se abre un nuevo período | Todos los usuarios |

### 16.2 Persistencia de notificaciones

Todas las notificaciones se guardan en la tabla `notificaciones`. Si el usuario no está conectado cuando se genera el evento, las verá cuando inicie sesión (badge en el header).

### 16.3 Push Notifications (PWA)

Para usuarios que tengan la PWA instalada y hayan concedido permiso:
- Usar Web Push API + VAPID keys
- Enviar push para: rechazo de planilla, aprobación final, vacaciones aprobadas/rechazadas
- Incluir título, cuerpo y link de acción

---

## 17. EXPORTACIÓN EXCEL

### 17.1 Exportación individual

Genera un `.xlsx` basado en `template_horas.xlsx`:

- Celda de mes (Row 7, Col C): "mesAnterior-mesActual año"
- Filas de datos (desde Row 12): una fila por día del período (21 al 20)
- Columnas: Fecha | Entrada1 | Salida1 | Entrada2 | Salida2 | Horas | Viaje | Lugar | Hotel | Trailer | Maneja | Obs
- Nombre de archivo: `Planilla de horas {Apellido} {Nombre} ({mes1} - {mes2} - {año}).xlsx`

### 17.2 Exportación masiva (RRHH)

- Seleccionar sector y período
- Genera un ZIP con una planilla Excel por usuario
- Alternativamente, genera un Excel consolidado con una hoja por usuario

### 17.3 Historial de exportaciones

Lista de planillas exportadas con:
- Nombre del archivo
- Fecha de exportación
- Usuario que exportó
- Opción de volver a descargar

---

## 18. PWA — PROGRESSIVE WEB APP

### 18.1 manifest.json

```json
{
  "name": "Planilla de Horas",
  "short_name": "Planilla",
  "description": "Gestión de jornadas laborales CCT 637/11",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1E3A5F",
  "theme_color": "#2563EB",
  "orientation": "any",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ],
  "screenshots": [
    { "src": "/screenshot-mobile.png", "sizes": "390x844", "type": "image/png", "form_factor": "narrow" },
    { "src": "/screenshot-desktop.png", "sizes": "1280x800", "type": "image/png", "form_factor": "wide" }
  ]
}
```

### 18.2 Estrategia de cache (Workbox)

| Recurso | Estrategia | TTL |
|---|---|---|
| Assets estáticos (JS, CSS, fonts) | CacheFirst | Inmutable (hash en nombre) |
| Imágenes | CacheFirst | 30 días |
| Datos de API (`/api/planillas`) | NetworkFirst | Fallback a cache |
| Datos de usuario (`/api/auth/me`) | NetworkFirst | 5 minutos |
| Analytics | NetworkFirst | Sin cache offline |

### 18.3 Funcionalidad offline

- Ver planilla actual (última versión cacheada en IndexedDB con Dexie.js)
- Ver historial de planillas
- Ver saldo de vacaciones
- **No disponible offline:** aprobar planillas, enviar planillas, exportar Excel

### 18.4 Background Sync

Si el usuario intenta guardar un registro de horas sin conexión:
1. El registro se guarda en IndexedDB (`pendingRecords`)
2. Al recuperar la conexión, Background Sync lo envía al servidor
3. El usuario recibe notificación "Registros sincronizados"

### 18.5 Compatibilidad

- Android Chrome 80+: completa (instalación, offline, push)
- iOS Safari 16.4+: instalación y offline (push notifications con limitaciones)
- Chrome Desktop 80+: completa
- Firefox Desktop: sin push notifications, resto completo
- Edge Desktop: completa

---

## 19. API REST — ENDPOINTS COMPLETOS

### Base URL: `/api/v1`

### 19.1 Autenticación

```
POST   /auth/login                → { accessToken, user }
POST   /auth/refresh              → { accessToken }
POST   /auth/logout               → 204
POST   /auth/change-password      → 200
GET    /auth/me                   → User
```

### 19.2 Usuarios

```
GET    /usuarios                  → [User] (filtrado por rol)
POST   /usuarios                  → User (ADMIN, RRHH)
GET    /usuarios/:id              → User
PUT    /usuarios/:id              → User (ADMIN, RRHH)
PATCH  /usuarios/:id/diagrama     → User (ADMIN, COORD)
PATCH  /usuarios/:id/sector       → User (ADMIN)
DELETE /usuarios/:id              → 204 (soft delete, pone activo=false)
GET    /usuarios/:id/ficha        → FichaCompleta (RRHH, ADMIN)
GET    /usuarios/:id/analytics    → AnalyticsData
```

### 19.3 Planillas

```
GET    /planillas                 → [Planilla] (rol-filtered)
POST   /planillas                 → Planilla
GET    /planillas/:id             → PlanillaDetalle
PUT    /planillas/:id             → Planilla (solo BORRADOR)
DELETE /planillas/:id             → 204 (solo BORRADOR)
POST   /planillas/:id/enviar      → Planilla
POST   /planillas/:id/avanzar     → Planilla (ejecuta paso actual del flujo)
POST   /planillas/:id/rechazar    → Planilla { motivo: string }
POST   /planillas/:id/cerrar      → Planilla (RRHH)
GET    /planillas/:id/historial   → [HistorialItem]
GET    /planillas/:id/export      → .xlsx file
GET    /planillas/:id/calculo     → CalculoSalarial (rol-filtered)
```

### 19.4 Registros de horas

```
GET    /planillas/:id/registros   → [Registro]
POST   /planillas/:id/registros   → Registro
PUT    /planillas/:id/registros/:rid  → Registro (solo BORRADOR)
DELETE /planillas/:id/registros/:rid  → 204 (solo BORRADOR)
```

### 19.5 Vacaciones

```
GET    /vacaciones                → [Vacacion] (rol-filtered)
POST   /vacaciones                → Vacacion
GET    /vacaciones/:id            → VacacionDetalle
POST   /vacaciones/:id/enviar     → Vacacion
POST   /vacaciones/:id/avanzar    → Vacacion
POST   /vacaciones/:id/rechazar   → Vacacion
GET    /vacaciones/saldo          → { disponible, usados, pendiente }
```

### 19.6 Ausencias

```
GET    /ausencias                 → [Ausencia] (rol-filtered)
POST   /ausencias                 → Ausencia
GET    /ausencias/:id             → Ausencia
PUT    /ausencias/:id             → Ausencia (RRHH)
DELETE /ausencias/:id             → 204 (RRHH)
POST   /ausencias/:id/archivo     → multipart, guarda archivo
```

### 19.7 Analytics

```
GET    /analytics/usuario/:id     → AnalyticsUsuario
GET    /analytics/sector/:id      → AnalyticsSector
GET    /analytics/empresa         → AnalyticsEmpresa (RRHH, ADMIN)
GET    /analytics/comparativa     → ComparativaSectores (COORD, GER, RRHH, ADMIN)
```

### 19.8 Admin — Sectores

```
GET    /admin/sectores            → [Sector]
POST   /admin/sectores            → Sector
PUT    /admin/sectores/:id        → Sector
DELETE /admin/sectores/:id        → 204
```

### 19.9 Admin — Diagramas

```
GET    /admin/diagramas           → [Diagrama]
POST   /admin/diagramas           → Diagrama
PUT    /admin/diagramas/:id       → Diagrama
DELETE /admin/diagramas/:id       → 204
```

### 19.10 Admin — Flujos de aprobación

```
GET    /admin/flujos              → [Flujo]
POST   /admin/flujos              → Flujo (con pasos)
GET    /admin/flujos/:id          → FlujoDetalle
PUT    /admin/flujos/:id          → Flujo
DELETE /admin/flujos/:id          → 204
POST   /admin/flujos/:id/pasos    → Paso
PUT    /admin/flujos/:id/pasos/:pid → Paso
DELETE /admin/flujos/:id/pasos/:pid → 204
GET    /admin/flujos/asignaciones → [Asignacion]
POST   /admin/flujos/asignaciones → Asignacion
```

### 19.11 Admin — Convenios y Conceptos

```
GET    /admin/convenios           → [Convenio]
POST   /admin/convenios           → Convenio
GET    /admin/convenios/:id       → ConvenioDetalle (con categorías y conceptos)
PUT    /admin/convenios/:id       → Convenio

GET    /admin/categorias          → [Categoria]
POST   /admin/categorias          → Categoria
PUT    /admin/categorias/:id      → Categoria

GET    /admin/conceptos           → [Concepto] (filtrado por convenio_id)
POST   /admin/conceptos           → Concepto
PUT    /admin/conceptos/:id       → Concepto
PATCH  /admin/conceptos/:id/valor → ConceptoValor (actualización paritaria)
GET    /admin/conceptos/:id/historial → [ConceptoValor]
```

### 19.12 Admin — Configuración de empresa

```
GET    /admin/config              → EmpresaConfig
PUT    /admin/config              → EmpresaConfig
GET    /admin/config/vacaciones   → VacacionesConfig
PUT    /admin/config/vacaciones   → VacacionesConfig
```

### 19.13 Notificaciones

```
GET    /notificaciones            → [Notificacion]
PATCH  /notificaciones/:id/leer   → 200
PATCH  /notificaciones/leer-todas → 200
```

---

## 20. INFRAESTRUCTURA DOCKER

### 20.1 docker-compose.yml (desarrollo)

```yaml
version: '3.9'

services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: planilla_horas
      POSTGRES_USER: planilla_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - '5432:5432'
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U planilla_user -d planilla_horas"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - '6379:6379'
    volumes:
      - redisdata:/data

  api:
    build:
      context: ./apps/api
      dockerfile: Dockerfile.dev
    restart: unless-stopped
    environment:
      DATABASE_URL: postgresql://planilla_user:${DB_PASSWORD}@db:5432/planilla_horas
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
      JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET}
      VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY}
      VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY}
      PORT: 4000
      NODE_ENV: development
    volumes:
      - ./apps/api/src:/app/src
      - uploads:/app/uploads
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    ports:
      - '4000:4000'

  web:
    build:
      context: ./apps/web
      dockerfile: Dockerfile.dev
    restart: unless-stopped
    environment:
      VITE_API_URL: http://localhost:4000
      VITE_WS_URL: ws://localhost:4000
    volumes:
      - ./apps/web/src:/app/src
    ports:
      - '3000:3000'

volumes:
  pgdata:
  redisdata:
  uploads:
```

### 20.2 docker-compose.prod.yml (producción)

```yaml
version: '3.9'

services:
  db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_DB: planilla_horas
      POSTGRES_USER: planilla_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    # No exponer puerto en producción

  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redisdata:/data

  api:
    image: planilla-api:latest
    restart: always
    environment:
      DATABASE_URL: postgresql://planilla_user:${DB_PASSWORD}@db:5432/planilla_horas
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      JWT_SECRET: ${JWT_SECRET}
      JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET}
      VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY}
      VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY}
      PORT: 4000
      NODE_ENV: production
    volumes:
      - uploads:/app/uploads
    depends_on:
      - db
      - redis

  web:
    image: planilla-web:latest
    restart: always

  nginx:
    image: nginx:alpine
    restart: always
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
      - ./certbot/www:/var/www/certbot:ro
    depends_on:
      - api
      - web

volumes:
  pgdata:
  redisdata:
  uploads:
```

### 20.3 nginx.conf

```nginx
events { worker_connections 1024; }

http {
  upstream api {
    server api:4000;
  }

  upstream web {
    server web:3000;
  }

  server {
    listen 80;
    server_name tu-dominio.com;
    return 301 https://$host$request_uri;
  }

  server {
    listen 443 ssl;
    server_name tu-dominio.com;

    ssl_certificate /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    # API
    location /api/ {
      proxy_pass http://api;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection 'upgrade';
      proxy_set_header Host $host;
      proxy_cache_bypass $http_upgrade;
      client_max_body_size 10M;
    }

    # WebSocket
    location /socket.io/ {
      proxy_pass http://api;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "Upgrade";
      proxy_set_header Host $host;
    }

    # Frontend
    location / {
      proxy_pass http://web;
      proxy_set_header Host $host;
    }
  }
}
```

### 20.4 .env.example

```env
# Base de datos
DB_PASSWORD=cambiar_en_produccion

# Redis
REDIS_PASSWORD=cambiar_en_produccion

# JWT
JWT_SECRET=super_secreto_largo_y_aleatorio_256_bits
JWT_REFRESH_SECRET=otro_secreto_distinto_256_bits

# VAPID (Push Notifications) — generar con: npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_EMAIL=admin@tuempresa.com

# SMTP (opcional — para emails de notificación)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=

# App
NODE_ENV=development
PORT=4000
FRONTEND_URL=http://localhost:3000
```

---

## 21. SEGURIDAD

### 21.1 Reglas obligatorias

1. **Todos los endpoints** requieren JWT válido, excepto `/auth/login` y `/auth/refresh`.
2. **Todos los queries** filtran por `empresa_id` del usuario autenticado. Nunca confiar en el `empresa_id` que venga en el body.
3. **Validación con Zod** en todos los request bodies del backend.
4. **Rate limiting** en `/auth/login`: máximo 10 intentos por IP en 15 minutos (usando Redis).
5. **bcrypt** con factor 12 para passwords.
6. **Refresh tokens** almacenados en Redis con TTL. Al hacer logout se eliminan.
7. **HTTPS obligatorio** en producción.
8. **CORS** configurado solo para el origen del frontend.
9. **Uploads** de archivos: validar tipo MIME + extensión + tamaño máximo. Guardar fuera de la carpeta pública.
10. **XSS:** sanitizar observaciones y comentarios antes de guardar.

### 21.2 Validación de acceso a recursos

```typescript
// Antes de cualquier operación sobre planilla
async function verificarAccesoPlanilla(planillaId: string, usuarioId: string, rol: Rol): Promise<Planilla> {
  const planilla = await prisma.planilla.findUnique({ where: { id: planillaId }, include: { usuario: true } });

  if (!planilla) throw new NotFoundError('Planilla no encontrada');

  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });

  // Misma empresa siempre
  if (planilla.usuario.empresa_id !== usuario.empresa_id) throw new ForbiddenError();

  // El operador solo puede ver las suyas
  if (rol === 'OPERADOR' && planilla.usuario_id !== usuarioId) throw new ForbiddenError();

  // El supervisor solo puede ver las de su sector
  if (rol === 'SUPERVISOR' && planilla.usuario.sector_id !== usuario.sector_id) throw new ForbiddenError();

  return planilla;
}
```

---

## 22. PLAN DE IMPLEMENTACIÓN POR FASES

### Fase 1 — Infraestructura base (Semana 1)
- [ ] Crear monorepo con estructura de directorios
- [ ] Configurar Docker Compose con PostgreSQL y Redis
- [ ] Configurar Prisma con schema completo
- [ ] Ejecutar migraciones iniciales
- [ ] Crear seeds: empresa demo, convenios CCT, conceptos base, diagramas predefinidos, sectores ejemplo
- [ ] Configurar Express con TypeScript y middlewares base
- [ ] Implementar auth: login, JWT, refresh tokens, logout
- [ ] Implementar primer_login y cambio de contraseña obligatorio
- [ ] Scaffold React + Vite + Tailwind + shadcn/ui
- [ ] Implementar login page y app shell con sidebar

### Fase 2 — Usuarios y administración (Semana 2)
- [ ] CRUD de sectores
- [ ] CRUD de usuarios con ficha completa
- [ ] Asignación de diagramas a usuarios
- [ ] Panel de administración (hub ADMIN)
- [ ] Gestión de convenios y categorías
- [ ] CRUD de conceptos salariales con historial de valores

### Fase 3 — Core de horas (Semanas 3-4)
- [ ] Calendario de período (21 al 20) con visualización de diagrama
- [ ] CRUD de registros de horas con toda la lógica automática
- [ ] Motor de cálculo salarial completo con clasificación de horas
- [ ] Preview de cálculo en tiempo real mientras se cargan registros
- [ ] Creación y gestión de planillas por período

### Fase 4 — Flujos de aprobación (Semana 5)
- [ ] CRUD de flujos de aprobación con pasos configurables
- [ ] Asignación de flujos a sectores
- [ ] Máquina de estados para planillas
- [ ] Endpoints de enviar/aprobar/rechazar/cerrar
- [ ] Historial de movimientos del flujo

### Fase 5 — Notificaciones (Semana 5-6)
- [ ] Integrar Socket.io en servidor y cliente
- [ ] Tabla de notificaciones y persistencia
- [ ] Implementar todos los eventos del flujo
- [ ] Badge de notificaciones no leídas en header
- [ ] Web Push Notifications con VAPID

### Fase 6 — Vacaciones (Semana 6)
- [ ] Solicitud de vacaciones con calendario
- [ ] Flujo de aprobación de vacaciones
- [ ] Cron job de acumulación automática
- [ ] Panel de saldo en perfil del usuario
- [ ] Configuración de reglas de acumulación (ADMIN)

### Fase 7 — Ausencias (Semana 7)
- [ ] CRUD de ausencias con upload de certificados
- [ ] Vinculación de ausencias a planillas
- [ ] Impacto en motor salarial
- [ ] Vista de ausencias por sector (COORD, RRHH)

### Fase 8 — Analytics y reportes (Semana 7-8)
- [ ] Implementar endpoints de analytics con queries optimizados
- [ ] Gráficos de horas mes a mes (Recharts)
- [ ] Gráficos de composición salarial (RRHH/ADMIN)
- [ ] Analytics comparativo por sector (COORD/GER)
- [ ] Tabla de usuarios con filtros (RRHH)
- [ ] Exportación Excel individual y masiva

### Fase 9 — PWA y offline (Semana 8)
- [ ] Configurar Vite PWA Plugin y Workbox
- [ ] Implementar manifest.json con íconos
- [ ] Service Worker con estrategias de cache
- [ ] IndexedDB con Dexie.js para modo offline
- [ ] Background Sync para registros pendientes
- [ ] Botón "instalar app" en el header

### Fase 10 — Testing y producción (Semana 9)
- [ ] Tests unitarios del motor de cálculo salarial
- [ ] Tests de integración de los flujos de aprobación
- [ ] Script de migración de datos desde SQLite de Android
- [ ] Configuración de Docker Compose producción
- [ ] Configuración Nginx + SSL
- [ ] Deploy y smoke tests

---

## 23. NOTAS DE MIGRACIÓN DESDE ANDROID

### 23.1 Origen

La app Android usa Room/SQLite con la entidad `HorasTrabajoEntity`. Los campos mapean directamente a `registros_horas` en PostgreSQL.

### 23.2 Script de migración

```typescript
// scripts/migrate-from-sqlite.ts
import Database from 'better-sqlite3';
import { PrismaClient } from '@prisma/client';

const sqlite = new Database('./horas_trabajo.db'); // exportar de Android con adb
const prisma = new PrismaClient();

async function migrate() {
  const rows = sqlite.prepare('SELECT * FROM horas_trabajo').all();

  for (const row of rows) {
    // Crear o encontrar la planilla del período correspondiente
    const fecha = new Date(row.fechaMs);
    const periodoInicio = calcularPeriodoInicio(fecha);
    const periodoFin = calcularPeriodoFin(fecha);

    let planilla = await prisma.planilla.findFirst({
      where: { usuario_id: USUARIO_ID, periodo_inicio: periodoInicio }
    });

    if (!planilla) {
      planilla = await prisma.planilla.create({
        data: { usuario_id: USUARIO_ID, periodo_inicio: periodoInicio, periodo_fin: periodoFin, estado: 'CERRADA' }
      });
    }

    await prisma.registroHoras.create({
      data: {
        planilla_id: planilla.id,
        fecha: fecha,
        entrada_turno1: row.entradaInicioMs ? new Date(row.entradaInicioMs) : null,
        salida_turno1: row.salidaInicioMs ? new Date(row.salidaInicioMs) : null,
        // ... mapear todos los campos
        lugar_trabajo: row.lugarTrabajo.toUpperCase(),
        pernocte: row.pernocte.toUpperCase(),
        maneja: row.maneja === 1,
        es_feriado: row.esFeriado === 1,
        observaciones: row.observaciones,
      }
    });
  }

  console.log(`Migrados ${rows.length} registros`);
}

migrate().finally(() => prisma.$disconnect());
```

### 23.3 Pasos de migración

1. Exportar la base SQLite del dispositivo Android con `adb pull /data/data/com.tuapp/databases/horas_db ./`
2. Instalar `better-sqlite3` y ejecutar el script
3. Verificar integridad de datos en la UI
4. Archivar el SQLite original como backup

---

## APÉNDICE A — FERIADOS ARGENTINA

```typescript
// Precargados como seed en empresa_config.feriados_personalizados
// Actualizar anualmente

export const FERIADOS_ARGENTINA_2025 = [
  '2025-01-01', // Año Nuevo
  '2025-03-03', // Carnaval
  '2025-03-04', // Carnaval
  '2025-03-24', // Día de la Memoria
  '2025-04-02', // Malvinas
  '2025-04-18', // Viernes Santo
  '2025-05-01', // Día del Trabajador
  '2025-05-25', // Revolución de Mayo
  '2025-06-20', // Paso a la Inmortalidad de Belgrano
  '2025-07-09', // Independencia
  '2025-08-17', // Paso a la Inmortalidad de San Martín
  '2025-10-12', // Día del Respeto a la Diversidad Cultural
  '2025-11-20', // Día de la Soberanía Nacional
  '2025-12-08', // Inmaculada Concepción
  '2025-12-25', // Navidad
];

export const FERIADOS_ARGENTINA_2026 = [
  '2026-01-01',
  '2026-02-16', // Carnaval
  '2026-02-17', // Carnaval
  '2026-03-24',
  '2026-04-02',
  '2026-04-03', // Viernes Santo
  '2026-05-01',
  '2026-05-25',
  '2026-06-19', // Belgrano (lunes más cercano)
  '2026-07-09',
  '2026-08-16', // San Martín (lunes más cercano)
  '2026-10-12',
  '2026-11-20',
  '2026-12-08',
  '2026-12-25',
];
```

---

## APÉNDICE B — PRISMA SCHEMA COMPLETO

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Rol {
  OPERADOR
  SUPERVISOR
  COORDINADOR
  GERENTE
  RRHH
  ADMIN
}

enum PlanillaEstado {
  BORRADOR
  ENVIADA
  EN_REVISION
  APROBADA
  RECHAZADA
  CERRADA
}

enum VacacionEstado {
  BORRADOR
  PENDIENTE
  EN_REVISION
  APROBADA
  RECHAZADA
}

enum AusenciaTipo {
  CERTIFICADO_MEDICO
  FALTA_JUSTIFICADA
  FALTA_INJUSTIFICADA
  LICENCIA_ESPECIAL
}

enum LugarTrabajo {
  BASE
  CAMPO
  FRANCO
}

enum PernocteEnum {
  NO
  HOTEL
  TRAILER
}

enum DiagramaTipo {
  ROTATIVO
  FIJO_SEMANA
}

enum ContratoTipo {
  PRUEBA
  INDEFINIDO
  PLAZO_FIJO
  EVENTUAL
}

enum CctTipo {
  PETROLEROS_PRIVADOS_637
  JERARQUICOS_592
  PERSONALIZADO
}

enum ConceptoTipo {
  REMUNERATIVO_FIJO
  REMUNERATIVO_VARIABLE
  NO_REMUNERATIVO
  RETENCION
  DESCUENTO
}

model Empresa {
  id        String   @id @default(uuid())
  nombre    String
  cuit      String?
  direccion String?
  logoUrl   String?  @map("logo_url")
  activa    Boolean  @default(true)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  sectores    Sector[]
  convenios   Convenio[]
  usuarios    Usuario[]
  diagramas   Diagrama[]
  flujos      FlujoAprobacion[]
  config      EmpresaConfig?

  @@map("empresas")
}

model Sector {
  id          String   @id @default(uuid())
  empresaId   String   @map("empresa_id")
  nombre      String
  descripcion String?
  color       String?
  activo      Boolean  @default(true)
  createdAt   DateTime @default(now()) @map("created_at")

  empresa  Empresa   @relation(fields: [empresaId], references: [id], onDelete: Cascade)
  usuarios Usuario[]

  @@map("sectores")
}

model Convenio {
  id            String   @id @default(uuid())
  empresaId     String   @map("empresa_id")
  nombre        String
  tipo          CctTipo
  vigenteDesde  DateTime @map("vigente_desde")
  vigenteHasta  DateTime? @map("vigente_hasta")
  activo        Boolean  @default(true)
  createdAt     DateTime @default(now()) @map("created_at")

  empresa    Empresa              @relation(fields: [empresaId], references: [id], onDelete: Cascade)
  categorias Categoria[]
  conceptos  ConceptoSalarial[]
  usuarios   Usuario[]

  @@map("convenios")
}

model Categoria {
  id          String   @id @default(uuid())
  convenioId  String   @map("convenio_id")
  codigo      String
  nombre      String
  descripcion String?
  orden       Int      @default(0)
  activo      Boolean  @default(true)

  convenio Convenio           @relation(fields: [convenioId], references: [id], onDelete: Cascade)
  usuarios Usuario[]
  valores  ConceptoValor[]

  @@map("categorias")
}

model ConceptoSalarial {
  id                String       @id @default(uuid())
  convenioId        String       @map("convenio_id")
  codigo            String
  nombre            String
  tipo              ConceptoTipo
  descripcion       String?
  esPorcentual      Boolean      @default(false) @map("es_porcentual")
  porcentajeBase    Decimal?     @map("porcentaje_base") @db.Decimal(6, 4)
  montoFijo         Decimal?     @map("monto_fijo") @db.Decimal(12, 2)
  baseCalculo       String?      @map("base_calculo")
  aplicaSiempre     Boolean      @default(true) @map("aplica_siempre")
  condicionFormula  String?      @map("condicion_formula")
  esRemunerativo    Boolean      @default(true) @map("es_remunerativo")
  visibleEmpleado   Boolean      @default(true) @map("visible_empleado")
  editableRrhh      Boolean      @default(true) @map("editable_rrhh")
  orden             Int          @default(0)
  activo            Boolean      @default(true)
  createdAt         DateTime     @default(now()) @map("created_at")
  updatedAt         DateTime     @updatedAt @map("updated_at")

  convenio Convenio        @relation(fields: [convenioId], references: [id], onDelete: Cascade)
  valores  ConceptoValor[]

  @@map("conceptos_salariales")
}

model ConceptoValor {
  id           String    @id @default(uuid())
  conceptoId   String    @map("concepto_id")
  categoriaId  String?   @map("categoria_id")
  vigenteDesde DateTime  @map("vigente_desde")
  vigenteHasta DateTime? @map("vigente_hasta")
  monto        Decimal?  @db.Decimal(12, 2)
  porcentaje   Decimal?  @db.Decimal(6, 4)
  createdAt    DateTime  @default(now()) @map("created_at")

  concepto  ConceptoSalarial @relation(fields: [conceptoId], references: [id], onDelete: Cascade)
  categoria Categoria?       @relation(fields: [categoriaId], references: [id])

  @@map("conceptos_valores")
}

model Diagrama {
  id            String       @id @default(uuid())
  empresaId     String       @map("empresa_id")
  nombre        String
  tipo          DiagramaTipo
  diasTrabajo   Int?         @map("dias_trabajo")
  diasDescanso  Int?         @map("dias_descanso")
  diasSemana    Int[]        @map("dias_semana")
  descripcion   String?
  activo        Boolean      @default(true)
  createdAt     DateTime     @default(now()) @map("created_at")

  empresa    Empresa            @relation(fields: [empresaId], references: [id], onDelete: Cascade)
  asignaciones UsuarioDiagrama[]

  @@map("diagramas")
}

model UsuarioDiagrama {
  id          String    @id @default(uuid())
  usuarioId   String    @map("usuario_id")
  diagramaId  String    @map("diagrama_id")
  fechaInicio DateTime  @map("fecha_inicio")
  fechaFin    DateTime? @map("fecha_fin")
  activo      Boolean   @default(true)
  createdAt   DateTime  @default(now()) @map("created_at")

  usuario  Usuario  @relation(fields: [usuarioId], references: [id], onDelete: Cascade)
  diagrama Diagrama @relation(fields: [diagramaId], references: [id])

  @@map("usuarios_diagramas")
}

model FlujoAprobacion {
  id             String   @id @default(uuid())
  empresaId      String   @map("empresa_id")
  nombre         String
  tipoDocumento  String   @map("tipo_documento")
  descripcion    String?
  activo         Boolean  @default(true)
  createdAt      DateTime @default(now()) @map("created_at")

  empresa      Empresa           @relation(fields: [empresaId], references: [id], onDelete: Cascade)
  pasos        FlujoPaso[]
  asignaciones FlujoAsignacion[]
  planillas    Planilla[]
  vacaciones   Vacacion[]

  @@map("flujos_aprobacion")
}

model FlujoPaso {
  id                        String    @id @default(uuid())
  flujoId                   String    @map("flujo_id")
  orden                     Int
  nombrePaso                String    @map("nombre_paso")
  rolAprobador              Rol       @map("rol_aprobador")
  usuarioEspecificoId       String?   @map("usuario_especifico_id")
  accionAprobar             String    @default("APROBAR") @map("accion_aprobar")
  accionRechazar            String    @default("RECHAZAR") @map("accion_rechazar")
  requiereComentarioRechazo Boolean   @default(true) @map("requiere_comentario_rechazo")
  notificarRoles            Rol[]     @map("notificar_roles")
  tiempoLimiteHoras         Int?      @map("tiempo_limite_horas")
  createdAt                 DateTime  @default(now()) @map("created_at")

  flujo           FlujoAprobacion @relation(fields: [flujoId], references: [id], onDelete: Cascade)
  usuarioEspecifico Usuario?       @relation("pasos_usuario_especifico", fields: [usuarioEspecificoId], references: [id])

  @@map("flujos_pasos")
}

model FlujoAsignacion {
  id            String   @id @default(uuid())
  flujoId       String   @map("flujo_id")
  tipoDocumento String   @map("tipo_documento")
  sectorId      String?  @map("sector_id")
  usuarioId     String?  @map("usuario_id")
  activo        Boolean  @default(true)

  flujo   FlujoAprobacion @relation(fields: [flujoId], references: [id])
  sector  Sector?         @relation(fields: [sectorId], references: [id])
  usuario Usuario?        @relation("flujo_asignaciones_usuario", fields: [usuarioId], references: [id])

  @@map("flujos_asignaciones")
}

model Usuario {
  id                      String       @id @default(uuid())
  empresaId               String       @map("empresa_id")
  sectorId                String?      @map("sector_id")
  categoriaId             String?      @map("categoria_id")
  convenioId              String?      @map("convenio_id")
  nombre                  String
  apellido                String
  email                   String       @unique
  passwordHash            String       @map("password_hash")
  legajo                  String?
  dni                     String?
  cuil                    String?
  fechaNacimiento         DateTime?    @map("fecha_nacimiento")
  telefono                String?
  avatarUrl               String?      @map("avatar_url")
  rol                     Rol          @default(OPERADOR)
  tipoContrato            ContratoTipo @default(INDEFINIDO) @map("tipo_contrato")
  fechaIngreso            DateTime     @map("fecha_ingreso")
  fechaFinPrueba          DateTime?    @map("fecha_fin_prueba")
  fechaEgreso             DateTime?    @map("fecha_egreso")
  coordinadorId           String?      @map("coordinador_id")
  supervisorId            String?      @map("supervisor_id")
  diasVacacionesSaldo     Int          @default(0) @map("dias_vacaciones_saldo")
  diasVacacionesUsados    Int          @default(0) @map("dias_vacaciones_usados")
  sueldoBasicoOverride    Decimal?     @map("sueldo_basico_override") @db.Decimal(12, 2)
  activo                  Boolean      @default(true)
  primerLogin             Boolean      @default(true) @map("primer_login")
  createdAt               DateTime     @default(now()) @map("created_at")
  updatedAt               DateTime     @updatedAt @map("updated_at")

  empresa     Empresa          @relation(fields: [empresaId], references: [id], onDelete: Cascade)
  sector      Sector?          @relation(fields: [sectorId], references: [id])
  categoria   Categoria?       @relation(fields: [categoriaId], references: [id])
  convenio    Convenio?        @relation(fields: [convenioId], references: [id])
  coordinador Usuario?         @relation("coordinador_subordinados", fields: [coordinadorId], references: [id])
  supervisor  Usuario?         @relation("supervisor_subordinados", fields: [supervisorId], references: [id])
  subordinados_coord Usuario[] @relation("coordinador_subordinados")
  subordinados_sup   Usuario[] @relation("supervisor_subordinados")
  diagramas   UsuarioDiagrama[]
  planillas   Planilla[]
  vacaciones  Vacacion[]
  ausencias   Ausencia[]
  notificaciones Notificacion[]

  @@map("usuarios")
}

model Planilla {
  id                   String         @id @default(uuid())
  usuarioId            String         @map("usuario_id")
  flujoId              String?        @map("flujo_id")
  periodoInicio        DateTime       @map("periodo_inicio")
  periodoFin           DateTime       @map("periodo_fin")
  estado               PlanillaEstado @default(BORRADOR)
  pasoActual           Int            @default(0) @map("paso_actual")
  obsRechazo           String?        @map("obs_rechazo")
  aprobadaPorId        String?        @map("aprobada_por_id")
  enviadaAt            DateTime?      @map("enviada_at")
  aprobadaAt           DateTime?      @map("aprobada_at")
  cerradaAt            DateTime?      @map("cerrada_at")
  snapshotCalculo      Json?          @map("snapshot_calculo")
  totalHorasNormales   Decimal        @default(0) @map("total_horas_normales") @db.Decimal(7, 2)
  totalHorasExtra50    Decimal        @default(0) @map("total_horas_extra_50") @db.Decimal(7, 2)
  totalHorasExtra100   Decimal        @default(0) @map("total_horas_extra_100") @db.Decimal(7, 2)
  totalHorasViaje      Decimal        @default(0) @map("total_horas_viaje") @db.Decimal(7, 2)
  totalDiasCampo       Int            @default(0) @map("total_dias_campo")
  totalDiasBase        Int            @default(0) @map("total_dias_base")
  netoEstimado         Decimal?       @map("neto_estimado") @db.Decimal(12, 2)
  createdAt            DateTime       @default(now()) @map("created_at")
  updatedAt            DateTime       @updatedAt @map("updated_at")

  usuario    Usuario             @relation(fields: [usuarioId], references: [id])
  flujo      FlujoAprobacion?    @relation(fields: [flujoId], references: [id])
  registros  RegistroHoras[]
  historial  PlanillaHistorial[]

  @@map("planillas")
}

model PlanillaHistorial {
  id              String         @id @default(uuid())
  planillaId      String         @map("planilla_id")
  usuarioId       String         @map("usuario_id")
  estadoAnterior  PlanillaEstado? @map("estado_anterior")
  estadoNuevo     PlanillaEstado @map("estado_nuevo")
  pasoFlujo       Int?           @map("paso_flujo")
  comentario      String?
  createdAt       DateTime       @default(now()) @map("created_at")

  planilla Planilla @relation(fields: [planillaId], references: [id], onDelete: Cascade)
  usuario  Usuario  @relation(fields: [usuarioId], references: [id])

  @@map("planillas_historial")
}

model RegistroHoras {
  id                      String       @id @default(uuid())
  planillaId              String       @map("planilla_id")
  fecha                   DateTime
  entradaTurno1           DateTime?    @map("entrada_turno1")
  salidaTurno1            DateTime?    @map("salida_turno1")
  entradaTurno2           DateTime?    @map("entrada_turno2")
  salidaTurno2            DateTime?    @map("salida_turno2")
  cruzaMedianoche         Boolean      @default(false) @map("cruza_medianoche")
  lugarTrabajo            LugarTrabajo? @map("lugar_trabajo")
  pernocte                PernocteEnum @default(NO)
  maneja                  Boolean      @default(false)
  horasViajeInput         Decimal      @default(2) @map("horas_viaje_input") @db.Decimal(4, 2)
  esFeriado               Boolean      @default(false) @map("es_feriado")
  esFrancoCompensatorio   Boolean      @default(false) @map("es_franco_compensatorio")
  esFrancoTrabajado       Boolean      @default(false) @map("es_franco_trabajado")
  horasTrabajadas         Decimal?     @map("horas_trabajadas") @db.Decimal(5, 2)
  horasNormales           Decimal      @default(0) @map("horas_normales") @db.Decimal(5, 2)
  horasExtra50            Decimal      @default(0) @map("horas_extra_50") @db.Decimal(5, 2)
  horasExtra100           Decimal      @default(0) @map("horas_extra_100") @db.Decimal(5, 2)
  horasViajeCalc          Decimal      @default(0) @map("horas_viaje_calc") @db.Decimal(5, 2)
  observaciones           String?
  createdAt               DateTime     @default(now()) @map("created_at")
  updatedAt               DateTime     @updatedAt @map("updated_at")

  planilla Planilla @relation(fields: [planillaId], references: [id], onDelete: Cascade)

  @@unique([planillaId, fecha])
  @@map("registros_horas")
}

model Vacacion {
  id            String         @id @default(uuid())
  usuarioId     String         @map("usuario_id")
  flujoId       String?        @map("flujo_id")
  fechaInicio   DateTime       @map("fecha_inicio")
  fechaFin      DateTime       @map("fecha_fin")
  diasHabiles   Int            @map("dias_habiles")
  diasTotales   Int            @map("dias_totales")
  estado        VacacionEstado @default(BORRADOR)
  pasoActual    Int            @default(0) @map("paso_actual")
  motivo        String?
  obsRechazo    String?        @map("obs_rechazo")
  aprobadaPorId String?        @map("aprobada_por_id")
  aprobadaAt    DateTime?      @map("aprobada_at")
  createdAt     DateTime       @default(now()) @map("created_at")
  updatedAt     DateTime       @updatedAt @map("updated_at")

  usuario   Usuario              @relation(fields: [usuarioId], references: [id])
  flujo     FlujoAprobacion?     @relation(fields: [flujoId], references: [id])
  historial VacacionHistorial[]

  @@map("vacaciones")
}

model VacacionHistorial {
  id             String         @id @default(uuid())
  vacacionId     String         @map("vacacion_id")
  usuarioId      String         @map("usuario_id")
  estadoAnterior VacacionEstado? @map("estado_anterior")
  estadoNuevo    VacacionEstado @map("estado_nuevo")
  pasoFlujo      Int?           @map("paso_flujo")
  comentario     String?
  createdAt      DateTime       @default(now()) @map("created_at")

  vacacion Vacacion @relation(fields: [vacacionId], references: [id], onDelete: Cascade)
  usuario  Usuario  @relation(fields: [usuarioId], references: [id])

  @@map("vacaciones_historial")
}

model VacacionesConfig {
  id                       String   @id @default(uuid())
  empresaId                String   @unique @map("empresa_id")
  reglasAntiguedad         Json     @default("[]") @map("reglas_antiguedad")
  acumulacionActiva        Boolean  @default(true) @map("acumulacion_activa")
  acumulacionDiaDelMes     Int      @default(1) @map("acumulacion_dia_del_mes")
  acumulacionFrecuencia    String   @default("MENSUAL") @map("acumulacion_frecuencia")
  acumulacionMontoMensual  Decimal? @map("acumulacion_monto_mensual") @db.Decimal(5, 2)
  vencimientoActivo        Boolean  @default(false) @map("vencimiento_activo")
  vencimientoMeses         Int      @default(12) @map("vencimiento_meses")
  bloquearEnPrueba         Boolean  @default(true) @map("bloquear_en_prueba")
  createdAt                DateTime @default(now()) @map("created_at")
  updatedAt                DateTime @updatedAt @map("updated_at")

  empresa Empresa @relation(fields: [empresaId], references: [id], onDelete: Cascade)

  @@map("vacaciones_config")
}

model Ausencia {
  id                   String       @id @default(uuid())
  usuarioId            String       @map("usuario_id")
  planillaId           String?      @map("planilla_id")
  tipo                 AusenciaTipo
  fechaInicio          DateTime     @map("fecha_inicio")
  fechaFin             DateTime     @map("fecha_fin")
  diasAusencia         Int          @map("dias_ausencia")
  descripcion          String?
  numeroCertificado    String?      @map("numero_certificado")
  archivoUrl           String?      @map("archivo_url")
  descontaSueldo       Boolean      @default(false) @map("desconta_sueldo")
  porcentajeDescuento  Decimal      @default(0) @map("porcentaje_descuento") @db.Decimal(5, 2)
  requiereAprobacion   Boolean      @default(false) @map("requiere_aprobacion")
  aprobada             Boolean      @default(true)
  aprobadaPorId        String?      @map("aprobada_por_id")
  createdAt            DateTime     @default(now()) @map("created_at")

  usuario    Usuario  @relation(fields: [usuarioId], references: [id])

  @@map("ausencias")
}

model Notificacion {
  id        String   @id @default(uuid())
  usuarioId String   @map("usuario_id")
  tipo      String
  titulo    String
  cuerpo    String?
  link      String?
  leida     Boolean  @default(false)
  metadata  Json?
  createdAt DateTime @default(now()) @map("created_at")

  usuario Usuario @relation(fields: [usuarioId], references: [id], onDelete: Cascade)

  @@map("notificaciones")
}

model EmpresaConfig {
  id                       String   @id @default(uuid())
  empresaId                String   @unique @map("empresa_id")
  periodoDiaInicio         Int      @default(21) @map("periodo_dia_inicio")
  periodoDiaFin            Int      @default(20) @map("periodo_dia_fin")
  maxHorasDiarias          Int      @default(16) @map("max_horas_diarias")
  horasJornadaNormal       Int      @default(8) @map("horas_jornada_normal")
  umbralExtra50            Int      @default(8) @map("umbral_extra_50")
  umbralExtra100           Int      @default(12) @map("umbral_extra_100")
  redondeoMinutos          Int      @default(15) @map("redondeo_minutos")
  descuentoAlmuerzoBase    Boolean  @default(true) @map("descuento_almuerzo_base")
  descuentoAlmuerzoCampo   Boolean  @default(false) @map("descuento_almuerzo_campo")
  feriadosPersonalizados   Json     @default("[]") @map("feriados_personalizados")
  moduloVacacionesActivo   Boolean  @default(true) @map("modulo_vacaciones_activo")
  moduloAusenciasActivo    Boolean  @default(true) @map("modulo_ausencias_activo")
  moduloAnalyticsActivo    Boolean  @default(true) @map("modulo_analytics_activo")
  createdAt                DateTime @default(now()) @map("created_at")
  updatedAt                DateTime @updatedAt @map("updated_at")

  empresa Empresa @relation(fields: [empresaId], references: [id], onDelete: Cascade)

  @@map("empresa_config")
}
```

---

*Fin del documento. Versión 2.0 — Marzo 2025.*
*Este documento está pensado para ser consumido por un agente de IA como especificación completa de implementación.*
