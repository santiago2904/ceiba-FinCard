# DESIGN.md — FinCard: diseño técnico

Documento de diseño condensado del servicio de liquidación de puntos de lealtad.
Complementa el [README.md](./README.md) y las decisiones registradas en [docs/adr/](./docs/adr/).

## 1. Capas y regla de dependencia

Arquitectura hexagonal (ports & adapters), con cuatro capas:

```
src/
  domain/         → entidades, value objects, reglas de negocio puras (sin I/O)
  application/     → casos de uso (services) + ports (interfaces in/out)
  adapters/
    in/http/       → Fastify: rutas, esquemas Zod, manejo de errores
    out/{s3,glue,postgres} → implementaciones concretas de los ports "out"
  config/          → wiring (contenedor de dependencias) + variables de entorno
```

**Regla de dependencia**: las flechas de importación solo pueden apuntar hacia
adentro. `domain` no importa nada de `application` ni `adapters`. `application`
importa `domain` y define *ports* (interfaces) que los `adapters` implementan, pero
`application` nunca importa un adaptador concreto — solo el tipo del port
(`ObjectStoragePort`, `DataCatalogPort`, `TransactionRepositoryPort`,
`PartnerRepositoryPort`). El único punto donde se "conectan" las implementaciones
concretas a los casos de uso es `src/config/container.ts`.

Esto permite:
- Testear el dominio y los casos de uso con dobles de prueba (fakes/mocks) sin Docker.
- Cambiar de LocalStack a AWS real, o de Postgres a otro motor, sin tocar
  `domain`/`application` — solo el adaptador y el wiring del contenedor.

Ver justificación completa en [ADR-0001](./docs/adr/0001-hexagonal-architecture.md).

## 2. Pipeline ETL

### 2.1 Flujo de subida (`POST /api/v1/transactions/upload`)

1. **Adaptador HTTP** (`adapters/in/http/routes.ts`) recibe el archivo multipart en
   el campo `file` y lo pasa como `Buffer` al caso de uso `UploadTransactionsService`.
2. **Parseo** (`application/services/csv-parser.ts`): convierte el CSV crudo en filas
   tipadas (`RawTransactionRow[]`) con `csv-parse`.
3. **Validación de campos** (`domain/services/field-validator.ts`): por fila, verifica
   columnas requeridas, tipos/formatos (`MemberId`, `PartnerId`, `Points`,
   `TransactionDate` como value objects) y `transaction_id` duplicado dentro del mismo
   archivo. Las filas inválidas se acumulan como `RowError[]` (fila, campo, valor,
   mensaje) y no continúan al siguiente paso.
4. **Reglas de negocio anti-fraude** (`domain/services/business-rules.ts`): sobre las
   filas válidas, aplica RN-01..RN-04 (sección 4) y separa el conjunto en `clean`
   (persistible) y `flagged` (marcado, con motivo).
5. **Persistencia en el data lake**: las transacciones limpias se agrupan por
   `{year}/{month}/{partner_id}` y se escriben en S3 como un objeto NDJSON por lote
   (`{prefix}/{batchId}.ndjson`), más un manifiesto (`manifests/{batchId}.manifest.json`)
   con el resumen del lote (filas válidas/rechazadas/marcadas, errores, hash SHA-256 del
   archivo fuente).
6. **Catálogo de datos**: se asegura la base `fincard_loyalty` y se crea/actualiza la
   tabla `transactions` en Glue Data Catalog con el esquema de columnas.
7. **Query store**: las transacciones limpias se insertan en `transactions`
   (Postgres) y las marcadas en `transactions_flagged`, ambas con `batch_id` y
   `processed_at` para trazabilidad.
8. La respuesta HTTP `201` devuelve el manifiesto + `s3Prefixes` de los objetos
   escritos. Si **todas** las filas fallaron la validación, se responde `400
   VALIDATION_FAILED` con el detalle de errores.

### 2.2 Flujo de liquidación (`GET /api/v1/settlements/:partnerId`)

1. El adaptador HTTP valida `partnerId` (param) y `from`/`to` (query) con esquemas Zod
   (`settlement.schema.ts`).
2. `GetSettlementService` resuelve el nombre del aliado (`PartnerRepositoryPort`); si
   no existe, lanza `NotFoundError` → `404`.
3. Consulta `TransactionRepositoryPort.findForSettlement(partnerId, from, to)`
   **contra Postgres**, no contra S3/Athena (ver ADR-0002).
4. `domain/services/settlement-calculator.ts` agrega totales
   (`total_points_earned`, `total_points_redeemed`, `net_points_owed` clamped a `>= 0`,
   `unique_members`) y construye el `daily_breakdown`, generando una fila por **cada**
   día del rango `[from, to]` (incluso días sin transacciones, con ceros) mediante
   `enumerateDates`.

