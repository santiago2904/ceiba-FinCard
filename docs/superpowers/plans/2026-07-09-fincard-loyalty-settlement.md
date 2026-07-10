# FinCard Loyalty Settlement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js + TypeScript + Fastify module that ingests loyalty-point transaction CSVs, validates them, stores them in S3, catalogs them in Glue, applies cross-cutting business rules, and exposes settlement queries — with a hexagonal architecture, Docker, Terraform deploy, and an advanced SQL deliverable.

**Architecture:** Hexagonal (Ports & Adapters). A pure `domain` core (models, value objects, validators, rules, settlement calculator) sits behind `application` use cases that depend only on ports. Adapters (`in/http` Fastify, `out/s3`, `out/glue`, `out/postgres`) implement those ports and are wired in a composition root. The same AWS SDK v3 adapters target LocalStack in dev and real AWS in prod via env-configured endpoints.

**Tech Stack:** Node 20 LTS, TypeScript 5, Fastify 5 (`@fastify/multipart`, `@fastify/helmet`, `@fastify/rate-limit`), Zod, `csv-parse`, Kysely + `pg`, AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/client-glue`), `parquetjs` (fallback NDJSON), Vitest + Testcontainers, Docker + docker-compose (Postgres + LocalStack), Terraform (ECS Fargate + RDS + S3 + ALB + ECR).

## Global Constraints

- Node.js `>=20`, TypeScript `^5.4`, ESM modules (`"type": "module"`, `NodeNext` resolution).
- Fastify `^5`. All plugins pinned to their Fastify-5-compatible majors.
- The `domain/` layer MUST NOT import from `application/`, `adapters/`, `config/`, or any `node_modules` infra SDK. Pure TypeScript only.
- The `application/` layer imports only from `domain/` and its own `ports/`. Never from `adapters/`.
- All IDs/regex verbatim: `member_id` → `^MEM\d{3}$`, `partner_id` → `^PART\d{2}$`.
- Points are non-negative integers. Dates are `YYYY-MM-DD`.
- S3 key prefix verbatim: `{year}/{month}/{partner_id}/` under bucket `fincard-transactions`. `month` is zero-padded 2 digits.
- Glue: database `fincard_loyalty`, table `transactions`.
- Endpoints verbatim: `POST /api/v1/transactions/upload`, `GET /api/v1/settlements/:partnerId?from=YYYY-MM-DD&to=YYYY-MM-DD`.
- `net_points_owed` reported as `0` externally when negative; real value kept internally.
- Every task follows TDD: failing test → run (fail) → minimal impl → run (pass) → commit.
- Commit style: Conventional Commits. Test and implementation may share one commit per step-group.

---

### Task 1: Project scaffold (TypeScript + Vitest + tooling)

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.eslintrc.cjs`, `.prettierrc`, `.env.example`, `src/main.ts` (placeholder), `test/smoke.spec.ts`

**Interfaces:**
- Produces: build/test scripts (`npm test`, `npm run build`, `npm run dev`), ESM+TS toolchain used by all later tasks.

- [ ] **Step 1: Initialize package and install deps**

```bash
cd /Users/sapalacioa/Documents/Development/Personal/ceiba-FinCard
npm init -y
npm pkg set type="module" engines.node=">=20"
npm i fastify@^5 @fastify/multipart@^9 @fastify/helmet@^12 @fastify/rate-limit@^10 \
  zod@^3 csv-parse@^5 kysely@^0.27 pg@^8 uuid@^10 \
  @aws-sdk/client-s3@^3 @aws-sdk/client-glue@^3
npm i -D typescript@^5.4 tsx@^4 vitest@^2 @types/node@^20 @types/pg@^8 \
  eslint@^9 @typescript-eslint/eslint-plugin@^8 @typescript-eslint/parser@^8 \
  prettier@^3 testcontainers@^10 parquetjs@^0.11
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: Write `vitest.config.ts` and package scripts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'html'], include: ['src/**'] },
  },
});
```

```bash
npm pkg set scripts.build="tsc -p tsconfig.json"
npm pkg set scripts.dev="tsx watch src/main.ts"
npm pkg set scripts.start="node dist/main.js"
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:watch="vitest"
npm pkg set scripts.coverage="vitest run --coverage"
npm pkg set scripts.lint="eslint src"
```

- [ ] **Step 4: Write `.env.example`**

```
NODE_ENV=development
PORT=3000
# Postgres
DATABASE_URL=postgres://fincard:fincard@localhost:5432/fincard
# AWS / LocalStack
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_ENDPOINT_URL=http://localhost:4566
S3_BUCKET=fincard-transactions
GLUE_DATABASE=fincard_loyalty
GLUE_TABLE=transactions
# storage format: parquet | ndjson
STORAGE_FORMAT=parquet
# upload limits
MAX_UPLOAD_BYTES=10485760
```

- [ ] **Step 5: Write smoke test and placeholder main**

`test/smoke.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs typescript + vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
```

`src/main.ts`:
```ts
export const placeholder = true;
```

- [ ] **Step 6: Run tests (expect PASS) and build**

Run: `npm test && npm run build`
Expected: smoke test PASS, `dist/` compiles cleanly.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold TypeScript + Fastify + Vitest project"
```

---

### Task 2: Local infra — Dockerfile + docker-compose (Postgres + LocalStack)

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `scripts/localstack-init.sh`

**Interfaces:**
- Produces: `docker compose up` bringing Postgres on `5432`, LocalStack on `4566` with the `fincard-transactions` bucket pre-created; app image build.

- [ ] **Step 1: Write `Dockerfile` (multi-stage)**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

- [ ] **Step 2: Write `.dockerignore`**

```
node_modules
dist
.git
test
*.spec.ts
docs
terraform
```

- [ ] **Step 3: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: fincard
      POSTGRES_PASSWORD: fincard
      POSTGRES_DB: fincard
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U fincard"]
      interval: 5s
      timeout: 3s
      retries: 10
  localstack:
    image: localstack/localstack:3
    environment:
      SERVICES: s3,glue
      DEBUG: "0"
    ports: ["4566:4566"]
    volumes:
      - ./scripts/localstack-init.sh:/etc/localstack/init/ready.d/init.sh
```

- [ ] **Step 4: Write `scripts/localstack-init.sh`**

```bash
#!/bin/bash
awslocal s3 mb s3://fincard-transactions
awslocal glue create-database --database-input '{"Name":"fincard_loyalty"}' || true
```

- [ ] **Step 5: Verify infra comes up**

Run: `docker compose up -d && sleep 8 && docker compose ps`
Expected: `postgres` healthy, `localstack` running. Then:
Run: `curl -s http://localhost:4566/_localstack/health | grep s3`
Expected: s3 shows `available`/`running`.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.yml scripts/
git commit -m "chore: add Dockerfile and docker-compose (postgres + localstack)"
```

---

### Task 3: Domain value objects

**Files:**
- Create: `src/domain/value-objects/member-id.ts`, `partner-id.ts`, `points.ts`, `transaction-date.ts`
- Test: `src/domain/value-objects/value-objects.spec.ts`

**Interfaces:**
- Produces:
  - `MemberId.create(raw: string): MemberId` — throws `ValidationError` if `!/^MEM\d{3}$/`. `.value: string`.
  - `PartnerId.create(raw: string): PartnerId` — throws if `!/^PART\d{2}$/`. `.value: string`.
  - `Points.create(raw: string | number): Points` — throws if not a non-negative integer. `.value: number`.
  - `TransactionDate.create(raw: string): TransactionDate` — throws if not `YYYY-MM-DD` valid date. `.value: string` (ISO date), `.toDate(): Date`.
  - `ValidationError` (from `src/domain/errors.ts`, created here).

- [ ] **Step 1: Write `src/domain/errors.ts`**

```ts
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class ValidationError extends DomainError {
  constructor(public readonly field: string, public readonly value: unknown, message: string) {
    super(message);
  }
}
export class NotFoundError extends DomainError {}
```

- [ ] **Step 2: Write failing test `value-objects.spec.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { MemberId } from './member-id.js';
import { PartnerId } from './partner-id.js';
import { Points } from './points.js';
import { TransactionDate } from './transaction-date.js';
import { ValidationError } from '../errors.js';

