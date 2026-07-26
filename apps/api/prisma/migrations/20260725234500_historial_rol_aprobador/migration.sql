-- El historial pasa a guardar el paso que se FIRMÓ (no el destino) y con qué rol.
-- No se toca ninguna fila existente a propósito: las viejas quedan con
-- rol_aprobador NULL, y ese NULL es justamente lo que le permite a la
-- reconstrucción saber que ahí `paso_flujo` significa "destino" y no "firmado".

-- AlterTable
ALTER TABLE "ausencias_historial" ADD COLUMN     "rol_aprobador" TEXT;

-- AlterTable
ALTER TABLE "cambios_diagrama_historial" ADD COLUMN     "rol_aprobador" TEXT;

-- AlterTable
ALTER TABLE "planillas_historial" ADD COLUMN     "rol_aprobador" TEXT;

-- AlterTable
ALTER TABLE "vacaciones_historial" ADD COLUMN     "rol_aprobador" TEXT;
