# PROMPT DE INICIO — PLANILLA DE HORAS PWA
## Para copiar y pegar directo a tu agente de IA

---

## INSTRUCCIÓN PRINCIPAL

Sos un agente de desarrollo full-stack. Tu tarea es implementar **Planilla de Horas**, una Progressive Web App de gestión de jornadas laborales para la industria petrolera argentina.

Tenés dos documentos de especificación que debés leer **antes de escribir cualquier código**:

1. `PLANILLA_HORAS_SPEC.md` — Especificación técnica completa v2.0 (arquitectura, base de datos, roles, flujos, motor salarial, vacaciones, ausencias, analytics, PWA)
2. `PLANILLA_HORAS_ADDENDUM_v2.1.md` — Addendum con exportación Excel avanzada y funcionalidades adicionales

Leé ambos archivos completos antes de empezar. Toda decisión de arquitectura, nombres de tablas, campos, enums y endpoints está definida ahí. No inventés nombres distintos a los especificados.

---

## OBJETIVO DE ESTA SESIÓN

Implementar la **Fase 1 completa** del plan de implementación, dejando el proyecto corriendo localmente en la PC del desarrollador con:

- Docker Compose levantando PostgreSQL + Redis + API + Web
- Migraciones de Prisma ejecutadas
- Seeds cargados (empresa demo, CCT, conceptos, sectores, diagramas, usuario ADMIN)
- Login funcionando en `http://localhost:3000`
- Un usuario ADMIN creado con email `admin@demo.com` y contraseña `Admin1234!`

---

## STACK A USAR (exactamente este, sin cambios)

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + Vite 5 + TypeScript 5 |
| UI | Tailwind CSS 3 + shadcn/ui |
| Estado | Zustand 4 + React Query (TanStack) v5 |
| Backend | Node.js 20 + Express 4 + TypeScript 5 |
| ORM | Prisma 5 |
| Base de datos | PostgreSQL 16 |
| Cache / Tokens | Redis 7 |
| Contenedores | Docker + Docker Compose |
| Proxy | Nginx (solo en prod, no en dev) |

---

## ESTRUCTURA DE DIRECTORIOS A CREAR

Crear exactamente esta estructura (definida en la sección 3 del spec):

```
planilla-horas/
├── apps/
│   ├── web/          ← React PWA
│   └── api/          ← Node.js + Express
│       └── prisma/
├── docker-compose.yml
├── docker-compose.prod.yml
└── .env.example
```

Usar un **monorepo simple** (sin Turborepo ni Nx por ahora, para mantenerlo simple).

---

## FASE 1 — TAREAS EN ORDEN ESTRICTO

Ejecutá cada tarea en este orden. No avances a la siguiente hasta terminar la anterior.

### TAREA 1 — Estructura base del proyecto

1. Crear la estructura de directorios completa según el spec sección 3
2. Crear `docker-compose.yml` de desarrollo exactamente como está en la sección 20.1 del spec
3. Crear `.env` con valores de desarrollo locales:
   ```
   DB_PASSWORD=planilla_dev_2025
   REDIS_PASSWORD=redis_dev_2025
   JWT_SECRET=dev_jwt_secret_muy_largo_para_que_funcione_bien_256bits
   JWT_REFRESH_SECRET=dev_refresh_secret_distinto_al_anterior_256bits
   VAPID_PUBLIC_KEY=
   VAPID_PRIVATE_KEY=
   NODE_ENV=development
   PORT=4000
   FRONTEND_URL=http://localhost:3000
   ```
4. Verificar que `docker compose up -d` levanta postgres y redis sin errores

### TAREA 2 — Setup del API (Node.js + Express + Prisma)

