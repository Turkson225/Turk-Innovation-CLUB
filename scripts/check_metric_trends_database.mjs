import fs from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createServiceShims} from './database_test_helpers.mjs';
import {uuid} from './load_test_fixture.mjs';
const db=new PGlite(), root=new URL('../supabase/migrations/',import.meta.url);
const exec=s=>db.exec(s.replaceAll('create extension if not exists pgcrypto;',''));
const migrate=name=>exec(fs.readFileSync(new URL(name,root),'utf8'));
const call=(actor,fn,args,aal=actor===1?'aal2':'aal1')=>db.transaction(async t=>{
  await t.exec('set local role '+(actor?'authenticated':'anon'));
  await t.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[actor?uuid(actor):'',JSON.stringify({aal,amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)}]})]);
  const values=args.map((_,i)=>'$'+(i+1)).join(',');
  return (await t.query('select public.'+fn+'('+values+') value',args)).rows[0].value;
});
const metrics=(actor,scope,grain='day',from='2024-02-28',through='2024-03-01',target=null)=>call(actor,'space_metric_trends',[scope,grain,from,through,target]);
const chapter=(actor,target,office=null,grain='day')=>call(actor,'space_chapter_metric_trends',[target,grain,'2024-02-28','2024-03-01',office]);
const ledger=(actor,grain='month')=>call(actor,'space_approved_ledger_trends',[grain,'2024-02-28','2024-03-01']);
const file='20261119010000_metric_trends.sql';
let n=0;
async function check(name,fn){await fn();n++;console.log('PASS',name);}
try{
  await createServiceShims({query:exec});
  await exec(`create schema realtime;
  create table realtime.messages(id uuid default gen_random_uuid(),topic text,extension text,payload jsonb);
  alter table realtime.messages enable row level security;
  grant usage on schema realtime to anon,authenticated;
  grant select,insert on realtime.messages to anon,authenticated;
  create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;`);
  for(const name of ['20261027000000_legacy_baseline.sql','20261027010000_security_hardening.sql','20261118000000_university_chapters.sql','20261119000000_chapter_operations.sql',file])await migrate(name);
  const [ca,cb,course,other]=[10,11,12,13].map(uuid);
  const id=Object.fromEntries(Array.from({length:8},(_,i)=>[i+1,uuid(i+1)]));
  await exec(`set session_replication_role=replica;
    insert into auth.users(id,email,email_confirmed_at)
      select md5('space-load:'||n)::uuid,'trends-'||n||'@example.invalid',now() from generate_series(1,8)n;
    insert into profiles(id,full_name,handle,role,application_type,membership_status,profile_visibility)
      select md5('space-load:'||n)::uuid,'Test account '||n,'metric_'||n,
      case n when 1 then 'admin' when 2 then 'teacher' when 7 then 'founder' else 'member' end,
      'member',case when n=5 then 'pending' else 'approved' end,'private'
      from generate_series(1,8)n;
    update profiles set role='investor' where id='${id[6]}';
    insert into courses(id,title,category,description,instructor_id)
      values('${course}','Learning A','Electronics and Robotics','Synthetic learning course','${id[2]}'),
            ('${other}','Learning B','Electronics and Robotics','Synthetic second course','${id[7]}');
    insert into course_enrollments(course_id,learner_id,created_at)
      values('${course}','${id[3]}','2024-02-29T00:00:00Z'),
            ('${course}','${id[4]}','2024-02-28T23:59:59Z'),
            ('${other}','${id[4]}','2024-03-01T12:00:00Z');
    insert into inventory_items(id,name,category,quantity_total,quantity_available,unit,created_by,created_at)
      values('${uuid(22)}','Training equipment','Tools',6,3,'pcs','${id[1]}','2024-02-29');
    insert into inventory_movements(item_id,kind,quantity,member_id,handled_by,note,created_at,unit_at_movement)
      values('${uuid(22)}','check_out',3,'${id[3]}','${id[1]}','Test checkout','2024-02-29','pcs');
    insert into space_shop_orders(buyer_id,client_token,request_fingerprint,contact_name,contact_phone,status,total_cents,collection_note,payment_status,created_at,collected_at)
      values('${id[3]}',gen_random_uuid(),'a','Test buyer','0240000000','collected',2000,'Synthetic','paid','2024-02-29','2024-03-01'),
            ('${id[4]}',gen_random_uuid(),'b','Other buyer','0240000000','ready',2000,'Synthetic','due','2024-02-29',null);
    insert into space_chapters(id,slug,name,institution,status)
      values('${ca}','campus-a','Campus A','Test university','active'),('${cb}','campus-b','Campus B','Test university','active');
    insert into space_chapter_memberships(chapter_id,user_id,role,status,requested_at) values
      ('${ca}','${id[2]}','coordinator','active','2024-02-28'),
      ('${ca}','${id[3]}','secretary','active','2024-02-29'),
      ('${cb}','${id[4]}','coordinator','active','2024-02-29');
    insert into audit_events(actor_id,action,target_type,target_id,created_at)
      select '${id[1]}','chapter_membership_active','chapter_membership',id,'2024-03-01T12:15:00Z' from space_chapter_memberships where chapter_id='${cb}';
    insert into space_chapter_office_assignments(chapter_id,user_id,office,assigned_by)
      values('${ca}','${id[3]}','treasurer','${id[1]}');
    insert into space_chapter_activities(chapter_id,kind,title,body,archived_at,created_at) values
      ('${ca}','announcement','Private synthetic title','PRIVATE NOTES',now(),'2024-02-29'),
      ('${cb}','project','Other campus record','PRIVATE NOTES',null,'2024-03-01');
    insert into space_chapter_office_tasks(chapter_id,office,assignee_id,title,instructions,status,created_at,completed_at) values
      ('${ca}','secretary','${id[3]}','Assigned work','PRIVATE NOTES','completed','2024-02-28','2024-02-29'),
      ('${ca}','coordinator','${id[2]}','Other work','PRIVATE NOTES','open','2024-03-01',null),
      ('${cb}','coordinator','${id[4]}','Other campus work','PRIVATE NOTES','open','2024-03-01',null);
    insert into officer_assignments(user_id,position,assigned_by) values('${id[8]}','treasurer','${id[1]}');
    insert into finance_entries(id,entry_type,category,amount,description,occurred_on,created_by) values
      ('${uuid(31)}','income','Learning',14.25,'PRIVATE RECEIPT','2024-02-29','${id[1]}'),
      ('${uuid(32)}','expense','Supplies',3.10,'PRIVATE RECEIPT','2024-03-01','${id[1]}'),
      ('${uuid(33)}','income','Learning',90,'UNAPPROVED','2024-02-29','${id[1]}');
    insert into finance_reviews(entry_id,reviewer_id,decision,note) values
      ('${uuid(31)}','${id[1]}','approved','Synthetic'),('${uuid(32)}','${id[1]}','approved','Synthetic');
    set session_replication_role=origin;`);
  await check('Migration reruns without moving chapter records',async()=>{await migrate(file);assert.equal((await db.query('select count(*)::int n from space_chapters')).rows[0].n,2);});
  await check('Daily, monthly and annual UTC buckets include leap day and clipped boundaries',async()=>{
    await exec("set timezone='Pacific/Kiritimati'");
    const d=await metrics(3,'learning');
    assert.deepEqual(d.rows.map(r=>[r.date,r.values.enrollments]),[['2024-02-28',0],['2024-02-29',1],['2024-03-01',0]]);
    const m=await metrics(3,'learning','month'),y=await metrics(3,'learning','year');
    assert.deepEqual(m.rows.map(r=>[r.from,r.through,r.values.enrollments]),[['2024-02-28','2024-02-29',1],['2024-03-01','2024-03-01',0]]);
    assert.equal(y.rows[0].values.enrollments,1);
  });
  await check('Learner and teacher scopes keep their participant and workshop boundaries',async()=>{
    assert.equal((await metrics(2,'teaching','month')).rows[0].values.enrollments,2);
    await assert.rejects(()=>metrics(2,'teaching','month','2024-02-28','2024-03-01',other),/Class unavailable/);
    await assert.rejects(()=>metrics(3,'learning','day','2024-02-28','2024-03-01',other),/Class unavailable/);
    for(const i of [0,5,6])await assert.rejects(()=>metrics(i,'learning'),/permission denied|Approved club/);
  });
  await check('Order placements and collections use separate dates and member ownership',async()=>{
    assert.deepEqual((await metrics(3,'orders')).rows.map(r=>r.values),[{orders_created:0,orders_collected:0},{orders_created:1,orders_collected:0},{orders_created:0,orders_collected:1}]);
    assert.equal((await metrics(1,'orders')).rows[1].values.orders_created,2);
  });
  await check('Stock chart does not expose private movement counts or sum quantities',async()=>{
    assert.deepEqual((await metrics(3,'inventory')).series,['stock_created']);
    const founder=await metrics(7,'inventory');assert.equal(founder.rows[1].values.checkouts,1);assert.equal(founder.rows[1].values.stock_created,1);
  });
  await check('Manual chart preserves missing periods and corrected zero, using only the same series',async()=>{
    const save=(actor,c,label,unit,value,target,day,n,previous=null)=>call(actor,'space_manual_metric_save',['teaching',c,label,unit,value,target,day,'Synthetic register','Synthetic correction',uuid(n),previous]);
    const root=await save(2,course,'Practical hours','hours',1.25,3,'2024-02-28',100);
    await save(2,course,'Practical hours','hours',2.5,4,'2024-02-29',101);
    await save(2,course,'Practical hours','hours',0,null,'2024-02-28',102,root);
    await save(1,course,'Practical hours','hours',99,100,'2024-02-29',103);
    await save(2,course,'Practical hours','count',99,100,'2024-02-29',104);
    await save(1,other,'Practical hours','hours',99,100,'2024-03-01',105);
    const trend=(a,g='day')=>call(a,'space_manual_metric_trends',[root,g,'2024-02-28','2024-03-01']);
    const daily=await trend(2);
    assert.equal(daily.unit,'hours');
    assert.deepEqual(daily.rows.map(r=>[r.observed,r.values.actual,r.values.target]),[['2024-02-28',0,null],['2024-02-29',2.5,4],[null,null,null]]);
    assert.deepEqual((await trend(1,'month')).rows.map(r=>r.values.actual),[2.5,null]);
    for(const i of [0,3,5,7])await assert.rejects(()=>trend(i),/permission denied|Manual metric/);
  });
  await check('Chapter chart can aggregate the network but coordinators only see their chapter',async()=>{
    const network=await chapter(1,null),campus=await chapter(2,ca);
    assert.equal(network.rows[2].values.project,1);assert.equal(campus.rows[2].values.project,0);
    assert.equal(network.rows[2].values.activations,1);assert.equal(campus.rows[2].values.activations,0);
    assert.equal(campus.rows[1].values.announcement,1);
    await assert.rejects(()=>chapter(2,null),/administrator/);await assert.rejects(()=>chapter(2,cb),/office access/);
    assert(!JSON.stringify(network).includes('PRIVATE NOTES'));
  });
  await check('Officer charts exclude other people and can filter a single authorised office',async()=>{
    const only=await chapter(3,ca,'secretary');assert.deepEqual(only.series,['tasks_assigned','tasks_completed']);
    assert.equal(only.rows[0].values.tasks_assigned,1);assert.equal(only.rows[1].values.tasks_completed,1);assert.equal(only.rows[2].values.tasks_assigned,0);
    await assert.rejects(()=>chapter(3,ca,'coordinator'),/not assigned/);
    await db.query('update space_chapter_memberships set status=$1 where chapter_id=$2 and user_id=$3',['inactive',ca,id[3]]);
    await assert.rejects(()=>chapter(3,ca),/office access/);
  });
  await check('Ledger trend counts only approved dated entries with the existing finance entitlement',async()=>{
    const r=await ledger(8);assert.equal(r.unit,'GHS');
    assert.deepEqual(r.rows.map(v=>v.values),[{income:14.25,expense:0},{income:0,expense:3.1}]);
    assert.deepEqual(await ledger(1),r);assert(!JSON.stringify(r).includes('PRIVATE RECEIPT'));
    for(const i of [2,3,4])await assert.rejects(()=>ledger(i),/Finance report access/);
    await assert.rejects(()=>call(1,'space_approved_ledger_trends',['year','2024-01-01','2024-12-31'],'aal1'),/Finance report access/);
  });
  await check('Invalid and unbounded periods fail instead of exposing misleading buckets',async()=>{
    await assert.rejects(()=>metrics(3,'learning','hour'),/valid reporting/);
    await assert.rejects(()=>metrics(3,'learning','day','2023-01-01','2024-03-01'),/valid reporting/);
    await assert.rejects(()=>metrics(3,'learning','year','2024-01-01','2050-01-01'),/valid reporting/);
  });
  console.log(n+' trend database checks passed.');
}catch(e){console.error(e.message,e.detail||'',e.where||'');process.exitCode=1;}
finally{await db.close();}
