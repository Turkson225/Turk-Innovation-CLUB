# InnovateX Engineering Club platform

A responsive workspace for a practical engineering and technology club. The site is static and can be hosted on GitHub Pages. Supabase provides email sign-in and a database protected by row level security.

## What is included

- Public home and founders pages. Founder names remain placeholders until approved profiles are added.
- Email one-time-code signup, sign-in and sign-out, member profiles and an online indicator based on a recent heartbeat. Sign-out clears the member's presence; disconnected users disappear from "online" after about 65 seconds.
- Project cards, progress, tasks and discussion threads.
- Member channels with live message updates (and polling fallback), a private document library, and channel file sharing.
- Technology news submitted by members and reviewed by administrators before appearing in the feed.
- Founder invitations, verified-email acceptance, and a private founders' meeting room with Google Meet and calendar links.
- Administrator-approved member applications, threaded channel replies, reactions, mentions, unread counts, search and in-app notifications.
- A branded approval email for each newly approved member, teacher, founder and investor, delivered by a private Supabase worker after setup.
- Three-column member activity feed with project updates, resource links, shared club documents, comments, likes, recent stories and active members.
- Member profiles with a headline, bio and availability, plus private one-to-one messaging and unread counts. Tap a member portrait directly in the directory or a profile, feed, channel or direct-message photo to open a full-screen viewer with pinch, double-tap and button zoom. Optional dark theme is saved in the browser.
- New applicants choose member, teacher, founder or investor before email verification. The selected type is a request until an administrator approves it. Teachers can publish courses; founders have a private meeting room; investors have a separate curated portal and inquiry form.
- Administrator dashboard for pending applications, reports, club activity, investor inquiries and selected CSV exports.
- Role-specific sidebar: members use community pages, teachers get a Teaching studio, founders get the Founder room, investors use their separate portal, and administrators get oversight pages. Approved profiles display a role badge.
- Approved teachers and administrators can upload PDF notes, PowerPoint slides and Word guides (up to 20 MB) to a private learning library associated with a course or shared with the whole club. Approved club members can download the visible materials.
- Members can enroll in practical workshops, submit build notes and private evidence, receive teacher feedback, revise their work and earn a completion record after acceptance.
- Administrators can promote an already approved member to teacher; the teacher receives an in-app notification and completes a private teaching profile with a track, relevant experience, practical plan and availability.
- Approved founders can lead practical workshops while keeping founder meeting and finance review access. Administrators can make an approved teacher a founder, assign or pause founder teaching, remove founder access while retaining member or teacher status, and separately remove a public founder card.
- Members can choose whether their profile appears in the club directory and request account or content removal; administrators review and record the outcome.
- Blog-style engineering posts with an optional headline, topic, cover image, links and document attachments; comments support one level of replies. Channel messages can include an image selected from the member's gallery.
- Project collaborators, milestones and task assignments; meeting RSVPs, document versions, reports and moderation actions.
- Administrator-published courses, alerts and events. Events can include Google Meet links and open in Google Calendar or download as an ICS file.
- Phone, tablet and desktop layouts. Untrusted member text is escaped before display.
- Server-paged applications, feed, channel history and direct messages, with all-authorized-row CSV export for selected records and a separate private Storage backup procedure.

## Set up Supabase

