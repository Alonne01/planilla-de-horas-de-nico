-- La asignacion de flujo pasa a llevar su empresa denormalizada.
--
-- Motivo: el indice unico parcial que garantiza "un solo flujo global por tipo
-- de documento" no puede mirar la empresa del flujo, porque un indice parcial
-- solo ve columnas de su propia tabla. Sin esta columna la garantia valia para
-- TODA la base, asi que una segunda empresa no habria podido tener su propio
-- flujo global y habria recibido un P2002 apuntando al flujo de otra.

ALTER TABLE "flujos_asignaciones" ADD COLUMN "empresa_id" TEXT;

UPDATE "flujos_asignaciones" a
   SET "empresa_id" = f."empresa_id"
  FROM "flujos_aprobacion" f
 WHERE f."id" = a."flujo_id";

ALTER TABLE "flujos_asignaciones" ALTER COLUMN "empresa_id" SET NOT NULL;

ALTER TABLE "flujos_asignaciones"
  ADD CONSTRAINT "flujos_asignaciones_empresa_id_fkey"
  FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- El indice global se rehace acotado por empresa.
DROP INDEX "flujos_asignaciones_global_unico";
CREATE UNIQUE INDEX "flujos_asignaciones_global_unico"
  ON "flujos_asignaciones" ("empresa_id", "tipo_documento")
  WHERE "sector_id" IS NULL AND "usuario_id" IS NULL;
