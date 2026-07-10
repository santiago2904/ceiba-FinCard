# Sample data

This directory contains sample CSV files for manually and automatically testing the
FinCard upload endpoint (field validation + business rules) and the settlement query.

## Reference data used across the samples

| Partner ID | Partner name         |
|------------|-----------------------|
| PART01     | Café Central          |
| PART02     | Gasolinera Express    |
| PART03     | Tienda Moda           |
| PART04     | Restaurante Sabores   |

| Member ID |
|-----------|
| MEM001    |
| MEM002    |
| MEM003    |
| MEM004    |
| MEM005    |

Valid formats: `member_id` matches `^MEM\d{3}$`, `partner_id` matches `^PART\d{2}$`,
`points_earned`/`points_redeemed` are non-negative integers, `transaction_date` is a
valid `YYYY-MM-DD` date.

## `samples/transactions.csv`

27 data rows (header not counted). Column order:
`transaction_id,member_id,partner_id,points_earned,points_redeemed,transaction_date,partner_name`.

Dates span `2026-07-01`..`2026-07-10` (except the one deliberate future-date row), across
all 4 partners and all 5 members, so a settlement query for `PART01` over July 2026 returns
non-zero, meaningful aggregates.

### Row-by-row outcome

Row numbers below are 1-indexed data rows (i.e. row 1 = first line after the header).

| Row | transaction_id | member_id | partner_id | earned | redeemed | date       | Outcome |
|-----|-----------------|-----------|------------|--------|----------|------------|---------|
| 1   | TXN001          | MEM001    | PART01     | 150    | 0        | 2026-07-01 | Clean (valid, not flagged) |
| 2   | TXN002          | MEM002    | PART02     | 300    | 0        | 2026-07-01 | Clean |
| 3   | TXN003          | MEMX1     | PART01     | 100    | 0        | 2026-07-01 | **Field error** — invalid `member_id` (fails `^MEM\d{3}$`) |
| 4   | TXN004          | MEM01     | PART01     | 100    | 0        | 2026-07-01 | **Field error** — invalid `member_id` (only 2 digits) |
| 5   | TXN005          | MEM003    | PART01     | -50    | 0        | 2026-07-01 | **Field error** — negative `points_earned` |
| 6   | TXN001 (dup)    | MEM004    | PART01     | 10     | 0        | 2026-07-01 | **Field error** — duplicate `transaction_id` (same id as row 1, within the same file) |
| 7   | TXN006          | MEM001    | PART01     | 11000  | 0        | 2026-07-02 | Valid fields, but **flagged RN-01** — single-transaction daily net (11000) exceeds the 10,000 member/day cumulative limit |
| 8   | TXN007          | MEM002    | PART02     | 10     | 0        | 2027-01-01 | Valid fields, but **flagged RN-04** — future transaction date |
| 9   | TXN008          | MEM005    | PART03     | 200    | 0        | 2026-07-03 | Clean |
| 10  | TXN009          | MEM002    | PART01     | 300    | 0        | 2026-07-01 | Clean |
| 11  | TXN010          | MEM003    | PART02     | 150    | 50       | 2026-07-02 | Valid fields, but **flagged RN-02** — lone redemption in its partner/day group (redeemer ratio exceeds the allowed 30% for that group size) |
| 12  | TXN011          | MEM004    | PART03     | 400    | 0        | 2026-07-02 | Clean |
| 13  | TXN012          | MEM005    | PART04     | 250    | 0        | 2026-07-02 | Clean |
| 14  | TXN013          | MEM001    | PART02     | 180    | 20       | 2026-07-03 | **Flagged RN-02** (same reason as row 11) |
| 15  | TXN014          | MEM002    | PART03     | 220    | 0        | 2026-07-03 | Clean |
| 16  | TXN015          | MEM003    | PART04     | 300    | 0        | 2026-07-03 | Clean |
| 17  | TXN016          | MEM004    | PART01     | 150    | 0        | 2026-07-04 | Clean |
| 18  | TXN017          | MEM005    | PART02     | 100    | 10       | 2026-07-04 | **Flagged RN-02** (same reason as row 11) |
| 19  | TXN018          | MEM001    | PART03     | 275    | 0        | 2026-07-04 | Clean |
| 20  | TXN019          | MEM002    | PART04     | 190    | 0        | 2026-07-05 | Clean |
| 21  | TXN020          | MEM003    | PART01     | 320    | 0        | 2026-07-05 | Clean |
| 22  | TXN021          | MEM004    | PART02     | 210    | 0        | 2026-07-06 | Clean |
| 23  | TXN022          | MEM005    | PART03     | 180    | 30       | 2026-07-06 | **Flagged RN-02** (same reason as row 11) |
| 24  | TXN023          | MEM001    | PART04     | 260    | 0        | 2026-07-07 | Clean |
| 25  | TXN024          | MEM002    | PART01     | 340    | 0        | 2026-07-08 | Clean |
| 26  | TXN025          | MEM003    | PART02     | 150    | 0        | 2026-07-09 | Clean |
| 27  | TXN026          | MEM004    | PART03     | 220    | 0        | 2026-07-10 | Clean |