1. Create a Supabase project and open **SQL Editor**. Run [`supabase/schema.sql`](supabase/schema.sql) once. Use a new project or review existing schema before running it.
2. In **Authentication → Providers → Email**, enable email sign-in and leave email confirmation enabled. Under **Authentication → Email Templates**, edit **Magic Link / OTP**: set the subject to `Your InnovateX verification code` and replace the HTML body with [`supabase/email-otp-template.html`](supabase/email-otp-template.html). Because a new user can receive the **Confirm Signup** template, set its subject to `Verify your InnovateX account` and use the same HTML body there too. Both templates must contain `{{ .Token }}` rather than an authentication link for the site's code entry screen to work. Save each template. To email club members beyond your Supabase team's authorized addresses, configure **Authentication → SMTP Settings** with a verified sender and set the sender name to `InnovateX Engineering Club`; Supabase's built-in sender is restricted.
3. In **Authentication → URL Configuration**, set the Site URL to `https://turkson225.github.io/Turk-Innovation-CLUB/`. Add that exact URL to Redirect URLs. For local testing, add `http://localhost:8000/` as another Redirect URL.
4. In the project's **Connect** dialog, copy the Project URL and **publishable** key into [`config.js`](config.js). These values are designed for browser use. **Never paste a service_role or secret key** into the repository. This repository is configured with the project's public values.
5. Create your account and verify its email first. Then, in SQL Editor, promote your specific user to an administrator using the authenticated user's UUID from **Authentication → Users**:

   ```sql
   update public.profiles set role = 'admin'
   where id = 'YOUR-AUTH-USER-UUID';
   ```

   Check that exactly one row changed. If the membership upgrade has **already** been run, also run `update public.profiles set membership_status = 'approved' where id = 'YOUR-AUTH-USER-UUID';` and check that one row changed. On a new project, the membership upgrade below sets preexisting email-confirmed accounts to approved. The browser cannot promote accounts. An administrator can publish founder bios, courses, events and alerts. Other members can create projects and discussions.

6. Add the founding team only after they agree to have their name and biography shown publicly. The Dean of Students’ Affairs is a proposed patron; the interface does not claim the role has been accepted.

## Activate community pages

After the original schema is in place, open your project's **SQL Editor** and run [`supabase/upgrade_community.sql`](supabase/upgrade_community.sql) **once**. This adds community tables, a private `club-documents` Storage bucket, founder invitation rules and access policies without removing existing member or project data. Until this migration runs, the new pages display a setup notice. The SQL Editor is required because the browser's public key cannot create database tables or change access policies.

Next run [`supabase/upgrade_membership_collaboration.sql`](supabase/upgrade_membership_collaboration.sql) **once**. It adds member applications and approval rules, project teams, chat replies and notifications, RSVPs, report handling and document versions. Existing email-confirmed accounts remain approved; newly verified email accounts become **pending** and only see their own application page until an administrator approves them. A signed-in administrator reviews applications under **Applications**. Review access with a new pending account, an approved member, a founder and an administrator before inviting the wider club.

Run [`supabase/upgrade_admin_application_alerts.sql`](supabase/upgrade_admin_application_alerts.sql) in **SQL Editor** after the membership upgrade. This adds the existing notifications table to Supabase Realtime for immediate in-page application alerts; it is safe to rerun. A signed-in administrator sees a bell with the number of pending accounts and can open **Applications** from the alert. The page also checks every 10 seconds if Realtime disconnects. Sound is optional and must be switched on in that browser. Browser audio permissions may require a click after reopening the site. There are no push alerts or sounds when the tab is closed. The existing database trigger creates the alert when signup starts, which can precede email verification and application form submission. Approval is blocked at the database level until both steps have been completed once you run the approval email migration below.

Finally, run [`supabase/upgrade_activity_feed.sql`](supabase/upgrade_activity_feed.sql) **once**. It adds private member posts, comments, likes and moderation support. The activity feed displays a setup notice until this migration runs. Feed posts accept a link or an existing club document; they do not copy external article text or upload new files. Member comments generate an in-app notification to the post author.

Then run [`supabase/upgrade_direct_messages.sql`](supabase/upgrade_direct_messages.sql) **once**. It adds optional member profile details and private messages. Only the sender and recipient can read a message; both must be approved members for a new message to be sent. Direct messages generate in-app notifications and unread counts. The message page displays a setup notice until this migration runs. The appearance switch in the top bar works independently of Supabase and remembers the choice in that browser.

