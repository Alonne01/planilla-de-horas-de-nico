-- AlterTable
ALTER TABLE "empresa_config" ADD COLUMN     "vianda_cantidad_1" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "vianda_cantidad_2" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "vianda_umbral_1" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN     "vianda_umbral_2" INTEGER NOT NULL DEFAULT 10;
