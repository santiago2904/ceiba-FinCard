# Diseño — Módulo de Liquidación de Puntos y Aliados (FinCard)

- **Fecha:** 2026-07-09
- **Nivel:** Senior — Fullstack/Data & Integraciones
- **Plazo:** 2 días
- **Stack obligatorio:** Node.js + TypeScript + Fastify · AWS (S3, Glue Data Catalog, Athena, Redshift) · Docker
- **Alcance acordado:** Backend sólido + deploy real en AWS + IaC completo (máximo factor diferenciador)

---

## 1. Contexto y objetivo

FinCard opera un programa de lealtad con múltiples aliados comerciales. Hoy los aliados
envían archivos CSV/JSON por medios manuales (email/FTP), generando errores de calidad e
inconsistencias, con tiempos de liquidación de hasta 72h. El objetivo es un módulo
automatizado que:

1. Reciba y **valide** archivos de transacciones de puntos en tiempo real.
2. **Almacene** las transacciones válidas en un data lake (S3) y las **catalogue** (Glue).
3. Aplique **reglas de negocio cruzadas** y aísle transacciones sospechosas.
4. Exponga **consultas de liquidación** por aliado y rango de fechas.
5. Entregue un componente de **SQL analítico** (Redshift/Athena) con optimización de costos.

---

## 2. Decisiones de arquitectura (cerradas)

| # | Decisión | Elección | Justificación |
|---|----------|----------|---------------|
| D1 | Estilo arquitectónico | **Hexagonal (Ports & Adapters)** | Exigido/valorado; aísla dominio de infra; testeable; permite intercambiar S3/Glue real ↔ LocalStack sin tocar el núcleo. |
| D2 | Capa de datos consultable | **S3 (raw/Parquet) + Postgres (query store)** | S3 como data lake fiel a la narrativa Athena/Redshift; Postgres para consultas de liquidación (rangos, agregaciones, daily breakdown) y `transactions_flagged`. Pipeline ETL claro y escalable. |
| D3 | Emulación AWS en dev | **LocalStack** vía AWS SDK v3 (`endpoint` por env) | Misma clase adapter corre contra LocalStack (dev) o AWS real (prod). Alta fidelidad. |
| D4 | Deploy | **ECS Fargate** (contenedor Fastify) detrás de ALB, RDS Postgres, S3, ECR | Servicio HTTP con uploads y conexión persistente a DB; reusa el Dockerfile obligatorio. |
| D5 | IaC | **Terraform** | Universal y muy valorado; describe Fargate + RDS + S3 + ALB + ECR. |
| D6 | Athena/Redshift | Se cubren como **entregable SQL** (`queries/optimization.sql`), no como integración viva | El enunciado solo pide *escribir* las consultas; el backend vivo corre sobre S3 + Glue + Postgres. Documentado como supuesto en README. |

### Librerías

| Rol | Elección | Motivo |
|-----|----------|--------|
| HTTP | Fastify + `@fastify/multipart` | obligatorio; upload de archivos |
| Validación | Zod | schemas tipados, mensajes de error por fila |
| CSV | `csv-parse` | parsing streaming y robusto |
| Acceso a DB | Kysely + migraciones | tipado, ligero, sin ORM pesado, compatible con hexagonal |
| S3 / Glue | AWS SDK v3 | mismo código para LocalStack y AWS real |
| Parquet | `parquetjs` (fallback a NDJSON si presenta problemas) | matchea narrativa Athena/Parquet |
| Tests | Vitest + Fastify `inject` + Testcontainers | rápido, TS nativo, integración real contra Postgres/LocalStack |
| Seguridad | `@fastify/helmet`, `@fastify/rate-limit` | headers seguros, protección básica |
| IaC | Terraform | Fargate + RDS + S3 + ALB + ECR |

---

## 3. Estructura del proyecto (hexagonal)

