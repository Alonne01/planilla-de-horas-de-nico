-- Normaliza todas las FECHAS-DIA a medianoche del dia calendario argentino.
--
-- POR QUE ESTE SQL NO LLEVA NINGUN `AT TIME ZONE`:
-- Las 23 columnas de abajo son `timestamp WITHOUT time zone` (Prisma mapea
-- `DateTime` a `timestamp(3)`, no a `timestamptz`). Verificado contra
-- information_schema: en todo el schema no hay una sola fecha-dia en timestamptz.
--
-- Sobre un `timestamp` naive, `AT TIME ZONE` NO es un ida y vuelta neutro: es una
-- conversion real que mueve el valor. `col AT TIME ZONE 'UTC'` interpreta el naive
-- como UTC y devuelve un timestamptz, que despues se muestra/castea en la zona de
-- la SESION. Como este servidor corre con TimeZone = America/Buenos_Aires, una fila
-- YA correcta (00:00) castea a 21:00 del dia anterior: entraria al UPDATE y se
-- correria. Y una fila en 03:00 castea a 00:00, asi que quedaria sin arreglar.
-- Es decir: con `AT TIME ZONE` el script hace exactamente lo contrario de lo que
-- tiene que hacer.
--
-- Prisma escribe y lee estas columnas como reloj UTC (manda el Date en UTC y al
-- leer reinterpreta el naive como UTC), asi que la parte DIA del valor guardado ya
-- es el dia calendario argentino en las tres convenciones que convivian:
--   00:00 -> dia D (ya correcta)
--   03:00 -> medianoche AR de D, guardada como UTC -> dia D
--   15:00 -> mediodia AR de D, guardado como UTC   -> dia D
--   22:08 -> instante real (new Date()) de las 19:08 AR de D -> dia D
-- En los cuatro casos el dia buscado es la parte fecha del naive, asi que truncar
-- es la conversion correcta y no hay que tocar la zona horaria para nada.
--
-- `date_trunc('day', <timestamp>)` sobre un naive es aritmetica pura: da el mismo
-- resultado bajo cualquier TimeZone de sesion. El script es idempotente (correrlo
-- dos veces da el mismo estado) y no depende de la configuracion de la conexion.
--
-- El WHERE deja fuera las filas que ya estan en 00:00 (no las toca) y, por usar
-- IS DISTINCT FROM, tambien deja fuera los NULL de las columnas opcionales.
--
-- No se tocan los instantes reales (created_at, aprobada_at, enviada_at,
-- entrada_turno*, salida_turno*, etc.).
--
-- CONDICION QUE HAY QUE REVALIDAR ANTES DE REUSAR ESTE SCRIPT:
-- truncar es la conversion correcta solo mientras ninguna fila caiga en la
-- ventana 00:00 < hora UTC < 03:00. Un valor ahi seria un instante que en hora
-- argentina pertenece al dia ANTERIOR, y date_trunc lo correria un dia hacia
-- adelante. Se barrieron las 23 columnas buscando esa ventana antes de aplicar:
-- cero filas. Si se reusa este script sobre otra base (o mas adelante sobre
-- esta), hay que volver a correr ese barrido primero:
--   SELECT count(*) FROM <tabla> WHERE <col>::time > '00:00:00' AND <col>::time < '03:00:00';

UPDATE registros_horas SET fecha = date_trunc('day', fecha) WHERE fecha IS DISTINCT FROM date_trunc('day', fecha);

UPDATE ausencias SET fecha_inicio = date_trunc('day', fecha_inicio) WHERE fecha_inicio IS DISTINCT FROM date_trunc('day', fecha_inicio);
UPDATE ausencias SET fecha_fin = date_trunc('day', fecha_fin) WHERE fecha_fin IS DISTINCT FROM date_trunc('day', fecha_fin);

UPDATE vacaciones SET fecha_inicio = date_trunc('day', fecha_inicio) WHERE fecha_inicio IS DISTINCT FROM date_trunc('day', fecha_inicio);
UPDATE vacaciones SET fecha_fin = date_trunc('day', fecha_fin) WHERE fecha_fin IS DISTINCT FROM date_trunc('day', fecha_fin);

UPDATE planillas SET periodo_inicio = date_trunc('day', periodo_inicio) WHERE periodo_inicio IS DISTINCT FROM date_trunc('day', periodo_inicio);
UPDATE planillas SET periodo_fin = date_trunc('day', periodo_fin) WHERE periodo_fin IS DISTINCT FROM date_trunc('day', periodo_fin);

UPDATE usuarios_diagramas SET fecha_inicio = date_trunc('day', fecha_inicio) WHERE fecha_inicio IS DISTINCT FROM date_trunc('day', fecha_inicio);
UPDATE usuarios_diagramas SET fecha_fin = date_trunc('day', fecha_fin) WHERE fecha_fin IS DISTINCT FROM date_trunc('day', fecha_fin);

UPDATE usuarios SET fecha_ingreso = date_trunc('day', fecha_ingreso) WHERE fecha_ingreso IS DISTINCT FROM date_trunc('day', fecha_ingreso);
UPDATE usuarios SET fecha_nacimiento = date_trunc('day', fecha_nacimiento) WHERE fecha_nacimiento IS DISTINCT FROM date_trunc('day', fecha_nacimiento);
UPDATE usuarios SET fecha_fin_prueba = date_trunc('day', fecha_fin_prueba) WHERE fecha_fin_prueba IS DISTINCT FROM date_trunc('day', fecha_fin_prueba);
UPDATE usuarios SET fecha_egreso = date_trunc('day', fecha_egreso) WHERE fecha_egreso IS DISTINCT FROM date_trunc('day', fecha_egreso);

UPDATE exportaciones SET periodo_inicio = date_trunc('day', periodo_inicio) WHERE periodo_inicio IS DISTINCT FROM date_trunc('day', periodo_inicio);
UPDATE exportaciones SET periodo_fin = date_trunc('day', periodo_fin) WHERE periodo_fin IS DISTINCT FROM date_trunc('day', periodo_fin);

UPDATE proyectos SET fecha_inicio = date_trunc('day', fecha_inicio) WHERE fecha_inicio IS DISTINCT FROM date_trunc('day', fecha_inicio);
UPDATE proyectos SET fecha_fin = date_trunc('day', fecha_fin) WHERE fecha_fin IS DISTINCT FROM date_trunc('day', fecha_fin);

UPDATE empleado_capacitaciones SET fecha_realizacion = date_trunc('day', fecha_realizacion) WHERE fecha_realizacion IS DISTINCT FROM date_trunc('day', fecha_realizacion);
UPDATE empleado_capacitaciones SET fecha_vencimiento = date_trunc('day', fecha_vencimiento) WHERE fecha_vencimiento IS DISTINCT FROM date_trunc('day', fecha_vencimiento);

UPDATE sesiones_capacitacion SET fecha = date_trunc('day', fecha) WHERE fecha IS DISTINCT FROM date_trunc('day', fecha);

UPDATE solicitudes_cambio_diagrama SET fecha_efectiva = date_trunc('day', fecha_efectiva) WHERE fecha_efectiva IS DISTINCT FROM date_trunc('day', fecha_efectiva);

UPDATE wentop_tarjetas SET fecha_reporte = date_trunc('day', fecha_reporte) WHERE fecha_reporte IS DISTINCT FROM date_trunc('day', fecha_reporte);
UPDATE wentop_tarjetas SET fecha_cierre = date_trunc('day', fecha_cierre) WHERE fecha_cierre IS DISTINCT FROM date_trunc('day', fecha_cierre);
