import fs from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createServiceShims} from './database_test_helpers.mjs';
import {uuid} from './load_test_fixture.mjs';
const db=new PGlite();
const migration='20261124000000_admin_data_center.sql';
const exec=q=>db.exec(q.replaceAll('create extension if not exists pgcrypto;',''));
const baseline=new URL('../supabase/migrations/',import.meta.url);
const migrate=f=>exec(fs.readFileSync(new URL(f,baseline),'utf8'));
const as=(actor,aal,q,args=[],fresh=true)=>db.transaction(async t=>{
  await t.exec('set local role '+(typeof actor==='number'?'authenticated':actor));
  if(typeof actor==='number')await t.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[
    uuid(actor),JSON.stringify({aal,amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)-(fresh?0:3600)}]})]);
  return (await t.query(q,args)).rows[0]?.v;
});
const today=new Date().toISOString().slice(0,10);
const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
const call='select public.space_data_center_page($1,$2,$3,$4,$5,$6,$7) v';
const catalog=(actor=1,level='aal2')=>as(actor,level,'select public.space_data_center_catalog() v');
const page=(mode,name,{cursor=null,limit=100,exporting=false,from=yesterday,to=today,actor=1,aal='aal2',fresh=true}={})=>
 as(actor,aal,call,[mode,name,from,to,cursor,limit,exporting],fresh);