```
src/
├─ domain/                      # núcleo puro, cero dependencias de infra
│  ├─ model/                    # Transaction, Partner, Member, Settlement,
│  │                            #   FlaggedTransaction, ProcessingManifest
│  ├─ value-objects/            # MemberId, PartnerId, Points, TransactionDate
│  └─ services/                 # FieldValidator, BusinessRules (RN-01..04),
│                               #   SettlementCalculator
├─ application/                 # orquestación (casos de uso)
│  ├─ ports/
│  │  ├─ in/                    # UploadTransactionsUseCase, GetSettlementUseCase
│  │  └─ out/                   # ObjectStoragePort, DataCatalogPort,
│  │                            #   TransactionRepository, FlaggedRepository
│  └─ services/                 # UploadTransactionsService, GetSettlementService
├─ adapters/
│  ├─ in/http/                  # Fastify: routes, controllers, multipart, error-mapper
│  └─ out/
│     ├─ s3/                    # AWS SDK v3 → LocalStack / S3 real
│     ├─ glue/                  # AWS SDK v3 Glue → LocalStack / Glue real
│     └─ postgres/              # Kysely + migraciones
├─ config/                      # env, composition root (DI manual)
└─ main.ts

queries/optimization.sql        # componente de datos (Redshift/Athena)
data/samples/                   # CSV de ejemplo con casos borde
terraform/                      # IaC (Fargate, RDS, S3, ALB, ECR)
docs/adr/                       # Architecture Decision Records
```

**Regla de dependencia:** `domain` no importa nada; `application` depende solo de `domain`
y de sus puertos; `adapters` implementan puertos. El *composition root* (`config`) cablea
todo. Dev vs prod = solo cambia configuración, no código.

---

## 4. Requerimientos funcionales

### RF-01 — `POST /api/v1/transactions/upload`

Recibe un CSV multipart con columnas:
`transaction_id, member_id, partner_id, points_earned, points_redeemed, transaction_date, partner_name`

**Validaciones de campo:**
- Archivo es CSV con el formato/columnas esperadas.
- Cada fila tiene todas las columnas requeridas.
- `member_id` cumple `^MEM\d{3}$`.
- `partner_id` cumple `^PART\d{2}$`.
- `points_earned` y `points_redeemed` son enteros ≥ 0.
- `transaction_date` es fecha válida `YYYY-MM-DD`.
- No hay `transaction_id` duplicados dentro del archivo.

**Salida en error:** `400 Bad Request` con detalle por fila:
```json
{
  "error": "VALIDATION_FAILED",
  "totalRows": 20,
  "invalidRows": 3,
  "errors": [
    { "row": 4, "field": "member_id", "value": "MEMX1", "message": "member_id debe cumplir el formato MEM + 3 dígitos" }
  ]
}
```

### RF-02 — Procesamiento y almacenamiento en S3

Transacciones válidas:
- Se almacenan en S3 en la ruta `s3://fincard-transactions/{year}/{month}/{partner_id}/`.
  (`year`/`month` derivados de `transaction_date`; un archivo por partición de partner/mes).
- Formato Parquet (fallback NDJSON documentado).
- Se genera un **manifest** por batch con:
  - Total de filas válidas
  - Total de filas rechazadas
  - Lista de errores por fila
  - Timestamp del procesamiento
  - Hash SHA-256 del archivo original
  - `batch_id` (UUID del procesamiento)

### RF-03 — Catalogación en AWS Glue Data Catalog

- Crear/actualizar base de datos `fincard_loyalty`.
- Crear/actualizar tabla `fincard_loyalty.transactions` con columnas:
  `transaction_id STRING, member_id STRING, partner_id STRING, points_earned INT,
   points_redeemed INT, transaction_date DATE, partner_name STRING,
   processed_at TIMESTAMP, batch_id STRING`.
- Vía AWS SDK v3 contra LocalStack (dev) / Glue real (prod).

### RF-04 — `GET /api/v1/settlements/{partner_id}?from=YYYY-MM-DD&to=YYYY-MM-DD`

Devuelve resumen de liquidación:
```json
{
  "partner_id": "PART01",
  "partner_name": "Café Central",
  "period": { "from": "2026-07-01", "to": "2026-07-31" },
  "summary": {
    "total_transactions": 1500,
    "total_points_earned": 225000,
    "total_points_redeemed": 180000,
    "net_points_owed": 45000,
    "unique_members": 320
  },
  "daily_breakdown": [
    { "date": "2026-07-01", "transactions": 50, "points_earned": 7500, "points_redeemed": 6000 }
  ]
}
```

**Reglas de liquidación:**
- `net_points_owed = total_points_earned − total_points_redeemed`.
- Si `net_points_owed` es negativo → se reporta `0` externamente, pero se conserva el valor
  negativo internamente (columna interna / flag).
