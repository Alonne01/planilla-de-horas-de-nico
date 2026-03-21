-- CreateEnum
CREATE TYPE "AusenciaEstado" AS ENUM ('BORRADOR', 'PENDIENTE', 'EN_REVISION', 'APROBADA', 'RECHAZADA');

-- AlterTable
ALTER TABLE "ausencias" ADD COLUMN     "aprobada_at" TIMESTAMP(3),
ADD COLUMN     "cargada_por_id" TEXT,
ADD COLUMN     "estado" "AusenciaEstado" NOT NULL DEFAULT 'BORRADOR',
ADD COLUMN     "flujo_id" TEXT,
ADD COLUMN     "obs_rechazo" TEXT,
ADD COLUMN     "paso_actual" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "registros_horas" ADD COLUMN     "bloqueado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "motivo_bloqueo" TEXT;

-- CreateTable
CREATE TABLE "ausencias_historial" (
    "id" TEXT NOT NULL,
    "ausencia_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "estado_anterior" "AusenciaEstado",
    "estado_nuevo" "AusenciaEstado" NOT NULL,
    "paso_flujo" INTEGER,
    "comentario" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ausencias_historial_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ausencias" ADD CONSTRAINT "ausencias_cargada_por_id_fkey" FOREIGN KEY ("cargada_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ausencias" ADD CONSTRAINT "ausencias_flujo_id_fkey" FOREIGN KEY ("flujo_id") REFERENCES "flujos_aprobacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ausencias_historial" ADD CONSTRAINT "ausencias_historial_ausencia_id_fkey" FOREIGN KEY ("ausencia_id") REFERENCES "ausencias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ausencias_historial" ADD CONSTRAINT "ausencias_historial_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
