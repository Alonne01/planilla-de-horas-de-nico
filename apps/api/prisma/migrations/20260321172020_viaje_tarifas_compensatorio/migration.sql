-- AlterTable
ALTER TABLE "empresa_config" ADD COLUMN     "descuento_almuerzo_minutos" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "tarifa_viaje_maneja" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tarifa_viaje_sin_manejar" DECIMAL(8,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "registros_horas" ADD COLUMN     "distancia_viaje" TEXT;
