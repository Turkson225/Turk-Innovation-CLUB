# SPACE capacity and connection readiness

## What 2,000 members means

2,000 registered accounts is a practical planning target for a PostgreSQL-backed club. It is not the same workload as 2,000 simultaneous chats, uploads or sign-ins. No live concurrency benchmark or restore was performed against this club's Supabase project. A member count alone cannot establish capacity or guarantee zero delay. Supabase compute, Realtime limits, disk, bandwidth, query plans and SMTP throughput must match peak activity.

## Changes in this release

- Sign-in loads the open page. Other pages fetch their records when opened; startup no longer fetches the complete workspace.
- Home does not download the entire member directory. It fetches names for up to 50 recent post authors. Pages that require the directory still retrieve every authorized profile in ordered batches of 500 and render 24 cards at a time. This is complete batched retrieval, not server-side directory search.
- At most six dataset-loading tasks run together in a page batch. Small capability checks use four workers. This is a limit on those batches, not a global limit on all browser requests, uploads or Realtime connections.
- A complete directory cache is reused for two minutes on other pages; the Members page refreshes presence. Only the current account's course-choice row is fetched, including for administrators.
- Repeated background loads for the same account and page share a request. Polls are staggered between 45 and 60 seconds and failed page loads back off up to about two minutes. Chat and approval alerts keep their focused checks.
- Initial HTML, sign-in, and first visits have responsive card, list or chat skeletons. After three seconds a slow-load message appears. A page has a 20-second deadline and a retry action; failed refreshes preserve previously loaded data.
- Browser offline events show a connection banner. Automatic page, chat, unread-count, presence and approval polls pause while offline. Reconnecting refreshes the page; it does not replay unsent writes.
- Member records and signed file URLs stay in memory for the open session. Sign-out, session expiry and account changes clear loading state and cached private data. This release does not add private offline storage.

Skeletons explain waiting; they do not make a slow query or a weak connection faster. On-demand loading reduces traffic but some individual pages still load full authorized collections. Before a busy launch, profile server-side directory search/pagination, teacher review aggregates, the inbox history and administrative ledgers as data grows. CSV exports deliberately fetch all rows, independent of the screen cache.

## Checks performed

Run from the repository root:

```bash
node --check app.js
node scripts/check_workspace.mjs
node scripts/check_storage_backup.mjs
```

The offline checks cover retrieval and CSV export of 2,505 synthetic member rows, joined application answers, six-task batching, request deduplication, slow/offline/retry states, stale-response isolation and the existing role/session/messaging behavior. The Storage fixture verifies 2,505 files across all five buckets and rejects changed or missing bytes. These are correctness tests, not measurements of Supabase throughput, production response time or live recovery.

## Before calling the platform ready for a busy launch

1. In Supabase, check the actual plan, compute size, database/storage growth, Realtime connection quota, egress and Auth/SMTP rate limits. Review the [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod) and [performance guidance](https://supabase.com/docs/guides/platform/performance). Do not infer capacity from the Free or Pro label alone.
2. Use a separate staging project with production-like row counts and synthetic data. Use test accounts and a test mail sink, and disable approval-email Cron/jobs in the rehearsal. Do not send bulk sign-in emails to real members or load-test production.
3. Test a normal member, teacher, founder, administrator and investor. Mix reading Home, opening a 2,500-profile directory, chatting, opening classroom materials, submitting work and reviewing applications. Include a slow mobile connection, interrupted requests and reconnects.
4. Increase concurrent sessions gradually, for example 10, 50, 100 and 250. Test the actual anticipated peak; if the requirement is 2,000 simultaneous active users, test that separately after earlier stages pass. Observe API latency, errors, database CPU/memory/IO, pool saturation, slow RLS/query plans, Realtime lag and upload/SMTP failures.
5. Agree on acceptance targets before the test. Suggested starting targets are authenticated page data p95 under two seconds on a normal connection, under 1% unexpected request errors, no duplicate writes and no missing records. These are proposed targets, not achieved results. Measure cold starts separately from cached visits and exclude email delivery wait from API latency.
6. Use actual slow-query evidence to add indexes or aggregates and adjust compute. Follow [connection-management guidance](https://supabase.com/docs/guides/database/connection-management); raising the API row limit or pool size blindly can increase pressure.
7. Repeat the staged workload after changes. Record the build SHA, dataset sizes, plan/compute, concurrency, duration, p95/p99, error rates and any remaining bottlenecks.

## Backup and recovery

The administrator's **Admin overview → Download CSV** exports complete authorized reports in 500-row batches. A CSV is not a backup of Auth, relationships, permissions or uploaded bytes. Exports and file downloads are not atomic snapshots; use a quiet period and verify the result.

Follow [backup_restore.md](backup_restore.md) to pair a database backup with all installed Storage buckets, verify the downloaded hashes, and restore to a separate project. Supabase database backups omit uploaded file bytes. Paid-plan daily backups and point-in-time recovery depend on the project's actual configuration; a link to the guide does not enable them. Keep encrypted off-site copies with a defined retention period, and record the last successful database backup, file verification and separate-project restore.

No database migration is needed for this loading update. No scheduled backup or live restore has been enabled by this release.
