-- =====================================================================
-- FinCard — Optimization SQL deliverable
-- Table (Redshift, 500M+ rows):
--   transactions (
--     transaction_id   VARCHAR,
--     member_id        VARCHAR,
--     partner_id       VARCHAR,
--     points_earned    INTEGER,
--     points_redeemed  INTEGER,
--     transaction_date DATE,
--     partner_name     VARCHAR,
--     processed_at     TIMESTAMP
--   )
-- =====================================================================


-- =====================================================================
-- Consulta 1 (Redshift): Liquidación mensual por aliado — últimos 12 meses
-- Columnas: partner_id, partner_name, year_month, total_earned,
--           total_redeemed, net_owed
-- Dialecto: Redshift (DATEADD, DATE_TRUNC, TO_CHAR).
-- =====================================================================
SELECT
  t.partner_id,
  t.partner_name,
  TO_CHAR(t.transaction_date, 'YYYY-MM')                AS year_month,
  SUM(t.points_earned)                                  AS total_earned,
  SUM(t.points_redeemed)                                AS total_redeemed,
  SUM(t.points_earned) - SUM(t.points_redeemed)         AS net_owed
FROM transactions t
-- Ventana móvil de 12 meses (mes actual inclusive + 11 meses previos):
-- -11, no -12, para no arrastrar un 13er mes.
WHERE t.transaction_date >= DATEADD(month, -11, DATE_TRUNC('month', CURRENT_DATE))
GROUP BY t.partner_id, t.partner_name, TO_CHAR(t.transaction_date, 'YYYY-MM')
ORDER BY t.partner_id, year_month;


-- =====================================================================
-- Consulta 2 (Athena/Parquet): misma liquidación, optimizada para Athena
-- sobre S3 + Parquet, particionado por year/month/partner_id.
-- Columnas: partner_id, partner_name, year_month, total_earned,
--           total_redeemed, net_owed
-- Dialecto: Presto/Trino (Athena). Las particiones (year, month,
-- partner_id) son claves de partición tipo STRING en el catálogo de Glue,
-- NO columnas físicas dentro de cada archivo Parquet.
-- =====================================================================
SELECT
  partner_id,
  partner_name,
  CONCAT(year, '-', month)                     AS year_month,
  SUM(points_earned)                           AS total_earned,
  SUM(points_redeemed)                         AS total_redeemed,
  SUM(points_earned) - SUM(points_redeemed)    AS net_owed
FROM fincard_loyalty.transactions_parquet
-- ---- Predicados de partition pruning: SIEMPRE filtrar por las claves de
-- ---- partición (year, month, partner_id) para que Athena descarte
-- ---- carpetas completas en S3 antes de leer un solo byte de datos.
-- ---- year/month son STRING en el catálogo de Glue; como 'YYYY-MM' ordena
-- ---- lexicográficamente igual que temporalmente, comparar concat(year,'-',month)
-- ---- contra el límite inferior de la ventana sigue permitiendo partition
-- ---- pruning y además reproduce la MISMA ventana móvil de 12 meses
-- ---- (mes actual inclusive + 11 previos) que la Consulta 1.
WHERE concat(year, '-', month) >= date_format(date_add('month', -11, date_trunc('month', current_date)), '%Y-%m')
  -- AND partner_id = 'PART01'                 -- añadir si se liquida un aliado puntual
GROUP BY partner_id, partner_name, year, month
ORDER BY partner_id, year_month;