describe('MemberId', () => {
  it('accepts MEM + 3 digits', () => expect(MemberId.create('MEM001').value).toBe('MEM001'));
  it('rejects bad format', () => expect(() => MemberId.create('MEMX1')).toThrow(ValidationError));
});
describe('PartnerId', () => {
  it('accepts PART + 2 digits', () => expect(PartnerId.create('PART01').value).toBe('PART01'));
  it('rejects bad format', () => expect(() => PartnerId.create('PART1')).toThrow(ValidationError));
});
describe('Points', () => {
  it('accepts non-negative int from string', () => expect(Points.create('150').value).toBe(150));
  it('rejects negative', () => expect(() => Points.create('-1')).toThrow(ValidationError));
  it('rejects decimals', () => expect(() => Points.create('1.5')).toThrow(ValidationError));
});
describe('TransactionDate', () => {
  it('accepts valid ISO date', () => expect(TransactionDate.create('2026-07-01').value).toBe('2026-07-01'));
  it('rejects invalid date', () => expect(() => TransactionDate.create('2026-13-40')).toThrow(ValidationError));
  it('rejects wrong format', () => expect(() => TransactionDate.create('01/07/2026')).toThrow(ValidationError));
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/domain/value-objects/value-objects.spec.ts`
Expected: FAIL (modules not found).

- [ ] **Step 4: Implement the value objects**

`src/domain/value-objects/member-id.ts`:
```ts
import { ValidationError } from '../errors.js';
const RE = /^MEM\d{3}$/;
export class MemberId {
  private constructor(public readonly value: string) {}
  static create(raw: string): MemberId {
    if (!RE.test(raw)) throw new ValidationError('member_id', raw, 'member_id debe cumplir el formato MEM + 3 dígitos');
    return new MemberId(raw);
  }
}
```

`src/domain/value-objects/partner-id.ts`:
```ts
import { ValidationError } from '../errors.js';
const RE = /^PART\d{2}$/;
export class PartnerId {
  private constructor(public readonly value: string) {}
  static create(raw: string): PartnerId {
    if (!RE.test(raw)) throw new ValidationError('partner_id', raw, 'partner_id debe cumplir el formato PART + 2 dígitos');
    return new PartnerId(raw);
  }
}
```

`src/domain/value-objects/points.ts`:
```ts
import { ValidationError } from '../errors.js';
export class Points {
  private constructor(public readonly value: number) {}
  static create(raw: string | number, field = 'points'): Points {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new ValidationError(field, raw, `${field} debe ser un entero no negativo`);
    return new Points(n);
  }
}
```

`src/domain/value-objects/transaction-date.ts`:
```ts
import { ValidationError } from '../errors.js';
const RE = /^\d{4}-\d{2}-\d{2}$/;
export class TransactionDate {
  private constructor(public readonly value: string) {}
  static create(raw: string): TransactionDate {
    if (!RE.test(raw)) throw new ValidationError('transaction_date', raw, 'transaction_date debe tener formato YYYY-MM-DD');
    const d = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw)
      throw new ValidationError('transaction_date', raw, 'transaction_date no es una fecha válida');
    return new TransactionDate(raw);
  }
  toDate(): Date { return new Date(`${this.value}T00:00:00.000Z`); }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/domain/value-objects/value-objects.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add src/domain
git commit -m "feat(domain): add value objects for member/partner/points/date"
```

---

### Task 4: Domain models

**Files:**
- Create: `src/domain/model/transaction.ts`, `flagged-transaction.ts`, `manifest.ts`, `settlement.ts`
- Test: `src/domain/model/transaction.spec.ts`

**Interfaces:**
- Consumes: value objects (Task 3).
- Produces:
  - `RawTransactionRow` type: `{ transaction_id, member_id, partner_id, points_earned, points_redeemed, transaction_date, partner_name }` (all `string`).
  - `Transaction` type: `{ transactionId: string; memberId: string; partnerId: string; pointsEarned: number; pointsRedeemed: number; transactionDate: string; partnerName: string }`.
  - `FlagReason` = `'RN-01' | 'RN-02' | 'RN-03' | 'RN-04'`.
  - `FlaggedTransaction` = `Transaction & { flagReason: FlagReason }`.
  - `ProcessingManifest` type: `{ batchId: string; validRows: number; rejectedRows: number; flaggedRows: number; errors: RowError[]; processedAt: string; sourceSha256: string }`.
  - `RowError` type: `{ row: number; field: string; value: unknown; message: string }`.
  - `Settlement` type matching RF-04 response shape.

- [ ] **Step 1: Write failing test `transaction.spec.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { toTransaction } from './transaction.js';

describe('toTransaction', () => {
  it('maps a validated raw row into a Transaction', () => {
    const t = toTransaction({
      transaction_id: 'TXN001', member_id: 'MEM001', partner_id: 'PART01',
      points_earned: '150', points_redeemed: '0', transaction_date: '2026-07-01',
      partner_name: 'Café Central',
    });
    expect(t).toEqual({
      transactionId: 'TXN001', memberId: 'MEM001', partnerId: 'PART01',
      pointsEarned: 150, pointsRedeemed: 0, transactionDate: '2026-07-01',
      partnerName: 'Café Central',
    });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/domain/model/transaction.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement models**

`src/domain/model/transaction.ts`:
```ts
export interface RawTransactionRow {
  transaction_id: string;
  member_id: string;
  partner_id: string;
  points_earned: string;
  points_redeemed: string;
  transaction_date: string;
  partner_name: string;
}
export interface Transaction {
  transactionId: string;
  memberId: string;
  partnerId: string;
  pointsEarned: number;
  pointsRedeemed: number;
  transactionDate: string;
  partnerName: string;
}
export function toTransaction(row: RawTransactionRow): Transaction {
  return {
    transactionId: row.transaction_id,
    memberId: row.member_id,
    partnerId: row.partner_id,
    pointsEarned: Number(row.points_earned),
    pointsRedeemed: Number(row.points_redeemed),
    transactionDate: row.transaction_date,
    partnerName: row.partner_name,
  };
}
```

`src/domain/model/flagged-transaction.ts`:
```ts
import type { Transaction } from './transaction.js';
export type FlagReason = 'RN-01' | 'RN-02' | 'RN-03' | 'RN-04';
export type FlaggedTransaction = Transaction & { flagReason: FlagReason };
```

`src/domain/model/manifest.ts`:
```ts
export interface RowError { row: number; field: string; value: unknown; message: string }
export interface ProcessingManifest {
  batchId: string;
  validRows: number;
  rejectedRows: number;
  flaggedRows: number;
  errors: RowError[];
  processedAt: string;
  sourceSha256: string;
}
```

`src/domain/model/settlement.ts`:
```ts
export interface DailyBreakdown { date: string; transactions: number; points_earned: number; points_redeemed: number }
export interface Settlement {
  partner_id: string;
  partner_name: string;
  period: { from: string; to: string };
  summary: {
    total_transactions: number;
    total_points_earned: number;
    total_points_redeemed: number;
    net_points_owed: number;
    unique_members: number;
  };
  daily_breakdown: DailyBreakdown[];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/domain/model/transaction.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/model
git commit -m "feat(domain): add transaction, flagged, manifest, settlement models"
```

---

### Task 5: Field validator (RF-01)

**Files:**
- Create: `src/domain/services/field-validator.ts`
- Test: `src/domain/services/field-validator.spec.ts`

**Interfaces:**
- Consumes: value objects (Task 3), `RawTransactionRow`, `RowError`, `Transaction`, `toTransaction` (Task 4).
- Produces:
  - `validateRows(rows: RawTransactionRow[]): { valid: Transaction[]; errors: RowError[] }`.
  - Row numbering is 1-based over data rows (header excluded). Duplicate `transaction_id` within the file → error on the second+ occurrence (field `transaction_id`).

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { validateRows } from './field-validator.js';
import type { RawTransactionRow } from '../model/transaction.js';

const base: RawTransactionRow = {
  transaction_id: 'TXN001', member_id: 'MEM001', partner_id: 'PART01',
  points_earned: '150', points_redeemed: '0', transaction_date: '2026-07-01', partner_name: 'Café Central',
};

describe('validateRows', () => {
  it('passes a fully valid row', () => {
    const { valid, errors } = validateRows([base]);
    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });
  it('flags invalid member_id with row number', () => {
    const { valid, errors } = validateRows([{ ...base, member_id: 'MEMX1' }]);
    expect(valid).toHaveLength(0);
    expect(errors[0]).toMatchObject({ row: 1, field: 'member_id' });
  });
  it('flags negative points_earned', () => {
    const { errors } = validateRows([{ ...base, points_earned: '-5' }]);
    expect(errors[0]).toMatchObject({ row: 1, field: 'points_earned' });
  });
  it('detects duplicate transaction_id on second occurrence', () => {
    const { valid, errors } = validateRows([base, { ...base, member_id: 'MEM002' }]);
    expect(valid).toHaveLength(1);
    expect(errors[0]).toMatchObject({ row: 2, field: 'transaction_id' });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/domain/services/field-validator.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `field-validator.ts`**

```ts
import { MemberId } from '../value-objects/member-id.js';
import { PartnerId } from '../value-objects/partner-id.js';
import { Points } from '../value-objects/points.js';
import { TransactionDate } from '../value-objects/transaction-date.js';
import { ValidationError } from '../errors.js';
import { toTransaction, type RawTransactionRow, type Transaction } from '../model/transaction.js';
import type { RowError } from '../model/manifest.js';

const REQUIRED: (keyof RawTransactionRow)[] = [
  'transaction_id', 'member_id', 'partner_id', 'points_earned',
  'points_redeemed', 'transaction_date', 'partner_name',
];

export function validateRows(rows: RawTransactionRow[]): { valid: Transaction[]; errors: RowError[] } {
  const valid: Transaction[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    const rowErrors: RowError[] = [];

    for (const col of REQUIRED) {
      if (row[col] === undefined || row[col] === null || row[col] === '') {
        rowErrors.push({ row: rowNum, field: col, value: row[col], message: `${col} es requerido` });
      }
    }
    if (rowErrors.length === 0) {
      const checks: [() => void][] = [
        [() => MemberId.create(row.member_id)],
        [() => PartnerId.create(row.partner_id)],
        [() => Points.create(row.points_earned, 'points_earned')],
        [() => Points.create(row.points_redeemed, 'points_redeemed')],
        [() => TransactionDate.create(row.transaction_date)],
      ];
      for (const [fn] of checks) {
        try { fn(); } catch (e) {
          if (e instanceof ValidationError) rowErrors.push({ row: rowNum, field: e.field, value: e.value, message: e.message });
        }
      }
      if (seen.has(row.transaction_id)) {
        rowErrors.push({ row: rowNum, field: 'transaction_id', value: row.transaction_id, message: 'transaction_id duplicado dentro del archivo' });
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    } else {
      seen.add(row.transaction_id);
      valid.push(toTransaction(row));
    }
  });

  return { valid, errors };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/domain/services/field-validator.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/services/field-validator.ts src/domain/services/field-validator.spec.ts
git commit -m "feat(domain): add CSV field validator with duplicate detection (RF-01)"
```

---

### Task 6: Business rules RN-01..RN-04 (RF-05)

**Files:**
- Create: `src/domain/services/business-rules.ts`
- Test: `src/domain/services/business-rules.spec.ts`

**Interfaces:**
- Consumes: `Transaction`, `FlaggedTransaction`, `FlagReason` (Task 4).
- Produces:
  - `applyBusinessRules(txns: Transaction[], now: Date): { clean: Transaction[]; flagged: FlaggedTransaction[] }`.
  - Rules (evaluated per the spec; a txn flagged by any rule goes to `flagged` once with the first matching reason, ordered RN-04, RN-02, RN-01, RN-03):
    - RN-04: `transaction_date` > `now` OR < `now - 2 years` → flag `RN-04`.
    - RN-02: within a (partner_id, date) group, if `redeemed>0` transactions exceed 30% of that group's count, flag the redeeming transactions beyond the allowed count as `RN-02`.
    - RN-01: within a (member_id, date) group, ordered by `transaction_id`, accumulate `pointsEarned - pointsRedeemed`; once cumulative net > 10000, flag subsequent as `RN-01`.
    - RN-03: within a (member_id, partner_id, date) group, ordered by `transaction_id`, the 6th+ transaction → flag `RN-03`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { applyBusinessRules } from './business-rules.js';
import type { Transaction } from '../model/transaction.js';

const t = (o: Partial<Transaction> & { transactionId: string }): Transaction => ({
  memberId: 'MEM001', partnerId: 'PART01', pointsEarned: 100, pointsRedeemed: 0,
  transactionDate: '2026-07-01', partnerName: 'Café Central', ...o,
});
const NOW = new Date('2026-07-09T00:00:00.000Z');

describe('applyBusinessRules', () => {
  it('RN-04 flags future dates', () => {
    const { clean, flagged } = applyBusinessRules([t({ transactionId: 'A', transactionDate: '2027-01-01' })], NOW);
    expect(clean).toHaveLength(0);
    expect(flagged[0].flagReason).toBe('RN-04');
  });
  it('RN-04 flags dates older than 2 years', () => {
    const { flagged } = applyBusinessRules([t({ transactionId: 'A', transactionDate: '2024-01-01' })], NOW);
    expect(flagged[0].flagReason).toBe('RN-04');
  });
  it('RN-01 flags txns after cumulative net exceeds 10000 for a member/day', () => {
    const txns = [
      t({ transactionId: 'A', pointsEarned: 9000 }),
      t({ transactionId: 'B', pointsEarned: 2000 }),
      t({ transactionId: 'C', pointsEarned: 500 }),
    ];
    const { clean, flagged } = applyBusinessRules(txns, NOW);
    expect(clean.map((x) => x.transactionId)).toEqual(['A', 'B']);
    expect(flagged.map((x) => [x.transactionId, x.flagReason])).toEqual([['C', 'RN-01']]);
  });
  it('RN-03 flags the 6th+ txn for same member/partner/day', () => {
    const txns = Array.from({ length: 7 }, (_, i) => t({ transactionId: `T${i}`, pointsEarned: 1 }));
    const { clean, flagged } = applyBusinessRules(txns, NOW);
    expect(clean).toHaveLength(5);
    expect(flagged).toHaveLength(2);
    expect(flagged.every((x) => x.flagReason === 'RN-03')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/domain/services/business-rules.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `business-rules.ts`**

```ts
import type { Transaction } from '../model/transaction.js';
import type { FlaggedTransaction, FlagReason } from '../model/flagged-transaction.js';

const DAILY_NET_LIMIT = 10000;
const MAX_TXNS_PER_MEMBER_PARTNER_DAY = 5;
const MAX_REDEEM_RATIO = 0.3;

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    (m.get(k) ?? m.set(k, []).get(k)!).push(it);
  }
  return m;
}

export function applyBusinessRules(txns: Transaction[], now: Date): { clean: Transaction[]; flagged: FlaggedTransaction[] } {
  const reason = new Map<string, FlagReason>(); // transactionId -> first reason

  const setIfAbsent = (id: string, r: FlagReason) => { if (!reason.has(id)) reason.set(id, r); };
  const twoYearsAgo = new Date(now); twoYearsAgo.setUTCFullYear(now.getUTCFullYear() - 2);

  // RN-04
  for (const t of txns) {
    const d = new Date(`${t.transactionDate}T00:00:00.000Z`);
    if (d.getTime() > now.getTime() || d.getTime() < twoYearsAgo.getTime()) setIfAbsent(t.transactionId, 'RN-04');
  }

  // RN-02: per (partner, day)
  for (const group of groupBy(txns, (t) => `${t.partnerId}|${t.transactionDate}`).values()) {
    const redeemers = group.filter((t) => t.pointsRedeemed > 0).sort((a, b) => a.transactionId.localeCompare(b.transactionId));
    const allowed = Math.floor(group.length * MAX_REDEEM_RATIO);
    redeemers.slice(allowed).forEach((t) => setIfAbsent(t.transactionId, 'RN-02'));
  }

  // RN-01: per (member, day), cumulative net
  for (const group of groupBy(txns, (t) => `${t.memberId}|${t.transactionDate}`).values()) {
    let net = 0;
    for (const t of [...group].sort((a, b) => a.transactionId.localeCompare(b.transactionId))) {
      net += t.pointsEarned - t.pointsRedeemed;
      if (net > DAILY_NET_LIMIT) setIfAbsent(t.transactionId, 'RN-01');
    }
  }

  // RN-03: per (member, partner, day), 6th+
  for (const group of groupBy(txns, (t) => `${t.memberId}|${t.partnerId}|${t.transactionDate}`).values()) {
    [...group].sort((a, b) => a.transactionId.localeCompare(b.transactionId))
      .slice(MAX_TXNS_PER_MEMBER_PARTNER_DAY)
      .forEach((t) => setIfAbsent(t.transactionId, 'RN-03'));
  }

  const clean: Transaction[] = [];
  const flagged: FlaggedTransaction[] = [];
  for (const t of txns) {
    const r = reason.get(t.transactionId);
    if (r) flagged.push({ ...t, flagReason: r });
    else clean.push(t);
  }
  return { clean, flagged };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/domain/services/business-rules.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/services/business-rules.ts src/domain/services/business-rules.spec.ts
git commit -m "feat(domain): add cross-cutting business rules RN-01..RN-04 (RF-05)"
```

---

### Task 7: Settlement calculator (RF-04)

**Files:**
- Create: `src/domain/services/settlement-calculator.ts`
- Test: `src/domain/services/settlement-calculator.spec.ts`

**Interfaces:**
- Consumes: `Transaction` (Task 4), `Settlement`, `DailyBreakdown` (Task 4).
- Produces:
  - `enumerateDates(from: string, to: string): string[]` — inclusive, `YYYY-MM-DD`.
  - `calculateSettlement(input: { partnerId: string; partnerName: string; from: string; to: string; transactions: Transaction[] }): Settlement`.
  - `net_points_owed`: real value if ≥ 0 else `0` (external). daily_breakdown covers every day in range.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { calculateSettlement, enumerateDates } from './settlement-calculator.js';
import type { Transaction } from '../model/transaction.js';

const t = (o: Partial<Transaction> & { transactionId: string }): Transaction => ({
  memberId: 'MEM001', partnerId: 'PART01', pointsEarned: 0, pointsRedeemed: 0,
  transactionDate: '2026-07-01', partnerName: 'Café Central', ...o,
});

describe('enumerateDates', () => {
  it('is inclusive of both ends', () => {
    expect(enumerateDates('2026-07-01', '2026-07-03')).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
  });
});

describe('calculateSettlement', () => {
  const input = {
    partnerId: 'PART01', partnerName: 'Café Central', from: '2026-07-01', to: '2026-07-02',
    transactions: [
      t({ transactionId: 'A', pointsEarned: 150, memberId: 'MEM001' }),
      t({ transactionId: 'B', pointsRedeemed: 50, memberId: 'MEM002' }),
    ],
  };
  it('computes summary and net owed', () => {
    const s = calculateSettlement(input);
    expect(s.summary.total_transactions).toBe(2);
    expect(s.summary.total_points_earned).toBe(150);
    expect(s.summary.total_points_redeemed).toBe(50);
    expect(s.summary.net_points_owed).toBe(100);
    expect(s.summary.unique_members).toBe(2);
  });
  it('reports 0 net when negative', () => {
    const s = calculateSettlement({ ...input, transactions: [t({ transactionId: 'A', pointsRedeemed: 500 })] });
    expect(s.summary.net_points_owed).toBe(0);
  });
  it('fills all days in range with zeros', () => {
    const s = calculateSettlement(input);
    expect(s.daily_breakdown).toHaveLength(2);
    expect(s.daily_breakdown[1]).toEqual({ date: '2026-07-02', transactions: 0, points_earned: 0, points_redeemed: 0 });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/domain/services/settlement-calculator.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `settlement-calculator.ts`**

```ts
import type { Transaction } from '../model/transaction.js';
import type { Settlement, DailyBreakdown } from '../model/settlement.js';

export function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cur.getTime() <= end.getTime()) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function calculateSettlement(input: {
  partnerId: string; partnerName: string; from: string; to: string; transactions: Transaction[];
}): Settlement {
  const { partnerId, partnerName, from, to, transactions } = input;
  const totalEarned = transactions.reduce((a, t) => a + t.pointsEarned, 0);
  const totalRedeemed = transactions.reduce((a, t) => a + t.pointsRedeemed, 0);
  const net = totalEarned - totalRedeemed;
  const members = new Set(transactions.map((t) => t.memberId));

  const byDate = new Map<string, DailyBreakdown>();
  for (const d of enumerateDates(from, to)) byDate.set(d, { date: d, transactions: 0, points_earned: 0, points_redeemed: 0 });
  for (const t of transactions) {
    const row = byDate.get(t.transactionDate);
    if (!row) continue;
    row.transactions += 1;
    row.points_earned += t.pointsEarned;
    row.points_redeemed += t.pointsRedeemed;
  }

  return {
    partner_id: partnerId,
    partner_name: partnerName,
    period: { from, to },
    summary: {
      total_transactions: transactions.length,
      total_points_earned: totalEarned,
      total_points_redeemed: totalRedeemed,
      net_points_owed: net < 0 ? 0 : net,
      unique_members: members.size,
    },
    daily_breakdown: [...byDate.values()],
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/domain/services/settlement-calculator.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/services/settlement-calculator.ts src/domain/services/settlement-calculator.spec.ts
git commit -m "feat(domain): add settlement calculator with date fill + net owed rule (RF-04)"
```

---

### Task 8: Ports (in/out interfaces)

**Files:**
- Create: `src/application/ports/out/object-storage.port.ts`, `data-catalog.port.ts`, `transaction-repository.port.ts`, `partner-repository.port.ts`, `src/application/ports/in/upload-transactions.usecase.ts`, `get-settlement.usecase.ts`

**Interfaces:**
- Produces (out ports):
  - `ObjectStoragePort`: `putObject(key: string, body: Buffer, contentType: string): Promise<void>`.
  - `DataCatalogPort`: `ensureDatabase(name: string): Promise<void>`; `upsertTable(db: string, table: string, columns: { name: string; type: string }[]): Promise<void>`.
  - `TransactionRepositoryPort`: `saveMany(txns: Transaction[], meta: { batchId: string; processedAt: string }): Promise<void>`; `saveFlagged(flagged: FlaggedTransaction[], meta: { batchId: string; processedAt: string }): Promise<void>`; `findForSettlement(partnerId: string, from: string, to: string): Promise<Transaction[]>`.
  - `PartnerRepositoryPort`: `findName(partnerId: string): Promise<string | null>`.
- Produces (in ports):
  - `UploadTransactionsUseCase`: `execute(input: { fileBuffer: Buffer; filename: string }): Promise<ProcessingManifest & { s3Prefixes: string[] }>`.
  - `GetSettlementUseCase`: `execute(input: { partnerId: string; from: string; to: string }): Promise<Settlement>`.

- [ ] **Step 1: Write the port interfaces**

`src/application/ports/out/object-storage.port.ts`:
```ts
export interface ObjectStoragePort {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
}
```

`src/application/ports/out/data-catalog.port.ts`:
```ts
export interface GlueColumn { name: string; type: string }
export interface DataCatalogPort {
  ensureDatabase(name: string): Promise<void>;
  upsertTable(db: string, table: string, columns: GlueColumn[]): Promise<void>;
}
```

`src/application/ports/out/transaction-repository.port.ts`:
```ts
import type { Transaction } from '../../../domain/model/transaction.js';
import type { FlaggedTransaction } from '../../../domain/model/flagged-transaction.js';
export interface SaveMeta { batchId: string; processedAt: string }
export interface TransactionRepositoryPort {
  saveMany(txns: Transaction[], meta: SaveMeta): Promise<void>;
  saveFlagged(flagged: FlaggedTransaction[], meta: SaveMeta): Promise<void>;
  findForSettlement(partnerId: string, from: string, to: string): Promise<Transaction[]>;
}
```

`src/application/ports/out/partner-repository.port.ts`:
```ts
export interface PartnerRepositoryPort {
  findName(partnerId: string): Promise<string | null>;
}
```

`src/application/ports/in/upload-transactions.usecase.ts`:
```ts
import type { ProcessingManifest } from '../../../domain/model/manifest.js';
export interface UploadResult extends ProcessingManifest { s3Prefixes: string[] }
export interface UploadTransactionsUseCase {
  execute(input: { fileBuffer: Buffer; filename: string }): Promise<UploadResult>;
}
```

`src/application/ports/in/get-settlement.usecase.ts`:
```ts
import type { Settlement } from '../../../domain/model/settlement.js';
export interface GetSettlementUseCase {
  execute(input: { partnerId: string; from: string; to: string }): Promise<Settlement>;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/application/ports
git commit -m "feat(application): define in/out ports for hexagonal boundaries"
```

---

### Task 9: UploadTransactionsService (use case) with fakes

**Files:**
- Create: `src/application/services/csv-parser.ts`, `src/application/services/upload-transactions.service.ts`
- Test: `src/application/services/upload-transactions.service.spec.ts`, `test/fakes/index.ts`

**Interfaces:**
- Consumes: `validateRows` (Task 5), `applyBusinessRules` (Task 6), all out ports (Task 8), `UploadTransactionsUseCase` (Task 8).
- Produces:
  - `parseCsv(buffer: Buffer): RawTransactionRow[]` (from `csv-parser.ts`).
  - `UploadTransactionsService` implementing `UploadTransactionsUseCase`. Constructor DI: `(storage, catalog, repo, clock)` where `clock: () => Date`.
  - Behavior: parse → validate → if errors present AND zero valid rows, still stores nothing and returns manifest with errors (HTTP layer decides 400 vs 201 — see Task 14: 400 when `validRows === 0 && errors.length > 0`, else 201). Business rules split clean/flagged. S3 write groups clean txns by `{year}/{month}/{partnerId}` and writes one object per group + one manifest object. Glue `ensureDatabase` + `upsertTable`. Repo `saveMany(clean)` + `saveFlagged(flagged)`.

- [ ] **Step 1: Write fakes `test/fakes/index.ts`**

```ts
import type { ObjectStoragePort } from '../../src/application/ports/out/object-storage.port.js';
import type { DataCatalogPort } from '../../src/application/ports/out/data-catalog.port.js';
import type { TransactionRepositoryPort, SaveMeta } from '../../src/application/ports/out/transaction-repository.port.js';
import type { Transaction } from '../../src/domain/model/transaction.js';
import type { FlaggedTransaction } from '../../src/domain/model/flagged-transaction.js';

export class FakeStorage implements ObjectStoragePort {
  puts: { key: string; body: Buffer }[] = [];
  async putObject(key: string, body: Buffer) { this.puts.push({ key, body }); }
}
export class FakeCatalog implements DataCatalogPort {
  dbs: string[] = []; tables: string[] = [];
  async ensureDatabase(n: string) { this.dbs.push(n); }
  async upsertTable(db: string, t: string) { this.tables.push(`${db}.${t}`); }
}
export class FakeRepo implements TransactionRepositoryPort {
  saved: Transaction[] = []; flagged: FlaggedTransaction[] = [];
  async saveMany(txns: Transaction[], _m: SaveMeta) { this.saved.push(...txns); }
  async saveFlagged(f: FlaggedTransaction[], _m: SaveMeta) { this.flagged.push(...f); }
  async findForSettlement(partnerId: string, from: string, to: string) {
    return this.saved.filter((t) => t.partnerId === partnerId && t.transactionDate >= from && t.transactionDate <= to);
  }
}
```

- [ ] **Step 2: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { UploadTransactionsService } from './upload-transactions.service.js';
import { FakeStorage, FakeCatalog, FakeRepo } from '../../../test/fakes/index.js';

const CSV = `transaction_id,member_id,partner_id,points_earned,points_redeemed,transaction_date,partner_name
TXN001,MEM001,PART01,150,0,2026-07-01,Café Central
TXN002,MEMX1,PART01,10,0,2026-07-01,Café Central`;

describe('UploadTransactionsService', () => {
  it('stores valid rows, records errors, catalogs, and persists', async () => {
    const storage = new FakeStorage(); const catalog = new FakeCatalog(); const repo = new FakeRepo();
    const svc = new UploadTransactionsService(storage, catalog, repo, () => new Date('2026-07-09T00:00:00.000Z'));
    const res = await svc.execute({ fileBuffer: Buffer.from(CSV), filename: 'batch.csv' });
    expect(res.validRows).toBe(1);
    expect(res.rejectedRows).toBe(1);
    expect(res.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(repo.saved).toHaveLength(1);
    expect(catalog.dbs).toContain('fincard_loyalty');
    expect(storage.puts.some((p) => p.key.includes('/2026/07/PART01/'))).toBe(true);
    expect(storage.puts.some((p) => p.key.includes('manifest'))).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify fail**

Run: `npx vitest run src/application/services/upload-transactions.service.spec.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `csv-parser.ts`**

```ts
import { parse } from 'csv-parse/sync';
import type { RawTransactionRow } from '../../domain/model/transaction.js';
export function parseCsv(buffer: Buffer): RawTransactionRow[] {
  return parse(buffer, { columns: true, skip_empty_lines: true, trim: true }) as RawTransactionRow[];
}
```

- [ ] **Step 5: Implement `upload-transactions.service.ts`**

```ts
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { parseCsv } from './csv-parser.js';
import { validateRows } from '../../domain/services/field-validator.js';
import { applyBusinessRules } from '../../domain/services/business-rules.js';
import type { Transaction } from '../../domain/model/transaction.js';
import type { ObjectStoragePort } from '../ports/out/object-storage.port.js';
import type { DataCatalogPort } from '../ports/out/data-catalog.port.js';
import type { TransactionRepositoryPort } from '../ports/out/transaction-repository.port.js';
import type { UploadTransactionsUseCase, UploadResult } from '../ports/in/upload-transactions.usecase.js';

const GLUE_COLUMNS = [
  { name: 'transaction_id', type: 'string' }, { name: 'member_id', type: 'string' },
  { name: 'partner_id', type: 'string' }, { name: 'points_earned', type: 'int' },
  { name: 'points_redeemed', type: 'int' }, { name: 'transaction_date', type: 'date' },
  { name: 'partner_name', type: 'string' }, { name: 'processed_at', type: 'timestamp' },
  { name: 'batch_id', type: 'string' },
];

export class UploadTransactionsService implements UploadTransactionsUseCase {
  constructor(
    private readonly storage: ObjectStoragePort,
    private readonly catalog: DataCatalogPort,
    private readonly repo: TransactionRepositoryPort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute({ fileBuffer }: { fileBuffer: Buffer; filename: string }): Promise<UploadResult> {
    const now = this.clock();
    const processedAt = now.toISOString();
    const batchId = randomUUID();
    const sourceSha256 = createHash('sha256').update(fileBuffer).digest('hex');

    const rows = parseCsv(fileBuffer);
    const { valid, errors } = validateRows(rows);
    const { clean, flagged } = applyBusinessRules(valid, now);

    const s3Prefixes: string[] = [];
    const groups = new Map<string, Transaction[]>();
    for (const t of clean) {
      const [y, m] = t.transactionDate.split('-');
      const prefix = `${y}/${m}/${t.partnerId}`;
      (groups.get(prefix) ?? groups.set(prefix, []).get(prefix)!).push(t);
    }
    for (const [prefix, txns] of groups) {
      const body = Buffer.from(txns.map((t) => JSON.stringify({ ...t, processed_at: processedAt, batch_id: batchId })).join('\n'));
      await this.storage.putObject(`${prefix}/${batchId}.ndjson`, body, 'application/x-ndjson');
      s3Prefixes.push(prefix);
    }

    const manifest = {
      batchId, validRows: clean.length, rejectedRows: errors.length,
      flaggedRows: flagged.length, errors, processedAt, sourceSha256,
    };
    await this.storage.putObject(`manifests/${batchId}.manifest.json`, Buffer.from(JSON.stringify(manifest, null, 2)), 'application/json');

    await this.catalog.ensureDatabase('fincard_loyalty');
    await this.catalog.upsertTable('fincard_loyalty', 'transactions', GLUE_COLUMNS);

    await this.repo.saveMany(clean, { batchId, processedAt });
    await this.repo.saveFlagged(flagged, { batchId, processedAt });

    return { ...manifest, s3Prefixes };
  }
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run src/application/services/upload-transactions.service.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/application/services test/fakes
git commit -m "feat(application): add UploadTransactions use case with CSV parsing pipeline"
```

---

### Task 10: GetSettlementService (use case)

**Files:**
- Create: `src/application/services/get-settlement.service.ts`
- Test: `src/application/services/get-settlement.service.spec.ts`

**Interfaces:**
- Consumes: `calculateSettlement` (Task 7), `TransactionRepositoryPort`, `PartnerRepositoryPort` (Task 8), `NotFoundError` (Task 3), `GetSettlementUseCase` (Task 8).
- Produces: `GetSettlementService` implementing `GetSettlementUseCase`. Constructor DI: `(repo, partners)`. Throws `NotFoundError` when partner name is null.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { GetSettlementService } from './get-settlement.service.js';
import { FakeRepo } from '../../../test/fakes/index.js';
import { NotFoundError } from '../../domain/errors.js';

class FakePartners { async findName(id: string) { return id === 'PART01' ? 'Café Central' : null; } }

describe('GetSettlementService', () => {
  it('builds settlement from repo transactions', async () => {
    const repo = new FakeRepo();
    await repo.saveMany([
      { transactionId: 'A', memberId: 'MEM001', partnerId: 'PART01', pointsEarned: 150, pointsRedeemed: 0, transactionDate: '2026-07-01', partnerName: 'Café Central' },
    ], { batchId: 'b', processedAt: '2026-07-09T00:00:00.000Z' });
    const svc = new GetSettlementService(repo, new FakePartners());
    const s = await svc.execute({ partnerId: 'PART01', from: '2026-07-01', to: '2026-07-01' });
    expect(s.summary.total_points_earned).toBe(150);
    expect(s.partner_name).toBe('Café Central');
  });
  it('throws NotFoundError for unknown partner', async () => {
    const svc = new GetSettlementService(new FakeRepo(), new FakePartners());
    await expect(svc.execute({ partnerId: 'PART99', from: '2026-07-01', to: '2026-07-01' })).rejects.toThrow(NotFoundError);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/application/services/get-settlement.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `get-settlement.service.ts`**

```ts
import { calculateSettlement } from '../../domain/services/settlement-calculator.js';
import { NotFoundError } from '../../domain/errors.js';
import type { TransactionRepositoryPort } from '../ports/out/transaction-repository.port.js';
import type { PartnerRepositoryPort } from '../ports/out/partner-repository.port.js';
import type { GetSettlementUseCase } from '../ports/in/get-settlement.usecase.js';
import type { Settlement } from '../../domain/model/settlement.js';

export class GetSettlementService implements GetSettlementUseCase {
  constructor(private readonly repo: TransactionRepositoryPort, private readonly partners: PartnerRepositoryPort) {}
  async execute({ partnerId, from, to }: { partnerId: string; from: string; to: string }): Promise<Settlement> {
    const partnerName = await this.partners.findName(partnerId);
    if (!partnerName) throw new NotFoundError(`partner ${partnerId} no existe`);
    const transactions = await this.repo.findForSettlement(partnerId, from, to);
    return calculateSettlement({ partnerId, partnerName, from, to, transactions });
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/application/services/get-settlement.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/services/get-settlement.service.ts src/application/services/get-settlement.service.spec.ts
git commit -m "feat(application): add GetSettlement use case"
```

---

### Task 11: Postgres adapter + migrations (integration)

**Files:**
- Create: `migrations/001_init.sql`, `src/adapters/out/postgres/db.ts`, `src/adapters/out/postgres/transaction.repository.ts`, `src/adapters/out/postgres/partner.repository.ts`, `src/adapters/out/postgres/migrate.ts`
- Test: `src/adapters/out/postgres/transaction.repository.spec.ts`

**Interfaces:**
- Consumes: ports (Task 8), models.
- Produces:
  - `migrations/001_init.sql` creating `transactions`, `transactions_flagged`, `partners`, `members` (per spec §6) + indexes + partner seed rows (PART01..04).
  - `createDb(connectionString: string): Kysely<DB>` and `DB` schema types.
  - `PostgresTransactionRepository` implementing `TransactionRepositoryPort`.
  - `PostgresPartnerRepository` implementing `PartnerRepositoryPort`.
  - `runMigrations(db, sqlDir)`.

- [ ] **Step 1: Write `migrations/001_init.sql`**

```sql
CREATE TABLE IF NOT EXISTS partners (
  partner_id TEXT PRIMARY KEY,
  partner_name TEXT NOT NULL
);
INSERT INTO partners (partner_id, partner_name) VALUES
  ('PART01','Café Central'),('PART02','Gasolinera Express'),
  ('PART03','Tienda Moda'),('PART04','Restaurante Sabores')
ON CONFLICT (partner_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS members (
  member_id TEXT PRIMARY KEY,
  member_name TEXT NOT NULL
);
INSERT INTO members (member_id, member_name) VALUES
  ('MEM001','Ana García'),('MEM002','Carlos López'),('MEM003','María Torres'),
  ('MEM004','Pedro Ruiz'),('MEM005','Laura Díaz')
ON CONFLICT (member_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS transactions (
  transaction_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  points_earned INTEGER NOT NULL,
  points_redeemed INTEGER NOT NULL,
  transaction_date DATE NOT NULL,
  partner_name TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL,
  batch_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_txn_partner_date ON transactions (partner_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_txn_member_date ON transactions (member_id, transaction_date);

CREATE TABLE IF NOT EXISTS transactions_flagged (
  id BIGSERIAL PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  points_earned INTEGER NOT NULL,
  points_redeemed INTEGER NOT NULL,
  transaction_date DATE NOT NULL,
  partner_name TEXT NOT NULL,
  flag_reason TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL
);
```

- [ ] **Step 2: Write `src/adapters/out/postgres/db.ts`**

```ts
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

export interface DB {
  partners: { partner_id: string; partner_name: string };
  members: { member_id: string; member_name: string };
  transactions: {
    transaction_id: string; member_id: string; partner_id: string;
    points_earned: number; points_redeemed: number; transaction_date: string;
    partner_name: string; processed_at: string; batch_id: string;
  };
  transactions_flagged: {
    id?: number; transaction_id: string; member_id: string; partner_id: string;
    points_earned: number; points_redeemed: number; transaction_date: string;
    partner_name: string; flag_reason: string; batch_id: string; processed_at: string;
  };
}

export function createDb(connectionString: string): Kysely<DB> {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }) });
}
```

- [ ] **Step 3: Write `migrate.ts`**

```ts
import { readFileSync } from 'node:fs';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from './db.js';

export async function runMigrations(db: Kysely<DB>, sqlFile: string): Promise<void> {
  const ddl = readFileSync(sqlFile, 'utf8');
  await sql.raw(ddl).execute(db);
}
```

- [ ] **Step 4: Write failing integration test (Testcontainers)**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb } from './db.js';
import { runMigrations } from './migrate.js';
import { PostgresTransactionRepository } from './transaction.repository.js';
import { PostgresPartnerRepository } from './partner.repository.js';
import type { Kysely } from 'kysely';
import type { DB } from './db.js';

let container: StartedPostgreSqlContainer; let db: Kysely<DB>;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  db = createDb(container.getConnectionUri());
  await runMigrations(db, 'migrations/001_init.sql');
}, 120_000);
afterAll(async () => { await db.destroy(); await container.stop(); });

describe('PostgresTransactionRepository', () => {
  it('saves and queries transactions for settlement', async () => {
    const repo = new PostgresTransactionRepository(db);
    await repo.saveMany([
      { transactionId: 'TXN001', memberId: 'MEM001', partnerId: 'PART01', pointsEarned: 150, pointsRedeemed: 0, transactionDate: '2026-07-01', partnerName: 'Café Central' },
    ], { batchId: 'b1', processedAt: '2026-07-09T00:00:00.000Z' });
    const found = await repo.findForSettlement('PART01', '2026-07-01', '2026-07-31');
    expect(found).toHaveLength(1);
    expect(found[0].pointsEarned).toBe(150);
  });
  it('resolves partner name from seed', async () => {
    const partners = new PostgresPartnerRepository(db);
    expect(await partners.findName('PART01')).toBe('Café Central');
    expect(await partners.findName('PART99')).toBeNull();
  });
});
```

Note: install the dedicated module: `npm i -D @testcontainers/postgresql@^10`.

- [ ] **Step 5: Run to verify fail**

Run: `npx vitest run src/adapters/out/postgres/transaction.repository.spec.ts`
Expected: FAIL (repository modules not found).

- [ ] **Step 6: Implement repositories**

`src/adapters/out/postgres/transaction.repository.ts`:
```ts
import type { Kysely } from 'kysely';
import type { DB } from './db.js';
import type { Transaction } from '../../../domain/model/transaction.js';
import type { FlaggedTransaction } from '../../../domain/model/flagged-transaction.js';
import type { TransactionRepositoryPort, SaveMeta } from '../../../application/ports/out/transaction-repository.port.js';

export class PostgresTransactionRepository implements TransactionRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  async saveMany(txns: Transaction[], meta: SaveMeta): Promise<void> {
    if (txns.length === 0) return;
    await this.db.insertInto('transactions').values(txns.map((t) => ({
      transaction_id: t.transactionId, member_id: t.memberId, partner_id: t.partnerId,
      points_earned: t.pointsEarned, points_redeemed: t.pointsRedeemed, transaction_date: t.transactionDate,
      partner_name: t.partnerName, processed_at: meta.processedAt, batch_id: meta.batchId,
    }))).onConflict((oc) => oc.column('transaction_id').doNothing()).execute();
  }
  async saveFlagged(flagged: FlaggedTransaction[], meta: SaveMeta): Promise<void> {
    if (flagged.length === 0) return;
    await this.db.insertInto('transactions_flagged').values(flagged.map((t) => ({
      transaction_id: t.transactionId, member_id: t.memberId, partner_id: t.partnerId,
      points_earned: t.pointsEarned, points_redeemed: t.pointsRedeemed, transaction_date: t.transactionDate,
      partner_name: t.partnerName, flag_reason: t.flagReason, batch_id: meta.batchId, processed_at: meta.processedAt,
    }))).execute();
  }
  async findForSettlement(partnerId: string, from: string, to: string): Promise<Transaction[]> {
    const rows = await this.db.selectFrom('transactions').selectAll()
      .where('partner_id', '=', partnerId)
      .where('transaction_date', '>=', from).where('transaction_date', '<=', to)
      .execute();
    return rows.map((r) => ({
      transactionId: r.transaction_id, memberId: r.member_id, partnerId: r.partner_id,
      pointsEarned: r.points_earned, pointsRedeemed: r.points_redeemed,
      transactionDate: String(r.transaction_date).slice(0, 10), partnerName: r.partner_name,
    }));
  }
}
```

`src/adapters/out/postgres/partner.repository.ts`:
```ts
import type { Kysely } from 'kysely';
import type { DB } from './db.js';
import type { PartnerRepositoryPort } from '../../../application/ports/out/partner-repository.port.js';

export class PostgresPartnerRepository implements PartnerRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  async findName(partnerId: string): Promise<string | null> {
    const row = await this.db.selectFrom('partners').select('partner_name').where('partner_id', '=', partnerId).executeTakeFirst();
    return row?.partner_name ?? null;
  }
}
```

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run src/adapters/out/postgres/transaction.repository.spec.ts`
Expected: PASS (container starts, migrations run, assertions pass).

- [ ] **Step 8: Commit**

```bash
git add migrations src/adapters/out/postgres
git commit -m "feat(adapters): add Postgres repositories + migrations (query store)"
```

---

### Task 12: S3 adapter (RF-02)

**Files:**
- Create: `src/adapters/out/s3/s3-object-storage.ts`
- Test: `src/adapters/out/s3/s3-object-storage.spec.ts`

**Interfaces:**
- Consumes: `ObjectStoragePort` (Task 8).
- Produces: `S3ObjectStorage` implementing `ObjectStoragePort`. Constructor: `(config: { bucket: string; region: string; endpoint?: string })`. Uses `@aws-sdk/client-s3` with `forcePathStyle: true` when endpoint set (LocalStack).

- [ ] **Step 1: Write integration test (LocalStack via Testcontainers)**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { S3Client, GetObjectCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { S3ObjectStorage } from './s3-object-storage.js';

let ls: StartedTestContainer; let endpoint: string;
beforeAll(async () => {
  ls = await new GenericContainer('localstack/localstack:3').withEnvironment({ SERVICES: 's3' }).withExposedPorts(4566).start();
  endpoint = `http://${ls.getHost()}:${ls.getMappedPort(4566)}`;
  const client = new S3Client({ region: 'us-east-1', endpoint, forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
  await client.send(new CreateBucketCommand({ Bucket: 'fincard-transactions' }));
}, 120_000);
afterAll(async () => { await ls.stop(); });

describe('S3ObjectStorage', () => {
  it('puts an object retrievable at the expected key', async () => {
    const storage = new S3ObjectStorage({ bucket: 'fincard-transactions', region: 'us-east-1', endpoint });
    await storage.putObject('2026/07/PART01/b1.ndjson', Buffer.from('hello'), 'text/plain');
    const client = new S3Client({ region: 'us-east-1', endpoint, forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
    const res = await client.send(new GetObjectCommand({ Bucket: 'fincard-transactions', Key: '2026/07/PART01/b1.ndjson' }));
    expect(await res.Body!.transformToString()).toBe('hello');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/adapters/out/s3/s3-object-storage.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `s3-object-storage.ts`**

```ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import type { ObjectStoragePort } from '../../../application/ports/out/object-storage.port.js';

export interface S3Config { bucket: string; region: string; endpoint?: string }

export class S3ObjectStorage implements ObjectStoragePort {
  private readonly client: S3Client;
  constructor(private readonly config: S3Config) {
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } } : {}),
    });
  }
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType }));
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/adapters/out/s3/s3-object-storage.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/out/s3
git commit -m "feat(adapters): add S3 object storage adapter (RF-02)"
```

---

### Task 13: Glue catalog adapter (RF-03)

**Files:**
- Create: `src/adapters/out/glue/glue-catalog.ts`
- Test: `src/adapters/out/glue/glue-catalog.spec.ts`

**Interfaces:**
- Consumes: `DataCatalogPort`, `GlueColumn` (Task 8).
- Produces: `GlueCatalog` implementing `DataCatalogPort`. `ensureDatabase` is idempotent (ignore `AlreadyExistsException`); `upsertTable` creates or updates.

- [ ] **Step 1: Write integration test (LocalStack glue)**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { GlueClient, GetDatabaseCommand, GetTableCommand } from '@aws-sdk/client-glue';
import { GlueCatalog } from './glue-catalog.js';

let ls: StartedTestContainer; let endpoint: string;
beforeAll(async () => {
  ls = await new GenericContainer('localstack/localstack:3').withEnvironment({ SERVICES: 'glue' }).withExposedPorts(4566).start();
  endpoint = `http://${ls.getHost()}:${ls.getMappedPort(4566)}`;
}, 120_000);
afterAll(async () => { await ls.stop(); });

describe('GlueCatalog', () => {
  it('ensures database and upserts table idempotently', async () => {
    const cat = new GlueCatalog({ region: 'us-east-1', endpoint });
    await cat.ensureDatabase('fincard_loyalty');
    await cat.ensureDatabase('fincard_loyalty'); // idempotent
    await cat.upsertTable('fincard_loyalty', 'transactions', [
      { name: 'transaction_id', type: 'string' }, { name: 'points_earned', type: 'int' },
    ]);
    await cat.upsertTable('fincard_loyalty', 'transactions', [
      { name: 'transaction_id', type: 'string' }, { name: 'points_earned', type: 'int' },
    ]); // update path
    const client = new GlueClient({ region: 'us-east-1', endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
    await expect(client.send(new GetDatabaseCommand({ Name: 'fincard_loyalty' }))).resolves.toBeTruthy();
    const t = await client.send(new GetTableCommand({ DatabaseName: 'fincard_loyalty', Name: 'transactions' }));
    expect(t.Table?.Name).toBe('transactions');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/adapters/out/glue/glue-catalog.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `glue-catalog.ts`**

```ts
import {
  GlueClient, CreateDatabaseCommand, CreateTableCommand, UpdateTableCommand, GetTableCommand,
} from '@aws-sdk/client-glue';
import type { DataCatalogPort, GlueColumn } from '../../../application/ports/out/data-catalog.port.js';

export interface GlueConfig { region: string; endpoint?: string }

export class GlueCatalog implements DataCatalogPort {
  private readonly client: GlueClient;
  constructor(config: GlueConfig) {
    this.client = new GlueClient({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } } : {}),
    });
  }
  async ensureDatabase(name: string): Promise<void> {
    try { await this.client.send(new CreateDatabaseCommand({ DatabaseInput: { Name: name } })); }
    catch (e: any) { if (e?.name !== 'AlreadyExistsException') throw e; }
  }
  async upsertTable(db: string, table: string, columns: GlueColumn[]): Promise<void> {
    const TableInput = { Name: table, StorageDescriptor: { Columns: columns.map((c) => ({ Name: c.name, Type: c.type })) } };
    const exists = await this.client.send(new GetTableCommand({ DatabaseName: db, Name: table })).then(() => true).catch(() => false);
    if (exists) await this.client.send(new UpdateTableCommand({ DatabaseName: db, TableInput }));
    else await this.client.send(new CreateTableCommand({ DatabaseName: db, TableInput }));
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/adapters/out/glue/glue-catalog.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/out/glue
git commit -m "feat(adapters): add Glue Data Catalog adapter (RF-03)"
```

---

### Task 14: Fastify HTTP layer + error mapper (RF-01/RF-04)

**Files:**
- Create: `src/adapters/in/http/errors.ts`, `src/adapters/in/http/settlement.schema.ts`, `src/adapters/in/http/routes.ts`, `src/adapters/in/http/app.ts`
- Test: `src/adapters/in/http/routes.spec.ts`

**Interfaces:**
- Consumes: use case interfaces (Task 8), `ValidationError`, `NotFoundError` (Task 3).
- Produces:
  - `buildApp(deps: { upload: UploadTransactionsUseCase; settlement: GetSettlementUseCase }): FastifyInstance`.
  - `POST /api/v1/transactions/upload`: multipart file field `file`. Returns `400` with `{ error, totalRows, invalidRows, errors }` when `validRows===0 && errors.length>0`; else `201` with manifest+prefixes.
  - `GET /api/v1/settlements/:partnerId?from&to`: Zod-validated query (`from`,`to` required `YYYY-MM-DD`, `from<=to`). `200` settlement, `404` unknown partner, `422` bad params.

- [ ] **Step 1: Write failing route test**

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from './app.js';
import type { UploadTransactionsUseCase } from '../../../application/ports/in/upload-transactions.usecase.js';
import type { GetSettlementUseCase } from '../../../application/ports/in/get-settlement.usecase.js';

const CSV = `transaction_id,member_id,partner_id,points_earned,points_redeemed,transaction_date,partner_name
TXN001,MEM001,PART01,150,0,2026-07-01,Café Central`;

function makeApp(overrides: { upload?: Partial<UploadTransactionsUseCase>; settlement?: Partial<GetSettlementUseCase> } = {}) {
  const upload: UploadTransactionsUseCase = {
    execute: overrides.upload?.execute ?? (async () => ({
      batchId: 'b1', validRows: 1, rejectedRows: 0, flaggedRows: 0, errors: [],
      processedAt: '2026-07-09T00:00:00.000Z', sourceSha256: 'x'.repeat(64), s3Prefixes: ['2026/07/PART01'],
    })),
  };
  const settlement: GetSettlementUseCase = {
    execute: overrides.settlement?.execute ?? (async () => ({
      partner_id: 'PART01', partner_name: 'Café Central', period: { from: '2026-07-01', to: '2026-07-01' },
      summary: { total_transactions: 1, total_points_earned: 150, total_points_redeemed: 0, net_points_owed: 150, unique_members: 1 },
      daily_breakdown: [{ date: '2026-07-01', transactions: 1, points_earned: 150, points_redeemed: 0 }],
    })),
  };
  return buildApp({ upload, settlement });
}

describe('routes', () => {
  it('POST upload returns 201 with manifest', async () => {
    const app = makeApp();
    const form = new FormData();
    form.append('file', new Blob([CSV], { type: 'text/csv' }), 'batch.csv');
    const res = await app.inject({ method: 'POST', url: '/api/v1/transactions/upload', payload: form });
    expect(res.statusCode).toBe(201);
    expect(res.json().validRows).toBe(1);
    await app.close();
  });
  it('POST upload returns 400 when all rows invalid', async () => {
    const app = makeApp({ upload: { execute: async () => ({
      batchId: 'b', validRows: 0, rejectedRows: 1, flaggedRows: 0,
      errors: [{ row: 1, field: 'member_id', value: 'X', message: 'bad' }],
      processedAt: 'now', sourceSha256: 'y'.repeat(64), s3Prefixes: [],
    }) } });
    const form = new FormData();
    form.append('file', new Blob(['bad'], { type: 'text/csv' }), 'b.csv');
    const res = await app.inject({ method: 'POST', url: '/api/v1/transactions/upload', payload: form });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_FAILED');
    await app.close();
  });
  it('GET settlement validates query and returns 200', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/settlements/PART01?from=2026-07-01&to=2026-07-01' });
    expect(res.statusCode).toBe(200);
    expect(res.json().partner_id).toBe('PART01');
    await app.close();
  });
  it('GET settlement returns 422 on bad date', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/settlements/PART01?from=bad&to=2026-07-01' });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});
```

Note: install multipart form support for inject: `npm i -D form-data-encoder formdata-node` is not required — Fastify inject supports `payload` as `FormData` in Node 20. If issues arise, use `@fastify/multipart` test helper by sending raw multipart body (documented fallback below in Step 3).

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/adapters/in/http/routes.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement HTTP layer**

`src/adapters/in/http/errors.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { ValidationError, NotFoundError } from '../../../domain/errors.js';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ValidationError) return reply.status(400).send({ error: 'VALIDATION_FAILED', field: err.field, message: err.message });
    if (err instanceof NotFoundError) return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
    if ((err as any).statusCode === 400) return reply.status(422).send({ error: 'INVALID_PARAMS', message: err.message });
    app.log.error(err);
    return reply.status(500).send({ error: 'INTERNAL_ERROR' });
  });
}
```

`src/adapters/in/http/settlement.schema.ts`:
```ts
import { z } from 'zod';
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'formato YYYY-MM-DD');
export const settlementQuery = z.object({ from: DATE, to: DATE }).refine((q) => q.from <= q.to, { message: 'from debe ser <= to', path: ['from'] });
export const partnerParam = z.object({ partnerId: z.string().regex(/^PART\d{2}$/, 'partner_id inválido') });
```

`src/adapters/in/http/routes.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { settlementQuery, partnerParam } from './settlement.schema.js';
import type { UploadTransactionsUseCase } from '../../../application/ports/in/upload-transactions.usecase.js';
import type { GetSettlementUseCase } from '../../../application/ports/in/get-settlement.usecase.js';

export function registerRoutes(app: FastifyInstance, deps: { upload: UploadTransactionsUseCase; settlement: GetSettlementUseCase }): void {
  app.post('/api/v1/transactions/upload', async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.status(422).send({ error: 'INVALID_PARAMS', message: 'archivo requerido en campo "file"' });
    const buffer = await file.toBuffer();
    const result = await deps.upload.execute({ fileBuffer: buffer, filename: file.filename });
    if (result.validRows === 0 && result.errors.length > 0) {
      return reply.status(400).send({ error: 'VALIDATION_FAILED', totalRows: result.validRows + result.rejectedRows, invalidRows: result.rejectedRows, errors: result.errors });
    }
    return reply.status(201).send(result);
  });

  app.get('/api/v1/settlements/:partnerId', async (req, reply) => {
    const params = partnerParam.safeParse(req.params);
    if (!params.success) return reply.status(422).send({ error: 'INVALID_PARAMS', message: params.error.issues[0].message });
    const query = settlementQuery.safeParse(req.query);
    if (!query.success) return reply.status(422).send({ error: 'INVALID_PARAMS', message: query.error.issues[0].message });
    const result = await deps.settlement.execute({ partnerId: params.data.partnerId, from: query.data.from, to: query.data.to });
    return reply.status(200).send(result);
  });
}
```

`src/adapters/in/http/app.ts`:
```ts
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { registerRoutes } from './routes.js';
import { registerErrorHandler } from './errors.js';
import type { UploadTransactionsUseCase } from '../../../application/ports/in/upload-transactions.usecase.js';
import type { GetSettlementUseCase } from '../../../application/ports/in/get-settlement.usecase.js';

export function buildApp(deps: { upload: UploadTransactionsUseCase; settlement: GetSettlementUseCase; maxUploadBytes?: number }): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(helmet);
  app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  app.register(multipart, { limits: { fileSize: deps.maxUploadBytes ?? 10 * 1024 * 1024, files: 1 } });
  registerErrorHandler(app);
  app.register(async (instance) => registerRoutes(instance, deps));
  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/adapters/in/http/routes.spec.ts`
Expected: PASS. If `FormData` payload fails in inject, switch the two upload tests to send a hand-built multipart body:
```ts
const boundary = '----t';
const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="b.csv"\r\nContent-Type: text/csv\r\n\r\n${CSV}\r\n--${boundary}--\r\n`;
const res = await app.inject({ method: 'POST', url: '/api/v1/transactions/upload', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body });
```

- [ ] **Step 5: Commit**

```bash
git add src/adapters/in/http
git commit -m "feat(adapters): add Fastify HTTP routes + error mapper (RF-01, RF-04)"
```

---

### Task 15: Config + composition root + main (E2E local)

**Files:**
- Create: `src/config/env.ts`, `src/config/container.ts`, `src/main.ts` (replace placeholder)
- Test: `src/config/env.spec.ts`

**Interfaces:**
- Consumes: all adapters + use cases.
- Produces:
  - `loadEnv(): AppConfig` (Zod-validated env).
  - `buildContainer(config): { app }` wiring Postgres + S3 + Glue adapters into use cases and `buildApp`.
  - `main.ts` runs migrations then starts server on `PORT`.

- [ ] **Step 1: Write failing env test**

```ts
import { describe, it, expect } from 'vitest';
import { parseEnv } from './env.js';

describe('parseEnv', () => {
  it('parses valid env', () => {
    const cfg = parseEnv({ PORT: '3000', DATABASE_URL: 'postgres://x', AWS_REGION: 'us-east-1', S3_BUCKET: 'b', GLUE_DATABASE: 'd', GLUE_TABLE: 't' });
    expect(cfg.port).toBe(3000);
    expect(cfg.s3Bucket).toBe('b');
  });
  it('throws on missing DATABASE_URL', () => {
    expect(() => parseEnv({ PORT: '3000' } as any)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/config/env.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `env.ts`**

```ts
import { z } from 'zod';
const schema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url().or(z.string().startsWith('postgres')),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ENDPOINT_URL: z.string().optional(),
  S3_BUCKET: z.string(),
  GLUE_DATABASE: z.string().default('fincard_loyalty'),
  GLUE_TABLE: z.string().default('transactions'),
  MAX_UPLOAD_BYTES: z.coerce.number().default(10 * 1024 * 1024),
});
export interface AppConfig {
  port: number; databaseUrl: string; awsRegion: string; awsEndpoint?: string;
  s3Bucket: string; glueDatabase: string; glueTable: string; maxUploadBytes: number;
}
export function parseEnv(env: NodeJS.ProcessEnv): AppConfig {
  const p = schema.parse(env);
  return {
    port: p.PORT, databaseUrl: p.DATABASE_URL, awsRegion: p.AWS_REGION, awsEndpoint: p.AWS_ENDPOINT_URL,
    s3Bucket: p.S3_BUCKET, glueDatabase: p.GLUE_DATABASE, glueTable: p.GLUE_TABLE, maxUploadBytes: p.MAX_UPLOAD_BYTES,
  };
}
export const loadEnv = (): AppConfig => parseEnv(process.env);
```

- [ ] **Step 4: Implement `container.ts` and `main.ts`**

`src/config/container.ts`:
```ts
import type { AppConfig } from './env.js';
import { createDb } from '../adapters/out/postgres/db.js';
import { PostgresTransactionRepository } from '../adapters/out/postgres/transaction.repository.js';
import { PostgresPartnerRepository } from '../adapters/out/postgres/partner.repository.js';
import { S3ObjectStorage } from '../adapters/out/s3/s3-object-storage.js';
import { GlueCatalog } from '../adapters/out/glue/glue-catalog.js';
import { UploadTransactionsService } from '../application/services/upload-transactions.service.js';
import { GetSettlementService } from '../application/services/get-settlement.service.js';
import { buildApp } from '../adapters/in/http/app.js';

export function buildContainer(config: AppConfig) {
  const db = createDb(config.databaseUrl);
  const repo = new PostgresTransactionRepository(db);
  const partners = new PostgresPartnerRepository(db);
  const storage = new S3ObjectStorage({ bucket: config.s3Bucket, region: config.awsRegion, endpoint: config.awsEndpoint });
  const catalog = new GlueCatalog({ region: config.awsRegion, endpoint: config.awsEndpoint });
  const upload = new UploadTransactionsService(storage, catalog, repo);
  const settlement = new GetSettlementService(repo, partners);
  const app = buildApp({ upload, settlement, maxUploadBytes: config.maxUploadBytes });
  return { app, db };
}
```

`src/main.ts` (replace placeholder):
```ts
import { loadEnv } from './config/env.js';
import { buildContainer } from './config/container.js';
import { runMigrations } from './adapters/out/postgres/migrate.js';

async function bootstrap() {
  const config = loadEnv();
  const { app, db } = buildContainer(config);
  await runMigrations(db, 'migrations/001_init.sql');
  await app.listen({ port: config.port, host: '0.0.0.0' });
}
bootstrap().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Run env test (PASS) + full suite + typecheck**

Run: `npx vitest run src/config/env.spec.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Manual E2E against compose**

Run:
```bash
docker compose up -d
cp .env.example .env
npm run dev &
sleep 4
curl -s -F "file=@data/samples/transactions.csv" http://localhost:3000/api/v1/transactions/upload | head -c 400
curl -s "http://localhost:3000/api/v1/settlements/PART01?from=2026-07-01&to=2026-07-31" | head -c 400
```
Expected: upload returns a 201 manifest (or 400 if the sample is all-invalid — use the valid sample), settlement returns JSON. (Requires Task 16 sample file — run this step after Task 16.)

- [ ] **Step 7: Commit**

```bash
git add src/config src/main.ts
git commit -m "feat(config): add env parsing + composition root + bootstrap"
```

---

### Task 16: Sample data + seeds

**Files:**
- Create: `data/samples/transactions.csv`, `data/samples/transactions_all_invalid.csv`, `data/README.md`

**Interfaces:**
- Produces: a ≥20-row CSV containing all required edge cases; used by E2E and manual testing.

- [ ] **Step 1: Write `data/samples/transactions.csv` (≥20 rows with edge cases)**

Include exactly: ≥2 invalid `member_id`, ≥1 negative `points_earned`, ≥1 duplicate `transaction_id`, ≥1 exceeding 10,000 daily points, ≥1 future date. Example header + representative rows (fill to ≥20):
```csv
transaction_id,member_id,partner_id,points_earned,points_redeemed,transaction_date,partner_name
TXN001,MEM001,PART01,150,0,2026-07-01,Café Central
TXN002,MEM002,PART02,0,500,2026-07-01,Gasolinera Express
TXN003,MEMX1,PART01,100,0,2026-07-01,Café Central
TXN004,MEM01,PART01,100,0,2026-07-01,Café Central
TXN005,MEM003,PART01,-50,0,2026-07-01,Café Central
TXN001,MEM004,PART01,10,0,2026-07-01,Café Central
TXN006,MEM001,PART01,11000,0,2026-07-02,Café Central
TXN007,MEM002,PART02,10,0,2027-01-01,Gasolinera Express
TXN008,MEM005,PART03,200,0,2026-07-03,Tienda Moda
```
(Add TXN009..TXN022 valid rows spread across PART01..04 and MEM001..005 and dates 2026-07-01..2026-07-10 to reach ≥20 and give the settlement query real aggregates.)

- [ ] **Step 2: Write `data/README.md`** documenting which row triggers which validation/rule.

- [ ] **Step 3: Verify parse + validation on the sample**

Run:
```bash
node --input-type=module -e "import('csv-parse/sync').then(async ({parse})=>{const {readFileSync}=await import('node:fs');const rows=parse(readFileSync('data/samples/transactions.csv'),{columns:true,trim:true});console.log('rows',rows.length)})"
```
Expected: prints `rows` ≥ 20.

- [ ] **Step 4: Commit**

```bash
git add data
git commit -m "test: add sample CSV with required edge cases + data docs"
```

---

### Task 17: SQL deliverable (`queries/optimization.sql`)

**Files:**
- Create: `queries/optimization.sql`

**Interfaces:**
- Produces: the three required queries + cost/partitioning/Parquet write-up as SQL comments.

- [ ] **Step 1: Write Query 1 (Redshift monthly settlement, last 12 months)**

```sql
-- Consulta 1: Liquidación mensual por aliado (Redshift) — últimos 12 meses
SELECT
  t.partner_id,
  t.partner_name,
  TO_CHAR(t.transaction_date, 'YYYY-MM')                AS year_month,
  SUM(t.points_earned)                                  AS total_earned,
  SUM(t.points_redeemed)                                AS total_redeemed,
  SUM(t.points_earned) - SUM(t.points_redeemed)         AS net_owed
FROM transactions t
WHERE t.transaction_date >= DATEADD(month, -12, DATE_TRUNC('month', CURRENT_DATE))
GROUP BY t.partner_id, t.partner_name, TO_CHAR(t.transaction_date, 'YYYY-MM')
ORDER BY t.partner_id, year_month;
```

- [ ] **Step 2: Write Query 2 (Athena/Parquet optimized) + cost write-up**

```sql
-- Consulta 2: Misma liquidación optimizada para Athena (S3 + Parquet, particionado por year/month/partner_id)
SELECT
  partner_id,
  partner_name,
  CONCAT(year, '-', month)                     AS year_month,
  SUM(points_earned)                           AS total_earned,
  SUM(points_redeemed)                         AS total_redeemed,
  SUM(points_earned) - SUM(points_redeemed)    AS net_owed
FROM fincard_loyalty.transactions_parquet
WHERE year  BETWEEN '2025' AND '2026'          -- poda de particiones (partition pruning)
  AND   month BETWEEN '01'  AND '12'
GROUP BY partner_id, partner_name, year, month
ORDER BY partner_id, year_month;

/*
Estrategias de reducción de costos (Athena cobra $5 / TB escaneado):
1) Particionamiento por year/month/partner_id + filtros SIEMPRE sobre las claves de
   partición → "partition pruning": Athena solo lee las carpetas relevantes.
2) Formato columnar Parquet + proyección de columnas: la query solo lee
   points_earned/points_redeemed/partner_*, no el resto de columnas → menos bytes.
3) Compresión (Snappy/ZSTD) sobre Parquet → menos bytes físicos escaneados.
4) Tablas agregadas materializadas (CTAS) por mes/aliado → las dashboards consultan
   una tabla pequeña ya sumarizada en lugar de los 500M de filas crudas.
5) Partition projection en Glue → evita millones de particiones en el catálogo y
   acelera el planning sin listar S3.

Plan de particionamiento sugerido:
  s3://fincard-transactions/year=YYYY/month=MM/partner_id=PARTxx/*.parquet
  (claves: year STRING, month STRING, partner_id STRING)

Parquet vs CSV:
  - Columnar: lee solo las columnas necesarias (CSV obliga a leer filas completas).
  - Predicate pushdown + estadísticas por row-group: descarta bloques sin leerlos.
  - Compresión eficiente por columna (tipos homogéneos) → 5-10x menos bytes que CSV.
  - Resultado directo: menos TB escaneados = menor costo por consulta.
*/
```

- [ ] **Step 3: Write Query 3 (anomaly detection > 50% MoM)**

```sql
-- Consulta 3: Aliados con cambio > 50% en puntos netos liquidados vs mes anterior
WITH monthly AS (
  SELECT
    partner_id,
    partner_name,
    DATE_TRUNC('month', transaction_date)               AS month,
    SUM(points_earned) - SUM(points_redeemed)           AS net
  FROM transactions
  GROUP BY partner_id, partner_name, DATE_TRUNC('month', transaction_date)
),
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
  ROUND(100.0 * (net - prev_net) / NULLIF(ABS(prev_net), 0), 2)    AS pct_change
FROM with_prev
WHERE prev_net IS NOT NULL
  AND ABS(net - prev_net) > 0.5 * ABS(prev_net)
ORDER BY ABS(pct_change) DESC;
```

- [ ] **Step 4: Commit**

```bash
git add queries
git commit -m "feat(data): add Redshift/Athena settlement + cost optimization + anomaly SQL"
```

---

### Task 18: Documentation — README, DESIGN, ADR, Mermaid

**Files:**
- Create: `README.md`, `DESIGN.md`, `docs/adr/0001-hexagonal-architecture.md`, `docs/adr/0002-postgres-query-store.md`, `docs/adr/0003-localstack-vs-real-aws.md`

**Interfaces:**
- Produces: run-local instructions, architecture justification, Mermaid diagram, tech list, documented assumptions.

- [ ] **Step 1: Write `README.md`** with: project intro, tech stack, prerequisites, `docker compose up` + `npm run dev` steps, endpoint examples (curl), test command, the Mermaid diagram below, and the documented assumptions (from spec §12).

Mermaid diagram to embed:
```mermaid
flowchart LR
  Client -->|POST /upload CSV| HTTP[Fastify Adapter]
  Client -->|GET /settlements| HTTP
  HTTP --> UC1[UploadTransactions UseCase]
  HTTP --> UC2[GetSettlement UseCase]
  UC1 --> DOM[Domain: validator + rules]
  UC2 --> DOM2[Domain: settlement calc]
  UC1 --> S3[(S3 ObjectStorage)]
  UC1 --> GLUE[(Glue Catalog)]
  UC1 --> PG[(Postgres Repo)]
  UC2 --> PG
  subgraph AWS/LocalStack
    S3
    GLUE
  end
```

- [ ] **Step 2: Write `DESIGN.md`** — condensed from the spec (layers, dependency rule, pipeline, data model, testing strategy).

- [ ] **Step 3: Write the three ADRs** (context / decision / consequences each): hexagonal architecture; Postgres as query store (vs Athena live); LocalStack + SDK adapters (dev/prod parity).

- [ ] **Step 4: Verify Mermaid renders** (paste into README preview or `npx @mermaid-js/mermaid-cli` if available) and links resolve.

- [ ] **Step 5: Commit**

```bash
git add README.md DESIGN.md docs/adr
git commit -m "docs: add README, DESIGN, ADRs, and architecture diagram"
```

---

### Task 19: IaC — Terraform (ECS Fargate + RDS + S3 + ALB + ECR)

**Files:**
- Create: `terraform/main.tf`, `variables.tf`, `outputs.tf`, `network.tf`, `ecs.tf`, `rds.tf`, `s3.tf`, `README.md`

**Interfaces:**
- Produces: applyable Terraform provisioning VPC/subnets, ECR repo, S3 bucket `fincard-transactions`, RDS Postgres, ECS Fargate service behind ALB; outputs the ALB DNS name (deployed URL).

- [ ] **Step 1: Write `terraform/variables.tf` + `s3.tf` + `ecr` (in main.tf)**

Define `aws_region`, `project` vars; `aws_s3_bucket.transactions`; `aws_ecr_repository.app`.

- [ ] **Step 2: Write `network.tf`** — VPC, 2 public + 2 private subnets, IGW, NAT, route tables, security groups (ALB:80, app:3000 from ALB, RDS:5432 from app).

- [ ] **Step 3: Write `rds.tf`** — `aws_db_instance` Postgres 16, `db.t3.micro`, in private subnets, credentials via `aws_secretsmanager_secret`.

- [ ] **Step 4: Write `ecs.tf`** — ECS cluster, task definition (image from ECR, env incl. `DATABASE_URL` from Secrets Manager, `S3_BUCKET`, no `AWS_ENDPOINT_URL` so it hits real S3/Glue, task role with S3+Glue permissions), Fargate service, ALB + target group + listener + health check on `/health`.

- [ ] **Step 5: Write `outputs.tf`** — `alb_dns_name`, `ecr_repository_url`.

- [ ] **Step 6: Validate**

Run: `cd terraform && terraform init -backend=false && terraform validate && terraform fmt -check`
Expected: `Success! The configuration is valid.`

- [ ] **Step 7: Write `terraform/README.md`** — deploy steps: `terraform apply`, `docker build` + push to ECR, force new ECS deployment, curl the `alb_dns_name`. Put the resulting URL into the root README.

- [ ] **Step 8: Commit**

```bash
git add terraform
git commit -m "feat(iac): add Terraform for ECS Fargate + RDS + S3 + ALB + ECR"
```

---

### Task 20: CI (GitHub Actions) — optional differentiator

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: CI running lint + typecheck + tests on push/PR. (Integration tests needing Docker run on the GitHub-hosted runner which has Docker available.)

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: ci
on: [push, pull_request]
jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run lint
      - run: npx tsc --noEmit
      - run: npm test
```

- [ ] **Step 2: Verify workflow syntax** (push to a branch and confirm the Actions run is green, or validate locally with `act` if available).

- [ ] **Step 3: Commit**

```bash
git add .github
git commit -m "ci: add lint + typecheck + test workflow"
```

---

## Self-Review

**1. Spec coverage:**
- RF-01 (upload + field validation + 400 detail) → Task 5, Task 14. ✓
- RF-02 (S3 storage + path + manifest + SHA-256) → Task 9, Task 12. ✓
- RF-03 (Glue db/table) → Task 9 (calls), Task 13 (adapter). ✓
- RF-04 (settlement + net owed + daily fill) → Task 7, Task 10, Task 14. ✓
- RF-05 (RN-01..04 + transactions_flagged) → Task 6, Task 9, Task 11. ✓
- Reference data + sample CSV edge cases → Task 11 (seeds), Task 16. ✓
- Hexagonal / SOLID → Tasks 3–15 structure. ✓
- Tests → every domain/app/adapter/http task. ✓
- Dockerfile + compose → Task 2. ✓
- SQL deliverable (3 queries + cost/partition/Parquet) → Task 17. ✓
- README + Mermaid + DESIGN + ADR → Task 18. ✓
- AWS deploy + IaC → Task 19. ✓
- CI (bonus) → Task 20. ✓

**2. Placeholder scan:** No TBD/TODO left in code steps; the only "fill to ≥20 rows" note in Task 16 is an explicit data-authoring instruction with a concrete pattern, not a code placeholder.

**3. Type consistency:** `Transaction` field names (`transactionId`, `pointsEarned`, …) consistent across domain, ports, repos, use cases. Port method names (`putObject`, `ensureDatabase`, `upsertTable`, `saveMany`, `saveFlagged`, `findForSettlement`, `findName`, `execute`) consistent between Task 8 definitions and Tasks 9–15 usage. `FlagReason` union consistent (Task 4 ↔ Task 6 ↔ Task 11).
