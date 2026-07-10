# ADR-0003: LocalStack + adaptadores AWS SDK v3 (paridad dev/prod)

## Estado

Aceptada.

## Contexto

El servicio depende de dos servicios de AWS (S3 y Glue Data Catalog) para el data
lake. Se necesita poder desarrollar y correr pruebas de integración localmente sin
una cuenta de AWS real, sin incurrir en costo, y sin que el código de los
adaptadores (`S3ObjectStorage`, `GlueCatalog`) difiera entre entorno local y
producción — lo que se quiere validar en local debe ser el mismo código que corre en
producción, solo apuntando a un endpoint distinto.

Adicionalmente, el objetivo documentado a mediano plazo para la capa analítica es
almacenamiento columnar Parquet (ver `queries/optimization.sql` y ADR-0002), pero
introducir una dependencia de escritura Parquet en el camino caliente del endpoint
de subida agrega complejidad (buffers, tipado de columnas, librería nativa) que no
aporta valor al alcance actual del ejercicio, cuyo backend en vivo se sirve desde
Postgres, no desde Athena.

## Decisión

- Se usa **LocalStack 3** (`docker-compose.yml`, servicios `s3` y `glue`) como
  emulador de AWS para desarrollo local e integración. Un script de init
  (`scripts/localstack-init.sh`) crea el bucket (`fincard-transactions`) y la base
  de Glue (`fincard_loyalty`) al arrancar el contenedor.
- Los adaptadores de salida (`S3ObjectStorage`, `GlueCatalog`) usan el **AWS SDK v3
  oficial** (`@aws-sdk/client-s3`, `@aws-sdk/client-glue`) sin ninguna
  bifurcación de código por entorno. La única diferencia entre desarrollo y
  producción es la variable de entorno `AWS_ENDPOINT_URL`: si está definida (como en
  `.env.example`, `http://localhost:4566`), el cliente apunta a LocalStack con
  `forcePathStyle: true` y credenciales dummy (`test`/`test`); si no está definida,
  el SDK usa la resolución estándar de AWS (credenciales reales, endpoints
  regionales de AWS).
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
- Las pruebas de integración (`npm run test:int`) validan los adaptadores S3/Glue
  reales contra LocalStack, no contra mocks del SDK — se detectan errores de
  serialización o de forma de las llamadas que un mock no capturaría.
- Promover a producción es, en principio, un cambio de configuración
  (`AWS_ENDPOINT_URL` + credenciales IAM reales), no de código.

**Negativas / trade-offs**
- LocalStack no es una réplica perfecta de AWS: hay comportamientos de límites,
  latencia, consistencia eventual y permisos IAM que no se emulan, así que la
  paridad dev/prod es "razonable", no total — se requiere validación adicional
  contra AWS real antes de ir a producción.
- El formato NDJSON en vivo diverge del formato Parquet documentado como objetivo
  para Athena; si en el futuro se conecta Athena directamente sobre estos objetos,
  hará falta un job de conversión NDJSON → Parquet (o cambiar el escritor) antes de
  que el partition-pruning y las ganancias de costo descritas en
  `queries/optimization.sql` apliquen a los datos realmente escritos por este
  servicio.