/*
=======================================================================
Estrategias de reducción de costos en Athena
(Athena cobra $5 por TB escaneado; el objetivo es minimizar bytes leídos)
=======================================================================

1) Particionamiento por year/month/partner_id + filtros SIEMPRE sobre las
   claves de partición ("partition pruning"): Athena consulta primero el
   catálogo de Glue y solo abre las carpetas S3 que coinciden con el
   WHERE, en vez de escanear las 500M+ filas de la tabla completa. Una
   consulta de un mes/aliado puede pasar de escanear cientos de GB a solo
   unos pocos MB.

2) Formato columnar Parquet + proyección de columnas: como Parquet
   almacena cada columna por separado, el motor solo lee
   points_earned/points_redeemed/partner_id/partner_name — nunca
   transaction_id, member_id o processed_at si no aparecen en la query.
   Esto reduce directamente los bytes escaneados (y por tanto el costo)
   sin tocar la definición de la tabla.

3) Compresión por columna (Snappy o ZSTD) dentro de Parquet: al comprimir
   cada columna homogénea de forma independiente se logran ratios de
   5-10x frente a CSV sin comprimir, así que el mismo dato físico ocupa
   muchos menos bytes en S3 y, por tanto, menos TB facturados por Athena.

4) Tablas agregadas materializadas vía CTAS (CREATE TABLE AS SELECT):
   generar una tabla pequeña ya sumarizada por mes/aliado (el resultado
   de esta misma Consulta 2) para que los dashboards y reportes
   recurrentes consulten esa tabla agregada en lugar de re-escanear los
   500M+ registros crudos en cada refresco.

5) Partition projection en el catálogo de Glue: en vez de mantener
   millones de particiones registradas explícitamente (una por
   year/month/partner_id), se define un patrón de proyección que calcula
   las rutas S3 en tiempo de consulta. Esto evita el costoso listado de
   S3 y acelera drásticamente el "query planning", sin afectar el costo
   de escaneo pero mejorando la latencia general.

Plan de particionamiento sugerido:
  s3://fincard-transactions/year=YYYY/month=MM/partner_id=PARTxx/*.parquet
  Claves de partición: year STRING, month STRING, partner_id STRING
  (particiones "altas" primero — year/month — para que un rango de fechas
  pode carpetas completas antes de llegar al nivel de partner_id).

Por qué Parquet y no CSV:
  - Columnar: Parquet permite leer solo las columnas necesarias; CSV
    obliga a leer la fila completa (todas las columnas) para extraer
    cualquier campo.
  - Predicate pushdown + estadísticas por row-group: Parquet guarda
    min/max por bloque, así que Athena puede descartar row-groups enteros
    sin decodificarlos si el filtro no puede coincidir.
  - Compresión eficiente por columna (tipos de datos homogéneos por
    columna comprimen mejor que filas mixtas en texto plano) → 5-10x
    menos bytes físicos que el mismo dataset en CSV.
  - Resultado directo sobre el costo: menos TB escaneados a $5/TB ⇒
    facturas de Athena órdenes de magnitud menores para el mismo
    resultado de negocio.
=======================================================================
*/


-- =====================================================================
-- Consulta 3 (Redshift): Detección de anomalías — aliados con cambio
-- > 50% en puntos netos liquidados vs. el mes anterior.
-- Columnas: partner_id, partner_name, current_month, current_net,
--           prev_month, prev_net, pct_change
-- Dialecto: Redshift (DATE_TRUNC, TO_CHAR, LAG() OVER, NULLIF para evitar
-- división por cero cuando el mes anterior tuvo neto = 0).
-- =====================================================================
WITH monthly AS (
  SELECT
    partner_id,
    partner_name,
    DATE_TRUNC('month', transaction_date)               AS month,
    SUM(points_earned) - SUM(points_redeemed)           AS net
  FROM transactions
  GROUP BY partner_id, partner_name, DATE_TRUNC('month', transaction_date)
),
-- LAG() devuelve el mes anterior CON DATOS por aliado, no el mes calendario
-- inmediatamente anterior: si un aliado tiene un mes sin transacciones, se
-- comparará contra el último mes que sí tuvo datos, saltándose el hueco.
with_prev AS (
  SELECT
    partner_id, partner_name, month, net,
    LAG(net)   OVER (PARTITION BY partner_id ORDER BY month) AS prev_net,
    LAG(month) OVER (PARTITION BY partner_id ORDER BY month) AS prev_month
  FROM monthly
)
SELECT
  partner_id,
  partner_name,
  TO_CHAR(month, 'YYYY-MM')                                        AS current_month,
  net                                                              AS current_net,
  TO_CHAR(prev_month, 'YYYY-MM')                                   AS prev_month,
  prev_net,
  -- NULLIF protege contra división por cero cuando el mes anterior fue 0
  ROUND(100.0 * (net - prev_net) / NULLIF(ABS(prev_net), 0), 2)    AS pct_change
FROM with_prev
WHERE prev_net IS NOT NULL
  AND ABS(net - prev_net) > 0.5 * ABS(prev_net)
ORDER BY ABS(pct_change) DESC;