Run [`supabase/upgrade_media_threads.sql`](supabase/upgrade_media_threads.sql) **once**, after direct messages. This adds feed headlines and categories, photo attachments, threaded comment replies, and gallery images in channels and private direct messages. The `club-media` bucket is private and accepts JPG/PNG/WebP/GIF up to 5 MB. Approved members can open images in visible posts or channels; only the two direct message participants can open images shared in their conversation. The uploader retains access to their own uploads. Photos appear through temporary signed links. This upgrade does not enable video uploads or more than one level of comment replies. If you see an error such as `public.is_approved() does not exist`, an earlier migration has not completed: run the files in this section in the order listed.

If replying to a channel thread or feed comment returns a row-level security error, run [`supabase/fix_thread_reply_policies.sql`](supabase/fix_thread_reply_policies.sql) once in SQL Editor. It corrects both reply policies without changing stored content.

If inserting an activity feed comment reports `infinite recursion detected in policy for relation "activity_comments"`, run [`supabase/fix_reply_policy_recursion.sql`](supabase/fix_reply_policy_recursion.sql) in SQL Editor after the reply policy migration. It replaces self-referencing INSERT checks with restricted security-definer parent validators for comments and channel messages. It does not disable row-level security or change stored content.

Then run [`supabase/upgrade_profile_images.sql`](supabase/upgrade_profile_images.sql) **once**. Approved members can upload, replace or remove their own profile photo from the Members page. Photos appear in the directory, feed, channels and direct messages through temporary links. The private `club-media` bucket accepts images up to 5 MB; only approved members can view an approved member's current profile photo. The home page uses original concept artwork in optimized WebP files under `assets/`; it does not depict actual club members or events. Interface motion follows the device's reduced motion preference.

Run [`supabase/upgrade_roles_investors.sql`](supabase/upgrade_roles_investors.sql) **once** after the profile images upgrade. This adds applicant types, administrator assignment of the approved role, a separate investor portal and private investor inquiries. Existing approved users keep their existing roles. New applicants remain pending until an administrator approves them under **Admin dashboard → Applications**. Choosing a type in the sign-in form never grants privileges directly. Teachers can publish courses after approval. Approved investors can read curated investor updates and their own inquiries; they cannot read club channels, posts, documents or private messages. Public founder profiles remain subject to consent. Administrators can publish investor updates from the portal and review inquiries there.

Run [`supabase/upgrade_message_counts.sql`](supabase/upgrade_message_counts.sql) in **SQL Editor** after the roles upgrade. It calculates channel and direct-message unread totals on the server for the signed-in member, so badges do not stop at the browser's first page of messages. This migration is safe to rerun and does not grant access to another member's conversations.

### Approval feedback email

New applicants in all four categories receive an InnovateX email once an administrator approves their verified account. This is a separate email from the sign-in code. **Authentication → SMTP Settings** alone cannot deliver this approval message; the private Edge Function below needs its own Gmail App Password. Never put the App Password or a Supabase secret key in the repository, `config.js`, a browser console, or a public chat.

