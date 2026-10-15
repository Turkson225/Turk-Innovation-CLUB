# SPACE measured database benchmark — 2026-10-15

**Result: passed the isolated database thresholds.** This is a synthetic PostgreSQL benchmark. It does not establish live Supabase capacity or that 2,000 simultaneously active users can use the platform without delay. The live project was not contacted or modified.

Application/test revision: `b5465aa0e2a69dc050c0f1190ca0e7e261315e9c`. Full measurements are in the [original JSON report](2026-10-15-optimized-postgres.json). The runnable method is in [load_testing.md](../load_testing.md).

## Findings and next changes

All measured workloads met this run's database thresholds. Proceed to the separate staging gate before making a live-capacity claim.

At the final measured stage (100 clients), the two slowest operation p95 values were Directory page + statistics: 1.18 s and Notifications + unread counts: 0.62 s. The workload shares and counts below show their relative sample sizes.

The optimized workload uses a 24-row directory RPC with complete visible counts and facets, and an explicit learner filter on student submissions. The original baseline retrieved every visible profile. This is a comparison of the old and new application loading behavior, not the same SQL query with a smaller elapsed time. The registered-account fixture and workload shares are retained.

Next: validate these changes in separate Supabase staging with authenticated HTTP/browser sessions, Realtime and uploaded files. Include an arrival-rate burst and sustained 15–30-minute stage before making a live-capacity claim.

## Measured stages

Each client keeps one operation active with no think time. Seven operations model a mixture of member reads, teacher rosters and duplicate-safe message writes. Stages target 30 seconds; recorded elapsed time includes outstanding work finishing. A pass requires **every workload's p95 below 2,000 ms** and **unexpected errors below 1%**. p95 means 95% of recorded operations finished at or below that value; it is not a guarantee for every request.

| Active SQL clients | Operations | Ops/sec | p50 ms | p95 ms | p99 ms | Errors | Threshold |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 10 | 11953 | 398.17 | 18.03 | 73.2 | 98.85 | 0 | Pass |
| 50 | 11786 | 391.73 | 78.22 | 434.28 | 541.07 | 0 | Pass |
| 100 | 11631 | 385.23 | 152.54 | 929.12 | 1154.23 | 0 | Pass |


## p95 by operation

| Operation | 10 clients, ms | 50 clients, ms | 100 clients, ms |
| --- | ---: | ---: | ---: |
| Directory page + statistics | 104 (1197 samples) | 569 (1186 samples) | 1182.88 (1176 samples) |
| Activity feed | 10.61 (2389 samples) | 51.93 (2351 samples) | 113.51 (2307 samples) |
| Student classroom | 46.99 (2392 samples) | 241.75 (2357 samples) | 493.96 (2335 samples) |
| Teacher roster | 23.94 (596 samples) | 111 (588 samples) | 250.9 (578 samples) |
| DM history + inbox | 20 (1795 samples) | 98.83 (1770 samples) | 205.3 (1748 samples) |
| Notifications + unread counts | 56.05 (2388 samples) | 290.79 (2354 samples) | 616.63 (2321 samples) |
| DM send + identical retry | 13.34 (1196 samples) | 63.06 (1180 samples) | 198.6 (1166 samples) |

Sample counts are provided because short stages can produce sparse measurements for low-share operations. These percentiles are diagnostic estimates, not a statistical certification. Operations have different query counts, so ops/sec is not database queries/sec or website visits/sec.

## Synthetic data

- profiles: 2,000
- courses: 16
- course_enrollments: 7,964
- classroom_assignments: 128
- classroom_assignment_submissions: 7,964
- space_course_lessons: 128
- direct_messages: 100,000
- channel_messages: 20,000
- activity_posts: 10,000
- notifications: 40,000

There is one administrator, eight teachers and 1,991 learners. Every row is synthetic. Ten percent of profiles are private. The test applies 33 repository SQL files to a fresh database. Auth/Storage SQL shims support permission checks, while email/push delivery schedules are omitted. Measured requests execute under the authenticated role and a synthetic user identity. Fixture creation bypasses triggers; measured message writes do not.

## Integrity after load

- Capacity race: 25 confirmed, 75 waitlisted, for 100 registrations competing for 25 places through 25 concurrent connections.
- Duplicate message retry tokens: 0.
- Application answers visible to the test member: 1 (their own).
- Other people's private messages visible to the test member: 0.

## Environment and limits

- PostgreSQL: PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
- Node: v24.21.0; linux/x64.
- Runner CPU: AMD EPYC 7763 64-Core Processor; 4 logical CPUs reported.
- Runner memory: 15.61 GiB reported.
- Database after seeding: 109.70 MiB.
- Settings: fsync=on, max_connections=150, shared_buffers=16384 × 8kB, synchronous_commit=on, work_mem=4096 × kB.

The load generator and PostgreSQL share a GitHub Actions runner. Recorded load-generator CPU is not database CPU. These resources and timings must not be extrapolated to the club's Supabase plan. Warm cache, closed-loop traffic and 30-second stages exclude startup and long-running effects. Each later stage uses the same dataset, including earlier synthetic writes.

- Load generator and database share this machine. No network, PostgREST, Supabase compute, Auth, SMTP, Realtime, Storage, push or browser rendering is measured.
- Auth and Storage have SQL contract shims. All public application migrations are used; scheduled external workers are omitted.
- Concurrency means active SQL clients, not registered members or simultaneous signed-in browsers. Closed-loop load can hide latency under an open arrival rate.
- Directory measures one 24-row RPC page plus complete visible statistics; the earlier baseline fetched the full directory. HTTP/network cost is excluded. Other operations model selected hot paths, not complete pages.

The next capacity gate is the same application in a separate Supabase staging project with matching intended compute: authenticated HTTP/browser sessions, arrival-rate bursts, a 15–30-minute sustained stage, Realtime, uploads, cold starts and mobile network checks. Monitor resource saturation and query plans alongside end-to-end latency. A database-plus-Storage recovery rehearsal is a separate check.