1. Inicializar `apps/api` con `npm init` y las dependencias exactas del stack
2. Configurar TypeScript con `tsconfig.json` estricto
3. Crear `apps/api/prisma/schema.prisma` con **el schema completo del Apéndice B** del spec v2.0 más los modelos adicionales del Addendum sección 6 (`Exportacion`, `ExportacionPlantilla`, `Proyecto`, `ReciboSueldo`, `TipoCapacitacion`, `EmpleadoCapacitacion`, `AlertaConfig`)
4. Ejecutar `npx prisma migrate dev --name init`
5. Verificar que todas las tablas se crearon correctamente
6. Crear `apps/api/prisma/seed.ts` con los siguientes datos de prueba:
   - 1 empresa: `{ nombre: "TechOil Demo", cuit: "30-12345678-9" }`
   - 6 sectores: Fractura, Well Testing, Servicios Well Head, Mantenimiento Mecánico, END, Wireline (cada uno con un color hex distinto)
   - 1 convenio: CCT 637/11 Petroleros Privados
   - 4 categorías: OF.1A, OF.2A, OF.3A, ADM.A
   - Todos los conceptos salariales del CCT 637/11 listados en la sección 4.6 del spec (básico, antigüedad, presentismo, bono paz, adicional torre, horas extra 50%, horas extra 100%, horas viaje, desarraigo, manejo, vianda, desayuno, vaca muerta, jubilación 11%, PAMI 3%, OS 3%, sindical 2.65%, mutual 3.97%)
   - 6 diagramas: Lun-Vier, 7×7, 10×5, 14×14, 8×6, 21×7 (según sección 8.2)
   - 1 flujo de aprobación estándar para planillas con 2 pasos (Coordinador → RRHH)
   - 1 flujo para vacaciones con 2 pasos (Coordinador → RRHH)
   - Config de empresa con valores default
   - Config de vacaciones con reglas CCT (0-1 año: 14 días, 1-5 años: 14 días, 5-10 años: 21 días, 10-20 años: 28 días, 20+ años: 35 días)
   - Feriados Argentina 2025-2026 del Apéndice A
   - 6 usuarios de prueba (uno por rol):
     ```
     admin@demo.com       / Admin1234!   → ADMIN
     rrhh@demo.com        / Admin1234!   → RRHH
     gerente@demo.com     / Admin1234!   → GERENTE
     coordinador@demo.com / Admin1234!   → COORDINADOR — sector: Well Testing
     supervisor@demo.com  / Admin1234!   → SUPERVISOR   — sector: Well Testing
     operador@demo.com    / Admin1234!   → OPERADOR     — sector: Well Testing, diagrama: 7×7
     ```
   - Asignar al operador el diagrama 7×7 con fecha_inicio = primer día del mes actual
   - Asignar `coordinador@demo.com` como coordinador del supervisor y del operador
7. Ejecutar `npx prisma db seed` y verificar que todos los datos quedaron cargados

### TAREA 3 — API base con autenticación

Implementar los siguientes archivos en `apps/api/src/`:

1. `app.ts` — Express app con middlewares: cors, json, helmet, morgan, rate limiter
2. `middleware/auth.middleware.ts` — verificar JWT del header Authorization
3. `middleware/roles.middleware.ts` — función `requireRole(...roles)`
4. `middleware/empresa.middleware.ts` — asegurar que el recurso pertenece a la empresa del usuario
5. `utils/jwt.utils.ts` — funciones `signAccessToken`, `signRefreshToken`, `verifyToken`
6. `routes/auth.routes.ts` — implementar estos 4 endpoints completamente funcionales:
   - `POST /api/v1/auth/login` → valida email+password, devuelve accessToken en body y refreshToken en cookie httpOnly
   - `POST /api/v1/auth/refresh` → lee cookie, rota el refresh token, devuelve nuevo accessToken
   - `POST /api/v1/auth/logout` → invalida el refresh token en Redis
   - `GET /api/v1/auth/me` → devuelve datos del usuario autenticado
   - `POST /api/v1/auth/change-password` → cambia contraseña y pone `primer_login = false`
7. `routes/index.ts` — registrar todas las rutas bajo `/api/v1`
8. Verificar con curl o Postman que el login funciona y devuelve el token

### TAREA 4 — Setup del frontend (React + Vite)

1. Crear `apps/web` con `npm create vite@latest . -- --template react-ts`
2. Instalar todas las dependencias del stack frontend listadas en la sección 2 del spec
3. Configurar Tailwind CSS y shadcn/ui con `npx shadcn@latest init`
4. Instalar los componentes shadcn necesarios: `button input label card form toast badge separator skeleton dialog sheet`
5. Configurar el cliente de React Query en `main.tsx`
6. Configurar Zustand store de auth en `src/stores/authStore.ts`:
   - Estado: `{ user, accessToken, isAuthenticated }`
   - Acciones: `setAuth`, `clearAuth`
   - El accessToken se guarda **en memoria** (NO en localStorage)
7. Configurar axios en `src/services/api.ts`:
   - Base URL: `http://localhost:4000/api/v1`
   - Interceptor de request: agrega `Authorization: Bearer {accessToken}` del store
   - Interceptor de response: si recibe 401, llama al endpoint de refresh automáticamente y reintenta
   - `withCredentials: true` para enviar la cookie del refresh token
8. Implementar `src/pages/auth/LoginPage.tsx` con:
   - Formulario con email y password
   - Validación con React Hook Form + Zod
   - Al hacer login exitoso → guardar en authStore y redirigir a `/dashboard`
   - Si `primer_login = true` → redirigir a `/cambiar-password`
   - Manejo de errores con toast
9. Implementar `src/pages/auth/ChangePasswordPage.tsx` con:
   - Formulario de nueva contraseña con confirmación
   - Mínimo 8 caracteres, al menos 1 mayúscula y 1 número
   - Al completar → redirigir a `/dashboard`
10. Implementar `src/components/layout/AppShell.tsx` con sidebar básico:
    - Logo y nombre de la empresa
    - Links de navegación según rol del usuario autenticado
    - Botón de logout
    - Badge con notificaciones no leídas (hardcodeado en 0 por ahora)
