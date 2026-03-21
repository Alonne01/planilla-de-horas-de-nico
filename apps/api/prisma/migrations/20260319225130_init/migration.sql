-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('OPERADOR', 'SUPERVISOR', 'COORDINADOR', 'GERENTE', 'RRHH', 'ADMIN');

-- CreateEnum
CREATE TYPE "PlanillaEstado" AS ENUM ('BORRADOR', 'ENVIADA', 'EN_REVISION', 'APROBADA', 'RECHAZADA', 'CERRADA');

-- CreateEnum
CREATE TYPE "VacacionEstado" AS ENUM ('BORRADOR', 'PENDIENTE', 'EN_REVISION', 'APROBADA', 'RECHAZADA');

-- CreateEnum
CREATE TYPE "AusenciaTipo" AS ENUM ('CERTIFICADO_MEDICO', 'FALTA_JUSTIFICADA', 'FALTA_INJUSTIFICADA', 'LICENCIA_ESPECIAL');

-- CreateEnum
CREATE TYPE "LugarTrabajo" AS ENUM ('BASE', 'CAMPO', 'FRANCO');

-- CreateEnum
CREATE TYPE "PernocteEnum" AS ENUM ('NO', 'HOTEL', 'TRAILER');

-- CreateEnum
CREATE TYPE "DiagramaTipo" AS ENUM ('ROTATIVO', 'FIJO_SEMANA');

-- CreateEnum
CREATE TYPE "ContratoTipo" AS ENUM ('PRUEBA', 'INDEFINIDO', 'PLAZO_FIJO', 'EVENTUAL');

-- CreateEnum
CREATE TYPE "CctTipo" AS ENUM ('PETROLEROS_PRIVADOS_637', 'JERARQUICOS_592', 'PERSONALIZADO');

-- CreateEnum
CREATE TYPE "ConceptoTipo" AS ENUM ('REMUNERATIVO_FIJO', 'REMUNERATIVO_VARIABLE', 'NO_REMUNERATIVO', 'RETENCION', 'DESCUENTO');

