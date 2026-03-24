-- CreateEnum
CREATE TYPE "CambioDiagramaEstado" AS ENUM ('PENDIENTE', 'EN_REVISION', 'APROBADA', 'RECHAZADA');

-- CreateTable
CREATE TABLE "solicitudes_cambio_diagrama" (
    "id" TEXT NOT NULL,
    "solicitante_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "diagrama_actual_id" TEXT,
    "diagrama_nuevo_id" TEXT NOT NULL,
    "flujo_id" TEXT,
    "estado" "CambioDiagramaEstado" NOT NULL DEFAULT 'PENDIENTE',
    "paso_actual" INTEGER NOT NULL DEFAULT 1,
    "motivo" TEXT,
    "obs_rechazo" TEXT,
    "aprobada_por_id" TEXT,
    "aprobada_at" TIMESTAMP(3),
    "fecha_efectiva" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solicitudes_cambio_diagrama_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cambios_diagrama_historial" (
    "id" TEXT NOT NULL,
    "solicitud_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "estado_anterior" "CambioDiagramaEstado",
    "estado_nuevo" "CambioDiagramaEstado" NOT NULL,
    "paso_flujo" INTEGER,
    "comentario" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cambios_diagrama_historial_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "solicitudes_cambio_diagrama" ADD CONSTRAINT "solicitudes_cambio_diagrama_solicitante_id_fkey" FOREIGN KEY ("solicitante_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_cambio_diagrama" ADD CONSTRAINT "solicitudes_cambio_diagrama_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_cambio_diagrama" ADD CONSTRAINT "solicitudes_cambio_diagrama_diagrama_actual_id_fkey" FOREIGN KEY ("diagrama_actual_id") REFERENCES "diagramas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_cambio_diagrama" ADD CONSTRAINT "solicitudes_cambio_diagrama_diagrama_nuevo_id_fkey" FOREIGN KEY ("diagrama_nuevo_id") REFERENCES "diagramas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_cambio_diagrama" ADD CONSTRAINT "solicitudes_cambio_diagrama_flujo_id_fkey" FOREIGN KEY ("flujo_id") REFERENCES "flujos_aprobacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_cambio_diagrama" ADD CONSTRAINT "solicitudes_cambio_diagrama_aprobada_por_id_fkey" FOREIGN KEY ("aprobada_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cambios_diagrama_historial" ADD CONSTRAINT "cambios_diagrama_historial_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes_cambio_diagrama"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cambios_diagrama_historial" ADD CONSTRAINT "cambios_diagrama_historial_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