11. Implementar `src/pages/dashboard/DashboardPage.tsx` con:
    - Saludo con nombre del usuario
    - 4 tarjetas básicas (vacías por ahora): Planilla actual, Horas del período, Vacaciones disponibles, Próximas novedades
    - Las tarjetas deben mostrar un skeleton loader mientras cargan
12. Configurar `react-router-dom` con estas rutas:
    - `/login` → LoginPage (pública)
    - `/cambiar-password` → ChangePasswordPage (requiere estar autenticado con primer_login=true)
    - `/dashboard` → DashboardPage (requiere auth)
    - Ruta catch-all → redirect a `/dashboard` si autenticado, `/login` si no

### TAREA 5 — Docker Compose completo para desarrollo

1. Actualizar `docker-compose.yml` para incluir también los servicios `api` y `web` con hot reload:
   - `api`: montar `./apps/api/src` como volumen, usar `ts-node-dev` o `tsx watch` para hot reload
   - `web`: montar `./apps/web/src` como volumen, Vite ya tiene HMR nativo
2. Agregar un `Makefile` o script `start.sh` en la raíz que:
   - Levante todos los contenedores con `docker compose up -d`
   - Ejecute las migraciones
   - Ejecute los seeds
   - Muestre los logs de api y web
3. Verificar que abriendo `http://localhost:3000` aparece el login
4. Verificar que con `admin@demo.com` / `Admin1234!` se puede ingresar y ver el dashboard

### TAREA 6 — Verificación final

Al terminar la Fase 1, el sistema debe pasar estas verificaciones:

```bash
# 1. Todos los contenedores corriendo
docker compose ps
# Debe mostrar: db, redis, api, web — todos "Up"

# 2. Base de datos con tablas
docker compose exec db psql -U planilla_user -d planilla_horas -c "\dt"
# Debe mostrar todas las tablas del schema

# 3. Seeds cargados
docker compose exec db psql -U planilla_user -d planilla_horas -c "SELECT email, rol FROM usuarios;"
# Debe mostrar los 6 usuarios de prueba

# 4. API respondiendo
curl http://localhost:4000/api/v1/auth/login \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com","password":"Admin1234!"}'
# Debe devolver { accessToken: "..." }

# 5. Frontend cargando
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
# Debe devolver 200
```

---

## REGLAS QUE DEBÉS SEGUIR SIEMPRE

1. **Leer el spec antes de codear.** Ante cualquier duda sobre nombres, tipos o comportamiento, la respuesta está en los archivos `.md`.

2. **Nunca hardcodear la empresa_id.** Siempre tomarla del usuario autenticado.

3. **Toda ruta protegida requiere JWT.** Sin excepciones salvo `/auth/login` y `/auth/refresh`.

4. **Passwords siempre con bcrypt factor 12.** Nunca guardar en texto plano.

5. **El accessToken va en memoria del cliente, nunca en localStorage.** El refreshToken va en cookie httpOnly.

6. **Usar exactamente los nombres de tablas y campos del schema del spec.** No renombrar, no "mejorar" los nombres.

7. **TypeScript estricto.** Sin `any`, sin `as unknown`, sin `@ts-ignore`.

8. **Validar todos los request bodies con Zod** antes de procesarlos en el backend.

9. **Commits atómicos.** Un commit por tarea completada con mensaje descriptivo.

10. **Si algo no está claro en el spec, preguntar antes de inventar.** No asumir.

---

## DESPUÉS DE LA FASE 1

Una vez que la Fase 1 esté funcionando, continuar con las siguientes fases en este orden:

- **Fase 2:** CRUD de sectores, usuarios y ficha completa de empleado, gestión de convenios y conceptos salariales
- **Fase 3:** Calendario de período, registro de horas con toda la lógica automática, motor de cálculo salarial
- **Fase 4:** Flujos de aprobación configurables, máquina de estados de planillas
- **Fase 5:** Socket.io + notificaciones real-time
- **Fase 6:** Vacaciones con acumulación automática (cron)
- **Fase 7:** Ausencias con upload de archivos
- **Fase 8:** Analytics y dashboards con Recharts
- **Fase 9:** Exportación Excel avanzada (spec en Addendum v2.1)
- **Fase 10:** PWA completa (Service Worker, manifest, offline, push notifications)

---

## ARCHIVOS DE REFERENCIA

- `PLANILLA_HORAS_SPEC.md` → Especificación principal (secciones 1-23)
- `PLANILLA_HORAS_ADDENDUM_v2.1.md` → Exportación Excel y funcionalidades adicionales

Ante cualquier duda técnica sobre el dominio del negocio (CCT, períodos, cálculo de horas), la respuesta está en la sección 11 del spec principal.

---

*Este prompt está pensado para ser dado al inicio de cada sesión de desarrollo. En sesiones posteriores, podés reemplazar "OBJETIVO DE ESTA SESIÓN" por la fase correspondiente.*
