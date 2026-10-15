// Synthetic database fixture. Called only by the disposable local load-test runner.
import fs from 'node:fs';
import crypto from 'node:crypto';
export const uuid = n => {
  const h = crypto.createHash('md5').update(`space-load:${n}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
};
export const migrations = [
  'schema.sql','upgrade_community.sql','upgrade_membership_collaboration.sql',
  'upgrade_activity_feed.sql','upgrade_direct_messages.sql','upgrade_media_threads.sql',
  'upgrade_profile_images.sql','upgrade_roles_investors.sql','upgrade_teacher_materials.sql',
  'fix_thread_reply_policies.sql','fix_reply_policy_recursion.sql','upgrade_course_journey.sql',
  'upgrade_privacy_requests.sql','upgrade_founder_portraits.sql','upgrade_inventory_finance.sql',
  'upgrade_inventory_finance_approvals.sql','upgrade_admin_application_alerts.sql',
  'upgrade_admin_alert_inventory_edits.sql','upgrade_inventory_unit_changes.sql',
  'upgrade_approval_emails.sql','upgrade_teacher_promotions.sql','upgrade_founder_teaching_roles.sql',
  'upgrade_course_planning.sql','upgrade_private_applications.sql',
  'upgrade_course_classroom_access.sql','upgrade_course_lifecycle_reviews.sql',
  'upgrade_message_counts.sql','upgrade_dm_conversations.sql','upgrade_web_push.sql',
  'upgrade_learning_dashboards.sql','upgrade_officer_workspaces_finance.sql','upgrade_advanced_platform.sql',
  'upgrade_directory_learning_performance.sql'
];
export async function prepareFixture(db, members = 2000) {
  if(!Number.isInteger(members)||members<2000||members>10000)throw Error('Synthetic members must be an integer from 2000 to 10000');
  // These shims reproduce only the SQL-facing Auth/Storage contract, not their services.
  await db.query(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,
      raw_user_meta_data jsonb default '{}'::jsonb,created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.role',true),'') $$;
    create table storage.buckets(id text primary key,name text,public boolean,
      file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,
      name text,owner uuid,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to authenticated;
    create function storage.foldername(text) returns text[] language sql immutable as $$
      select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
    create publication supabase_realtime;
  `);
  for (const name of migrations) {
    try { await db.query(fs.readFileSync(new URL('../supabase/'+name,import.meta.url),'utf8')); }
    catch (e) { throw new Error(`Fixture migration ${name}: ${e.message}`,{cause:e}); }
  }
  await db.query(`create function public.load_uuid(n integer) returns uuid language sql immutable as $$
    select md5('space-load:'||n)::uuid $$`);
  // Fixture inserts bypass delivery/auto-enrollment triggers. Measured transactions do not.
  await db.query('set session_replication_role=replica');
  try {
    await db.query(`insert into auth.users(id,email,email_confirmed_at)
      select load_uuid(n),'loadtest-'||n||'@example.invalid',now() from generate_series(1,$1) n`,[members]);
    await db.query(`insert into public.profiles(id,full_name,handle,role,application_type,membership_status,
      profile_visibility,headline,bio,programme,skills,created_at)
      select load_uuid(n),'Synthetic member '||n,'loadtest_'||n,
        case when n=1 then 'admin' when n<=9 then 'teacher' else 'member' end,
        case when n between 2 and 9 then 'teacher' else 'member' end,'approved',
        case when n%10=0 then 'private' else 'club' end,'Practical engineering learner',
        repeat('Synthetic profile for isolated performance testing. ',4),'Engineering',
        'Design, build, measure, test',now()-n*interval '1 minute'
      from generate_series(1,$1) n`,[members]);
    await db.query(`insert into public.application_answers(user_id,reason)
      select id,'Synthetic application answer. Never use real member data in this test.' from profiles`);
    await db.query(`insert into public.courses(id,title,category,instructor_id,description,starts_at,submission_due_at)
      select load_uuid(10000+n),'Synthetic workshop '||n,
        (array['Controls and Automation','Software and Programming','Electronics and Robotics','AI & Machine Learning'])[1+(n-1)%4],
        load_uuid(2+(n-1)%8),repeat('Build and measure a practical prototype. ',10),now(),now()+interval '30 days'
      from generate_series(1,16) n;
      insert into public.teaching_track_assignments(teacher_id,track)
        select distinct instructor_id,category from courses;
      insert into public.member_learning_paths(user_id,tracks)
        select load_uuid(n),array['Controls and Automation','Software and Programming','Electronics and Robotics','AI & Machine Learning']
        from generate_series(10,$1) n;
      insert into public.course_enrollments(course_id,learner_id)
        select load_uuid(10001+(n%4)*4+t),load_uuid(n) from generate_series(10,$1) n cross join generate_series(0,3) t;
      insert into public.classroom_assignments(id,course_id,title,kind,instructions,created_by,due_at)
        select load_uuid(20000+n),load_uuid(10001+(n-1)/8),'Synthetic practical '||n,'practical',
          repeat('Build a prototype and document repeatable measurements. ',8),load_uuid(2+((n-1)/8)%8),now()+interval '7 days'
        from generate_series(1,128) n;
      insert into public.classroom_assignment_submissions(assignment_id,learner_id,details)
        select load_uuid(20001+(c.course_number-1)*8),e.learner_id,
          repeat('Synthetic build measurements and test results. ',20)
        from course_enrollments e join (select n course_number,load_uuid(10000+n) id from generate_series(1,16) n) c on c.id=e.course_id;
      insert into public.space_course_lessons(id,course_id,title,position,outcome,instructions)
        select load_uuid(30000+n),load_uuid(10001+(n-1)/8),'Synthetic lesson '||n,1+(n-1)%8,
          'Demonstrate a measurable working build.',repeat('Build and test the practical circuit. ',8)
        from generate_series(1,128) n;
      insert into public.space_class_sessions(course_id,title,starts_at,ends_at)
        select id,'Synthetic practical session',now()+interval '1 day',now()+interval '1 day 2 hours' from courses;
      insert into public.direct_messages(sender_id,recipient_id,body,created_at)
        select load_uuid(10+(n-1)%($1-9)),load_uuid(10+((n-1)+1+((n-1)/($1-9))%20)%($1-9)),
          repeat('Synthetic private engineering conversation. ',6),now()-n*interval '2 second'
        from generate_series(1,100000) n;
      insert into public.channel_messages(channel_id,author_id,body,created_at)
        select (select id from channels order by id limit 1),load_uuid(10+(n-1)%($1-9)),
          repeat('Synthetic channel discussion. ',6),now()-n*interval '3 second'
        from generate_series(1,20000) n;
      insert into public.activity_posts(author_id,body,created_at)
        select load_uuid(10+(n-1)%($1-9)),repeat('Synthetic practical activity update. ',12),now()-n*interval '10 second'
        from generate_series(1,10000) n;
      insert into public.notifications(user_id,kind,title,target_type,target_id,created_at)
        select load_uuid(10+(n-1)%($1-9)),'direct_message','Synthetic club notification','direct_message',
          load_uuid(10+n%($1-9)),now()-n*interval '4 second' from generate_series(1,40000) n;
      insert into public.events(id,title,description,starts_at,ends_at)
        values(load_uuid(40000),'Synthetic test event','Isolated event capacity check',now()+interval '1 day',now()+interval '1 day 1 hour');
      insert into public.space_event_settings(event_id,capacity) values(load_uuid(40000),25);
    `.replaceAll('$1',String(members)));
  } finally { await db.query('set session_replication_role=origin'); }
  await db.query('analyze');
  const tables=['profiles','courses','course_enrollments','classroom_assignments','classroom_assignment_submissions',
    'space_course_lessons','direct_messages','channel_messages','activity_posts','notifications'];
  const counts={};
  for(const t of tables)counts[t]=Number((await db.query(`select count(*) n from public.${t}`)).rows[0].n);
  return counts;
}
