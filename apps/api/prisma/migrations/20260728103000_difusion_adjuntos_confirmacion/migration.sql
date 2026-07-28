-- Adjuntos múltiples, alcance del destino y confirmación explícita de recepción.
--
-- El backfill y el DROP van en la MISMA migración a propósito: partirlos deja una
-- ventana donde el mismo adjunto vive en dos lugares y cualquier escritura de esa
-- ventana se pierde. Al momento de escribir esto son 3 filas en mensajes y 3 en
-- mensaje_respuestas (sobre 19 mensajes y 6 respuestas).

CREATE TABLE "mensaje_adjuntos" (
    "id" TEXT NOT NULL,
    "mensaje_id" TEXT,
    "respuesta_id" TEXT,
    "url" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "tamanio_bytes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensaje_adjuntos_pkey" PRIMARY KEY ("id"),
    -- Un adjunto cuelga de un mensaje O de una respuesta, nunca de los dos ni de
    -- ninguno: sin esto, una fila huérfana no la ve nadie hasta que rompe un JOIN.
    CONSTRAINT "mensaje_adjuntos_uno_u_otro" CHECK (
        ("mensaje_id" IS NOT NULL AND "respuesta_id" IS NULL)
        OR ("mensaje_id" IS NULL AND "respuesta_id" IS NOT NULL)
    )
);

CREATE INDEX "mensaje_adjuntos_mensaje_id_idx" ON "mensaje_adjuntos"("mensaje_id");
CREATE INDEX "mensaje_adjuntos_respuesta_id_idx" ON "mensaje_adjuntos"("respuesta_id");

ALTER TABLE "mensaje_adjuntos" ADD CONSTRAINT "mensaje_adjuntos_mensaje_id_fkey"
    FOREIGN KEY ("mensaje_id") REFERENCES "mensajes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mensaje_adjuntos" ADD CONSTRAINT "mensaje_adjuntos_respuesta_id_fkey"
    FOREIGN KEY ("respuesta_id") REFERENCES "mensaje_respuestas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill. `tamanio_bytes` queda en 0 en lo histórico: el archivo puede ya no
-- estar en disco y no vale la pena tocar el filesystem desde una migración.
INSERT INTO "mensaje_adjuntos" ("id", "mensaje_id", "url", "nombre", "tipo", "tamanio_bytes", "created_at")
SELECT gen_random_uuid()::text, "id", "archivo_url", COALESCE("archivo_nombre", 'adjunto'),
       CASE WHEN lower("archivo_url") ~ '\.(png|jpe?g|gif|webp|bmp|heic)$' THEN 'IMAGEN' ELSE 'ARCHIVO' END,
       0, "created_at"
FROM "mensajes" WHERE "archivo_url" IS NOT NULL;

INSERT INTO "mensaje_adjuntos" ("id", "respuesta_id", "url", "nombre", "tipo", "tamanio_bytes", "created_at")
SELECT gen_random_uuid()::text, "id", "archivo_url", COALESCE("archivo_nombre", 'adjunto'),
       CASE WHEN lower("archivo_url") ~ '\.(png|jpe?g|gif|webp|bmp|heic)$' THEN 'IMAGEN' ELSE 'ARCHIVO' END,
       0, "created_at"
FROM "mensaje_respuestas" WHERE "archivo_url" IS NOT NULL;

ALTER TABLE "mensajes" DROP COLUMN "archivo_url", DROP COLUMN "archivo_nombre";
ALTER TABLE "mensaje_respuestas" DROP COLUMN "archivo_url", DROP COLUMN "archivo_nombre";

ALTER TABLE "mensajes"
    ADD COLUMN "destino_sector_id" TEXT,
    ADD COLUMN "requiere_confirmacion" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "mensaje_destinatarios" ADD COLUMN "confirmado_at" TIMESTAMP(3);
