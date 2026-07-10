# ADR-0003: LocalStack + adaptadores AWS SDK v3 (paridad dev/prod) + catálogo local para Glue

## Estado

Aceptada. Actualizada para reflejar que Glue no está disponible en LocalStack
community (ver sección "Actualización" más abajo).

## Contexto

El servicio depende de dos servicios de AWS (S3 y Glue Data Catalog) para el data
lake. Se necesita poder desarrollar y correr pruebas de integración localmente sin
una cuenta de AWS real, sin incurrir en costo, y sin que el código de los
adaptadores (`S3ObjectStorage`, `GlueCatalog`) difiera entre entorno local y
producción — lo que se quiere validar en local debe ser el mismo código que corre en
producción, solo apuntando a un endpoint distinto.

**Actualización:** Glue es una feature de **LocalStack Pro** (edición paga); la
edición community usada en este ejercicio responde
`API for service 'glue' not yet implemented or pro feature` a cualquier llamada de
Glue, lo que rompe la ruta de subida en vivo (`UploadTransactions` llama al catálogo en
cada upload) y la prueba de integración de `GlueCatalog`. El enunciado permite
explícitamente emular Glue con persistencia local en JSON para el alcance de este
ejercicio, así que se introduce un segundo adaptador de `DataCatalogPort` para
desarrollo local (ver Decisión).

Adicionalmente, el objetivo documentado a mediano plazo para la capa analítica es
almacenamiento columnar Parquet (ver `queries/optimization.sql` y ADR-0002), pero
introducir una dependencia de escritura Parquet en el camino caliente del endpoint
de subida agrega complejidad (buffers, tipado de columnas, librería nativa) que no
aporta valor al alcance actual del ejercicio, cuyo backend en vivo se sirve desde
Postgres, no desde Athena.

## Decisión

- Se usa **LocalStack 3** (`docker-compose.yml`, servicio `s3` únicamente — `glue` se
  removió del `SERVICES` porque no está soportado en community) como emulador de AWS
  para desarrollo local e integración de S3. Un script de init
  (`scripts/localstack-init.sh`) crea el bucket (`fincard-transactions`) al arrancar el
  contenedor.
- El adaptador de S3 (`S3ObjectStorage`) usa el **AWS SDK v3 oficial**
  (`@aws-sdk/client-s3`) sin ninguna bifurcación de código por entorno. La única
  diferencia entre desarrollo y producción es la variable de entorno
  `AWS_ENDPOINT_URL`: si está definida (como en `.env.example`,
  `http://localhost:4566`), el cliente apunta a LocalStack con `forcePathStyle: true`
  y credenciales dummy (`test`/`test`); si no está definida, el SDK usa la resolución
  estándar de AWS (credenciales reales, endpoints regionales de AWS).
- Para `DataCatalogPort` (RF-03) existen **dos adaptadores**, seleccionados por la
  variable de entorno `CATALOG_MODE` (`src/config/env.ts`, `src/config/container.ts`):
  - **`GlueCatalog`** (`src/adapters/out/glue/glue-catalog.ts`, `CATALOG_MODE=glue`):
    usa el AWS SDK v3 oficial (`@aws-sdk/client-glue`) igual que `S3ObjectStorage`, para
    producción o para correr contra LocalStack Pro / AWS Glue real.
  - **`FileDataCatalog`** (`src/adapters/out/catalog/file-data-catalog.ts`,
    `CATALOG_MODE=file`, **default**): emula el mismo contrato (`ensureDatabase`,
    `upsertTable`) persistiendo un JSON en disco (`CATALOG_FILE`, default
    `./data/catalog/catalog.json`) con la forma
    `{ databases: { <db>: { tables: { <table>: { columns } } } } }`. Es la opción por
    defecto en desarrollo/pruebas locales porque Glue no está disponible en LocalStack
    community; el enunciado permite explícitamente esta emulación con persistencia
    local. No pretende ser segura ante escritura concurrente (es un emulador de
    desarrollo, lectura-modificación-escritura secuencial).
  - La prueba de integración de `GlueCatalog`
    (`src/adapters/out/glue/glue-catalog.int.spec.ts`) queda **omitida por defecto**
    (`describe.skipIf(!process.env.RUN_GLUE_IT)`) porque requiere LocalStack Pro o AWS
    real; se puede correr explícitamente con `RUN_GLUE_IT=1 npm run test:int`. RF-03 se
    valida localmente en cambio con la prueba unitaria de `FileDataCatalog`
    (`src/adapters/out/catalog/file-data-catalog.spec.ts`).
- El **formato de almacenamiento en S3 en el camino en vivo es NDJSON** (un objeto
  `.ndjson` por lote, particionado por `{year}/{month}/{partner_id}`), no Parquet.
  Parquet queda documentado como el formato objetivo para la capa analítica
  (Athena/Glue, partition pruning + columnar + compresión — ver
  `queries/optimization.sql`), pero implementarlo en el pipeline de ingesta vivo no
  es necesario mientras el query store de servicio sea Postgres (ADR-0002); NDJSON
  simplifica la ruta de escritura y la mantiene fácil de inspeccionar/depurar
  localmente sin una librería de escritura Parquet en el camino caliente.

## Consecuencias

**Positivas**
- Cualquiera puede levantar el proyecto completo (`docker compose up -d`) sin
  cuenta de AWS, sin costo, y con paridad de comportamiento razonable con
  producción (mismo SDK, mismas llamadas).
- Las pruebas de integración (`npm run test:int`) validan el adaptador S3 real
  contra LocalStack, no contra mocks del SDK — se detectan errores de
  serialización o de forma de las llamadas que un mock no capturaría. `FileDataCatalog`
  se valida como prueba unitaria rápida, sin Docker.
- Promover a producción es, en principio, un cambio de configuración
  (`AWS_ENDPOINT_URL`, `CATALOG_MODE=glue` + credenciales IAM reales), no de código.

**Negativas / trade-offs**
- LocalStack no es una réplica perfecta de AWS: hay comportamientos de límites,
  latencia, consistencia eventual y permisos IAM que no se emulan, así que la
  paridad dev/prod es "razonable", no total — se requiere validación adicional
  contra AWS real antes de ir a producción.
- `FileDataCatalog` no es una réplica de Glue: no valida tipos de columna, no soporta
  particiones/ubicación de datos ni concurrencia real, y su prueba de integración
  contra el `GlueCatalog` real queda deshabilitada por defecto (`RUN_GLUE_IT`), así que
  la paridad dev/prod del catálogo es menor que la de S3 y requiere validación manual
  contra Glue real (o LocalStack Pro) antes de producción.
- El formato NDJSON en vivo diverge del formato Parquet documentado como objetivo
  para Athena; si en el futuro se conecta Athena directamente sobre estos objetos,
  hará falta un job de conversión NDJSON → Parquet (o cambiar el escritor) antes de
  que el partition-pruning y las ganancias de costo descritas en
  `queries/optimization.sql` apliquen a los datos realmente escritos por este
  servicio.