- `daily_breakdown` incluye **todos** los días del rango, con ceros donde no hay transacciones.
- Solo cuentan transacciones **NO** flagged (las flagged no afectan la liquidación — ver RF-05).

### RF-05 — Reglas de negocio de validación cruzada

Además de las validaciones de campo, sobre las filas válidas se aplican:

| Regla | Descripción | Acción |
|-------|-------------|--------|
| RN-01 | Un miembro no puede acumular > 10,000 puntos **netos** en un mismo día | transacciones adicionales → "sujetas a revisión" |
| RN-02 | Un aliado no puede tener > 30% de sus transacciones diarias con `points_redeemed > 0` | posible fraude → marcar |
| RN-03 | Un miembro con > 5 transacciones el mismo día con el mismo aliado | transacciones adicionales → "sujetas a revisión" |
| RN-04 | `transaction_date` no puede ser futura ni menor a 2 años atrás | marcar |

Las transacciones que fallen estas reglas se almacenan en `transactions_flagged` con el
**motivo** de la bandera y **no** afectan los cálculos de liquidación (RF-04).

> Supuesto documentado: el orden de evaluación y la definición de "adicionales" se resuelve
> ordenando las transacciones del grupo (día/miembro/aliado) por `transaction_id` y marcando
> las que exceden el umbral. Se documentará en README.

---

## 5. Flujo de datos (pipeline ETL)

**Upload:**
```
CSV (multipart)
  → parse (csv-parse)
  → validación de campo (Zod)  ──(falla)──▶ 400 con errores por fila
  → dedupe transaction_id
  → reglas cruzadas RN-01..04  ──▶ split { válidas, flagged }
  → S3: Parquet en {year}/{month}/{partner_id}/  +  manifest.json (SHA-256, conteos, errores)
  → Glue: upsert fincard_loyalty.transactions
  → Postgres: insert transactions (válidas) + transactions_flagged (con motivo)
  → 201 con resumen del batch (batch_id, válidas, rechazadas, flagged, ruta S3)
```

**Settlement:**
```
GET settlements/{partner_id}?from&to
  → validar params (partner_id, rango de fechas)
  → Postgres: agregación por partner + rango (solo no-flagged)
  → SettlementCalculator: net_owed, unique_members, daily_breakdown (relleno de días)
  → 200 con el JSON de liquidación
```

---

## 6. Modelo de datos (Postgres — query store)

```sql
-- transactions (proyección consultable de las válidas)
transaction_id   TEXT PRIMARY KEY
member_id        TEXT NOT NULL
partner_id       TEXT NOT NULL
points_earned    INTEGER NOT NULL
points_redeemed  INTEGER NOT NULL
transaction_date DATE NOT NULL
partner_name     TEXT NOT NULL
processed_at     TIMESTAMPTZ NOT NULL
batch_id         TEXT NOT NULL
-- índices: (partner_id, transaction_date), (member_id, transaction_date)

-- transactions_flagged
id               BIGSERIAL PRIMARY KEY
transaction_id   TEXT NOT NULL
member_id        TEXT NOT NULL
partner_id       TEXT NOT NULL
points_earned    INTEGER NOT NULL
points_redeemed  INTEGER NOT NULL
transaction_date DATE NOT NULL
partner_name     TEXT NOT NULL
flag_reason      TEXT NOT NULL      -- RN-01 | RN-02 | RN-03 | RN-04
batch_id         TEXT NOT NULL
processed_at     TIMESTAMPTZ NOT NULL
```

Los catálogos de referencia (partners MEM/PART y members) se cargan como seed para validar
existencia y resolver `partner_name`.

---

## 7. Manejo de errores y seguridad

- **Jerarquía de errores de dominio**: `DomainError` → `ValidationError`, `NotFoundError`,
  `BusinessRuleError`. Un **error-mapper** central en la capa Fastify los traduce a HTTP:
  `400` (validación, con array por fila), `404` (partner inexistente), `422` (params
  inválidos), `500` (genérico, sin filtrar detalles internos).
- **Seguridad:**
  - Límite de tamaño y tipo de archivo en multipart.
  - `@fastify/helmet` (headers), `@fastify/rate-limit`.
  - Queries parametrizadas (Kysely) → sin SQL injection.
  - Secrets vía variables de entorno / SSM en prod (nunca en repo).
  - Validación estricta de todos los inputs con Zod.

