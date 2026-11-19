import fs from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createServiceShims} from './database_test_helpers.mjs';
import {uuid} from './load_test_fixture.mjs';

const db=new PGlite(), root=new URL('../supabase/migrations/',import.meta.url);
const exec=sql=>db.exec(sql.replaceAll('create extension if not exists pgcrypto;',''));
const migration=name=>exec(fs.readFileSync(new URL(name,root),'utf8'));
const request=(actor,call,args=[],aal=actor===1?'aal2':'aal1',recent=true)=>db.transaction(async t=>{
  await t.exec('set local role '+(actor?'authenticated':'anon'));
  const amr=recent?[{method:'totp',timestamp:Math.floor(Date.now()/1000)}]:[];
  await t.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[actor?uuid(actor):'',JSON.stringify({aal,amr})]);
  return t.query(call,args);
});
const scalar=async(...args)=>(await request(...args)).rows[0]?.value;
const save=(slug,status='active')=>scalar(1,'select space_save_chapter(null,$1,$1,$2,$3,$4) value',[slug,'Example University','Pilot workspace',status]);
const refine=(id,status)=>scalar(1,'select space_save_chapter($1,$2,$3,$4,$5,$6) value',[id,'attempted-renaming','Updated chapter','University','Chapter description',status]);
const get=(actor,slug,kind='announcement',start=0)=>scalar(actor,'select space_get_chapter($1,$2,$3) value',[slug,kind,start]);
const directory=actor=>scalar(actor,'select space_chapter_directory() value');
const roster=(actor,id,status)=>scalar(actor,'select space_chapter_roster($1,$2) value',[id,status]);
const join=(actor,id)=>scalar(actor,'select space_request_chapter_membership($1) value',[id]);
const review=(actor,id,person,decision)=>scalar(actor,'select space_review_chapter_membership($1,$2,$3) value',[id,uuid(person),decision]);
const role=(actor,id,person,role)=>scalar(actor,'select space_assign_chapter_role($1,$2,$3) value',[id,uuid(person),role]);
const publish=(actor,id,kind,activity=null,archive=false)=>scalar(actor,'select space_save_chapter_activity($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[id,activity,kind,'Intro workshop','A private local activity',kind==='event'?'2027-01-05T12:00:00Z':null,'Local campus',kind==='workshop'?'Electronics and Robotics':null,archive]);
let checks=0;
const check=async(name,run)=>{await run();checks++;console.log('PASS',name);};
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
    insert into auth.users(id,email,email_confirmed_at) select md5('space-load:'||n)::uuid,'chapter-'||n||'@example.invalid',now() from generate_series(1,9)n;
    insert into profiles(id,full_name,handle,role,application_type,membership_status,profile_visibility)
      select md5('space-load:'||n)::uuid,'Synthetic account '||n,'chapter_'||n,
        case when n=1 then 'admin' when n=8 then 'investor' else 'member' end,'member',
        case when n=9 then 'pending' else 'approved' end,'private' from generate_series(1,9)n;
    set session_replication_role=origin;`);
  await migration('20261027010000_security_hardening.sql');
  await migration('20261118000000_university_chapters.sql');
  const a=await save('campus-a'),b=await save('campus-b'),draft=await save('draft-campus','draft');
  await check('Additive migration can be rerun and keeps campus and account records',async()=>{
    await migration('20261118000000_university_chapters.sql');
    assert.equal((await directory(1)).chapters.length,3);
    assert.equal((await db.query('select count(*)::int n from profiles')).rows[0].n,9);
  });
  await check('Directory does not expose drafts, pending accounts or investor entry',async()=>{
    assert.deepEqual((await directory(2)).chapters.map(c=>c.slug),['campus-a','campus-b']);
    await assert.rejects(()=>get(2,'draft-campus'),/unavailable/);
    for(const actor of [0,8,9])await assert.rejects(()=>directory(actor),/permission denied|Approved club membership/);
    await assert.rejects(()=>join(2,draft),/not accepting/);
  });
  await check('Central setup and role changes require verified and recent admin MFA',async()=>{
    const q="select space_save_chapter(null,'no-access','No access','Example','', 'draft') value";
    await assert.rejects(()=>scalar(2,q),/administrator access/);
    await assert.rejects(()=>scalar(1,q,[],'aal1'),/administrator access/);
    await assert.rejects(()=>scalar(1,q,[],'aal2',false),/authenticator again/);
    await assert.rejects(()=>scalar(1,"select space_assign_chapter_role($1,$2,'coordinator') value",[a,uuid(2)],'aal2',false),/authenticator again/);
  });
  await check('Join requests are idempotent and cannot grant access before review',async()=>{
    assert.equal(await join(2,a),'pending');assert.equal(await join(2,a),'pending');
    assert.equal((await get(2,'campus-a')).can_read,false);
    assert.equal((await roster(1,a,'pending')).length,1);
    await assert.rejects(()=>review(2,a,2,'approve'),/leadership access/);
    await review(1,a,2,'approve');await role(1,a,2,'coordinator');
    assert.equal((await get(2,'campus-a')).role,'coordinator');
    assert.equal((await db.query("select role from profiles where id=$1",[uuid(2)])).rows[0].role,'member');
  });
  await check('Coordinators can approve applicants only in their own chapter',async()=>{
    await join(3,a); await join(3,b);
    await assert.rejects(()=>roster(2,b,'pending'),/leadership access/);
    await assert.rejects(()=>review(2,b,3,'approve'),/leadership access/);
    await assert.rejects(()=>role(2,a,3,'teacher'),/administrator access/);
    await review(2,a,3,'approve');await role(1,a,3,'teacher');
    assert.equal((await get(3,'campus-a')).can_publish_workshop,true);
    assert.equal((await get(3,'campus-b')).can_read,false);
    assert.deepEqual(Object.keys((await roster(2,a,'active'))[0]).sort(),['full_name','id','requested_at','role','status','user_id']);
  });
  const announcement=await publish(2,a,'announcement'), workshop=await publish(3,a,'workshop');
  const staffWorkshop=await publish(2,a,'workshop');
  await check('Local activities are private and teacher edits are limited to their own workshops',async()=>{
    await join(4,a);await join(5,b);await review(1,b,5,'approve');
    for(const actor of [4,5,6])assert.deepEqual((await get(actor,'campus-a')).activities,[]);
    assert.deepEqual((await get(2,'campus-b')).activities,[]);
    assert.equal((await get(3,'campus-a')).activities[0].id,announcement);
    assert.equal((await get(3,'campus-a')).activities[0].can_edit,false);
    await assert.rejects(()=>publish(3,a,'announcement'),/own chapter workshops/);
    await assert.rejects(()=>publish(3,a,'workshop',announcement),/own chapter workshops/);
    await assert.rejects(()=>publish(3,a,'workshop',staffWorkshop),/own chapter workshops/);
    await assert.rejects(()=>publish(3,b,'workshop',workshop),/publishing access/);
    const otherWorkshop=await publish(1,b,'workshop');
    await assert.rejects(()=>publish(2,a,'workshop',otherWorkshop),/Activity unavailable/);
    await publish(3,a,'workshop',workshop);
    assert.equal((await get(3,'campus-a','workshop')).activities.find(x=>x.id===workshop).can_edit,true);
  });
  await check('Chapter records cannot be queried or edited directly from a browser account',async()=>{
    for(const table of ['space_chapters','space_chapter_memberships','space_chapter_activities']){
      for(const actor of [0,1,2])await assert.rejects(()=>request(actor,'select * from '+table),/permission denied/);
    }
    await assert.rejects(()=>request(2,"update space_chapter_memberships set role='coordinator'"),/permission denied/);
  });
  await check('Removal revokes access and the central club account is unaffected',async()=>{
    await review(2,a,4,'approve');assert.equal((await get(4,'campus-a')).can_read,true);
    await assert.rejects(()=>review(2,a,3,'remove'),/staff memberships/);
    await review(2,a,4,'remove');assert.equal((await get(4,'campus-a')).can_read,false);
    assert.equal(await join(4,a),'inactive');
    assert.equal((await db.query('select membership_status from profiles where id=$1',[uuid(4)])).rows[0].membership_status,'approved');
    await review(2,a,4,'restore');assert.equal((await get(4,'campus-a')).can_read,true);
    await db.query("update profiles set membership_status='suspended' where id=$1",[uuid(4)]);
    await assert.rejects(()=>get(4,'campus-a'),/Approved club membership/);
  });
  await check('Archives preserve data and suspend new local requests and writes',async()=>{
    await publish(2,a,'announcement',announcement,true);assert.equal((await get(2,'campus-a')).activities.length,0);
    assert.equal((await db.query('select count(*)::int n from space_chapter_activities where id=$1',[announcement])).rows[0].n,1);
    await refine(a,'archived');
    assert.equal((await get(3,'campus-a','workshop')).activities.length,2);
    assert.equal((await get(3,'campus-a','workshop')).can_publish_workshop,false);
    await assert.rejects(()=>get(6,'campus-a'),/unavailable/);await assert.rejects(()=>join(6,a),/not accepting/);
    await assert.rejects(()=>publish(2,a,'event'),/unavailable/);await assert.rejects(()=>roster(2,a,'active'),/unavailable/);
    assert.equal((await directory(3)).mine.find(c=>c.id===a).status,'archived');
    await refine(a,'active');assert.equal((await get(2,'campus-a')).chapter.slug,'campus-a');
  });
  await check('Membership and role changes are recorded in the central audit trail',async()=>{
    assert((await db.query("select count(*)::int n from audit_events where target_type='chapter_membership'")).rows[0].n>=10);
    await assert.rejects(()=>request(2,"insert into audit_events(action,target_type) values('fake','chapter')"),/permission denied/);
  });
  console.log(checks+' chapter database checks passed.');
}finally{await db.close();}