let checks=0;
async function check(label,fn){await fn();console.log('PASS',label);checks++;}
try{
  await createServiceShims({query:exec});
  await exec("create schema realtime;create table realtime.messages(id uuid default gen_random_uuid(),topic text,extension text,payload jsonb);alter table realtime.messages enable row level security;grant usage on schema realtime to anon,authenticated;grant select,insert on realtime.messages to authenticated;create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;");
  for(const name of fs.readdirSync(baseline).filter(n=>n!==migration).sort())await migrate(name);
  await exec(`set session_replication_role=replica;
    insert into auth.users(id,email,email_confirmed_at) values('${uuid(1)}','admin@example.invalid',now()),('${uuid(2)}','member@example.invalid',now()),('${uuid(3)}','investor@example.invalid',now());
    insert into profiles(id,full_name,handle,role,application_type,membership_status,profile_visibility,bio)
    values('${uuid(1)}','Admin','dc_admin','admin','member','approved','private','DO-NOT-EXPORT-BIO'),
          ('${uuid(2)}','Member','dc_member','member','member','approved','private','DO-NOT-EXPORT-BIO'),
          ('${uuid(3)}','Investor','dc_investor','investor','investor','approved','private','DO-NOT-EXPORT-BIO');
    insert into projects(id,owner_id,title,description,created_at)
      select md5('data-center-project-'||n)::uuid,'${uuid(2)}','Project '||n,'DO-NOT-EXPORT-DESCRIPTION',now()-interval '1 day'
      from generate_series(1,7)n;
    set session_replication_role=origin;`);
  await migrate(migration);
  await check('Catalogue checks table definitions and is safely rerunnable without backfilling history',async()=>{
    const initial=await catalog();
    assert(initial.datasets.length>=70);
    await migrate(migration);
    assert.deepEqual(await catalog(),initial);
    assert.equal((await db.query('select count(*)::int n from space_private.data_center_events')).rows[0].n,0);
    assert(initial.datasets.find(d=>d.id==='direct_messages'&&!d.records&&!d.columns.length));
    assert(!initial.datasets.find(d=>d.id==='push_subscriptions'||d.id==='application_answers'));
  });
  await check('Only approved admins with MFA can browse; record queries also require recent MFA',async()=>{
    for(const [actor,aal] of [[1,'aal1'],[2,'aal2'],[3,'aal2'],['anon',null],['service_role',null]]){
      await assert.rejects(()=>catalog(actor,aal),/Administrator|permission denied/);
      await assert.rejects(()=>page('records','profiles',{actor,aal}),/Administrator|permission denied/);
    }
    assert((await catalog()).datasets.length);
    await assert.rejects(()=>page('records','profiles',{fresh:false}),/authenticator again/);
    await assert.rejects(()=>as(1,'aal2','select dataset from space_private.data_center_sources'),/permission denied/);
    await assert.rejects(()=>as(1,'aal2','select dataset from space_private.data_center_events'),/permission denied/);
  });
  await check('Records cover existing rows, use a stable cursor, and omit excluded fields',async()=>{
    const seen=new Set();let cursor=null,passes=0,firstAsOf=null;
    do{
      const q=await page('records','projects',{cursor,limit:2});
      firstAsOf??=q.as_of;assert.equal(q.as_of,firstAsOf);
      for(const item of q.rows){assert(!seen.has(item.id));seen.add(item.id);assert(!('description' in item));}
      assert.deepEqual(q.columns,['id','created_at','owner_id','title','status','progress']);
      cursor=q.next_cursor;passes++;
      if(cursor)await assert.rejects(()=>page('records','profiles',{cursor}),/does not match/);
    }while(cursor&&passes<10);
    assert.equal(seen.size,7);assert.equal(passes,4);
    const p=await page('records','profiles');assert(!JSON.stringify(p.rows).includes('DO-NOT-EXPORT'));
    await assert.rejects(()=>page('records','auth.users'),/Dataset unavailable/);
    await assert.rejects(()=>page('records','direct_messages'),/detailed records/);
    await assert.rejects(()=>page('totals',null,{from:'2001-01-01'}),/valid UTC date range/);
    const undated=await page('records','space_shop_order_items');assert(undated.columns.includes('line_total_cents'));
  });
  await check('Audit history tracks real field changes and rolls back together with the write',async()=>{
    await exec("update public.projects set title='Revised title', progress=42 where title='Project 1';");
    await exec("update public.projects set description='PRIVATE NEW WORDS' where title='Revised title';");
    await exec("update public.profiles set last_seen_at=now() where handle='dc_member';");
    await db.transaction(async t=>{await t.exec("update public.projects set progress=77 where title='Revised title'");await t.rollback();});
    const h=await page('history','projects');
    assert.equal(h.rows.length,1);
    assert.deepEqual(h.rows[0].changed_fields,['progress','title']);
    assert.equal(h.rows[0].after_state.progress,42);
    assert(!JSON.stringify(h.rows).includes('Revised title'));
    assert(!JSON.stringify(h.rows).includes('PRIVATE NEW WORDS'));
    assert.equal((await page('history','profiles')).rows.length,0);
    await page('records','projects',{exporting:true,limit:2});
    const audit=await page('history',null);
    assert(audit.rows.some(x=>x.action==='export_requested'&&x.actor_id===uuid(1)&&x.after_state.dataset==='projects'));
  });
  await check('Bulk private activity stores only daily counts and the analysis export contains no identity or contents',async()=>{
    await db.query("insert into public.direct_messages(sender_id,recipient_id,body) select $1,$2,'NEVER LOG THIS' from generate_series(1,12)",[uuid(1),uuid(2)]);
    assert.equal((await page('history','direct_messages')).rows.length,0);
    const counts=await db.query("select dataset,action,sum(total)::int n,count(*)::int counters from space_private.data_center_daily where dataset='direct_messages' group by 1,2");
    assert.deepEqual(counts.rows,[{dataset:'direct_messages',action:'insert',n:12,counters:1}]);
    assert.equal((await page('totals','direct_messages')).rows.length,0); // Current UTC day is not final.
    await db.query("update space_private.data_center_daily set day=$1 where dataset='direct_messages'",[yesterday]);
    const report=await page('totals',null,{exporting:true,limit:1});
    assert(report.rows.some(x=>x.dataset==='direct_messages'&&x.total===12));
    for(const row of report.rows){
      assert.deepEqual(Object.keys(row).sort(),['area','dataset','day','operation','total']);
      assert(!JSON.stringify(row).includes('NEVER LOG'));
    }
  });
  console.log(`${checks} Data Center database checks passed`);
}finally{await db.close();}
