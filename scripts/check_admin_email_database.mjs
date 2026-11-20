// Real PostgreSQL in a disposable local engine, using only synthetic accounts.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createServiceShims} from './database_test_helpers.mjs';
import {uuid} from './load_test_fixture.mjs';
const db=new PGlite();
const exec=q=>db.exec(q.replaceAll('create extension if not exists pgcrypto;',''));
const migrate=name=>exec(fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
const mail='20261120000000_admin_email_notifications.sql';
const as=(actor,aal,query,args=[],fresh=true)=>db.transaction(async t=>{
  const role=typeof actor==='number'?'authenticated':actor;
  await t.exec('set local role '+role);
  if(typeof actor==='number')await t.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[
    uuid(actor),JSON.stringify({aal,amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)-(fresh?0:3600)}]})]);
  return (await t.query(query,args)).rows[0]?.v;
});
const admin=(name,values=[],fresh=true)=>as(1,'aal2','select public.space_admin_mail_'+name+'('+values.map((_,i)=>'$'+(i+1)).join(',')+') v',values,fresh);
const worker=(name,values=[])=>as('service_role',null,'select public.space_admin_mail_'+name+'('+values.map((_,i)=>'$'+(i+1)).join(',')+') v',values);
const live=['updates','alerts','errors','security','service_status'];
const save=async (enabled,cats=live,email='ops@example.invalid')=>admin('save',[email,enabled,cats,(await admin('read')).settings.revision]);
const due=()=>exec("update space_private.admin_mail_jobs set next_at=now()-interval '1 second' where state in ('queued','retry')");
const flush=()=>exec("delete from space_private.admin_mail_jobs");
const only=async()=>{const rows=(await admin('read')).jobs;assert.equal(rows.length,1);return rows[0];};
const report=async n=>as(n,'aal1',"insert into public.reports(reporter_id,target_type,target_id,reason) values(auth.uid(),'news',$1,'PRIVATE reports never appear in email')",[uuid(n+100)]);
const post=priority=>as(1,'aal2',"insert into public.announcements(title,body,priority) values('PRIVATE club title','PRIVATE club text',$1)",[priority]);
const observeAgain=()=>exec("update space_private.admin_mail_monitor set sampled_at=now()-interval '2 minutes'");
let count=0;
async function check(label,fn){await fn();count++;console.log('PASS',label);}
try {
 await createServiceShims({query:exec});
 await exec("create schema realtime;create table realtime.messages(id uuid default gen_random_uuid(),topic text,extension text,payload jsonb);alter table realtime.messages enable row level security;grant usage on schema realtime to anon,authenticated;grant select,insert on realtime.messages to authenticated;create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;");
 for(const f of ['20261027000000_legacy_baseline.sql','20261027010000_security_hardening.sql','20261118000000_university_chapters.sql','20261119000000_chapter_operations.sql',mail]) await migrate(f);
 await exec(`set session_replication_role=replica;
  insert into auth.users(id,email,email_confirmed_at)
    select md5('space-load:'||n)::uuid,'acct-'||n||'@example.invalid',now() from generate_series(1,8)n;
  insert into profiles(id,full_name,handle,role,application_type,membership_status,profile_visibility)
    select md5('space-load:'||n)::uuid,'Synthetic '||n,'synthetic_'||n,
      case n when 1 then 'admin' else 'member' end,'member','approved','private' from generate_series(1,8)n;
  set session_replication_role=origin;`);
 await check('Rerunnable setup defaults to no destination and no outbound work',async()=>{
   await migrate(mail);
   await post('urgent');await worker('poll',[true]);
   assert.equal((await admin('read')).settings.enabled,false);
   assert.equal((await admin('read')).settings.recipient,null);
   assert.equal((await admin('read')).jobs.length,0);
   assert.equal(await worker('claim'),null);
 });
 await check('Recipients, audit, and worker RPCs are isolated from non-admins and password-only admins',async()=>{
   for(const [a,aal] of [[1,'aal1'],[2,'aal2'],['anon',null],['service_role',null]]){
     await assert.rejects(()=>as(a,aal,'select public.space_admin_mail_read() v'),/Administrator|administrator|permission denied/);
   }
   for(const a of [1,2,'anon'])await assert.rejects(()=>as(a,'aal2','select public.space_admin_mail_claim() v'),/permission denied/);
   for(const a of [1,2,'service_role'])await assert.rejects(()=>as(a,'aal2','select recipient from space_private.admin_mail_settings'),/permission denied/);
 });
 await check('Only fresh MFA permits settings or tests; invalid addresses and plans are rejected',async()=>{
   await assert.rejects(()=>admin('save',['ops@example.invalid',true,live,1],false),/authenticator again/);
   await assert.rejects(()=>admin('test',[],false),/authenticator again/);
   await assert.rejects(()=>save(true,live,'forged@example.invalid,extra@example.invalid'),/one valid/);
   await assert.rejects(()=>save(true,['other']),/preferences/);
   await assert.rejects(()=>save(true,[]),/at least one/);
   await save(true);
   await assert.rejects(()=>admin('save',['ops@example.invalid',true,live,1]),/settings were changed/);
   assert.equal((await admin('read')).settings.recipient,'ops@example.invalid');
 });
 await check('Triggers group source records and disclose only the catalogue, not private content',async()=>{
   await post('normal');await post('normal');
   await report(2);await report(3);
   await exec(`insert into audit_events(actor_id,action,target_type,target_id)
    values('${uuid(1)}','membership_suspended_member','profile','${uuid(5)}'),
          ('${uuid(1)}','officer_roles_changed','profile','${uuid(6)}'),
          ('${uuid(1)}','unrelated_event','profile','${uuid(7)}')`);
   const list=(await admin('read')).jobs;
   assert.equal(list.length,4);
   assert(list.some(x=>x.category==='updates'&&x.occurrences===2));
   assert(list.some(x=>x.category==='alerts'&&x.occurrences===2));
   assert(!JSON.stringify(list).includes('PRIVATE'));
   await due();
   const c=await worker('claim'),payload=await worker('start',[c.id,c.token]);
   assert.equal(payload.code,'account_suspended');assert.equal(payload.severity,'high');
   assert.equal(payload.recipient,'ops@example.invalid');assert.equal(payload.route,'admin');
   assert(!JSON.stringify(payload).includes(uuid(5)));
   await flush();
 });
 await check('Changing email or disabling a category cancels queued claims and never redirects them',async()=>{
   await post('normal');await due();const old=await worker('claim');
   await save(true,['security'],'new@example.invalid');
   assert.equal(await worker('start',[old.id,old.token]),null);
   assert.equal((await only()).state,'cancelled');
   await post('urgent');assert.equal((await admin('read')).jobs.length,1);
   await save(true);await flush();
 });
 await check('Test alerts are throttled and SMTP acceptance is audited without the destination',async()=>{
   const id=await admin('test');assert(id);
   await assert.rejects(()=>admin('test'),/recently/);
   const c=await worker('claim');assert.equal(c.id,id);
   await assert.equal(await worker('start',[c.id,uuid(40)]),null);
   const payload=await worker('start',[c.id,c.token]);assert.equal(payload.code,'test');
   assert.equal(await worker('start',[c.id,c.token]),null);
   assert.equal(await worker('finish',[c.id,c.token,'sent',null]),true);
   assert.equal(await worker('finish',[c.id,c.token,'sent',null]),false);
   const job=await only();assert.equal(job.state,'sent');assert(job.sent_at);assert.equal(job.history[0].outcome,'sent');
   assert(!JSON.stringify(job).includes('@'));
   await flush();
 });
 await check('Confirmed temporary failures retry with delays and stop after the fourth attempt',async()=>{
   await post('urgent');await due();let claim;
   for(let i=1;i<=4;i++){
     claim=await worker('claim');assert(claim);
     await worker('start',[claim.id,claim.token]);
     assert.equal(await worker('finish',[claim.id,claim.token,'retry','smtp_temporary']),true);
     assert.equal(await worker('claim'),null);
     await due();
   }
   const j=await only();assert.equal(j.attempts,4);assert.equal(j.state,'failed');assert.deepEqual(j.history.map(a=>a.outcome),['retry','retry','retry','failed']);
   await flush();
 });
 await check('A lost acknowledgement never resends while a lease that never started may retry',async()=>{
   await post('urgent');await post('normal');await due();
   const a=await worker('claim'),b=await worker('claim');
   await worker('start',[a.id,a.token]);
   await exec("update space_private.admin_mail_jobs set lease_until=now()-interval '1 second'");
   await worker('poll',[false]);
   let j=(await admin('read')).jobs;
   assert.equal(j.find(r=>r.id===a.id).state,'uncertain');assert.equal(j.find(r=>r.id===b.id).state,'retry');
   await due();assert.equal((await worker('claim')).id,b.id);assert.equal(await worker('claim'),null);
   assert.equal((await admin('read')).worker.sender_ready,false);await flush();
 });
 await check('The rate cap reserves at most twelve attempts in a rolling hour',async()=>{
   await db.query("insert into space_private.admin_mail_jobs(revision,code,bucket) select revision,'urgent_announcement',now()+n*interval '1 second' from space_private.admin_mail_settings cross join generate_series(1,13)n");
   const claims=await Promise.all(Array.from({length:13},()=>worker('claim')));
   assert.equal(claims.filter(Boolean).length,12);
   assert.equal(new Set(claims.filter(Boolean).map(c=>c.id)).size,12);
   await flush();
 });
 await check('Service degradation and clearing an alert require consecutive timed samples',async()=>{
   await db.query("insert into approval_email_outbox(user_id,recipient_email,applicant_name,application_type,status,next_attempt_at) values($1,'PRIVATE@example.invalid','PRIVATE','member','pending',now()-interval '25 minutes')",[uuid(2)]);
   await observeAgain();await worker('poll',[true]);await worker('poll',[true]);assert.equal((await admin('read')).jobs.length,0);
   await observeAgain();await worker('poll',[true]);
   let j=await only();assert.equal(j.category,'service_status');assert(j.title.includes('needs attention'));assert.equal(j.observed_count,1);
   await observeAgain();await worker('poll',[true]);assert.equal((await only()).occurrences,1);
   await exec("update approval_email_outbox set status='sent',sent_at=now()");
   await observeAgain();await worker('poll',[true]);assert.equal((await admin('read')).jobs.length,1);
   await observeAgain();await worker('poll',[true]);
   assert((await admin('read')).jobs.some(row=>row.title.includes('alert cleared')));await flush();
 });
 await check('Member error alerts require multiple different recent reports; bodies stay private',async()=>{
   const issue=n=>as(n,'aal1',"select space_report_client_issue('upload','configuration') v");
   await issue(2);await issue(2);await observeAgain();await worker('poll',[true]);
   assert.equal((await admin('read')).jobs.length,0);
   await issue(3);await issue(4);await observeAgain();await worker('poll',[true]);
   await observeAgain();await worker('poll',[true]);
   const j=await only();assert.equal(j.category,'errors');assert.equal(j.observed_count,3);await flush();
 });
 await check('Audit pages retain exact ordering and retention expires old delivery work',async()=>{
   await exec("insert into space_private.admin_mail_jobs(revision,code,bucket,first_at) select revision,'announcement',now()+n*interval '1 second',now()-n*interval '1 hour' from space_private.admin_mail_settings cross join generate_series(1,30)n");
   const page=(await admin('read')).jobs;assert.equal(page.length,26);
   const next=(await admin('read',[page[24].first_at,page[24].id])).jobs;assert.equal(next.length,5);
   assert(!next.some(j=>page.slice(0,25).some(p=>p.id===j.id)));
   await worker('poll',[true]);
   assert.equal((await admin('read')).jobs.slice(0,25).concat((await admin('read',[page[24].first_at,page[24].id])).jobs).filter(j=>j.state==='cancelled').length,7);
 });
 console.log(count+' administrator email database checks passed.');
} finally{await db.close();}
