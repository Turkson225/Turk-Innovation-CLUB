// Uses a disposable loopback PostgreSQL service and creates a fresh random database.
// Dependencies and methodology: docs/load_testing.md
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {prepareFixture,uuid,migrations} from './load_test_fixture.mjs';

const require=createRequire(import.meta.url);
const {Client}=require(process.env.SPACE_LOAD_PG_MODULE||'pg');
const options=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
const duration=Number(options.seconds||30),stages=(options.clients||'10,50,100').split(',').map(Number);
if(!(duration>=2&&duration<=300)||stages.some(n=>!Number.isInteger(n)||n<1||n>100))throw Error('Use --seconds=2..300 and --clients=1..100');
if(process.env.DATABASE_URL||process.env.SPACE_LOAD_DATABASE_URL)throw Error('External database URLs are not supported. Unset DATABASE_URL for this isolated test.');
if(process.env.SPACE_LOAD_DISPOSABLE_SERVICE!=='1')throw Error('Requires a fresh disposable service: SPACE_LOAD_DISPOSABLE_SERVICE=1. See docs/load_testing.md.');
const out=path.resolve(options.out||'docs/load-test-results/local.json');
const database='space_load_'+crypto.randomBytes(8).toString('hex');
const cfg={host:'127.0.0.1',port:Number(process.env.SPACE_LOAD_PORT||5432),user:'postgres',database:'space_load_service',password:process.env.SPACE_LOAD_PASSWORD,application_name:'SPACE isolated load test',connectionTimeoutMillis:15000};
const percentile=(a,p)=>a.length?[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.ceil(a.length*p)-1)]:null;
const rounded=n=>n===null?null:Math.round(n*100)/100;
const stats=a=>({samples:a.length,p50_ms:rounded(percentile(a,.5)),p95_ms:rounded(percentile(a,.95)),p99_ms:rounded(percentile(a,.99)),max_ms:rounded(a.length?a.reduce((m,v)=>Math.max(m,v),0):null)});
async function actor(db,n,fn){
 await db.query('begin');
 try{await db.query('set local role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uuid(n)]);
  const r=await fn(db);await db.query('commit');return r;
 }catch(e){await db.query('rollback');throw e;}
}
const workloads=[
 {name:'directory_complete',weight:10,role:'member',run:async(db,n)=>{
   let total=0,count=0;do {const r=await db.query('select *,count(*) over() as load_total from profiles order by created_at desc,id desc limit 500 offset $1',[total]);count=Number(r.rows[0]?.load_total||0);total+=r.rowCount;}while(total<count);
   assert(total>=1800&&total<=2000);return total;
 }},
 {name:'activity_feed',weight:20,role:'member',run:async db=>{const r=await db.query('select * from activity_posts order by created_at desc,id desc limit 50');assert.equal(r.rowCount,50);}},
 {name:'classroom_student',weight:20,role:'member',run:async(db,n)=>{
   const course=uuid(10001+(n%4)*4);await db.query('select * from courses where id=$1',[course]);
   assert.equal((await db.query('select * from space_course_lessons where course_id=$1 order by position',[course])).rowCount,8);
   await db.query('select * from classroom_assignments where course_id=$1 order by created_at desc,id desc limit 500',[course]);
   const r=await db.query('select * from classroom_assignment_submissions order by created_at desc,id desc limit 500');assert(r.rows.every(x=>x.learner_id===uuid(n)));
 }},
 {name:'teacher_roster',weight:5,role:'teacher',run:async db=>{const r=await db.query('select * from teacher_course_roster() order by course_id,learner_id limit 500');assert(r.rowCount>0);}},
 {name:'dm_read',weight:15,role:'member',run:async(db,n)=>{const peer=uuid(n===2000?10:n+1);const r=await db.query('select * from direct_messages where sender_id=any($1::uuid[]) and recipient_id=any($1::uuid[]) order by created_at desc,id desc limit 50',[[uuid(n),peer]]);assert(r.rows.every(x=>[x.sender_id,x.recipient_id].includes(uuid(n))));await db.query('select * from club_dm_inbox(30,0)');}},
 {name:'notification_badge',weight:20,role:'member',run:async(db,n)=>{const r=await db.query('select * from notifications order by created_at desc,id desc limit 50');assert(r.rows.every(x=>x.user_id===uuid(n)));await db.query('select club_unread_counts()');}},
 {name:'dm_send_retry',weight:10,role:'member',run:async(db,n)=>{
   const token=crypto.randomUUID(),peer=uuid(n===2000?10:n+1),body='Isolated synthetic message '+token;
   const r=await db.query('select (space_send_dm($1,$2,null,null,$3)).id',[peer,body,token]);
   const retry=await db.query('select (space_send_dm($1,$2,null,null,$3)).id',[peer,body,token]);assert.equal(r.rows[0].id,retry.rows[0].id);
 }}
];
const deck=workloads.flatMap(w=>Array(w.weight).fill(w));
let service,created=false,admin,clients=[];const report={
 schema_version:1,generated_at:new Date().toISOString(),scope:'isolated PostgreSQL only; not live Supabase capacity',
 source_commit:options.commit||'not supplied',duration_per_stage_seconds:duration,
 workload_model:'closed loop, one outstanding operation per client, no think time; queueing included; warm cache',
 thresholds:{p95_ms:2000,error_rate_below:.01},migrations,
 environment:{node:process.version,platform:process.platform,arch:process.arch,cpu_model:os.cpus()[0]?.model,logical_cpu_count:os.cpus().length,total_memory_bytes:os.totalmem()},stages:[],integrity:{},limitations:[
  'Load generator and database share this machine. No network, PostgREST, Supabase compute, Auth, SMTP, Realtime, Storage, push or browser rendering is measured.',
  'Auth and Storage have SQL contract shims. All public application migrations are used; scheduled external workers are omitted.',
  'Concurrency means active SQL clients, not registered members or simultaneous signed-in browsers. Closed-loop load can hide latency under an open arrival rate.',
  'Directory uses COUNT OVER plus 500-row offsets; PostgREST exact-count planning and JSON/network cost differ. Other operations model selected hot paths, not complete pages.'
 ]};
try{
 service=new Client(cfg);await service.connect();
 assert.equal((await service.query("select count(*)::int n from pg_roles where rolname in ('anon','authenticated','service_role')")).rows[0].n,0,'Use a fresh disposable PostgreSQL service, with no Supabase roles');
 assert.equal((await service.query("select count(*)::int n from pg_tables where schemaname='public'")).rows[0].n,0,'Disposable service must be empty');
 await service.query(`create database ${database}`);created=true;cfg.database=database;
 admin=new Client(cfg);await admin.connect();
 report.environment.postgresql=(await admin.query('select version() version')).rows[0].version;
 report.environment.database_settings=(await admin.query("select name,setting,unit from pg_settings where name in ('shared_buffers','work_mem','max_connections','fsync','synchronous_commit')")).rows;
 console.log('Creating synthetic fixture with 2,000 accounts and real application migrations...');
 report.dataset=await prepareFixture(admin);
 report.environment.database_bytes=Number((await admin.query('select pg_database_size(current_database()) n')).rows[0].n);
 console.log(JSON.stringify({dataset:report.dataset,database_bytes:report.environment.database_bytes}));
 // Exercise every operation before timing; catches a broken seed or missing migration.
 for(const w of workloads)await actor(admin,w.role==='teacher'?2:10,db=>w.run(db,w.role==='teacher'?2:10));
 for(const concurrency of stages){
   clients=await Promise.all(Array.from({length:concurrency},async()=>{const c=new Client(cfg);await c.connect();await c.query("set statement_timeout='15s'; set lock_timeout='10s'");return c;}));
   const samples=new Map(workloads.map(w=>[w.name,[]])),errors=[],latencies=[];let count=0;
   const cpuStart=process.cpuUsage(),begin=performance.now(),until=begin+duration*1000;
   await Promise.all(clients.map(async(c,i)=>{
     let sequence=i*13;
     while(performance.now()<until){
       const w=deck[(sequence++*37)%deck.length],n=w.role==='teacher'?2+(i%8):10+((i*19+sequence*7)%1991),t=performance.now();
       try{await actor(c,n,db=>w.run(db,n));}catch(e){errors.push({workload:w.name,code:e.code||'ASSERTION',message:e.message.slice(0,160)});}
       const ms=performance.now()-t;samples.get(w.name).push(ms);latencies.push(ms);count++;
     }
   }));
   const elapsed=(performance.now()-begin)/1000,errorRate=errors.length/count;
   const stage={clients:concurrency,elapsed_seconds:rounded(elapsed),operations:count,operations_per_second:rounded(count/elapsed),
     ...stats(latencies),errors:errors.length,error_rate:rounded(errorRate*100)/100,
     by_workload:Object.fromEntries([...samples].map(([k,v])=>[k,{...stats(v),errors:errors.filter(e=>e.workload===k).length}])),
     error_examples:errors.slice(0,5),load_generator_cpu_microseconds:process.cpuUsage(cpuStart),
     passed:[...samples.values()].every(a=>a.length>0&&percentile(a,.95)<2000)&&errorRate<.01};
   report.stages.push(stage);console.log(JSON.stringify(stage));
   await Promise.all(clients.map(c=>c.end()));clients=[];
   if(errorRate>=.01){report.stopped_reason='Unexpected error rate reached 1%; later stages skipped.';break;}
 }
 // A real concurrent row-lock race: only 25 of 100 applicants may be confirmed.
 const capacityClients=await Promise.all(Array.from({length:25},async()=>{const c=new Client(cfg);await c.connect();return c;}));
 try{await Promise.all(capacityClients.map(async(c,i)=>{for(let n=10+i;n<110;n+=25)await actor(c,n,db=>db.query('select space_register_event($1)',[uuid(40000)]));}));}
 finally{await Promise.all(capacityClients.map(c=>c.end()));}
 const event=(await admin.query('select status,count(*)::int n from space_event_registrations group by status')).rows;
 assert.equal(event.find(x=>x.status==='confirmed')?.n,25);assert.equal(event.find(x=>x.status==='waitlisted')?.n,75);
 report.integrity.event_capacity={confirmed:25,waitlisted:75,concurrent_clients:25};
 report.integrity.duplicate_retry_tokens=Number((await admin.query('select count(*)::int n from(select sender_id,client_token from direct_messages where client_token is not null group by sender_id,client_token having count(*)>1) s')).rows[0].n);
 assert.equal(report.integrity.duplicate_retry_tokens,0);
 const privateCount=await actor(admin,10,async db=>(await db.query('select count(*)::int n from application_answers')).rows[0].n);assert.equal(privateCount,1);
 report.integrity.member_application_answers_visible=privateCount;
 report.integrity.nonparticipant_dm_visible=await actor(admin,10,async db=>Number((await db.query('select count(*) n from direct_messages where sender_id<>auth.uid() and recipient_id<>auth.uid()')).rows[0].n));
 assert.equal(report.integrity.nonparticipant_dm_visible,0);
 report.database_statistics=(await admin.query('select xact_commit,xact_rollback,deadlocks,blks_read,blks_hit,temp_bytes from pg_stat_database where datname=current_database()')).rows[0];
 report.finished_at=new Date().toISOString();report.passed=report.stages.length===stages.length&&report.stages.every(s=>s.passed);
 await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');
 console.log(`Report: ${out}`);if(!report.passed)process.exitCode=2;
}finally{
 await Promise.allSettled(clients.map(c=>c.end()));if(admin)await admin.end().catch(()=>{});
 if(created)await service.query(`drop database ${database} with (force)`).catch(e=>console.error(e.message));
 if(service)await service.end().catch(()=>{});
}
