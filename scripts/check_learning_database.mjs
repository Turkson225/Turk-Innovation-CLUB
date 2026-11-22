// Isolated PostgreSQL regression suite. Does not connect to a live Supabase project.
// npm install --prefix /tmp/space-sql-tools --ignore-scripts @electric-sql/pglite@0.5.10
// SPACE_PGLITE_MODULE=/tmp/space-sql-tools/node_modules/@electric-sql/pglite node scripts/check_learning_database.mjs
import fs from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.SPACE_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();
const root=new URL('../',import.meta.url);
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const actors={admin:id(1),teacher:id(2),otherTeacher:id(3),student:id(4),otherStudent:id(5),pending:id(6),investor:id(7),unverified:id(8),outsider:id(9)};
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS',name);}
const as=(actor,sql,params=[])=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);return tx.query(sql,params);});
const reject=async(fn,pattern)=>{await assert.rejects(fn,pattern);};
try{
await db.exec(`
create role anon; create role authenticated;
create schema auth; create schema storage;
grant usage on schema public,auth,storage to anon,authenticated;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant execute on function auth.uid() to anon,authenticated;
create table public.profiles(id uuid primary key references auth.users(id),full_name text not null,role text not null default 'member',application_type text not null default 'member',membership_status text not null default 'pending',programme text default '',skills text default '',last_seen_at timestamptz,created_at timestamptz default now());
alter table public.profiles enable row level security;
grant select on public.profiles to authenticated;
grant update(full_name,programme,skills,last_seen_at) on public.profiles to authenticated;
create policy own_profile on public.profiles for all to authenticated using(id=auth.uid()) with check(id=auth.uid());
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and membership_status='approved' and role='admin') $$;
create function public.is_approved() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and membership_status='approved' and role in ('member','teacher','founder','admin')) $$;
create function public.is_teacher() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and membership_status='approved' and role in ('teacher','admin')) $$;
create table public.founders(id uuid primary key default gen_random_uuid());
create table public.courses(id uuid primary key default gen_random_uuid(),title text not null,category text not null,level text not null default 'Beginner',description text default '',starts_at timestamptz,resource_url text,created_at timestamptz default now());
alter table public.courses enable row level security;
grant select,insert on public.courses to authenticated;
create policy "Members view courses" on public.courses for select to authenticated using(public.is_approved());
create table public.notifications(id uuid primary key default gen_random_uuid(),user_id uuid references public.profiles(id),kind text,title text,target_type text,target_id uuid,created_at timestamptz default now());
create table public.audit_events(id uuid primary key default gen_random_uuid(),actor_id uuid,action text,target_type text,target_id uuid,created_at timestamptz default now());
create table public.founder_invites(email text,accepted_at timestamptz);
create table public.approval_email_outbox(user_id uuid,application_type text,status text,attempts integer default 0);
create table public.application_answers(user_id uuid primary key,reason text);
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
grant select,insert,delete on storage.objects to authenticated;
`);
for(const file of ['upgrade_teacher_materials.sql','upgrade_course_journey.sql','upgrade_teacher_promotions.sql','upgrade_founder_teaching_roles.sql','upgrade_course_planning.sql','upgrade_course_classroom_access.sql','upgrade_course_lifecycle_reviews.sql']){
  await db.exec(fs.readFileSync(new URL('supabase/'+file,root),'utf8'));
}
for(const [name,actor] of Object.entries(actors)){
  await db.query('insert into auth.users values($1,$2,$3)',[actor,name+'@example.test',name==='unverified'?null:new Date().toISOString()]);
  await db.query('insert into public.profiles(id,full_name,role,membership_status,application_type) values($1,$2,$3,$4,$5)',[actor,name,name==='admin'?'admin':name.toLowerCase().includes('teacher')?'teacher':name==='investor'?'investor':'member',name==='pending'?'pending':'approved',name==='investor'?'investor':'member']);
}
const c1=id(101),c2=id(102),ended=id(103),archived=id(104);
await db.query('insert into public.courses(id,title,category,instructor_id,status) values($1,$2,$3,$4,$5),($6,$7,$8,$9,$10),($11,$12,$13,$14,$15),($16,$17,$18,$19,$20)',[c1,'Control systems lab','Controls and Automation',actors.teacher,'active',c2,'Programming lab','Software and Programming',actors.otherTeacher,'active',ended,'Old controls lab','Controls and Automation',actors.teacher,'ended',archived,'Archived controls','Controls and Automation',actors.teacher,'archived']);
const migration=fs.readFileSync(new URL('supabase/upgrade_learning_dashboards.sql',root),'utf8');
await check('Migration applies with previous course migrations and can be rerun',async()=>{await db.exec(migration);await db.exec(migration);});
await check('Existing class teachers keep their teaching courses',async()=>{assert.equal((await as(actors.teacher,'select * from public.teaching_track_assignments')).rows.length,1);});
await check('Members can choose all four courses and join matching open classes only',async()=>{
  await as(actors.student,'select public.set_my_learning_tracks($1)',['{Controls and Automation,Software and Programming,Electronics and Robotics,AI & Machine Learning}']);
  const rows=(await as(actors.student,'select course_id from public.course_enrollments order by course_id')).rows;assert.deepEqual(rows.map(x=>x.course_id),[c1,c2]);
});
await check('Repeated choices do not duplicate enrollments',async()=>{await as(actors.student,"select public.set_my_learning_tracks(array['Controls and Automation','Software and Programming'])");assert.equal((await as(actors.student,'select * from public.course_enrollments')).rows.length,2);});
const driveMigration=fs.readFileSync(new URL('supabase/migrations/20261121000000_drive_learning_materials.sql',root),'utf8');
const driveUrl='https://docs.google.com/presentation/d/Example_File-4QB7qh7Dx/edit?resourcekey=0-example';
const linkMaterial=(actor,course,url=driveUrl,owner=actor,storagePath=null)=>as(actor,
  "insert into public.learning_materials(course_id,uploaded_by,title,kind,drive_url,storage_path) values($1,$2,'Practice slides','slides',$3,$4) returning id",
  [course,owner,url,storagePath]);
await check('Drive upgrade is rerunnable and preserves files uploaded before the migration',async()=>{
  const path=actors.teacher+'/fixture.pdf';
  await as(actors.teacher,
    "insert into public.learning_materials(course_id,uploaded_by,title,kind,file_name,storage_path,file_size) values($1,$2,'Workshop file','notes','fixture.pdf',$3,1024)",
    [c1,actors.teacher,path]);
  await db.exec(driveMigration);
  await db.exec(driveMigration);
  assert.equal((await as(actors.student,'select storage_path from public.learning_materials where storage_path=$1 and drive_url is null',[path])).rows[0].storage_path,path);
});
await check('Drive materials use classroom roles, visibility and the administrator hide control',async()=>{
  const link=(await linkMaterial(actors.teacher,c1)).rows[0].id;
  const visible=async actor=>(await as(actor,'select drive_url from public.learning_materials where id=$1',[link])).rows[0]?.drive_url;
  for(const actor of [actors.admin,actors.teacher,actors.student])assert.equal(await visible(actor),driveUrl);
  for(const actor of [actors.otherTeacher,actors.otherStudent,actors.pending,actors.investor])assert.equal(await visible(actor),undefined);
  await reject(()=>linkMaterial(actors.otherTeacher,c1),/row-level security/);
  await reject(()=>linkMaterial(actors.student,c1),/row-level security/);
  await reject(()=>linkMaterial(actors.teacher,c1,driveUrl,actors.otherTeacher),/row-level security/);
  await as(actors.admin,'update public.learning_materials set hidden_at=now() where id=$1',[link]);
  assert.equal(await visible(actors.student),undefined);
  assert.equal(await visible(actors.admin),driveUrl);
});
await check('Drive records must belong to a course and contain a supported Google URL and no storage path',async()=>{
  await reject(()=>linkMaterial(actors.admin,null),/row-level security|learning_materials_source_check/);
  await reject(()=>linkMaterial(actors.teacher,c1,'https://drive.google.com.example.test/file/d/Example_File-4QB7qh7Dx/view'),/learning_materials_source_check/);
  await reject(()=>linkMaterial(actors.teacher,c1,driveUrl,actors.teacher,actors.teacher+'/another.pdf'),/row-level security|learning_materials_source_check/);
  const result=await as(actors.admin,
    "insert into public.learning_materials(course_id,uploaded_by,title,kind,drive_url) values($1,$2,'Practice video','video',$3) returning kind",
    [c1,actors.admin,'https://drive.google.com/file/d/Example_File-4QB7qh7Dx/view']);
  assert.equal(result.rows[0].kind,'video');
});
const trackMigration=fs.readFileSync(new URL('supabase/migrations/20261122000000_track_learning_materials.sql',root),'utf8');
const controlsTrack='Controls and Automation';
const shareTrack=(actor,track,course=null)=>as(actor,
  "insert into public.learning_materials(course_id,learning_track,uploaded_by,title,kind,drive_url) values($1,$2,auth.uid(),'Track slides','slides',$3) returning id",
  [course,track,driveUrl]);
await check('A track Drive link reaches its students without becoming a workshop or general-library item',async()=>{
  await db.exec(trackMigration);await db.exec(trackMigration);
  const id=(await shareTrack(actors.teacher,controlsTrack)).rows[0].id;
  const visible=async actor=>(await as(actor,'select course_id,learning_track,drive_url from public.learning_materials where id=$1',[id])).rows;
  for(const actor of [actors.admin,actors.teacher,actors.student])assert.deepEqual(await visible(actor),[{course_id:null,learning_track:controlsTrack,drive_url:driveUrl}]);
  for(const actor of [actors.otherTeacher,actors.otherStudent,actors.pending,actors.investor])assert.deepEqual(await visible(actor),[]);
  // A current course choice is enough, even before the learner has joined a workshop.
  await db.query("insert into public.member_learning_paths(user_id,tracks) values($1,array[$2::text]),($3,array[$2::text])",[actors.outsider,controlsTrack,actors.pending]);
  assert.equal((await as(actors.outsider,'select * from public.course_enrollments where learner_id=auth.uid()')).rows.length,0);
  assert.equal((await visible(actors.outsider)).length,1);
  assert.deepEqual(await visible(actors.pending),[]);
  await db.query('delete from public.member_learning_paths where user_id in ($1,$2)',[actors.outsider,actors.pending]);
  await reject(()=>shareTrack(actors.otherTeacher,controlsTrack),/row-level security/);
  await reject(()=>shareTrack(actors.student,controlsTrack),/row-level security/);
  await reject(()=>shareTrack(actors.admin,'Not a real course'),/learning_materials_track_check/);
  await reject(()=>shareTrack(actors.admin,controlsTrack,c1),/row-level security|learning_materials_track_check/);
  assert.equal((await shareTrack(actors.admin,'AI & Machine Learning')).rows.length,1);
});
await check('A track PDF can be downloaded only by its audience and stops appearing after administrators hide it',async()=>{
  const path=actors.teacher+'/track-practice.pdf';
  await as(actors.teacher,"insert into storage.objects(bucket_id,name) values('club-learning',$1)",[path]);
  const id=(await as(actors.teacher,
    "insert into public.learning_materials(learning_track,uploaded_by,title,kind,file_name,storage_path,file_size) values($1,auth.uid(),'Track notes','notes','track-practice.pdf',$2,2048) returning id",
    [controlsTrack,path])).rows[0].id;
  const visible=async actor=>(await as(actor,"select name from storage.objects where bucket_id='club-learning' and name=$1",[path])).rows.map(r=>r.name);
  for(const actor of [actors.admin,actors.teacher,actors.student])assert.deepEqual(await visible(actor),[path]);
  for(const actor of [actors.otherTeacher,actors.otherStudent,actors.pending,actors.investor])assert.deepEqual(await visible(actor),[]);
  await as(actors.admin,'update public.learning_materials set hidden_at=now() where id=$1',[id]);
  assert.deepEqual(await visible(actors.student),[]);
  assert.deepEqual(await visible(actors.teacher),[]);
});
await check('A Drive folder link stays in the selected track and does not change access rules',async()=>{
  const folderSql=fs.readFileSync(new URL('supabase/migrations/20261122010000_drive_folder_materials.sql',root),'utf8');
  await db.exec(folderSql);await db.exec(folderSql);
  const folder='https://drive.google.com/drive/folders/Example_File-4QB7qh7Dx?resourcekey=0-example';
  const insert=(actor,link,track=controlsTrack,course=null)=>as(actor,
    "insert into public.learning_materials(course_id,learning_track,uploaded_by,title,kind,drive_url) values($1,$2,auth.uid(),'Course folder','guide',$3) returning id",
    [course,track,link]);
  const id=(await insert(actors.teacher,folder)).rows[0].id;
  assert.deepEqual((await as(actors.student,'select learning_track,drive_url from public.learning_materials where id=$1',[id])).rows,[{learning_track:controlsTrack,drive_url:folder}]);
  assert.deepEqual((await as(actors.otherStudent,'select id from public.learning_materials where id=$1',[id])).rows,[]);
  await insert(actors.teacher,folder,null,c1);
  await reject(()=>insert(actors.otherTeacher,folder),/row-level security/);
  await reject(()=>insert(actors.admin,folder,null),/learning_materials_source_check/);
  await reject(()=>insert(actors.admin,'https://drive.google.com.invalid/drive/folders/Example_File-4QB7qh7Dx'),/learning_materials_source_check/);
});
const removeLearning=(actor,id,removed)=>as(actor,'select public.set_learning_material_removed($1,$2)',[id,removed]);
await check('Teachers can delete and restore their own workshop files without touching storage or losing audit history',async()=>{
  const sql=fs.readFileSync(new URL('supabase/migrations/20261122020000_remove_learning_materials.sql',root),'utf8');
  await db.exec(sql);await db.exec(sql);
  const path=actors.teacher+'/reversible-material.pdf';
  await as(actors.teacher,"insert into storage.objects(bucket_id,name) values('club-learning',$1)",[path]);
  const id=(await as(actors.teacher,
    "insert into public.learning_materials(course_id,uploaded_by,title,kind,file_name,storage_path,file_size) values($1,auth.uid(),'Temporary notes','notes','notes.pdf',$2,2048) returning id",[c1,path])).rows[0].id;
  const rows=async actor=>(await as(actor,'select hidden_at from public.learning_materials where id=$1',[id])).rows;
  const file=async actor=>(await as(actor,"select name from storage.objects where bucket_id='club-learning' and name=$1",[path])).rows;
  assert.equal((await file(actors.student)).length,1);
  await reject(()=>removeLearning(actors.student,id,true),/Approved teaching access/);
  await reject(()=>removeLearning(actors.otherTeacher,id,true),/cannot manage/);
  await removeLearning(actors.teacher,id,true);await removeLearning(actors.teacher,id,true);
  assert((await rows(actors.teacher))[0].hidden_at);
  assert.deepEqual(await rows(actors.student),[]);
  assert.deepEqual(await file(actors.student),[]);
  await removeLearning(actors.teacher,id,false);
  assert.equal((await rows(actors.student))[0].hidden_at,null);
  assert.equal((await file(actors.student)).length,1);
  const audit=(await db.query("select action,actor_id from public.audit_events where target_type='learning_material' and target_id=$1 order by created_at",[id])).rows;
  assert.deepEqual(audit.map(a=>a.action).sort(),['learning_material_removed','learning_material_restored']);
  assert(audit.every(a=>a.actor_id===actors.teacher));
});
await check('Admins can remove any Drive link and a teacher who lost the track cannot restore it',async()=>{
  const id=(await shareTrack(actors.teacher,controlsTrack)).rows[0].id;
  await removeLearning(actors.admin,id,true);
  assert.deepEqual((await as(actors.teacher,'select hidden_at from public.learning_materials where id=$1',[id])).rows,[]);
  await reject(()=>removeLearning(actors.teacher,id,false),/Only an administrator/);
  await removeLearning(actors.admin,id,false);
  await removeLearning(actors.teacher,id,true);
  assert((await as(actors.teacher,'select hidden_at from public.learning_materials where id=$1',[id])).rows[0].hidden_at);
  await db.query('delete from public.teaching_track_assignments where teacher_id=$1 and track=$2',[actors.teacher,controlsTrack]);
  await reject(()=>removeLearning(actors.teacher,id,false),/cannot manage/);
  assert.deepEqual((await as(actors.teacher,'select id from public.learning_materials where id=$1',[id])).rows,[]);
  await removeLearning(actors.admin,id,false);
  assert.equal((await as(actors.student,'select drive_url from public.learning_materials where id=$1',[id])).rows[0].drive_url,driveUrl);
  await db.query('insert into public.teaching_track_assignments(teacher_id,track) values($1,$2)',[actors.teacher,controlsTrack]);
  await reject(()=>db.transaction(async tx=>{await tx.exec('set local role anon');return tx.query('select public.set_learning_material_removed($1,true)',[id]);}),/permission denied/);
});
const deliverMaterialAlerts=async()=>(await db.query('select space_private.deliver_learning_material_alerts() sent')).rows[0].sent;
const materialAlerts=async id=>(await db.query("select user_id,kind from public.notifications where target_type='learning_material' and target_id=$1 order by user_id",[id])).rows;
await check('Learning alerts notify new and existing learners once, and never notify other tracks or pending accounts',async()=>{
  const migration=fs.readFileSync(new URL('supabase/migrations/20261122030000_learning_material_alerts.sql',root),'utf8');
  await db.exec(migration); // Projects without Cron can queue while finishing setup.
  await db.exec(`create schema cron;
    create table cron.learning_schedule(name text primary key, interval text, command text);
    create function cron.schedule(job_name text, cadence text, sql_command text) returns bigint language sql as $$
      insert into cron.learning_schedule values(job_name,cadence,sql_command) on conflict (name)
        do update set interval=excluded.interval,command=excluded.command returning 1::bigint $$;`);
  await db.exec(migration);await db.exec(migration);
  assert.equal((await db.query("select name from cron.learning_schedule where name='space-learning-material-alerts'")).rows.length,1);
  assert.equal(await deliverMaterialAlerts(),0);
  await db.query('insert into public.member_learning_paths(user_id,tracks) select id,array[$1::text] from public.profiles where id=any($2::uuid[])',
    [controlsTrack,[actors.outsider,actors.pending,actors.unverified]]);
  const mid=(await shareTrack(actors.teacher,controlsTrack)).rows[0].id;
  const ownClass=(await linkMaterial(actors.teacher,c1)).rows[0].id;
  const deleted=(await shareTrack(actors.teacher,controlsTrack)).rows[0].id;
  await removeLearning(actors.admin,deleted,true);
  await as(actors.teacher,
    "insert into public.learning_materials(uploaded_by,title,kind,file_name,storage_path,file_size) values(auth.uid(),'Shared safety notes','notes','safety.pdf',$1,1024)",
    [actors.teacher+'/general-alert-check.pdf']);
  assert.equal(await deliverMaterialAlerts(),3);
  assert.deepEqual((await materialAlerts(mid)).map(r=>r.user_id),[actors.student,actors.outsider]);
  assert.deepEqual((await materialAlerts(ownClass)).map(r=>r.user_id),[actors.student]);
  assert.deepEqual(await materialAlerts(deleted),[]);
  await removeLearning(actors.admin,deleted,false);
  assert.equal(await deliverMaterialAlerts(),0);
  assert.equal((await as(actors.outsider,'select id from public.learning_materials where id=$1',[deleted])).rows.length,1);
  await reject(()=>as(actors.teacher,'select space_private.deliver_learning_material_alerts()'),/permission denied/);
  await db.query('delete from public.member_learning_paths where user_id=any($1::uuid[])',[[actors.outsider,actors.pending,actors.unverified]]);
});
await check('A large track receives every alert across bounded batches and even after a retry',async()=>{
  const ai='AI & Machine Learning';
  await db.exec(`insert into auth.users(id,email,email_confirmed_at)
    select md5('track-alert-test-'||i)::uuid,'track-alert-'||i||'@example.test',now() from generate_series(1,251)i;
    insert into public.profiles(id,full_name,role,membership_status,application_type)
    select id,'Synthetic track learner','member','approved','member' from auth.users where email like 'track-alert-%@example.test';`);
  await db.query("insert into public.member_learning_paths(user_id,tracks) select id,array[$1::text] from auth.users where email like 'track-alert-%@example.test'",[ai]);
  const material=(await shareTrack(actors.admin,ai)).rows[0].id;
  assert.equal(await deliverMaterialAlerts(),250);
  assert.equal(await deliverMaterialAlerts(),0);
  await db.query('update space_private.learning_material_alert_jobs set after_user=null,next_batch_at=now() where material_id=$1',[material]);
  assert.equal(await deliverMaterialAlerts(),0); // First batch replay is deduplicated.
  await db.query('update space_private.learning_material_alert_jobs set next_batch_at=now() where material_id=$1',[material]);
  assert.equal(await deliverMaterialAlerts(),1);
  assert.equal((await materialAlerts(material)).length,251);
  assert.equal(await deliverMaterialAlerts(),0);
});
await check('Empty, duplicate and invented courses are rejected',async()=>{for(const tracks of [[],['fake'],['Controls and Automation','Controls and Automation']])await reject(()=>as(actors.student,'select public.set_my_learning_tracks($1)',[tracks]),/Select one or more/);});
await check('Unverified and investor accounts cannot choose member courses',async()=>{for(const actor of [actors.unverified,actors.investor])await reject(()=>as(actor,"select public.set_my_learning_tracks(array['Controls and Automation'])"),/Verified club account/);});
await check('Pending applicants save choices without joining a private class',async()=>{await as(actors.pending,"select public.set_my_learning_tracks(array['Controls and Automation'])");assert.equal((await db.query('select * from public.course_enrollments where learner_id=$1',[actors.pending])).rows.length,0);});
await check('Approval connects the selected classes automatically',async()=>{await db.query("update public.profiles set membership_status='approved' where id=$1",[actors.pending]);assert.equal((await as(actors.pending,'select * from public.course_enrollments')).rows.length,1);});
await check('Students cannot read other learners course choices',async()=>{assert.equal((await as(actors.student,'select * from public.member_learning_paths where user_id=$1',[actors.pending])).rows.length,0);});
await check('Teachers see only names in their assigned course roster',async()=>{const rows=(await as(actors.teacher,'select * from public.learning_track_roster()')).rows;assert(rows.length>=2);assert(rows.every(r=>r.track==='Controls and Automation'));assert.deepEqual(Object.keys(rows[0]).sort(),['full_name','learner_id','track']);});
await check('Students cannot use the teacher roster to discover learners',async()=>{assert.equal((await as(actors.student,'select * from public.learning_track_roster()')).rows.length,0);});
await check('Future published classes enroll the selected approved students',async()=>{await as(actors.teacher,"insert into public.courses(title,category,description) values('Next controller build','Controls and Automation','Build and test a feedback controller')");assert.equal((await as(actors.student,'select * from public.course_enrollments')).rows.length,3);});
await check('Teachers cannot publish in unassigned courses',async()=>{await reject(()=>as(actors.teacher,"insert into public.courses(title,category) values('AI lab','AI & Machine Learning')"),/Assign this teacher/);});
await check('Choosing different courses preserves previous class records',async()=>{await as(actors.student,"select public.set_my_learning_tracks(array['Software and Programming'])");assert.equal((await as(actors.student,'select * from public.course_enrollments')).rows.length,3);await as(actors.student,"select public.set_my_learning_tracks(array['Controls and Automation','Software and Programming'])");});
await as(actors.otherStudent,"select public.set_my_learning_tracks(array['Controls and Automation'])");
let task,personal;
await check('Assigned teacher publishes classwork and a task for one student',async()=>{
  task=(await as(actors.teacher,"select public.publish_classroom_assignment($1,'Measure the response','practical','Build the controller and record its response to three setpoints.',null,null,null)",[c1])).rows[0].publish_classroom_assignment;
  personal=(await as(actors.teacher,"select public.publish_classroom_assignment($1,'Improve the controller','assignment','Repeat your experiment and explain the difference in settling time.',null,null,$2)",[c1,actors.student])).rows[0].publish_classroom_assignment;
});
await check('A different course teacher cannot publish work in this class',async()=>{await reject(()=>as(actors.otherTeacher,"select public.publish_classroom_assignment($1,'Invalid cross-course task','project','Build this project with an instructor from another course.')",[c1]),/Only the assigned teacher/);});
await check('An unenrolled outsider sees no classwork',async()=>{assert.equal((await as(actors.outsider,'select * from public.classroom_assignments')).rows.length,0);});
await check('Targeted work stays private from the rest of the class',async()=>{const rows=(await as(actors.otherStudent,'select id from public.classroom_assignments')).rows;assert(rows.some(x=>x.id===task));assert(!rows.some(x=>x.id===personal));});
await check('Assigned students can read both whole-class and personal tasks',async()=>{assert.equal((await as(actors.student,'select * from public.classroom_assignments')).rows.length,2);});
await check('A teacher cannot assign work to a student outside the class',async()=>{await reject(()=>as(actors.teacher,"select public.publish_classroom_assignment($1,'Another task','project','Build and document a complete testable prototype.',null,null,$2)",[c1,actors.outsider]),/Choose a student enrolled/);});
await check('Ended classes do not accept newly assigned work',async()=>{await reject(()=>as(actors.teacher,"select public.publish_classroom_assignment($1,'Old class task','project','Build and document a complete testable prototype.')",[ended]),/open class/);});
let attempt;
await check('Students submit work to their own enrolled class',async()=>{attempt=(await as(actors.student,"select public.submit_classroom_assignment($1,'I tested three setpoints and measured the settling time at each one.','https://example.test/evidence')",[task])).rows[0].submit_classroom_assignment;});
await check('Unenrolled students cannot submit to another class',async()=>{await reject(()=>as(actors.outsider,"select public.submit_classroom_assignment($1,'Here are my tests and results for this practical assignment.')",[task]),/Enrollment/);});
await check('Students cannot read one another submissions',async()=>{assert.equal((await as(actors.otherStudent,'select * from public.classroom_assignment_submissions')).rows.length,0);});
await check('An unrelated teacher cannot read or review these submissions',async()=>{assert.equal((await as(actors.otherTeacher,'select * from public.classroom_assignment_submissions')).rows.length,0);await reject(()=>as(actors.otherTeacher,"select public.review_classroom_assignment($1,'accepted','Clear and complete work.')",[attempt]),/Only the assigned teacher/);});
await check('A pending attempt blocks duplicate submissions',async()=>{await reject(()=>as(actors.student,"select public.submit_classroom_assignment($1,'Here are another set of results for the same pending task.')",[task]),/awaiting review/);});
await check('A teacher marks work seen without completing its review',async()=>{await as(actors.teacher,"select public.review_classroom_assignment($1,'seen')",[attempt]);const row=(await as(actors.student,'select * from public.classroom_assignment_submissions')).rows[0];assert(row.seen_at);assert.equal(row.review_status,'submitted');});
await check('Revision feedback reaches only the author and opens a new attempt',async()=>{await as(actors.teacher,"select public.review_classroom_assignment($1,'revision_requested','Please compare overshoot and settling time for all three trials.')",[attempt]);const row=(await as(actors.student,'select * from public.classroom_assignment_submissions')).rows[0];assert(row.teacher_feedback.includes('overshoot'));});
let improved;
await check('Improved submissions preserve the earlier attempt and its feedback',async()=>{improved=(await as(actors.student,"select public.submit_classroom_assignment($1,'I repeated all three trials and compared both overshoot and settling time.')",[task])).rows[0].submit_classroom_assignment;assert.equal((await as(actors.student,'select * from public.classroom_assignment_submissions')).rows.length,2);});
await check('Acceptance prevents further attempts and leaves history intact',async()=>{await as(actors.teacher,"select public.review_classroom_assignment($1,'accepted','Good comparison with repeatable measurements and a clear explanation.')",[improved]);await reject(()=>as(actors.student,"select public.submit_classroom_assignment($1,'Another complete attempt after the teacher already accepted it.')",[task]),/already accepted/);});
await check('Previously reviewed attempts cannot silently be rewritten',async()=>{await reject(()=>as(actors.teacher,"select public.review_classroom_assignment($1,'accepted','Changing the previous revision decision now.')",[attempt]),/already been reviewed/);});
await check('Direct writes cannot bypass role or assignment RPCs',async()=>{await reject(()=>as(actors.student,"update public.profiles set role='admin' where id=auth.uid()"),/permission denied/);await reject(()=>as(actors.teacher,"insert into public.teaching_track_assignments(teacher_id,track) values(auth.uid(),'AI & Machine Learning')"),/permission denied/);await reject(()=>as(actors.student,"update public.classroom_assignment_submissions set review_status='accepted'"),/permission denied/);});
await check('Only an administrator can change account roles',async()=>{await reject(()=>as(actors.teacher,"select public.assign_account_role($1,'admin')",[actors.otherStudent]),/Administrator/);});
await check('An administrator cannot change their own access through this tool',async()=>{await reject(()=>as(actors.admin,"select public.assign_account_role($1,'member')",[actors.admin]),/another approved account/);});
await check('An administrator promotes a member and assigns multiple teaching courses',async()=>{await as(actors.admin,"select public.assign_account_role($1,'teacher',array['Electronics and Robotics','AI & Machine Learning'])",[actors.otherStudent]);assert.equal((await as(actors.otherStudent,'select role from public.profiles where id=auth.uid()')).rows[0].role,'teacher');assert.equal((await as(actors.otherStudent,'select * from public.teaching_track_assignments')).rows.length,2);});
await check('Teachers cannot give themselves additional teaching courses',async()=>{await reject(()=>as(actors.otherStudent,"select public.assign_account_role($1,'teacher',array['Controls and Automation'])",[actors.otherStudent]),/Administrator/);});
await check('Roles requiring teaching cannot remove responsibility for existing classes',async()=>{await reject(()=>as(actors.admin,"select public.assign_account_role($1,'member')",[actors.teacher]),/Reassign/);await reject(()=>as(actors.admin,"select public.assign_account_role($1,'teacher',array['AI & Machine Learning'])",[actors.teacher]),/Reassign/);});
await check('New administrators receive a role notification and an audit record',async()=>{await as(actors.admin,"select public.assign_account_role($1,'admin')",[actors.outsider]);assert.equal((await as(actors.outsider,'select public.is_admin()')).rows[0].is_admin,true);assert((await db.query("select * from public.audit_events where action='account_role_member_to_admin' and target_id=$1",[actors.outsider])).rows.length===1);});
await check('Investor reassignment removes member and teaching access',async()=>{await as(actors.admin,"select public.assign_account_role($1,'investor')",[actors.otherStudent]);assert.equal((await as(actors.otherStudent,'select public.is_approved(),public.is_teacher()')).rows[0].is_approved,false);assert.equal((await as(actors.otherStudent,'select * from public.classroom_assignments')).rows.length,0);});
await check('Anonymous accounts cannot call learning or role management functions',async()=>{await assert.rejects(()=>db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query("select public.assign_account_role($1,'admin')",[actors.student]);}),/permission denied/);});
await check('Classes with classwork are archived even when no students have joined',async()=>{
  const emptyClass=(await as(actors.admin,"insert into public.courses(title,category) values('Unenrolled AI class','AI & Machine Learning') returning id")).rows[0].id;
  await as(actors.admin,"select public.publish_classroom_assignment($1,'Build a classifier','project','Train a classifier and evaluate it on a held-out sample.')",[emptyClass]);
  assert.equal((await as(actors.admin,'select public.delete_course($1)',[emptyClass])).rows[0].delete_course,'archived');
  assert.equal((await db.query('select count(*)::int as total from public.classroom_assignments where course_id=$1',[emptyClass])).rows[0].total,1);
});
await check('New classes notify each matching student once',async()=>{const rows=(await db.query("select * from public.notifications where user_id=$1 and title='New class added: Next controller build'",[actors.student])).rows;assert.equal(rows.length,1);});
await check('Teaching founders retain assigned teaching without losing leadership',async()=>{await as(actors.admin,"select public.assign_account_role($1,'founder',array['Controls and Automation'])",[actors.teacher]);const profile=(await as(actors.teacher,'select role,founder_teaching_enabled,public.is_teacher() as teaches from public.profiles where id=auth.uid()')).rows[0];assert.equal(profile.role,'founder');assert.equal(profile.founder_teaching_enabled,true);assert.equal(profile.teaches,true);});
await check('SQL rejects non-HTTPS assignment and evidence links',async()=>{await reject(()=>as(actors.teacher,"select public.publish_classroom_assignment($1,'Unsafe resource','practical','Build and document a testable low voltage controller.',null,'http://example.test/file')",[c1]),/check constraint/);});
await check('Migration reruns preserve submissions and explicit administrator role decisions',async()=>{await db.exec(migration);assert.equal((await db.query('select * from public.classroom_assignment_submissions')).rows.length,2);assert.equal((await db.query('select * from public.teaching_track_assignments where teacher_id=$1',[actors.otherStudent])).rows.length,0);});
console.log(`${checks}/${checks} database checks passed`);
} finally {await db.close();}
