import fs from 'node:fs/promises';
import path from 'node:path';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node scripts/render_load_report.mjs INPUT.json OUTPUT.md');
const r=JSON.parse(await fs.readFile(input,'utf8'));
if(r.schema_version!==1||!Array.isArray(r.stages))throw Error('Unsupported report');
const labels={directory_complete:'Complete directory',directory_page:'Directory page + statistics',activity_feed:'Activity feed',classroom_student:'Student classroom',teacher_roster:'Teacher roster',dm_read:'DM history + inbox',notification_badge:'Notifications + unread counts',dm_send_retry:'DM send + identical retry'};
const rows=r.stages.map(s=>`| ${s.clients} | ${s.operations} | ${s.operations_per_second} | ${s.p50_ms} | ${s.p95_ms} | ${s.p99_ms} | ${s.errors} | ${s.passed?'Pass':'Fail'} |`).join('\n');
const workloads=Object.entries(labels).filter(([key])=>r.stages.some(s=>s.by_workload[key])).map(([key,label])=>`| ${label} | ${r.stages.map(s=>{const w=s.by_workload[key];return w?`${w.p95_ms} (${w.samples} samples)`:'—';}).join(' | ')} |`).join('\n');
const e=r.environment;
const last=r.stages.at(-1),slowest=Object.entries(last.by_workload).sort((a,b)=>b[1].p95_ms-a[1].p95_ms).slice(0,2);
const failed=r.stages.filter(s=>!s.passed).map(s=>s.clients),passed=r.stages.filter(s=>s.passed).map(s=>s.clients);
const findings=r.passed?'All measured workloads met this run\'s database thresholds. Proceed to the separate staging gate before making a live-capacity claim.':
  `Passed stages: ${passed.join(', ')||'none'} active clients. Failed stages: ${failed.join(', ')} active clients. Total unexpected errors: ${r.stages.reduce((n,s)=>n+s.errors,0)}. Compare throughput and latency in the table below; resource and query-plan evidence are needed to identify the exact cause of any slowdown.`;
const text=`# SPACE measured database benchmark — ${r.generated_at.slice(0,10)}

**Result: ${r.passed?'passed the isolated database thresholds':'did not pass the isolated database thresholds'}.** This is a synthetic PostgreSQL benchmark. It does not establish live Supabase capacity or that 2,000 simultaneously active users can use the platform without delay. The live project was not contacted or modified.

Application/test revision: \`${r.source_commit}\`. Full measurements are in the [original JSON report](${path.basename(input)}). The runnable method is in [load_testing.md](../load_testing.md).

## Findings and next changes

${findings}

At the final measured stage (${last.clients} clients), the two slowest operation p95 values were ${slowest.map(([key,w])=>`${labels[key]}: ${(w.p95_ms/1000).toFixed(2)} s`).join(' and ')}. The workload shares and counts below show their relative sample sizes.

1. Move directory search and filtering to the server and retrieve only the visible member page. Keep complete CSV exports as a separate batched operation. The earlier baseline measured a full directory; the optimized workload measures one server-filtered 24-row page with visible counts and facets.
2. Add explicit learner/course filters to student data requests, retaining RLS and separate teacher/admin scopes. The current classroom operation requests the RLS-visible submissions collection. Capture EXPLAIN ANALYZE with BUFFERS in staging to verify the effective scan and index behavior before choosing an index or policy change.
3. Rerun the same fixture and workload after those changes, then run a sustained HTTP/browser test against separate Supabase staging. Do not treat a larger database connection limit as a fix for slow queries.

## Measured stages

Each client keeps one operation active with no think time. Seven operations model a mixture of member reads, teacher rosters and duplicate-safe message writes. Stages target ${r.duration_per_stage_seconds} seconds; recorded elapsed time includes outstanding work finishing. A pass requires **every workload's p95 below 2,000 ms** and **unexpected errors below 1%**. p95 means 95% of recorded operations finished at or below that value; it is not a guarantee for every request.

| Active SQL clients | Operations | Ops/sec | p50 ms | p95 ms | p99 ms | Errors | Threshold |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${rows}

${r.stopped_reason?`Ramp stopped: ${r.stopped_reason}\n`:''}
## p95 by operation

| Operation | ${r.stages.map(s=>`${s.clients} clients, ms`).join(' | ')} |
| --- | ${r.stages.map(()=>'---:').join(' | ')} |
${workloads}

Sample counts are provided because short stages can produce sparse measurements for low-share operations. These percentiles are diagnostic estimates, not a statistical certification. Operations have different query counts, so ops/sec is not database queries/sec or website visits/sec.

## Synthetic data

${Object.entries(r.dataset).map(([k,v])=>`- ${k}: ${v.toLocaleString('en-US')}`).join('\n')}

There are one administrator, eight teachers and 1,991 learners. Every row is synthetic. Ten percent of profiles are private. The test applies ${r.migrations.length} repository SQL files to a fresh database. Auth/Storage SQL shims support permission checks, while email/push delivery schedules are omitted. Measured requests execute under the authenticated role and a synthetic user identity. Fixture creation bypasses triggers; measured message writes do not.

## Integrity after load

- Capacity race: ${r.integrity.event_capacity?.confirmed} confirmed, ${r.integrity.event_capacity?.waitlisted} waitlisted, for 100 registrations competing for 25 places through ${r.integrity.event_capacity?.concurrent_clients} concurrent connections.
- Duplicate message retry tokens: ${r.integrity.duplicate_retry_tokens}.
- Application answers visible to the test member: ${r.integrity.member_application_answers_visible} (their own).
- Other people's private messages visible to the test member: ${r.integrity.nonparticipant_dm_visible}.

## Environment and limits

- PostgreSQL: ${e.postgresql}
- Node: ${e.node}; ${e.platform}/${e.arch}.
- Runner CPU: ${e.cpu_model}; ${e.logical_cpu_count} logical CPUs reported.
- Runner memory: ${(e.total_memory_bytes/1024**3).toFixed(2)} GiB reported.
- Database after seeding: ${(e.database_bytes/1024**2).toFixed(2)} MiB.
- Settings: ${e.database_settings.map(x=>`${x.name}=${x.setting}${x.unit?' × '+x.unit:''}`).join(', ')}.

The load generator and PostgreSQL share a GitHub Actions runner. Recorded load-generator CPU is not database CPU. These resources and timings must not be extrapolated to the club's Supabase plan. Warm cache, closed-loop traffic and ${r.duration_per_stage_seconds}-second stages exclude startup and long-running effects. Each later stage uses the same dataset, including earlier synthetic writes.

${r.limitations.map(x=>`- ${x}`).join('\n')}

The next capacity gate is the same application in a separate Supabase staging project with matching intended compute: authenticated HTTP/browser sessions, arrival-rate bursts, a 15–30-minute sustained stage, Realtime, uploads, cold starts and mobile network checks. Monitor resource saturation and query plans alongside end-to-end latency. A database-plus-Storage recovery rehearsal is a separate check.
`;
await fs.writeFile(output,text);
console.log(output);
