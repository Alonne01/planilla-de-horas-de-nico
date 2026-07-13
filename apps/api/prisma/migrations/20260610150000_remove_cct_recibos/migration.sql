-- DropForeignKey
ALTER TABLE "categorias" DROP CONSTRAINT "categorias_convenio_id_fkey";

-- DropForeignKey
ALTER TABLE "conceptos_salariales" DROP CONSTRAINT "conceptos_salariales_convenio_id_fkey";

-- DropForeignKey
ALTER TABLE "conceptos_valores" DROP CONSTRAINT "conceptos_valores_categoria_id_fkey";

-- DropForeignKey
ALTER TABLE "conceptos_valores" DROP CONSTRAINT "conceptos_valores_concepto_id_fkey";

-- DropForeignKey
ALTER TABLE "convenios" DROP CONSTRAINT "convenios_empresa_id_fkey";

-- DropForeignKey
ALTER TABLE "recibos_sueldo" DROP CONSTRAINT "recibos_sueldo_planilla_id_fkey";

-- DropForeignKey
ALTER TABLE "recibos_sueldo" DROP CONSTRAINT "recibos_sueldo_usuario_id_fkey";

-- DropForeignKey
ALTER TABLE "usuarios" DROP CONSTRAINT "usuarios_categoria_id_fkey";

-- DropForeignKey
ALTER TABLE "usuarios" DROP CONSTRAINT "usuarios_convenio_id_fkey";

-- AlterTable
ALTER TABLE "usuarios" DROP COLUMN "categoria_id",
DROP COLUMN "convenio_id",
DROP COLUMN "sueldo_basico_override";

-- DropTable
DROP TABLE "categorias";

-- DropTable
DROP TABLE "conceptos_salariales";

-- DropTable
DROP TABLE "conceptos_valores";

-- DropTable
DROP TABLE "convenios";

-- DropTable
DROP TABLE "recibos_sueldo";

-- DropEnum
DROP TYPE "CctTipo";

-- DropEnum
DROP TYPE "ConceptoTipo";

