-- CreateEnum
CREATE TYPE "WentopEstado" AS ENUM ('ABIERTA', 'EN_PROGRESO', 'CERRADA');

-- CreateEnum
CREATE TYPE "WentopTipoTarjeta" AS ENUM ('DETENCION_TAREAS', 'CONDICION_INSEGURA', 'ACTO_INSEGURO', 'CASI_ACCIDENTE', 'OBSERVACION_POSITIVA');

-- CreateTable
CREATE TABLE "wentop_tarjetas" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "creador_id" TEXT NOT NULL,
    "sector_observacion_id" TEXT,
    "sector_tercero" BOOLEAN NOT NULL DEFAULT false,
    "estado" "WentopEstado" NOT NULL DEFAULT 'ABIERTA',
    "fecha_reporte" TIMESTAMP(3) NOT NULL,
    "cliente" TEXT,
    "lugar_pozo_locacion" TEXT,
    "tipo_tarjeta" "WentopTipoTarjeta" NOT NULL,
    "calidad" JSONB DEFAULT '[]',
    "medioambiente" JSONB DEFAULT '[]',
    "seguridad_salud" JSONB DEFAULT '[]',
    "descripcion" TEXT NOT NULL,
    "acciones_inmediatas" TEXT,
    "recomendaciones" TEXT,
    "justificacion_abierta" TEXT,
    "accion_cierre" TEXT,
    "fecha_cierre" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wentop_tarjetas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wentop_fotos" (
    "id" TEXT NOT NULL,
    "tarjeta_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wentop_fotos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wentop_gestores" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "sector_id" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wentop_gestores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wentop_tarjetas_empresa_id_estado_idx" ON "wentop_tarjetas"("empresa_id", "estado");

-- CreateIndex
CREATE INDEX "wentop_tarjetas_creador_id_idx" ON "wentop_tarjetas"("creador_id");

-- CreateIndex
CREATE INDEX "wentop_tarjetas_sector_observacion_id_idx" ON "wentop_tarjetas"("sector_observacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "wentop_gestores_usuario_id_sector_id_key" ON "wentop_gestores"("usuario_id", "sector_id");

-- AddForeignKey
ALTER TABLE "wentop_tarjetas" ADD CONSTRAINT "wentop_tarjetas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wentop_tarjetas" ADD CONSTRAINT "wentop_tarjetas_creador_id_fkey" FOREIGN KEY ("creador_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wentop_tarjetas" ADD CONSTRAINT "wentop_tarjetas_sector_observacion_id_fkey" FOREIGN KEY ("sector_observacion_id") REFERENCES "sectores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wentop_fotos" ADD CONSTRAINT "wentop_fotos_tarjeta_id_fkey" FOREIGN KEY ("tarjeta_id") REFERENCES "wentop_tarjetas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wentop_gestores" ADD CONSTRAINT "wentop_gestores_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wentop_gestores" ADD CONSTRAINT "wentop_gestores_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wentop_gestores" ADD CONSTRAINT "wentop_gestores_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