---

## 8. Componente SQL (`queries/optimization.sql`)

- **Consulta 1 (Redshift):** liquidación mensual por aliado, últimos 12 meses →
  `partner_id, partner_name, year_month, total_earned, total_redeemed, net_owed`.
- **Consulta 2 (Athena/Parquet):** misma liquidación optimizada +
  1. ≥3 estrategias de reducción de costos (particiones + `WHERE` sobre partition keys,
     columnar projection, compresión, `CTAS`/tablas agregadas, formato Parquet).
  2. Plan de particionamiento sugerido (`year` / `month` / `partner_id`).
  3. Explicación Parquet vs CSV (columnar, predicate pushdown, compresión, menos bytes
     escaneados → menor costo por TB).
- **Consulta 3 (detección de anomalías):** aliados con cambio > 50% MoM en puntos netos
  liquidados, usando window functions (`LAG`) →
  `partner_id, partner_name, current_month, current_net, prev_month, prev_net, pct_change`.

---

## 9. Estrategia de pruebas

- **Unitarias (núcleo, alta cobertura):** `FieldValidator`, cada regla RN-01..04,
  `SettlementCalculator` (net_owed negativo, relleno de días, unique_members).
- **De aplicación:** casos de uso con *fakes* en memoria de los puertos out.
- **De ruta (HTTP):** `app.inject()` sobre Fastify — happy path, 400 con errores por fila, 404.
- **De integración (opcional/diferenciador):** Testcontainers con Postgres real +
  LocalStack para adapters S3/Glue.
- **Fixtures:** CSV de ejemplo (≥20 filas) con: ≥2 `member_id` inválidos, ≥1 `points_earned`
  negativo, ≥1 `transaction_id` duplicado, ≥1 que exceda 10,000 puntos diarios, ≥1 fecha futura.

---

## 10. Entregables → mapeo

| Entregable | Ubicación |
|------------|-----------|
| Repo público con código | GitHub `ceiba-FinCard` |
| README (arquitectura + justificación + Mermaid + tecnologías + run local) | `README.md` |
| DESIGN.md | `DESIGN.md` |
| ADR (decisiones clave) | `docs/adr/*.md` |
| Tests automatizados | `test/` / `*.spec.ts` |
| SQL avanzado | `queries/optimization.sql` |
| Dockerfile | `Dockerfile` + `docker-compose.yml` |
| IaC (diferenciador) | `terraform/` |
| Datos de ejemplo | `data/samples/*.csv`, seeds |
| URL desplegada (diferenciador) | README (output de Terraform / ALB DNS) |
| CI (opcional) | `.github/workflows/*` |

---

## 11. Orden de construcción (fases del plan)

1. **Scaffold:** TS, Fastify, Vitest, config/env, Dockerfile, docker-compose (app + Postgres + LocalStack).
2. **Dominio + tests (TDD):** modelo, value objects, FieldValidator, reglas RN, SettlementCalculator.
3. **Puertos + casos de uso** con fakes + tests de aplicación.
4. **Adapters out:** S3, Glue, Postgres (Kysely + migraciones) + tests de integración.
5. **Adapters in:** rutas Fastify (upload multipart, settlements) + error-mapper + tests de ruta.
6. **Sample data** + corrida E2E local (compose) verificando el pipeline completo.
7. **`queries/optimization.sql`** (3 consultas + estrategias de costo).
8. **Documentación:** README + diagrama Mermaid + DESIGN.md + ADRs.
9. **Terraform:** Fargate + RDS + S3 + ALB + ECR; deploy; capturar URL.
10. **CI/CD** (opcional): GitHub Actions (lint + test + build + push a ECR).

---

## 12. Supuestos documentados (para README)

- Athena/Redshift se entregan como consultas SQL, no como integración viva (el backend usa
  S3 + Glue + Postgres). El enunciado permite emular AWS localmente y deja la arquitectura a
  libre elección.
- Postgres se usa como *query store* para RF-04/RF-05 por eficiencia de consulta; S3 sigue
  siendo la fuente cruda (data lake), consistente con la narrativa de migración a Athena.
- El orden de marcado de transacciones "adicionales" (RN-01/RN-03) se define por orden de
  `transaction_id` dentro del grupo día/miembro(/aliado).
- `net_points_owed` negativo se reporta como `0` externamente conservando el valor real
  internamente.
