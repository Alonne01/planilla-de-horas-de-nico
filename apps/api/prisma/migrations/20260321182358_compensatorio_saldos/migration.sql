-- AlterTable
ALTER TABLE "vacacion_saldos" ADD COLUMN     "compensatorios_acumulados" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "compensatorios_pendientes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "compensatorios_usados" INTEGER NOT NULL DEFAULT 0;