1. After `upgrade_roles_investors.sql`, run [`supabase/upgrade_approval_emails.sql`](supabase/upgrade_approval_emails.sql) in **SQL Editor**. It adds a private delivery queue, updates the administrator approval action, and guards the underlying `profiles` status transition. A first-time applicant must have verified their email and submitted a reason for joining, even if a future approval path bypasses the button. Existing approved accounts are recorded as already approved and are **not** emailed retroactively. If you previously ran this migration, **run its updated full version again** to install the new status guard. Do not rerun `upgrade_roles_investors.sql` afterward: it would replace the updated approval function.

   If SQL Editor reports an **unterminated dollar-quoted string**, open a new query and paste the entire [raw migration](https://raw.githubusercontent.com/Turkson225/Turk-Innovation-CLUB/main/supabase/upgrade_approval_emails.sql). Confirm it continues through the final comment about retrying a failed job. Click inside the editor, select all the pasted SQL (Ctrl+A or Cmd+A), and click **Run**. A selected excerpt or partial paste can stop inside a function. The migration is safe to rerun after an interrupted attempt.
2. In **Edge Functions → Secrets**, set `APPROVAL_SMTP_EMAIL` to the Gmail address configured as the club sender and `APPROVAL_SMTP_APP_PASSWORD` to its Google App Password. It is okay to paste the 16-character password with or without spaces; the worker strips spaces. These are Edge Function secrets, separate from the credentials entered under Authentication → SMTP Settings.
3. Under **Project Settings → API Keys**, create a **secret** API key named exactly `approval_email_worker`. In **Vault**, create a secret named exactly `approval_email_worker_key` with that key's value. Keep both private. The worker accepts only this named key in its `apikey` header.
4. Deploy [`supabase/functions/send-approval-emails/index.ts`](supabase/functions/send-approval-emails/index.ts) from the repository root with the Supabase CLI. The included [`supabase/config.toml`](supabase/config.toml) disables JWT preverification so the function can check its **named secret key** itself:

   ```sh
   npx supabase login
   npx supabase link --project-ref xsbpxjiuiqpfrvhqmlsa
   npx supabase functions deploy send-approval-emails --no-verify-jwt
   ```

5. Enable `pg_cron` and `pg_net` under **Database → Extensions**. Run [`supabase/schedule_approval_emails.sql`](supabase/schedule_approval_emails.sql) in SQL Editor. Supabase Cron then calls the private worker every minute; it takes up to five queued approvals per invocation and retries transient failures. You can check the job in **Integrations → Cron → Jobs**, the delivery logs in **Edge Functions → send-approval-emails → Logs**, and the database status in SQL Editor:

   ```sql
   select application_type, status, attempts, next_attempt_at, sent_at, last_error
   from public.approval_email_outbox
   order by created_at desc limit 20;
   ```

6. Create and verify a fresh test account, submit its application, approve it in **Applications**, and check that the email arrives. Repeat with member, teacher, founder and investor test accounts before inviting applicants. An approval is recorded even if the mail service is temporarily unavailable; check queue status and logs if the message does not arrive. The queue sends at least once, so a rare worker interruption after Gmail accepts a message can lead to a duplicate.

Then run [`supabase/upgrade_teacher_materials.sql`](supabase/upgrade_teacher_materials.sql) **once**. It creates a private `club-learning` bucket and learning materials table. Only approved teachers and administrators may upload PDF, PPT, PPTX, DOC and DOCX files, up to 20 MB each. Approved members can download published learning files from **Courses**. Teachers manage uploads in **Teaching studio**; administrators can hide or restore a material. This is separate from the collaborative **Document library**, where approved members may continue sharing general project files.

Approved teachers and administrators can publish hands-on workshops under four learning tracks: Controls and Automation, Software and Programming, Electronics and Robotics, and AI & Machine Learning. The publishing form asks for the prototype learners will build, practical activities and tests, and the tools required. Older course categories are displayed in the closest current track. This uses the existing `courses` table and requires no additional migration.

Run [`supabase/upgrade_course_journey.sql`](supabase/upgrade_course_journey.sql) in **SQL Editor** after the roles and teacher materials upgrades. It adds learner enrollment, repeatable project attempts, teacher feedback, private PDF/image evidence files (up to 10 MB), and completion records. An approved member enrolls from **Courses**, submits build notes and optional evidence, and sees feedback. The assigned teacher or an administrator may request a revision or accept the work; acceptance records completion. Only the learner, assigned teacher and administrator can see a submission and its evidence. For a course published before this migration, an administrator should assign an approved teacher in **Teaching studio** so that the teacher can review submissions. Check the new private `club-course-evidence` bucket in **Storage** after migration.

Run [`supabase/upgrade_teacher_promotions.sql`](supabase/upgrade_teacher_promotions.sql) in **SQL Editor** after the roles, approval emails and course journey upgrades. This adds admin-only, audited teacher role actions and private teaching profiles. If an applicant chose **Member** but should teach, use **Applications → Approve as teacher** after their email is verified and application is submitted; this makes them a teacher directly and queues the normal first-approval email. For an **already approved member**, use **Applications → Approved accounts → Make teacher**. That role change sends an in-app notification but does **not** queue another approval email. In either case the same account gains the teacher sidebar on its next refresh or sign-in. The teacher's **Inbox** links to **Teaching studio**, where they can enter a learning track, experience, practical teaching plan and availability; existing approved teachers can fill the same form. Only that teacher and administrators can read the form, and only that teacher can edit it. Administrators can check submissions through **Applications → Approved accounts → Teaching details**. Access starts immediately: the form records teaching details, not verified qualifications, and it does not currently block course publishing until submitted. Do not rerun `upgrade_roles_investors.sql` after the approval emails upgrade.

Run [`supabase/upgrade_founder_teaching_roles.sql`](supabase/upgrade_founder_teaching_roles.sql) in **SQL Editor** after the teacher promotions, course journey and approval emails upgrades. It enables teaching for approved founders by default while preserving their Founder room and finance review role. In **Applications → Approved accounts**, use **Make founder** for an approved teacher; their teaching details and workshop assignments stay in place, and they gain founder access immediately. Use **Pause teaching** or **Assign teaching** for a founder; an enabled founder can complete the same private teaching profile and be assigned as a workshop teacher. To remove founder leadership, choose **Remove founder role**, then select **Teacher** to retain teaching and assigned workshops or **Member** to remove teaching too. Reassign the founder's workshops before pausing teaching or choosing Member. Role changes preserve the account and audit history and notify the person in-app; they do not send a new approval email. Public founder cards are independent records without linked account IDs: review **Founders → Remove public profile** separately if their biography should no longer appear. Removing a card does not revoke account access. The migration is safe to rerun. Avoid rerunning `upgrade_roles_investors.sql` or `upgrade_course_journey.sql` afterward because they would replace these newer authorization functions.

Run [`supabase/upgrade_privacy_requests.sql`](supabase/upgrade_privacy_requests.sql) in **SQL Editor** after the roles and profile image upgrades. Members can hide their directory profile from other members and submit an account or content removal request on **Privacy & conduct**. Administrators retain access for reviews and see a request queue in their dashboard. Hiding a profile does not remove contributions, existing messages or files. Removal requests require manual review and fulfillment, including the Auth user, related content and Storage objects; changing a request's status does not delete data. The account completion guard checks that the profile and Auth user were removed; administrators must still clean up related files and content themselves. Review the club's retention obligations and keep a record of the action taken before marking a request complete.

Run [`supabase/upgrade_inventory_finance.sql`](supabase/upgrade_inventory_finance.sql) **once** after the roles and investor upgrade to create the base Inventory and Finance tables. Then run [`supabase/upgrade_inventory_finance_approvals.sql`](supabase/upgrade_inventory_finance_approvals.sql) **once** to activate item types and founder approvals. If the first migration was already run, run only the second. The base migration will stop with an error if rerun after the approval upgrade, protecting the newer stock rules. The pages show a setup notice until both migrations are applied.

Approved club members can view the component, tool, equipment, supply and other stock records. Administrators set each item’s category, unit (such as pcs, cm or g), starting stock, reorder level, condition, location and optional serial number. Quantities are whole numbers: use smaller units such as cm for wire if fractions of a metre matter. The unit becomes fixed once stock or movement history exists, preserving the meaning of older records. Administrators can receive stock, check out a returnable tool, record a return, issue components or supplies to a named member for a project, and make a documented adjustment. Issued stock reduces both total and available quantity; a checkout only reduces available quantity and must later be returned. Founders and administrators can review permanent movement history, including reasons and before/after details for catalog changes, and download inventory and history CSV files. The database locks stock during movements, prevents overdrawn checkouts and issues, and allows a former borrower to return an outstanding loan even if their membership changes.

Only administrators have the **Finance** management page and can submit income or expense entries in GHS. Every entry must be approved or rejected by an **approved founder** in the separate **Finance review** page; a rejection requires a reason. Entries that existed before this upgrade keep their dates and details but enter the pending queue for founder review. The recorded balance includes only approved entries; rejected and pending entries remain visible in history but are excluded from totals. The entry and the founder review are immutable; correcting an approved transaction requires a new entry and approval. The admin ledger CSV includes decision status, reviewer and note. Record any opening balance explicitly with a clear reference. These records are not a substitute for database backups.

The public **About the club** page introduces InnovateX's vision, mission, practical learning tracks, team workflow, values and leadership. Its two original engineering workshop images in `assets/` are illustrative artwork and do not depict actual club members. Patronage remains a proposal until formally accepted. Four proposed workshop cards appear on **Courses** until a teacher publishes a real workshop; two proposed project ideas appear on **Projects** until members create real plans. Use [`content/starter_workshops_and_projects.md`](content/starter_workshops_and_projects.md) to review the draft activities, materials and tests. Confirm the teacher, venue, equipment, safety plan, date and project owner before publishing. Add founder names and biographies only after each person has approved their public profile.

The entry screen has separate **Create an account** and **I have an account** choices. Creating an account verifies the email code once and creates a pending application. Returning users request a new one-time code for sign-in; that path does not create another account. Both flows require the custom Supabase OTP email templates from step 2 above. A successful code exchange creates a Supabase session; account approval and role permissions remain in the database.

Once the first administrator has been promoted using step 5 above:

1. Members can use **Channels**, share files up to 10 MB in **Document library**, and submit external stories through **Technology news**. Administrators review submitted news before publication and can create new channels. The news feed is curated by members; it does not automatically ingest third-party articles.
2. An administrator opens **Founder room → Invite founder** and enters the founder's sign-in email address. The founder signs in with that exact email, sees an invitation on **Members**, and clicks **Accept invitation**. The database checks that the email is confirmed before granting founder access. This in-app invitation does not send a separate email; the administrator should tell the founder that an invitation is waiting.
3. Accepted founders and administrators can schedule private meetings with an agenda and an existing Google Meet URL. **Calendar** opens Google Calendar with the meeting details; **ICS** downloads a calendar event. Organizers can also create a Meet link through the optional Google Calendar connection below.

The `club-documents` bucket is private. Downloads use short-lived signed links, and each uploader stores files under their own user ID. Approved club members can access shared files; do not upload a file intended only for founders. The founder room and its meeting links are restricted by row level security to founders and administrators.

After the membership upgrade, only **approved** members can access the shared file bucket, channels and other private content. A document's previous versions remain available through the library. Members can report messages, news and documents; administrators review reports and can hide content. The **Privacy & conduct** page gives members a plain-language overview of the workspace.

## Optional Google Calendar Meet creation

Organizers can always paste an existing Google Meet URL. To enable **Create Meet** from an event or founder meeting:

1. In Google Cloud, enable the **Google Calendar API**, configure the OAuth consent screen and create a **Web application** OAuth client. Add `https://turkson225.github.io` to **Authorized JavaScript origins** (the origin does not include the repository path). Add `http://localhost:8000` if testing locally. Grant or request the `https://www.googleapis.com/auth/calendar.events` scope for the organizer.
2. Put the public **OAuth client ID** into `googleClientId` in [`config.js`](config.js). Never put the OAuth client secret or a Google access token in the repository.
3. An authorized event organizer clicks **Create Meet**, grants Google Calendar access, and the site creates a unique calendar event with Google Meet in that organizer's primary Google Calendar, then saves its Meet URL in Supabase. The site asks for consent at the time of creation and does not store the access token. If Google has not yet produced a Meet link, check the newly created event in Google Calendar.

Members respond to events using **Going**, **Maybe** or **Can't go**. Accepted founders can respond to founder meetings. The Inbox highlights events and assigned tasks due soon when members open the site; it does not send background email reminders. Google Calendar attendees are not automatically invited.

## Operations and data protection

- **Moderation:** Administrators can approve accounts, inspect reports, remove reported messages, posts, documents and news, and see recent admin actions. Suspended accounts cannot access the member workspace. Club leaders should decide who reviews applications and reports.
- **Content export:** The administrator's **Admin dashboard** offers CSV downloads for applications and members, projects, events, posts, reports, investor inquiries and audit actions. Each CSV requests all authorized rows in batches at download time, independent of the visible page size. Founder and administrator inventory history exports and the administrator finance ledger use the same approach. Run exports during a quiet period: multiple requests cannot provide one point-in-time snapshot if records are concurrently added or removed. Exports omit Auth records, private direct messages, some relational tables and file bytes; they are **not database backups**. Keep a separate database backup and follow [`docs/backup_restore.md`](docs/backup_restore.md) to download the four private Storage buckets with [`scripts/backup_storage.mjs`](scripts/backup_storage.mjs). The backup script requires a private secret API key kept only on a trusted computer. See [Supabase database backups](https://supabase.com/docs/guides/platform/backups).
- **Scale note:** Some relationship lists, including project collaborators and event or meeting attendance, still read at most the first 1,000 records. The broader record refresh loads all authorized rows in batches and may become slow as the club grows. Monitor this as usage increases and move those lists and refreshes to server paging before they become large.
- **Verification:** Test access from separate accounts for pending, approved, founder and admin roles; test a direct database request as a pending user and verify it cannot read channels, documents or meetings. Then test upload, version download, reported content and meeting RSVPs. Keep the SQL migrations in the repository for review.

## Publish on GitHub Pages

The included GitHub Actions workflow publishes the static site on each push to `main`. In **Settings → Pages**, use **GitHub Actions** as the publishing source if GitHub asks you to select one. The expected address is `https://turkson225.github.io/Turk-Innovation-CLUB/`. Check the **Actions** tab for the deployment result. The public site shell works before Supabase is configured; member actions become available after steps 1–4. If Actions deployment is unavailable in your repository, set **Deploy from a branch → main → /(root)** as a fallback.

For a local preview, run `python3 -m http.server 8000` from the repository root and open `http://localhost:8000/`.

## Operational notes

- The public repository exposes all static site code and `config.js`. Supabase RLS, not hidden JavaScript, controls database access. Verify RLS after any schema changes.
- The members directory, project data, course content, events and alerts are accessible only to approved club members after the membership migration. Public founder cards are deliberately public.
- The online indicator is approximate, not a surveillance or attendance record. It means a member's open tab updated `last_seen_at` recently; background tabs, network loss and browser shutdowns can delay a change.
- For invite-only membership, turn off public signup in Supabase Auth and invite members administratively; otherwise anyone able to receive an email can create an account. Before public launch, decide the membership admission process.
- There are no push notifications, scheduled email reminders, automatic news ingestion or built-in video meetings. Google Meet links can be pasted manually or created through the optional organizer-authorized Google Calendar connection.

## Platform roles

| Role | Abilities |
| --- | --- |
| Visitor | Public home, founders, investors, privacy and conduct pages |
| Applicant | Own application and privacy pages while approval is pending; requested type does not confer access |
| Member | Directory and profiles, private direct messages, activity posts and comments, channels, documents, news, projects and assigned tasks, discussions, events, RSVPs and inbox |
| Teacher | Member abilities plus course publishing, learning material uploads and private teaching profile after approval |
| Founder | Member and teaching abilities by default, plus private founder meetings and finance review; an administrator can pause teaching without removing founder leadership |
| Investor | Curated investor updates and own private inquiries, separate from the member workspace |
| Administrator | Member and teaching abilities plus account reviews, role changes, moderation, CSV and JSON export, investor updates and inquiries, publishing, channel creation and founder invitations |

## References

- [Supabase passwordless email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [GitHub Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
