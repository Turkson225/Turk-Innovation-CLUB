// Real migrations/RLS in isolated PostgreSQL, with synthetic accounts only.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {prepareFixture,uuid} from './load_test_fixture.mjs';
const {PGlite}=createRequire(import.meta.url)(process.env.SPACE_PGLITE_MODULE||'@electric-sql/pglite');
const engine=new PGlite(),db={query:async(q,p)=>p?engine.query(q,p):(await engine.exec(q.replace('create extension if not exists pgcrypto;',''))).at(-1)};
const sql=fs.readFileSync(new URL('../supabase/upgrade_analytics_periods.sql',import.meta.url),'utf8');
const as=(n,q,args=[],role='authenticated')=>engine.transaction(async tx=>{await tx.exec('set local role '+role);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[n?uuid(n):'']);return tx.query(q,args);});
const analytics=async(n=1,scope='membership',from='2024-01-01',through='2024-12-31',grain='month',status='all')=>(await as(n,'select public.space_admin_analytics($1,$2,$3,$4,$5) data',[scope,from,through,grain,status])).rows[0].data;
const page=async(n=1,created=null,id=null,cutoff=null,limit=500,status='all')=>(await as(n,'select public.space_analytics_members($1,$2,$3,$4,$5,$6,$7) data',['2024-01-01','2024-12-31',status,created,id,cutoff,limit])).rows[0].data;
const count=d=>d.rows.reduce((a,r)=>a+['member','teacher','founder','investor','admin'].reduce((s,k)=>s+r[k],0),0);
let passed=0;const check=async(name,fn)=>{await fn();passed++;console.log('PASS',name);};
try{
 await prepareFixture(db);await db.query(sql);
 await db.query(`set session_replication_role=replica;
  update profiles set created_at='2024-02-29T12:00:00Z';
  update profiles set created_at='2024-01-01T00:00:00Z' where id=load_uuid(1);
  update profiles set created_at='2024-03-01T00:00:00Z' where id=load_uuid(2);
  update profiles set created_at='2024-02-29T23:59:59Z' where id=load_uuid(3);
  update profiles set role='founder',created_at='2023-12-31T23:59:59Z' where id=load_uuid(4);
  update profiles set role='investor',created_at='2025-01-01T00:00:00Z' where id=load_uuid(5);
  update profiles set membership_status='pending',created_at='2024-02-28T12:00:00Z' where id=load_uuid(6);
  update profiles set membership_status='suspended',created_at='2024-02-28T12:00:00Z' where id=load_uuid(7);
  update profiles set membership_status='rejected',created_at='2024-02-28T12:00:00Z' where id=load_uuid(8);
  update profiles set created_at='2024-02-01T00:00:00Z' where id=load_uuid(9);
  update profiles set created_at='2024-03-02T00:00:00Z' where id=load_uuid(10);
  update profiles set created_at='2024-02-29T00:00:00Z' where id=load_uuid(11);
  insert into finance_entries(id,entry_type,category,amount,description,occurred_on,created_by) values
    (load_uuid(90001),'income','Synthetic',50,'Opening','2023-12-31',load_uuid(1)),
    (load_uuid(90002),'income','Synthetic',100,'January','2024-01-31',load_uuid(1)),
    (load_uuid(90003),'income','Synthetic',123.45,'Leap day income','2024-02-29',load_uuid(1)),
    (load_uuid(90004),'expense','Synthetic',23.40,'Leap day expense','2024-02-29',load_uuid(1)),
    (load_uuid(90005),'expense','Synthetic',0.05,'March','2024-03-01',load_uuid(1)),
    (load_uuid(90006),'income','Synthetic',900,'Pending','2024-02-28',load_uuid(1)),
    (load_uuid(90007),'income','Synthetic',800,'Rejected','2024-02-29',load_uuid(1));
  insert into finance_reviews(entry_id,reviewer_id,decision,note)
    select load_uuid(n),load_uuid(1),'approved','Synthetic' from generate_series(90001,90005)n;
  insert into finance_reviews(entry_id,reviewer_id,decision,note) values(load_uuid(90007),load_uuid(1),'rejected','Synthetic');
  set session_replication_role=origin;`);
 await check('Migration reruns safely without changing 2,000 accounts or ledger entries',async()=>{await db.query(sql);assert.equal((await db.query('select count(*)::int n from profiles')).rows[0].n,2000);assert.equal((await db.query('select count(*)::int n from finance_entries')).rows[0].n,7);});
 await check('Both RPCs are invokers and anonymous callers have no execution privilege',async()=>{const p=await db.query("select prosecdef from pg_proc where proname in ('space_admin_analytics','space_analytics_members')");assert.equal(p.rows.length,2);assert(p.rows.every(r=>!r.prosecdef));await assert.rejects(()=>as(null,"select public.space_admin_analytics('membership','2024-01-01','2024-01-02')",[],'anon'),/permission denied/);await assert.rejects(()=>as(null,"select public.space_analytics_members('2024-01-01','2024-01-02')",[],'anon'),/permission denied/);});
 await check('Members, teachers, founders, investors and unapproved accounts cannot use either RPC',async()=>{for(const n of [2,4,5,6,7,8,1999]){await assert.rejects(()=>analytics(n),/Administrator/);await assert.rejects(()=>page(n),/Administrator/);}});
 await check('Invalid periods, null values, grains and filters are rejected',async()=>{for(const args of [[1,'other'],[1,'membership',null],[1,'membership','2024-03-01','2024-02-29'],[1,'membership','1999-12-31','2024-01-01'],[1,'membership','2024-01-01','2999-01-01'],[1,'membership','2024-01-01','2024-12-31','week'],[1,'membership','2024-01-01','2024-12-31','month','pending'],[1,'membership','2010-01-01','2020-01-01']])await assert.rejects(()=>analytics(...args));await assert.rejects(()=>page(1,null,null,null,501),/page size/);await assert.rejects(()=>page(1,'2024-01-01',null),/cursor/);});
 await check('Daily limits allow a leap year and reject longer daily ranges',async()=>{const d=await analytics(1,'membership','2024-01-01','2024-12-31','day');assert.equal(d.rows.length,366);await assert.rejects(()=>analytics(1,'membership','2023-12-31','2024-12-31','day'),/Daily grouping/);});
 await check('Day, month and year groups conserve all sign-ups and zero-fill empty buckets',async()=>{for(const grain of ['day','month','year']){const d=await analytics(1,'membership','2024-01-01','2024-12-31',grain);assert.equal(count(d),1998);assert.equal(d.summary.accounts,1998);assert.equal(d.summary.approved,1995);assert.equal(d.summary.pending,1);if(grain!=='year')assert(d.rows.some(r=>['member','teacher','founder','investor','admin'].every(k=>r[k]===0)));}});
 await check('Approved filter excludes all three other statuses and counts current roles',async()=>{const d=await analytics(1,'membership','2024-01-01','2024-12-31','month','approved');assert.equal(count(d),1995);assert.equal(d.summary.accounts,1995);assert.equal(d.summary.pending,0);assert.equal(d.rows[0].admin,1);assert.equal(d.rows[1].teacher,2);});
 await check('UTC boundaries include leap-day endpoints and remain stable in another timezone',async()=>{await db.query("set timezone='Pacific/Kiritimati'");const d=await analytics(1,'membership','2024-02-29','2024-02-29','day');assert.equal(count(d),1991);assert.equal(d.rows[0].teacher,1);assert.equal(d.rows[0].from,'2024-02-29');await db.query("set timezone='UTC'");});
 await check('Partial month and year buckets label the actual selected endpoints',async()=>{for(const grain of ['month','year']){const d=await analytics(1,'membership','2024-02-28','2024-03-01',grain);assert.equal(d.rows[0].from,'2024-02-28');assert.equal(d.rows.at(-1).through,'2024-03-01');assert.equal(count(d),1995);}});
 await check('Finance includes approved transaction dates only and preserves pennies',async()=>{const d=await analytics(1,'finance','2024-02-01','2024-02-29','day');assert.equal(d.summary.income,123.45);assert.equal(d.summary.expense,23.4);assert.equal(d.summary.opening,150);assert.equal(d.summary.closing,250.05);assert.equal(d.summary.transactions,2);assert.equal(d.rows.at(-1).income,123.45);assert.equal(d.rows.at(-1).expense,23.4);});
 await check('Finance totals reconcile across grains and opening plus movement equals closing',async()=>{for(const grain of ['day','month','year']){const d=await analytics(1,'finance','2024-01-01','2024-12-31',grain);assert.equal(d.rows.reduce((a,r)=>a+r.income,0),223.45);assert.equal(d.rows.reduce((a,r)=>a+r.expense,0),23.45);assert.equal(d.summary.opening,50);assert.equal(d.summary.closing,250);assert.equal(Math.round((d.summary.opening+d.summary.income-d.summary.expense)*100),25000);}});
 await check('Keyset export returns every one of 1,998 records, including equal timestamps, with no duplicates',async()=>{const all=[];let d=await page(),pages=0;const cutoff=d.as_of;for(;;){pages++;assert(d.rows.length<=500);assert.equal(d.total,1998);all.push(...d.rows);if(!d.more)break;d=await page(1,d.next_created,d.next_id,cutoff);}assert.equal(pages,4);assert.equal(all.length,1998);assert.equal(new Set(all.map(r=>r.id)).size,1998);assert(all.every(r=>Object.keys(r).sort().join(',')==='created_at,full_name,handle,id,membership_status,role'));assert(!JSON.stringify(all).includes('Synthetic application answer'));});
 await check('Export status and creation cutoffs are applied on every page',async()=>{assert.equal((await page(1,null,null,null,500,'approved')).total,1995);const d=await page(1,null,null,'2024-01-31T23:59:59Z');assert.equal(d.total,1);assert.equal(d.rows[0].id,uuid(1));assert.equal(d.more,false);});
 await check('Administrator approval is rechecked for subsequent export pages',async()=>{const d=await page();await db.query("set session_replication_role=replica;update profiles set membership_status='suspended' where id=load_uuid(1);set session_replication_role=origin;");await assert.rejects(()=>page(1,d.next_created,d.next_id,d.as_of),/Administrator/);await assert.rejects(()=>analytics(),/Administrator/);});
 console.log(`${passed} SPACE analytics database checks passed`);
}catch(e){console.error('FAIL analytics database:',e.message,e.detail||'',e.position||'',e.where||'');process.exitCode=1;}finally{await engine.close();}