### Required edge cases (all present)

- **Invalid `member_id`** (≥2 required): rows 3 (`TXN003`, `MEMX1`) and 4 (`TXN004`, `MEM01`).
- **Negative `points_earned`** (≥1 required): row 5 (`TXN005`, `-50`).
- **Duplicate `transaction_id`** (≥1 required): row 6 reuses `TXN001` from row 1.
- **Exceeds the 10,000 daily-points limit (RN-01)** (≥1 required): row 7 (`TXN006`, 11000 earned in one transaction for `MEM001` on `2026-07-02`).
- **Future date (RN-04)** (≥1 required): row 8 (`TXN007`, `transaction_date` = `2027-01-01`).

### Business-rule summary (from actually running the validator + rule engine against this file)

- Field validation rejects 4 rows: 3, 4, 5, and 6 (23 rows pass field validation).
- Of the 23 field-valid rows, business rules flag 6: `TXN006` (RN-01), `TXN007` (RN-04),
  and `TXN010`/`TXN013`/`TXN017`/`TXN022` (RN-02 — each is the sole redemption in a small
  partner/day group, so it exceeds the 30% redeemer-ratio allowance for that group size).
- The remaining 17 rows are clean valid transactions and are what a settlement query
  (e.g. `PART01` for July 2026) will aggregate against.
- No row in this file triggers RN-03 (>5 transactions for the same member+partner+day) —
  every member/partner/day combination here has at most 2 transactions.

Note: because RN-04 compares each date against "today" at request time, the future-date
row (`2027-01-01`) will remain flagged for the useful life of this sample file.

## `samples/transactions_all_invalid.csv`

5 data rows, every one of which fails field validation. Used to exercise the "all rows
invalid" 400 response path (no rows make it to the business-rule stage).

| Row | transaction_id | Failure |
|-----|-----------------|---------|
| 1   | TXN101          | invalid `member_id` (`MEMBAD` does not match `^MEM\d{3}$`) |
| 2   | TXN102          | invalid `partner_id` (`PARTX` does not match `^PART\d{2}$`) |
| 3   | TXN103          | invalid `member_id` (`MEM6`, wrong digit count) **and** negative `points_earned` (`-10`) |
| 4   | TXN104          | invalid `partner_id` (`PART3`, only 1 digit) **and** invalid `transaction_date` (`2026-07-32` is not a real calendar date) |
| 5   | TXN105          | missing required `member_id` (empty field) |

## Verifying the sample parses

```bash
node --input-type=module -e "import('csv-parse/sync').then(async ({parse})=>{const {readFileSync}=await import('node:fs');const rows=parse(readFileSync('data/samples/transactions.csv'),{columns:true,trim:true,skip_empty_lines:true});console.log('rows',rows.length)})"
```

Expected output: `rows 27` (≥ 20 required).