-- CreateTable
CREATE TABLE "empresas" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cuit" TEXT,
    "direccion" TEXT,
    "logo_url" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sectores" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "color" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sectores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "convenios" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "CctTipo" NOT NULL,
    "vigente_desde" TIMESTAMP(3) NOT NULL,
    "vigente_hasta" TIMESTAMP(3),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "convenios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias" (
    "id" TEXT NOT NULL,
    "convenio_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conceptos_salariales" (
    "id" TEXT NOT NULL,
    "convenio_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "ConceptoTipo" NOT NULL,
    "descripcion" TEXT,
    "es_porcentual" BOOLEAN NOT NULL DEFAULT false,
    "porcentaje_base" DECIMAL(6,4),
    "monto_fijo" DECIMAL(12,2),
    "base_calculo" TEXT,
    "aplica_siempre" BOOLEAN NOT NULL DEFAULT true,
    "condicion_formula" TEXT,
    "es_remunerativo" BOOLEAN NOT NULL DEFAULT true,
    "visible_empleado" BOOLEAN NOT NULL DEFAULT true,
    "editable_rrhh" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conceptos_salariales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conceptos_valores" (
    "id" TEXT NOT NULL,
    "concepto_id" TEXT NOT NULL,
    "categoria_id" TEXT,
    "vigente_desde" TIMESTAMP(3) NOT NULL,
    "vigente_hasta" TIMESTAMP(3),
    "monto" DECIMAL(12,2),
    "porcentaje" DECIMAL(6,4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conceptos_valores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagramas" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "DiagramaTipo" NOT NULL,
    "dias_trabajo" INTEGER,
    "dias_descanso" INTEGER,
    "dias_semana" INTEGER[],
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagramas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios_diagramas" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "diagrama_id" TEXT NOT NULL,
    "fecha_inicio" TIMESTAMP(3) NOT NULL,
    "fecha_fin" TIMESTAMP(3),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_diagramas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flujos_aprobacion" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo_documento" TEXT NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flujos_aprobacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flujos_pasos" (
    "id" TEXT NOT NULL,
    "flujo_id" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "nombre_paso" TEXT NOT NULL,
    "rol_aprobador" "Rol" NOT NULL,
    "usuario_especifico_id" TEXT,
    "accion_aprobar" TEXT NOT NULL DEFAULT 'APROBAR',
    "accion_rechazar" TEXT NOT NULL DEFAULT 'RECHAZAR',
    "requiere_comentario_rechazo" BOOLEAN NOT NULL DEFAULT true,
    "notificar_roles" "Rol"[],
    "tiempo_limite_horas" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flujos_pasos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flujos_asignaciones" (
    "id" TEXT NOT NULL,
    "flujo_id" TEXT NOT NULL,
    "tipo_documento" TEXT NOT NULL,
    "sector_id" TEXT,
    "usuario_id" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "flujos_asignaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "sector_id" TEXT,
    "categoria_id" TEXT,
    "convenio_id" TEXT,
    "nombre" TEXT NOT NULL,
    "apellido" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "legajo" TEXT,
    "dni" TEXT,
    "cuil" TEXT,
    "fecha_nacimiento" TIMESTAMP(3),
    "telefono" TEXT,
    "avatar_url" TEXT,
    "rol" "Rol" NOT NULL DEFAULT 'OPERADOR',
    "tipo_contrato" "ContratoTipo" NOT NULL DEFAULT 'INDEFINIDO',
    "fecha_ingreso" TIMESTAMP(3) NOT NULL,
    "fecha_fin_prueba" TIMESTAMP(3),
    "fecha_egreso" TIMESTAMP(3),
    "coordinador_id" TEXT,
    "supervisor_id" TEXT,
    "dias_vacaciones_saldo" INTEGER NOT NULL DEFAULT 0,
    "dias_vacaciones_usados" INTEGER NOT NULL DEFAULT 0,
    "sueldo_basico_override" DECIMAL(12,2),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "primer_login" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planillas" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "flujo_id" TEXT,
    "periodo_inicio" TIMESTAMP(3) NOT NULL,
    "periodo_fin" TIMESTAMP(3) NOT NULL,
    "estado" "PlanillaEstado" NOT NULL DEFAULT 'BORRADOR',
    "paso_actual" INTEGER NOT NULL DEFAULT 0,
    "obs_rechazo" TEXT,
    "aprobada_por_id" TEXT,
    "enviada_at" TIMESTAMP(3),
    "aprobada_at" TIMESTAMP(3),
    "cerrada_at" TIMESTAMP(3),
    "snapshot_calculo" JSONB,
    "total_horas_normales" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "total_horas_extra_50" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "total_horas_extra_100" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "total_horas_viaje" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "total_dias_campo" INTEGER NOT NULL DEFAULT 0,
    "total_dias_base" INTEGER NOT NULL DEFAULT 0,
    "neto_estimado" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planillas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planillas_historial" (
    "id" TEXT NOT NULL,
    "planilla_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "estado_anterior" "PlanillaEstado",
    "estado_nuevo" "PlanillaEstado" NOT NULL,
    "paso_flujo" INTEGER,
    "comentario" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planillas_historial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registros_horas" (
    "id" TEXT NOT NULL,
    "planilla_id" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "entrada_turno1" TIMESTAMP(3),
    "salida_turno1" TIMESTAMP(3),
    "entrada_turno2" TIMESTAMP(3),
    "salida_turno2" TIMESTAMP(3),
    "cruza_medianoche" BOOLEAN NOT NULL DEFAULT false,
    "lugar_trabajo" "LugarTrabajo",
    "pernocte" "PernocteEnum" NOT NULL DEFAULT 'NO',
    "maneja" BOOLEAN NOT NULL DEFAULT false,
    "horas_viaje_input" DECIMAL(4,2) NOT NULL DEFAULT 2,
    "es_feriado" BOOLEAN NOT NULL DEFAULT false,
    "es_franco_compensatorio" BOOLEAN NOT NULL DEFAULT false,
    "es_franco_trabajado" BOOLEAN NOT NULL DEFAULT false,
    "horas_trabajadas" DECIMAL(5,2),
    "horas_normales" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "horas_extra_50" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "horas_extra_100" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "horas_viaje_calc" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "observaciones" TEXT,
    "proyecto_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registros_horas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vacaciones" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "flujo_id" TEXT,
    "fecha_inicio" TIMESTAMP(3) NOT NULL,
    "fecha_fin" TIMESTAMP(3) NOT NULL,
    "dias_habiles" INTEGER NOT NULL,
    "dias_totales" INTEGER NOT NULL,
    "estado" "VacacionEstado" NOT NULL DEFAULT 'BORRADOR',
    "paso_actual" INTEGER NOT NULL DEFAULT 0,
    "motivo" TEXT,
    "obs_rechazo" TEXT,
    "aprobada_por_id" TEXT,
    "aprobada_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vacaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vacaciones_historial" (
    "id" TEXT NOT NULL,
    "vacacion_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "estado_anterior" "VacacionEstado",
    "estado_nuevo" "VacacionEstado" NOT NULL,
    "paso_flujo" INTEGER,
    "comentario" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vacaciones_historial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vacaciones_config" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "reglas_antiguedad" JSONB NOT NULL DEFAULT '[]',
    "acumulacion_activa" BOOLEAN NOT NULL DEFAULT true,
    "acumulacion_dia_del_mes" INTEGER NOT NULL DEFAULT 1,
    "acumulacion_frecuencia" TEXT NOT NULL DEFAULT 'MENSUAL',
    "acumulacion_monto_mensual" DECIMAL(5,2),
    "vencimiento_activo" BOOLEAN NOT NULL DEFAULT false,
    "vencimiento_meses" INTEGER NOT NULL DEFAULT 12,
    "bloquear_en_prueba" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vacaciones_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ausencias" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "planilla_id" TEXT,
    "tipo" "AusenciaTipo" NOT NULL,
    "fecha_inicio" TIMESTAMP(3) NOT NULL,
    "fecha_fin" TIMESTAMP(3) NOT NULL,
    "dias_ausencia" INTEGER NOT NULL,
    "descripcion" TEXT,
    "numero_certificado" TEXT,
    "archivo_url" TEXT,
    "descuenta_sueldo" BOOLEAN NOT NULL DEFAULT false,
    "porcentaje_descuento" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "requiere_aprobacion" BOOLEAN NOT NULL DEFAULT false,
    "aprobada" BOOLEAN NOT NULL DEFAULT true,
    "aprobada_por_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ausencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificaciones" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "cuerpo" TEXT,
    "link" TEXT,
    "leida" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empresa_config" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "periodo_dia_inicio" INTEGER NOT NULL DEFAULT 21,
    "periodo_dia_fin" INTEGER NOT NULL DEFAULT 20,
    "max_horas_diarias" INTEGER NOT NULL DEFAULT 16,
    "horas_jornada_normal" INTEGER NOT NULL DEFAULT 8,
    "umbral_extra_50" INTEGER NOT NULL DEFAULT 8,
    "umbral_extra_100" INTEGER NOT NULL DEFAULT 12,
    "redondeo_minutos" INTEGER NOT NULL DEFAULT 15,
    "descuento_almuerzo_base" BOOLEAN NOT NULL DEFAULT true,
    "descuento_almuerzo_campo" BOOLEAN NOT NULL DEFAULT false,
    "feriados_personalizados" JSONB NOT NULL DEFAULT '[]',
    "modulo_vacaciones_activo" BOOLEAN NOT NULL DEFAULT true,
    "modulo_ausencias_activo" BOOLEAN NOT NULL DEFAULT true,
    "modulo_analytics_activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "empresa_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exportaciones" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "generada_por_id" TEXT NOT NULL,
    "periodo_inicio" TIMESTAMP(3) NOT NULL,
    "periodo_fin" TIMESTAMP(3) NOT NULL,
    "sectores_ids" TEXT[],
    "usuarios_ids" TEXT[],
    "roles_filtro" TEXT[],
    "hojas_incluidas" TEXT[],
    "incluye_salarial" BOOLEAN NOT NULL DEFAULT false,
    "estado_planillas" TEXT[],
    "nombre_archivo" TEXT NOT NULL,
    "tamanio_bytes" INTEGER,
    "archivo_url" TEXT,
    "total_personas" INTEGER,
    "total_registros" INTEGER,
    "creado_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exportaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exportaciones_plantillas" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "creada_por_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "configuracion" JSONB NOT NULL,
    "es_publica" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exportaciones_plantillas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proyectos" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cliente" TEXT,
    "descripcion" TEXT,
    "fecha_inicio" TIMESTAMP(3),
    "fecha_fin" TIMESTAMP(3),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proyectos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recibos_sueldo" (
    "id" TEXT NOT NULL,
    "planilla_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "pdf_url" TEXT,
    "firmado_empleado_at" TIMESTAMP(3),
    "ip_firma" TEXT,
    "user_agent_firma" TEXT,
    "hash_contenido" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recibos_sueldo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipos_capacitacion" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "vigencia_dias" INTEGER,
    "es_obligatoria" BOOLEAN NOT NULL DEFAULT false,
    "alerta_dias" INTEGER NOT NULL DEFAULT 30,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tipos_capacitacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empleado_capacitaciones" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "tipo_id" TEXT NOT NULL,
    "fecha_realizacion" TIMESTAMP(3) NOT NULL,
    "fecha_vencimiento" TIMESTAMP(3),
    "institucion" TEXT,
    "archivo_url" TEXT,
    "observaciones" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "empleado_capacitaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alertas_config" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "dias_anticipacion" INTEGER,
    "horas_limite" INTEGER,
    "roles_destino" TEXT[],
    "descripcion" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alertas_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "registros_horas_planilla_id_fecha_key" ON "registros_horas"("planilla_id", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "vacaciones_config_empresa_id_key" ON "vacaciones_config"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "empresa_config_empresa_id_key" ON "empresa_config"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "recibos_sueldo_planilla_id_key" ON "recibos_sueldo"("planilla_id");

-- AddForeignKey
ALTER TABLE "sectores" ADD CONSTRAINT "sectores_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convenios" ADD CONSTRAINT "convenios_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_convenio_id_fkey" FOREIGN KEY ("convenio_id") REFERENCES "convenios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conceptos_salariales" ADD CONSTRAINT "conceptos_salariales_convenio_id_fkey" FOREIGN KEY ("convenio_id") REFERENCES "convenios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conceptos_valores" ADD CONSTRAINT "conceptos_valores_concepto_id_fkey" FOREIGN KEY ("concepto_id") REFERENCES "conceptos_salariales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conceptos_valores" ADD CONSTRAINT "conceptos_valores_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagramas" ADD CONSTRAINT "diagramas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios_diagramas" ADD CONSTRAINT "usuarios_diagramas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios_diagramas" ADD CONSTRAINT "usuarios_diagramas_diagrama_id_fkey" FOREIGN KEY ("diagrama_id") REFERENCES "diagramas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flujos_aprobacion" ADD CONSTRAINT "flujos_aprobacion_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flujos_pasos" ADD CONSTRAINT "flujos_pasos_flujo_id_fkey" FOREIGN KEY ("flujo_id") REFERENCES "flujos_aprobacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flujos_pasos" ADD CONSTRAINT "flujos_pasos_usuario_especifico_id_fkey" FOREIGN KEY ("usuario_especifico_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flujos_asignaciones" ADD CONSTRAINT "flujos_asignaciones_flujo_id_fkey" FOREIGN KEY ("flujo_id") REFERENCES "flujos_aprobacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flujos_asignaciones" ADD CONSTRAINT "flujos_asignaciones_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flujos_asignaciones" ADD CONSTRAINT "flujos_asignaciones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_convenio_id_fkey" FOREIGN KEY ("convenio_id") REFERENCES "convenios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_coordinador_id_fkey" FOREIGN KEY ("coordinador_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planillas" ADD CONSTRAINT "planillas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planillas" ADD CONSTRAINT "planillas_aprobada_por_id_fkey" FOREIGN KEY ("aprobada_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planillas" ADD CONSTRAINT "planillas_flujo_id_fkey" FOREIGN KEY ("flujo_id") REFERENCES "flujos_aprobacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planillas_historial" ADD CONSTRAINT "planillas_historial_planilla_id_fkey" FOREIGN KEY ("planilla_id") REFERENCES "planillas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planillas_historial" ADD CONSTRAINT "planillas_historial_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_horas" ADD CONSTRAINT "registros_horas_planilla_id_fkey" FOREIGN KEY ("planilla_id") REFERENCES "planillas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_horas" ADD CONSTRAINT "registros_horas_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "proyectos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacaciones" ADD CONSTRAINT "vacaciones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacaciones" ADD CONSTRAINT "vacaciones_aprobada_por_id_fkey" FOREIGN KEY ("aprobada_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacaciones" ADD CONSTRAINT "vacaciones_flujo_id_fkey" FOREIGN KEY ("flujo_id") REFERENCES "flujos_aprobacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacaciones_historial" ADD CONSTRAINT "vacaciones_historial_vacacion_id_fkey" FOREIGN KEY ("vacacion_id") REFERENCES "vacaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacaciones_historial" ADD CONSTRAINT "vacaciones_historial_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacaciones_config" ADD CONSTRAINT "vacaciones_config_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ausencias" ADD CONSTRAINT "ausencias_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ausencias" ADD CONSTRAINT "ausencias_aprobada_por_id_fkey" FOREIGN KEY ("aprobada_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empresa_config" ADD CONSTRAINT "empresa_config_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exportaciones" ADD CONSTRAINT "exportaciones_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exportaciones" ADD CONSTRAINT "exportaciones_generada_por_id_fkey" FOREIGN KEY ("generada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exportaciones_plantillas" ADD CONSTRAINT "exportaciones_plantillas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exportaciones_plantillas" ADD CONSTRAINT "exportaciones_plantillas_creada_por_id_fkey" FOREIGN KEY ("creada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recibos_sueldo" ADD CONSTRAINT "recibos_sueldo_planilla_id_fkey" FOREIGN KEY ("planilla_id") REFERENCES "planillas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recibos_sueldo" ADD CONSTRAINT "recibos_sueldo_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tipos_capacitacion" ADD CONSTRAINT "tipos_capacitacion_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empleado_capacitaciones" ADD CONSTRAINT "empleado_capacitaciones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empleado_capacitaciones" ADD CONSTRAINT "empleado_capacitaciones_tipo_id_fkey" FOREIGN KEY ("tipo_id") REFERENCES "tipos_capacitacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alertas_config" ADD CONSTRAINT "alertas_config_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
