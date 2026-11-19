import fs from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createServiceShims} from './database_test_helpers.mjs';
import {uuid} from './load_test_fixture.mjs';

const db=new PGlite(),root=new URL('../supabase/migrations/',import.meta.url);
const exec=sql=>db.exec(sql.replaceAll('create extension if not exists pgcrypto;',''));
const migration=name=>exec(fs.readFileSync(new URL(name,root),'utf8'));
const ops='20261119000000_chapter_operations.sql';
const run=(actor,sql,args=[],aal=actor===1?'aal2':'aal1',mfa=true)=>db.transaction(async t=>{
  await t.exec('set local role '+(actor?'authenticated':'anon'));
  const amr=mfa?[{method:'totp',timestamp:Math.floor(Date.now()/1000)}]:[];
  await t.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[actor?uuid(actor):'',JSON.stringify({aal,amr})]);
  return (await t.query(sql,args)).rows[0]?.value;
});
const call=(actor,name,args=[])=>run(actor,'select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') value',args);
const save=(slug,status='active')=>call(1,'space_save_chapter',[null,slug,slug,'Example university','Testing local control',status]);
const join=(actor,c)=>call(actor,'space_request_chapter_membership',[c]);
const review=(actor,c,n,v)=>call(actor,'space_review_chapter_membership',[c,uuid(n),v]);
const activate=async(c,n)=>{await join(n,c);await review(1,c,n,'approve');};
const office=(actor,c,n,role,enable=true)=>call(actor,'space_set_chapter_office',[c,uuid(n),role,enable]);
const detail=(actor,c,days=30)=>call(actor,'space_chapter_ops_detail',[c,days]);
const directory=(actor)=>call(actor,'space_chapter_ops_index');
const mine=actor=>call(actor,'space_my_chapter_offices');
const task=(actor,c,n,role,id=crypto.randomUUID())=>call(actor,'space_create_chapter_office_task',[c,uuid(n),role,'Local assignment','Prepare the chapter update','2024-01-01',id]);
const action=(actor,c,id,name,note='Reviewed the update')=>call(actor,'space_chapter_office_task_action',[c,id,name,note]);
const history=(actor,c,id)=>call(actor,'space_chapter_office_task_history',[c,id]);
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS',name);}
try{
  await createServiceShims({query:exec});
  await exec(`create schema realtime;
    create table realtime.messages(id uuid default gen_random_uuid(),topic text,extension text,payload jsonb);
    alter table realtime.messages enable row level security;
    grant usage on schema realtime to anon,authenticated;
    grant select,insert on realtime.messages to anon,authenticated;
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;`);
  await migration('20261027000000_legacy_baseline.sql');
  await exec(`set session_replication_role=replica;
    insert into auth.users(id,email,email_confirmed_at) select md5('space-load:'||n)::uuid,'ops-'||n||'@example.invalid',now() from generate_series(1,8)n;
    insert into profiles(id,full_name,handle,role,application_type,membership_status,profile_visibility)
      select md5('space-load:'||n)::uuid,'Synthetic account '||n,'ops_'||n,
        case when n=1 then 'admin' when n=8 then 'investor' else 'member' end,'member',
        case when n=7 then 'pending' else 'approved' end,'private' from generate_series(1,8)n;
    set session_replication_role=origin;`);
  await migration('20261027010000_security_hardening.sql');
  await migration('20261118000000_university_chapters.sql');
  const a=await save('campus-a'),b=await save('campus-b'),draft=await save('campus-draft','draft');
  await activate(a,2);await activate(a,3);await activate(a,4);await activate(b,5);await join(6,a);
  await call(1,'space_assign_chapter_role',[a,uuid(2),'coordinator']);
  await call(1,'space_assign_chapter_role',[a,uuid(4),'teacher']);
  await call(2,'space_save_chapter_activity',[a,null,'workshop','Synthetic workshop','Synthetic instructions',null,'','Electronics and Robotics',false]);
  await migration(ops);
  await check('Migration is additive, can be rerun and preserves current roles and chapter contents',async()=>{
    await migration(ops);
    assert.equal((await directory(1)).total,3);
    assert.deepEqual((await mine(2))[0].offices,['coordinator']);
    assert.deepEqual((await mine(4))[0].offices,['teacher']);
    assert.equal((await detail(2,a)).metrics.workshops,1);
  });
  await check('Network dashboard and office appointments require central administration and recent MFA on appointments',async()=>{
    for(const n of [0,2,3,7,8])await assert.rejects(()=>directory(n),/administrator|permission denied/);
    await assert.rejects(()=>run(1,'select space_chapter_ops_index() value',[],'aal1'),/administrator/);
    await assert.rejects(()=>run(1,"select space_set_chapter_office($1,$2,'treasurer',true) value",[a,uuid(3)],'aal2',false),/authenticator again/);
    await assert.rejects(()=>office(2,a,3,'treasurer'),/administrator/);
    await assert.rejects(()=>office(1,a,6,'treasurer'),/approved active/);
    await assert.rejects(()=>office(1,a,5,'treasurer'),/approved active/);
    await assert.rejects(()=>office(1,draft,3,'treasurer'),/unavailable/);
    await assert.rejects(()=>office(1,a,3,'coordinator'),/valid chapter office/);
  });
  await check('Multiple office appointments are scoped, idempotent and notify the recipient once per change',async()=>{
    await office(1,a,3,'treasurer');await office(1,a,3,'events_lead');await office(1,a,3,'treasurer');
    await office(1,b,5,'treasurer');
    assert.deepEqual((await mine(3))[0].offices,['events_lead','treasurer']);
    assert.equal((await mine(5))[0].id,b);
    assert.equal((await db.query("select count(*)::int n from notifications where user_id=$1 and target_type='chapter_office'",[uuid(3)])).rows[0].n,2);
    assert.equal((await db.query("select role from profiles where id=$1",[uuid(3)])).rows[0].role,'member');
    await assert.rejects(()=>call(3,'finance_month_report',['2026-11-01']),/treasurer|Administrator|access required/i);
    await assert.rejects(()=>review(2,a,3,'remove'),/central administrators/);
  });
  await check('Only local coordinators and central admins can read candidate lists and full chapter metrics',async()=>{
    assert.equal((await detail(2,a)).manager,true);
    await assert.rejects(()=>detail(2,b),/office access/);
    await assert.rejects(()=>detail(6,a),/office access/);
    await assert.rejects(()=>detail(5,a),/office access/);
    await assert.rejects(()=>call(3,'space_chapter_ops_people',[a]),/leadership/);
    await assert.rejects(()=>call(2,'space_chapter_ops_people',[b]),/leadership/);
    const people=await call(2,'space_chapter_ops_people',[a,'account 3',0]);
    assert.deepEqual(people.map(p=>p.user_id),[uuid(3)]);
    assert.equal(Object.hasOwn(people[0],'email'),false);
    for(const n of [7,8])await assert.rejects(()=>mine(n),/Approved club membership/);
  });
  let t3,t4,t5;
  await check('Tasks can only be assigned to eligible holders, and repeat submissions do not duplicate tasks',async()=>{
    const id=crypto.randomUUID();
    t3=await task(2,a,3,'treasurer',id);assert.equal(await task(2,a,3,'treasurer',id),t3);
    t4=await task(1,a,4,'teacher');t5=await task(1,b,5,'treasurer');
    await assert.rejects(()=>task(2,b,5,'treasurer'),/leadership/);
    await assert.rejects(()=>task(3,a,3,'treasurer'),/leadership/);
    await assert.rejects(()=>task(2,a,3,'projects_lead'),/active holder/);
    assert.equal((await db.query('select count(*)::int n from space_chapter_office_tasks')).rows[0].n,3);
  });
  await check('Officers see only their own work and no peer workload; filters do not alter visibility',async()=>{
    const w=await detail(3,a);
    assert.equal(w.manager,false);assert.equal(w.metrics,null);
    assert.deepEqual(w.tasks.map(t=>t.id),[t3]);assert.deepEqual(w.office_metrics.map(o=>o.office),['events_lead','treasurer']);
    assert.equal(w.office_metrics.find(o=>o.office==='treasurer').overdue,1);
    assert(w.office_metrics.every(o=>o.holders===null));
    assert.deepEqual((await call(3,'space_chapter_ops_detail',[a,30,'teacher','all',0])).tasks,[]);
    await assert.rejects(()=>history(3,a,t4),/not found|unavailable/);
    await assert.rejects(()=>action(3,a,t4,'submit'),/assigned officer/);
    await assert.rejects(()=>action(2,a,t5,'cancel'),/Task unavailable/);
  });
  await check('Submit, return, resubmit and complete obey role boundaries and retain task history',async()=>{
    await assert.rejects(()=>action(2,a,t3,'complete'),/Only submitted/);
    await action(3,a,t3,'submit','First draft attached to our chapter notes');
    assert.equal((await detail(2,a)).metrics.submitted,1);
    await assert.rejects(()=>action(3,a,t3,'complete'),/leadership/);
    await action(2,a,t3,'return','Add the total for materials');
    await action(3,a,t3,'submit','Added the materials total');
    await action(2,a,t3,'complete');
    assert.equal((await detail(3,a)).tasks[0].status,'completed');
    assert.deepEqual((await history(3,a,t3)).map(r=>r.action),['complete','submit','return','submit','create']);
    assert.equal((await detail(2,a)).metrics.overdue,1);
  });
  await check('A coordinator cannot approve their own submission',async()=>{
    const self=await task(2,a,2,'coordinator');
    await action(2,a,self,'submit','Coordinator updates submitted');
    await assert.rejects(()=>action(2,a,self,'complete'),/Another chapter leader/);
    await action(1,a,self,'complete');
  });
  await check('Metrics distinguish current totals from the reporting window and compare cross-campus records',async()=>{
    await db.query("update space_chapter_office_tasks set completed_at=now()-interval '60 days' where id=$1",[t3]);
    await db.query("update space_chapter_activities set created_at=now()-interval '60 days' where chapter_id=$1",[a]);
    const thirty=await detail(2,a,30),ninety=await detail(2,a,90);
    assert.equal(thirty.metrics.active,3);assert.equal(ninety.metrics.pending,1);
    assert.equal(thirty.metrics.completed,1);assert.equal(ninety.metrics.completed,2);
    assert.equal(thirty.metrics.workshops,0);assert.equal(ninety.metrics.workshops,1);
    const net=await directory(1);assert.equal(net.metrics.active,4);assert.equal(net.metrics.pending,1);
    assert.equal(net.rows.find(c=>c.id===b).metrics.overdue,1);
    const people=await call(2,'space_chapter_ops_people',[a,'account 3',0,90]);
    assert.deepEqual(people[0].work,{open:0,submitted:0,completed:1,overdue:0});
  });
  await check('Revoked and archived offices do not allow work access, with records retained for management',async()=>{
    await office(1,a,4,'secretary');
    const abandoned=await task(1,a,4,'secretary');
    await office(1,a,4,'secretary',false);
    assert((await detail(2,a)).metrics.needs_reassignment>0);
    await assert.rejects(()=>action(4,a,abandoned,'submit'),/assigned officer/);
    assert(!(await mine(4))[0].offices.includes('secretary'));
    await call(1,'space_save_chapter',[b,'campus-b','Campus B','Example university','','archived']);
    assert.deepEqual(await mine(5),[]);await assert.rejects(()=>history(5,b,t5),/unavailable/);
    await assert.rejects(()=>action(1,b,t5,'cancel'),/unavailable/);
    assert.equal((await detail(1,b)).tasks[0].status,'open');
  });
  await check('New tables are not exposed directly and central role histories remain recorded',async()=>{
    for(const table of ['space_chapter_office_assignments','space_chapter_office_tasks','space_chapter_office_task_history']){
      await assert.rejects(()=>run(3,'select * from '+table),/permission denied/);
      await assert.rejects(()=>run(1,'select * from '+table),/permission denied/);
    }
    assert.equal((await db.query("select count(*)::int n from audit_events where action='chapter_office_revoked'")).rows[0].n,1);
  });
  console.log(checks+' chapter operations database checks passed.');
}catch(e){console.error(e.message);process.exitCode=1;}
finally{await db.close();}