## 3. Modelo de datos en Postgres

```sql
partners (partner_id PK, partner_name)
members  (member_id PK, member_name)

transactions (
  transaction_id PK, member_id, partner_id,
  points_earned, points_redeemed, transaction_date,
  partner_name, processed_at, batch_id
)
-- índices: (partner_id, transaction_date), (member_id, transaction_date)

transactions_flagged (
  id BIGSERIAL PK, transaction_id, member_id, partner_id,
  points_earned, points_redeemed, transaction_date,
  partner_name, flag_reason, batch_id, processed_at
)
```

`transactions` guarda únicamente las filas que pasaron validación y reglas de
negocio; es el query store que respalda las liquidaciones. `transactions_flagged` es
un log de auditoría de las transacciones marcadas como sospechosas, con el motivo
(`flag_reason`: `RN-01`..`RN-04`) para revisión manual. Los índices compuestos
`(partner_id, transaction_date)` y `(member_id, transaction_date)` soportan
directamente los patrones de consulta de RF-04/RF-05 (rango de fechas por aliado,
agregación por miembro).

## 4. Reglas de negocio

Implementadas en `domain/services/business-rules.ts`, evaluadas sobre las
transacciones ya válidas de un mismo archivo/lote:

- **RN-01 — Límite diario de 10,000 puntos netos por miembro.** Agrupando por
  `(member_id, transaction_date)` y ordenando por `transaction_id`, se acumula el neto
  (`points_earned - points_redeemed`). Desde la transacción en la que el neto
  acumulado supera 10,000, esa transacción y todas las siguientes del mismo día quedan
  marcadas `RN-01` (ver supuesto documentado #3 en el README).
- **RN-02 — Máximo 30% de transacciones de redención por aliado/día.** Agrupando por
  `(partner_id, transaction_date)`, si más del 30% de las transacciones del grupo son
  redenciones (`points_redeemed > 0`), las redenciones que exceden ese cupo (ordenadas
  por `transaction_id`) se marcan `RN-02`.
- **RN-03 — Máximo 5 transacciones por miembro/aliado/día.** Agrupando por
  `(member_id, partner_id, transaction_date)`, la 6ª transacción en adelante (ordenadas
  por `transaction_id`) se marca `RN-03`.
- **RN-04 — Ventana temporal válida.** Se marca `RN-04` cualquier transacción con
  `transaction_date` en el futuro respecto al momento de procesamiento, o con más de 2
  años de antigüedad.

Cada transacción se marca con el **primer** motivo detectado (no se acumulan motivos
múltiples); las transacciones marcadas no entran a `transactions`, solo a
`transactions_flagged`.

## 5. Manejo de errores

Contrato de error uniforme en las respuestas HTTP (`adapters/in/http/errors.ts`):

| Código | Cuándo | Body |
|---|---|---|
| `400 VALIDATION_FAILED` | Error de dominio (`ValidationError`) o CSV sin ninguna fila válida | `{ error, field?, message }` o `{ error, totalRows, invalidRows, errors[] }` |
| `404 NOT_FOUND` | Aliado inexistente en `GET /settlements/:partnerId` | `{ error, message }` |
| `422 INVALID_PARAMS` | Falta el archivo en el upload, o params/query inválidos (Zod) | `{ error, message }` |
| `500 INTERNAL_ERROR` | Cualquier error no controlado | `{ error }` (se registra con `app.log.error`) |

Los errores de validación de fila (CSV) no abortan todo el lote: cada fila se evalúa
independientemente y las inválidas se reportan en el arreglo `errors` de la respuesta
`201`, mientras las válidas siguen su curso normal.

## 6. Estrategia de pruebas

- **Unitarias** (`npm test`, Vitest): cubren `domain` (value objects, `business-rules`,
  `settlement-calculator`, `field-validator`) y `application/services` (con dobles de
  prueba para los ports `out`), sin dependencias externas. Se ejecutan en cada corrida
  local y en CI sin necesidad de Docker.
- **Integración** (`npm run test:int`, Vitest + Testcontainers): levantan un Postgres
  real efímero vía Docker para validar migraciones y los repositorios concretos
  (`transaction.repository.int.spec.ts`) y adaptadores S3/Glue
  (`s3-object-storage.int.spec.ts`, `glue-catalog.int.spec.ts`) contra LocalStack.
  Requieren Docker corriendo localmente.
- La separación de configs (`vitest.int.config.ts` vs. config por defecto) permite
  correr las unitarias rápido en cada guardado (`test:watch`) y reservar las de
  integración para antes de un commit/push.
