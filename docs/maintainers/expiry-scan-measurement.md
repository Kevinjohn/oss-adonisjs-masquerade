# Expiry scan measurement

The current bounded expiry query filters active rows by `expires_at`, orders by
`updated_at` and owner, then returns at most the requested batch:

```sql
SELECT * FROM masquerade_modes
WHERE state = 'active' AND expires_at <= ?
ORDER BY updated_at, authority_namespace, actor_id, actor_incarnation
LIMIT ?
```

The migration index is `(state, expires_at, updated_at)`. This report measures that query and
index on disposable databases. It does not compare a proposed replacement index.

## Method

Run `bin/measure_expiry_scan.ts` on Node 24 through `pnpm exec`. Each backend uses 100,000 owner
rows: 10,000 active and 90,000 idle. Three scenarios mark 100, 1,000, or 8,000 active rows expired;
the remaining active rows expire in the future. The query requests a batch of 100. Expiry dates
span 720 days, and `updated_at` values are spread deterministically so expiry order and sort order
do not align. The table contains the current mode columns, owner uniqueness constraint and expiry
index, with populated target, stamp and reason fields for active rows.

For each scenario, the probe updates expiry state, runs `ANALYZE` (PostgreSQL also vacuums between
scenarios to remove old tuple versions), records the query plan, times the first post-setup query,
runs five warm-ups, then records 50 wall-clock query repetitions. PostgreSQL also records
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. The first query is a separate first-touch sample; neither
SQLite's file cache nor the operating-system cache is forcibly cleared. PostgreSQL's measured
plans report zero shared-buffer reads, so its first sample is not a physical cold-disk result.
Wall-clock PostgreSQL timings include the local client round trip and decoding all returned rows;
`EXPLAIN ANALYZE` reports server execution separately.

The PostgreSQL helper starts the repository's disposable PostgreSQL 16 cluster on port 55539. The
probe creates a random schema and drops it in `finally`. The SQLite probe uses a temporary file and
removes it in `finally`. No application or customer database is read.

```sh
pnpm exec node --import=@poppinss/ts-exec --enable-source-maps bin/measure_expiry_scan.ts sqlite

DB_PORT=55539 pnpm pg:start
DB_HOST=127.0.0.1 DB_PORT=55539 DB_USER=account_kit DB_DATABASE=package_test \
  pnpm exec node --import=@poppinss/ts-exec --enable-source-maps bin/measure_expiry_scan.ts postgres
DB_PORT=55539 pnpm pg:stop
```

## Results

Environment: Node 24.21.0, pnpm 11.23.0, macOS arm64, SQLite 3.53.2, PostgreSQL 16.15. The local
PostgreSQL helper uses `fsync=off` and the server default 128 MiB `shared_buffers`; this is a
disposable measurement setup, not a production durability configuration. All three PostgreSQL
`EXPLAIN ANALYZE` plans reported zero shared-buffer reads. Both backends were queried serially on
one development machine.

| Expired rows | SQLite first / warm median / warm p95 (ms) | PostgreSQL first / warm median / warm p95 (ms) | PostgreSQL server execution (ms) |
| -----------: | -----------------------------------------: | ---------------------------------------------: | -------------------------------: |
|          100 |                      0.175 / 0.131 / 0.340 |                          1.981 / 0.507 / 0.682 |                            0.051 |
|        1,000 |                      0.507 / 0.475 / 1.049 |                          0.887 / 0.659 / 0.932 |                            0.388 |
|        8,000 |                      2.900 / 3.055 / 4.692 |                          3.040 / 2.562 / 8.290 |                            2.563 |

SQLite used `masquerade_modes_expiry_index` for all three cases and reported
`USE TEMP B-TREE FOR ORDER BY`. The measured scan and sort work grew with the expired backlog.

PostgreSQL used `Index Scan → Sort → Limit` at 100 and 1,000 expired rows. At 8,000 it switched to
`Bitmap Index Scan → Bitmap Heap Scan → top-N Sort → Limit`; the heap scan visited 8,000 rows in
459 exact heap blocks and the sort used 91 KiB of memory without temporary-file reads or writes.
The index narrows candidates, while the requested ordering still requires sorting them.

The wall-clock p95 values include occasional outliers on this development host; the small warm
medians and server-side plan times are more representative of the query itself. They
also differ in what they include: SQLite runs in-process, while PostgreSQL includes a client round
trip. Treat these as local workload observations, not cross-backend comparisons or service-level
targets.

## Recommendation

Keep the current query and index. The bounded batch still requires sorting the expired candidates,
but the largest measured backlog returned 100 rows in a 2.563 ms PostgreSQL server execution and a
3.055 ms SQLite warm median. This synthetic 100,000-owner dataset does not establish a useful
production benefit for an index migration. If a deployment later shows expiry cleanup delays, first
measure its owner count, expired backlog and batch size; any schema change should then be compared
against this query with the same selection and CAS re-read semantics.
