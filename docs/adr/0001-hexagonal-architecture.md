# ADR-0001: Arquitectura hexagonal (ports & adapters)

## Estado

Aceptada.

## Contexto

FinCard necesita un servicio que: (1) reciba e ingiera CSVs de transacciones,
validándolos y aplicando reglas de negocio anti-fraude; (2) persista el dato crudo en
un data lake (S3 + Glue) y una copia consultable en un motor relacional (Postgres);
(3) exponga liquidaciones agregadas por aliado vía HTTP. El enunciado original plantea
además una migración futura de la capa analítica hacia Athena/Redshift sobre Parquet,
y una entrega posterior de infraestructura como código (Terraform). Se necesita una
estructura de código que:

- Permita testear las reglas de negocio y los casos de uso sin encender Docker,
  Postgres real ni AWS/LocalStack.
- No ate el dominio a Fastify, al SDK de AWS ni al driver de Postgres, de forma que
  cambiar cualquiera de esos detalles técnicos (por ejemplo, mover de LocalStack a AWS
  real, o de escritura NDJSON a Parquet) no obligue a tocar las reglas de negocio.
- Sea comprensible y navegable para un evaluador externo en un proyecto de tamaño
  moderado (no se busca sobre-ingeniería, solo separación de responsabilidades clara).

## Decisión

Se adopta arquitectura hexagonal (ports & adapters) con cuatro capas:

- `domain/`: entidades, value objects (`MemberId`, `PartnerId`, `Points`,
  `TransactionDate`) y reglas de negocio puras, sin ningún import de librerías de
  infraestructura.
- `application/`: casos de uso (`UploadTransactionsService`,
  `GetSettlementService`) que orquestan el dominio, y los *ports* — interfaces que
  declaran lo que la aplicación necesita del exterior (`ObjectStoragePort`,
  `DataCatalogPort`, `TransactionRepositoryPort`, `PartnerRepositoryPort`) y lo que el
  exterior puede pedirle a la aplicación (`UploadTransactionsUseCase`,
  `GetSettlementUseCase`).
- `adapters/in/http/`: adaptador de entrada Fastify que traduce HTTP ↔ casos de uso
  (rutas, validación de esquema con Zod, manejo de errores).
- `adapters/out/{s3,glue,postgres}/`: adaptadores de salida que implementan los ports
  usando el AWS SDK v3 y Kysely/`pg`.

El wiring concreto (qué adaptador implementa cada port) vive únicamente en
`src/config/container.ts`. Ningún módulo de `domain` o `application` importa un
adaptador concreto.

## Consecuencias

**Positivas**
- Las pruebas unitarias de dominio y de casos de uso corren sin Docker ni red,
  usando dobles de prueba que implementan los mismos ports (`npm test` es rápido).
- Cambiar un detalle de infraestructura (LocalStack → AWS real, o el formato de
  almacenamiento en S3) es un cambio aislado al adaptador correspondiente — no toca
  `domain`/`application` (ver ADR-0003).
- La regla de dependencia (las flechas solo apuntan hacia adentro) hace explícito
  qué se puede reusar si en el futuro se cambia de framework HTTP o de motor de base
  de datos.

**Negativas / trade-offs**
- Más archivos e indirección (interfaces + implementación) que un enfoque en capas
  más simple (MVC/controller-service-repo clásico), lo cual añade una curva de
  entrada para quien no conozca el patrón.
- Requiere disciplina para no filtrar tipos de infraestructura (por ejemplo, tipos
  del AWS SDK o de Kysely) hacia `domain`/`application` — el equipo debe mantener esa
  frontera activamente en cada PR.
