-- AlterTable
ALTER TABLE "ausencias" ADD COLUMN     "circuito_snapshot" JSONB;

-- AlterTable
ALTER TABLE "planillas" ADD COLUMN     "circuito_snapshot" JSONB;

-- AlterTable
ALTER TABLE "solicitudes_cambio_diagrama" ADD COLUMN     "circuito_snapshot" JSONB;

-- AlterTable
ALTER TABLE "vacaciones" ADD COLUMN     "circuito_snapshot" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "flujos_asignaciones_tipo_documento_sector_id_key" ON "flujos_asignaciones"("tipo_documento", "sector_id");

-- CreateIndex
CREATE UNIQUE INDEX "flujos_pasos_flujo_id_orden_key" ON "flujos_pasos"("flujo_id", "orden");

-- Un solo flujo global por tipo: la restriccion de arriba no lo cubre porque
-- Postgres no considera iguales a dos NULL.
CREATE UNIQUE INDEX "flujos_asignaciones_global_unico"
  ON "flujos_asignaciones" ("tipo_documento")
  WHERE "sector_id" IS NULL AND "usuario_id" IS NULL;

-- Un solo flujo por usuario y tipo.
CREATE UNIQUE INDEX "flujos_asignaciones_usuario_unico"
  ON "flujos_asignaciones" ("tipo_documento", "usuario_id")
  WHERE "usuario_id" IS NOT NULL;
