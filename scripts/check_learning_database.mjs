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
