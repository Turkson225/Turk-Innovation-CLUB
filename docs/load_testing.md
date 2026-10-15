# Measured SPACE load tests

This is a repeatable **isolated database benchmark**, not a claim about the capacity of the live Supabase project. No production URL, member credentials, service-role key, real email, uploaded file or financial record is used. There is no database migration for the club to run for this test.

## Run it in GitHub

Open **Actions → SPACE measured database load test → Run workflow → main**. The workflow also runs when its two test scripts or workflow are changed on main. It uses a fresh PostgreSQL 17 service, installs the pinned `pg@8.16.3` client, applies the repository's application migrations, and deletes its randomly named database when finished. The disposable service is destroyed after the job. Cron and external email/push delivery workers are not installed.

Open the completed run and download **space-load-test-RUN_ID** under Artifacts. `postgres.json` contains the measured environment, schema/build revision, row counts, timing samples summarized by workload and stage, errors, thresholds and integrity checks. Artifacts are retained for 30 days. Failed thresholds cause a failed job, while the report is uploaded whenever it was produced. A setup/fixture failure is a test failure, not a capacity result.

## Dataset and workloads

The fixture uses exactly 2,000 accounts: one administrator, eight teachers and 1,991 learners. Ten percent of directory profiles are private. There are 16 workshops across the four tracks, 7,964 enrollments, 128 classwork briefs, 7,964 submissions, 128 lessons, 100,000 private messages, 20,000 channel messages, 10,000 activity posts and 40,000 notifications. Names, emails and all text are synthetic. The seeding phase bypasses application triggers only while creating fixtures; measured writes use the real application RPCs and triggers.

| Operation | Target share | What is measured |
| --- | ---: | --- |
| Complete member directory | 10% | Every authorized profile in 500-row batches, including a count |
| Activity feed | 20% | Fifty recent posts under member RLS |
| Student classroom | 20% | Workshop, lessons, classwork and the learner's submissions |
| Teacher roster | 5% | Assigned teacher roster RPC, first 500 rows |
| DM reading | 15% | Participant thread history and inbox RPC |
| Notification badge | 20% | Private notifications and channel/DM unread aggregates |
| DM sending and retry | 10% | Real message RPC followed by an identical retry; IDs must match |

Stages run at 10, 50 and 100 active SQL clients for 30 seconds each, following functional warmup. Each client keeps one operation in flight with no think time. This is a **closed-loop, warm-cache** workload. The test records actual elapsed time including the last in-flight operations, and latency includes SQL transaction setup and lock waiting. Success means each operation's p95 is below 2,000 ms and the overall unexpected-error rate is below 1%. Any stage with at least 1% unexpected errors stops the ramp. A slow stage fails even if its error count is zero.

After timed stages, 100 synthetic members compete for 25 event places using 25 concurrent connections. The result must be 25 confirmed and 75 waitlisted. The test checks retry-token uniqueness, participant DM isolation and applicant-only access to application answers.

Auth and Storage are represented by their SQL-facing schema/functions. Application policies, permissions, functions, indexes and triggers come from the actual migration files. Each workload executes as `authenticated` with a synthetic member identity, rather than measuring unrestricted superuser reads. The database and load generator share one GitHub runner; its CPU, memory, PostgreSQL settings and database size are recorded. Those resources do not describe the live Supabase compute.

## What the numbers do not establish

The test does not measure GitHub Pages/CDN delivery, mobile rendering, bad networks, PostgREST overhead/count planning, Supabase pooling/compute, email sign-in, Realtime fan-out, Storage transfer, approval-email processing or device notifications. It samples important database operations rather than complete browser page loads. Directory COUNT OVER has a different execution shape from PostgREST exact counts. A 30-second stage cannot establish long-running stability. Closed-loop clients slow their arrival rate when the server slows; an arrival-rate staging test is still required. A database-only result must not be described as “2,000 simultaneous users passed.”

## Run against a disposable local service

Use a fresh local PostgreSQL service with an empty database named `space_load_service`, no pre-existing `anon`, `authenticated` or `service_role` roles, and at least 110 available connections. The GitHub workflow sets `max_connections=150` before testing. Use PostgreSQL 17 to match the checked workflow. The runner accepts only the literal loopback address `127.0.0.1`; it does not accept an external connection URL and refuses to run if `DATABASE_URL` or `SPACE_LOAD_DATABASE_URL` is set.

```bash
npm install --prefix /tmp/space-load-tools --ignore-scripts --no-audit --no-fund pg@8.16.3
SPACE_LOAD_DISPOSABLE_SERVICE=1 \
SPACE_LOAD_PG_MODULE=/tmp/space-load-tools/node_modules/pg \
node scripts/run_load_test.mjs --seconds=30 --clients=10,50,100 --commit=YOUR_BUILD_SHA --out=load-test-results/postgres.json
```

Supply `SPACE_LOAD_PASSWORD` through the environment if the disposable service requires it. `SPACE_LOAD_PORT` can override 5432. The harness creates a new database with a random name; it never clears an existing database. The global fixture roles remain until the disposable service is destroyed, so start a fresh service before another run. The scripts are development tooling and are not included in the deployed public website.

## Complete the live-capacity assessment in staging

1. Create a **separate Supabase staging project**, using the intended production compute, pooling, region, API limits and Realtime configuration. Apply the same migration sequence; do not load synthetic accounts into production. Disable scheduled email/push workers and use a mail sink for sign-in tests.
2. Use synthetic accounts for each real role. Record the staging project reference, plan/compute, application revision, row counts and test duration. Credentials stay in local environment variables or GitHub Actions secrets; never put them in chat, source code or reports.
3. Exercise actual authenticated browser/API sessions at 10, 50 and 100 active users, then 250 only after earlier stages pass. Include read/write mixes, thread replies, assignments, event races, reconnects and private file transfers. A 2,000-account directory is a dataset target; 2,000 simultaneously active users is a separate, larger requirement.
4. Record end-to-end p50/p95/p99, throughput and failures; inspect Supabase CPU, memory, IO, query plans, connection pressure, Realtime lag and quotas during the same period. Run a sustained 15–30-minute stage and an arrival-rate burst after the initial ramp. Stop on unexpected error rates above 1%, persistent timeouts or resource saturation.
5. Tune only from measured bottlenecks, rerun the same workload, and retain before/after results. Test cold startup, a slower mobile network and a database-plus-Storage restore separately.

Official references: [Supabase performance tuning](https://supabase.com/docs/guides/platform/performance), [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod), [PostgreSQL benchmark measurement](https://www.postgresql.org/docs/current/pgbench.html).
