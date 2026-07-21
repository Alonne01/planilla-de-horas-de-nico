-- AlterTable
ALTER TABLE "ausencias" ADD COLUMN     "carga_manual" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "registros_horas" ADD COLUMN     "marca_manual_id" TEXT;

-- AddForeignKey
ALTER TABLE "registros_horas" ADD CONSTRAINT "registros_horas_marca_manual_id_fkey" FOREIGN KEY ("marca_manual_id") REFERENCES "ausencias"("id") ON DELETE SET NULL ON UPDATE CASCADE;
