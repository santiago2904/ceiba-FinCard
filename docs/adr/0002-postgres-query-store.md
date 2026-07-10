# ADR-0002: Postgres como query store para liquidaciones (vs. Athena en vivo)

## Estado

Aceptada.

## Contexto

El enunciado del ejercicio plantea un escenario de escala (500M+ filas) donde el
motor de consulta analítica objetivo es **Athena** (sobre S3 + Parquet + Glue Data
Catalog particionado por `year/month/partner_id`) o **Redshift**, y pide *escribir*
las consultas de optimización para ese escenario — ese entregable es
[`queries/optimization.sql`](../../queries/optimization.sql).

Sin embargo, el servicio HTTP en vivo (`GET /api/v1/settlements/:partnerId`) necesita
responder liquidaciones por rango de fechas con baja latencia y de forma
transaccionalmente consistente con lo que se acaba de subir en
`POST /api/v1/transactions/upload`. Consultar Athena directamente desde el request
HTTP tiene limitaciones reales para este caso de uso local/demo:

- Athena tiene latencia de segundos por consulta (no apto para un endpoint
  síncrono de baja latencia) y cobra por TB escaneado — no tiene sentido para
  volúmenes de demo/desarrollo.
- LocalStack (usado para desarrollo, ver ADR-0003) no emula Athena.
- Se necesita un lugar para registrar transacciones marcadas
  (`transactions_flagged`) como log de auditoría consultable, algo que no es el
  propósito de un data lake de solo-agregar.

## Decisión

Se usa **Postgres** como *query store* operacional:

- `transactions`: copia de las transacciones limpias, con índices compuestos
  `(partner_id, transaction_date)` y `(member_id, transaction_date)` que soportan
  directamente el patrón de acceso de RF-04 (liquidación por aliado y rango de
  fechas) y RF-05 (agregaciones).
- `transactions_flagged`: registro de auditoría de las transacciones marcadas por
  las reglas de negocio RN-01..RN-04.

**S3 sigue siendo la fuente de verdad del dato crudo** (data lake, NDJSON
particionado por `{year}/{month}/{partner_id}`, con manifiesto por lote), y Glue
Data Catalog sigue registrando el esquema de esa tabla externa — el pipeline de
ingesta (`UploadTransactionsService`) escribe en **ambos** destinos en el mismo
flujo. Postgres no sustituye al data lake: es una vista de servicio derivada del
mismo lote que se acaba de validar, optimizada para el patrón de acceso del
endpoint HTTP.

Esto es consistente con la narrativa de migración hacia Athena: en un escenario de
producción a escala, el pipeline de ingesta seguiría escribiendo a S3/Glue en
Parquet, y una capa de servicio (aquí, Postgres; en producción, potencialmente un
job de agregación periódico o una cache) seguiría respaldando las consultas de baja
latencia, mientras Athena/Redshift atienden las consultas analíticas ad-hoc de gran
volumen descritas en `queries/optimization.sql`.

## Consecuencias

**Positivas**
- `GET /api/v1/settlements/:partnerId` responde en milisegundos con índices simples,
  sin depender de un motor de consultas externo por request.
- `transactions_flagged` da trazabilidad/auditoría inmediata de lo que el pipeline
  marcó como sospechoso, consultable con SQL estándar.
- El mismo dato crudo persiste en S3 para reprocesos, auditoría de largo plazo, o
  una futura migración de la capa analítica a Athena/Parquet sin perder historia.

**Negativas / trade-offs**
- Doble escritura (S3 + Glue + Postgres) en cada subida: más superficie de fallo
  parcial (si Postgres falla después de escribir en S3, hay que reconciliar) y más
  código de infraestructura que mantener.
- Postgres no está diseñado para 500M+ filas con la misma eficiencia de costo que
  Parquet+Athena a esa escala; esta decisión asume el volumen real de operación de
  FinCard (por aliado/rango de fechas) es órdenes de magnitud menor al escenario de
  500M+ filas usado como contexto para el ejercicio de optimización SQL.
- Requiere mantener el esquema de Postgres sincronizado con el esquema de Glue
  (mismas columnas) manualmente; no hay generación automática de uno a partir del
  otro.
