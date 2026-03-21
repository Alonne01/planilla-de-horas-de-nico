/*
  Warnings:

  - The values [PETROLEROS_PRIVADOS_637,JERARQUICOS_592] on the enum `CctTipo` will be removed. If these variants are still used in the database, this will fail.
  - The `notificar_roles` column on the `flujos_pasos` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `rol` column on the `usuarios` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `rol_aprobador` on the `flujos_pasos` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "CctTipo_new" AS ENUM ('PETROLEROS_PRIVADOS_644', 'PETROLEROS_JERARQUICOS_637', 'PERSONALIZADO');
ALTER TABLE "convenios" ALTER COLUMN "tipo" TYPE "CctTipo_new" USING ("tipo"::text::"CctTipo_new");
ALTER TYPE "CctTipo" RENAME TO "CctTipo_old";
ALTER TYPE "CctTipo_new" RENAME TO "CctTipo";
DROP TYPE "CctTipo_old";
COMMIT;

-- AlterTable
ALTER TABLE "flujos_pasos" DROP COLUMN "rol_aprobador",
ADD COLUMN     "rol_aprobador" TEXT NOT NULL,
DROP COLUMN "notificar_roles",
ADD COLUMN     "notificar_roles" TEXT[];

-- AlterTable
ALTER TABLE "usuarios" DROP COLUMN "rol",
ADD COLUMN     "rol" TEXT NOT NULL DEFAULT 'OPERADOR';

-- DropEnum
DROP TYPE "Rol";

-- CreateTable
CREATE TABLE "roles_config" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "color" TEXT,
    "nivel" INTEGER NOT NULL DEFAULT 0,
    "es_sistema" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_config_empresa_id_codigo_key" ON "roles_config"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

-- AddForeignKey
ALTER TABLE "roles_config" ADD CONSTRAINT "roles_config_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
