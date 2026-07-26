-- AlterEnum
ALTER TYPE "AusenciaEstado" ADD VALUE 'CANCELADA';

-- AlterEnum
ALTER TYPE "VacacionEstado" ADD VALUE 'CANCELADA';

-- AlterTable
ALTER TABLE "empresa_config" ADD COLUMN     "marca_manual_activa" BOOLEAN NOT NULL DEFAULT false;
