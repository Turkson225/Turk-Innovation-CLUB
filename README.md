# SPACE platform

**Platform name:** SPACE  
**Official club URL:** [https://turkson225.github.io/Turk-Innovation-CLUB/](https://turkson225.github.io/Turk-Innovation-CLUB/)

A responsive workspace for a practical engineering and technology club. The site is static and can be hosted on GitHub Pages. Supabase provides email sign-in and a database protected by row level security.

## Faster directory, student queries and remembered sign-in — 15 October 2026

Sign-in now stays active on this browser until Sign out; the tab-only storage and app idle/eight-hour timers have been removed. Student reads explicitly filter their own learning records, and classroom loading fetches instructor names rather than the complete member directory.

For the new member directory, run the entire [`supabase/upgrade_directory_learning_performance.sql`](supabase/upgrade_directory_learning_performance.sql) in **Supabase → SQL Editor → New query → Run**, after the advanced platform migration. Then reload SPACE. Search, roles, status, interests, shared interests, bookmarks and ordering are applied on the server. Only 24 profile cards are transferred per page; complete visible counts and interest facets remain available. Profile links load the one requested visible profile. The migration preserves RLS, adds derived searchable profile fields, and caches caller-only permission checks once per statement. No real member, message or learning record is removed. Without the new function, Members shows activation guidance while the other pages remain usable.

The [optimized measured run](docs/load-test-results/2026-10-15-optimized-postgres.md) passed all three stages with 35,370 operations and zero errors. At 100 active SQL clients, overall p95 fell from 5.58 s to 0.93 s; directory-page p95 was 1.18 s and student-classroom p95 was 0.49 s. This is a synthetic database-only result, with a 24-row directory page replacing the former complete-directory read; live Supabase capacity remains unverified.

The fixture checks for the migration run with `SPACE_PGLITE_MODULE=/tmp/space-load-tools/node_modules/@electric-sql/pglite node scripts/check_directory_database.mjs`. The new workload measures the 24-row directory RPC and explicitly filtered student submissions against the same 2,000-account fixture and 10/50/100-client ramp. The prior full-directory baseline remains retained for comparison. Live Supabase migration activation and end-to-end capacity still require separate checks.

## Measured load testing — 15 October 2026

A repeatable isolated PostgreSQL benchmark now seeds 2,000 synthetic accounts and production-like message/classroom row counts, then measures seven authenticated workloads at 10, 50 and 100 concurrent SQL clients. It records p50/p95/p99, throughput, errors and post-load permission/integrity checks. Run **Actions → SPACE measured database load test → Run workflow** and download its JSON artifact. See [`docs/load_testing.md`](docs/load_testing.md) for the method and the separate Supabase staging capacity gate. This does not contact the live database, establish 2,000 simultaneous user capacity, or require a production migration.

The [first measured report](docs/load-test-results/2026-10-15-postgres.md) records p95 of 0.59 s at 10 clients, 2.90 s at 50 and 5.58 s at 100, with zero request errors. The higher-concurrency stages failed the two-second latency target. Complete-directory and student-classroom reads need attention before calling the platform ready for a busy launch.

## Capacity and slow connections — 14 October 2026

SPACE now loads the open page on demand, runs dataset reads in batches of up to six tasks, combines duplicate background refreshes, reuses a complete profile cache, and backs off after failed loads. Home fetches recent post authors instead of the whole member directory. Responsive skeletons cover startup, sign-in and first page visits; a slow-load message appears after three seconds, and failed page loads offer a retry after a 20-second deadline. Browser offline events pause automatic polling and show a connection banner; previously loaded records remain in the current session. No SQL migration is needed.

The regression fixtures cover complete retrieval and CSV export of **2,505 member rows** and verification of **2,505 uploaded-file fixtures**, including detection of missing or changed bytes. These are offline correctness checks; they do **not** prove that 2,000 simultaneous production users or a live restore have passed. See [`docs/capacity_and_loading.md`](docs/capacity_and_loading.md) for staging load-test targets, remaining scaling work and backup readiness. Database backups and Storage backups must be configured and verified separately.

## Sign-in recovery — 14 October 2026

After a valid password sign-in or signup verification, SPACE checks the account profile before allowing access. Course selections load separately and cannot hold the authentication form open. An unavailable or missing learning table leaves existing account access working; the new learning controls still require their migration. Account checks time out after 15 seconds with **Retry account check**, which reuses the authenticated session. Initial workspace loads have a 20-second deadline and a retry screen; other pages load when opened. Course-choice lookups have an 8-second deadline, and late responses cannot restore a signed-out account. This login fix requires no SQL migration. Run `node scripts/check_workspace.mjs` for the offline regression checks, then verify password sign-in, signup verification and password recovery with a test account on the deployed site.

## Activate the connected learning dashboards — 14 October 2026

Run the **entire** [`supabase/upgrade_learning_dashboards.sql`](supabase/upgrade_learning_dashboards.sql) in **Supabase → SQL Editor → New query → Run**, after the existing course lifecycle, classroom access, private applications, approval emails and founder teaching upgrades. Then reopen SPACE and sign in. This is one new migration; it runs inside a transaction and is safe to rerun. The new controls activate after the database tables exist. Older workshops and their feedback keep working before activation.

### Student journey

1. Verify the account email and complete the membership application. Choose **one or more** of the four courses; all four are allowed. The choices are saved while administrator approval is pending. An investor application can skip learning choices.
2. After approval, open **My learning**. Existing approved members without choices must choose their courses once before opening their workspace.
3. Open a matching class for its practical brief, **Materials & slides**, **Classwork**, final project submissions and feedback. Classwork supports assignments, practical exercises and projects, with deadlines and HTTPS resource or evidence links. Students can read only their own attempts and feedback.
4. Read the teacher's feedback and send an improved attempt when a revision is requested. Attempts are retained; an accepted task cannot be resubmitted. Completing an individual task does not replace the class's final-project completion record.

Selecting a course automatically enrolls an approved, verified member in its **open** published classes. Newly published classes enroll matching approved learners and notify them. Closed or archived classes are excluded. Updating choices controls future automatic enrollments and preserves all existing classes, materials, submissions and completion history. A member can still manually join an open workshop through Browse workshops. Previously joined students remain visible in the assigned teacher's class roster even after their choices change.

### Teacher journey

1. An administrator assigns a **Teacher** role and one or more **teaching courses**. Existing teachers retain the courses of their already assigned workshops. A teaching-profile preference by itself does not grant a teaching course.
2. Open **Teaching studio → Teaching profile** and complete experience, practical plans and availability.
3. **My students** combines learners who chose the teacher's assigned courses with existing class enrollments. Search, course filters and pages of 24 cards keep the list manageable. A private directory profile still exposes the learner's name to their teaching lead, without exposing email or application answers.
4. Publish an open workshop in an assigned teaching course. Its matching approved learners join automatically. Add or manage learners through the existing class roster when needed.
5. Upload slides, notes or worksheets against that workshop. Its enrolled students find them in **Materials & slides**. The existing file permissions remain in force.
6. Use **Classwork & feedback → Assign work** for the whole class or one enrolled student. Set clear instructions, type of work, an optional deadline and resource link. Read incoming attempts, mark them as seen, then accept with feedback or request a revision. The existing final-project review workflow remains available separately.

Student Home, teaching review summaries and the Calendar include classwork. Accepted student tasks drop out of their personal deadlines, while teachers retain planning and review records. No real teacher, class, date or student is invented or published by this upgrade.

### Administrator role management

Open **Membership approvals → Approved accounts → Change role / teaching courses**. Choose **Member**, **Teacher**, **Founder**, **Investor** or **Administrator**. Teachers require at least one teaching course; a founder with no teaching courses retains leadership without teaching access. Administrators have the full management dashboard. Role changes keep the existing approved account, notify the person in-app and create an audit entry. Their sidebar and dashboard follow the role on the next access refresh or sign-in; database permissions apply immediately.

The role tool cannot change the signed-in administrator's own access. Reassign every class before removing its instructor's teaching role or course responsibility, including past classes whose reviews must remain supported. Public founder biographies are managed separately. Roles apply only to approved, email-verified accounts and cannot be self-assigned. Existing notification subscriptions remain in place. Sign-in is remembered in this browser until explicit sign-out or server-side session invalidation.

### Verification

- `node scripts/check_workspace.mjs` covers frontend journeys, account isolation and the existing session, chat, calendar and member regressions.
- `scripts/check_learning_database.mjs` runs the previous course migrations and this upgrade in an isolated PostgreSQL-compatible PGlite database. It tests separate administrator, teacher, student, applicant, investor, unverified and outsider identities, real RLS policies, role restrictions, enrollment, private tasks, reviews and migration reruns. Its header gives the temporary dependency install command. It never connects to the live database.
- After applying the migration, use separate test accounts to confirm multi-course onboarding, automatic enrollment, teacher rosters, classwork and feedback, and an administrator-assigned role. The deployment does not execute SQL against the live Supabase project.

## What is included

- Public home and founders pages. A founder profile uses a wide portrait layout and a short biography with optional full text; the administrator publishes a real photo only after that person consents.
- Email/password sign-in, first-time email verification and sign-out, member profiles and an online indicator based on a recent heartbeat. Sign-out clears the member's presence; disconnected users disappear from "online" after about 65 seconds.
- Project cards, progress, tasks and discussion threads.
- Member channels with live message updates (and polling fallback), a private document library, and channel file sharing.
- Technology news submitted by members and reviewed by administrators before appearing in the feed.
- Founder invitations, verified-email acceptance, and a private founders' meeting room with Google Meet and calendar links.
- Administrator-approved member applications, threaded channel replies, reactions, mentions, unread counts, search and in-app notifications.
- A member inbox bell and in-app popups for new alerts. Optional device alerts use Web Push after a member enables them; the installed app shows an icon badge where the device supports it. Lock-screen previews never contain private message text.
- A branded approval email for each newly approved member, teacher, founder and investor, delivered by a private Supabase worker after setup.
- Three-column member activity feed with project updates, resource links, shared club documents, comments, likes, recent stories and active members.
- Member profiles with a headline, bio and availability, plus private one-to-one messaging and unread counts. Tap a member portrait directly in the directory or a profile, feed, channel or direct-message photo to open a full-screen viewer with pinch, double-tap and button zoom. Optional dark theme is saved in the browser.
- New applicants choose member, teacher, founder or investor before email verification. The selected type is a request until an administrator approves it. Teachers can publish courses; founders have a private meeting room; investors have a separate curated portal and inquiry form.
- Administrator dashboard for pending applications, reports, club activity, investor inquiries and selected CSV exports.
- Role-specific sidebar: visitors see public pages and a clear join/sign-in entry point, while protected deep links open the sign-in flow. Members use community pages, teachers get a Teaching studio, founders get the Founder room, investors use their separate portal, and administrators get oversight pages. Approved profiles display a role badge.
- Approved teachers and administrators can upload PDF notes, PowerPoint slides and Word guides (up to 20 MB) to a private learning library associated with a course or shared with the whole club. Enrolled learners and the assigned teaching lead can open their course materials; general library files remain available to approved club members after the classroom access upgrade.
- Members can enroll in several practical workshops at once, track each course and its next dates, submit build notes and private evidence, receive teacher feedback, revise their work and earn a completion record after acceptance.
- A teacher's Teaching studio groups their assigned workshops, enrolled learners, upcoming starts and project deadlines. Assigned teachers can enroll an approved learner by their sign-in email and update their own workshop schedules; administrators can do the same for any workshop.
- Teachers can acknowledge project submissions as seen, inspect evidence and give actionable feedback. They can end a workshop to close new enrollment, let existing students finish their projects, and publish a new workshop for the next group. Removing an unused workshop deletes it; one with learning records or materials is archived so its work and completion history remain available to its students and teacher.
- Administrators can promote an already approved member to teacher; the teacher receives an in-app notification and completes a private teaching profile with a track, relevant experience, practical plan and availability.
- Approved founders can lead practical workshops while keeping founder meeting and finance review access. Administrators can make an approved teacher a founder, assign or pause founder teaching, remove founder access while retaining member or teacher status, and separately remove a public founder card.
- Members can choose whether their profile appears in the club directory and request account or content removal; administrators review and record the outcome.
- Blog-style engineering posts with an optional headline, topic, cover image, links and document attachments; comments support one level of replies. Channel messages can include an image selected from the member's gallery.
- Project collaborators, milestones and task assignments; meeting RSVPs, document versions, reports and moderation actions.
- Administrator-published courses, alerts and events. Events can include Google Meet links and open in Google Calendar or download as an ICS file.
- Phone, tablet and desktop layouts. Untrusted member text is escaped before display.
- Server-paged applications, feed, channel history and direct messages, with all-authorized-row CSV export for selected records and a separate private Storage backup procedure.

## Finding your way around SPACE

Home, Notifications, Direct messages and Calendar are the daily shortcuts. The sidebar groups the rest into Learning & projects, Community, Club activities, Leadership & partners, Administration and About SPACE. Open a group to see its pages; selecting a page opens its group, and background refreshes preserve a group you manually collapsed. Groups with no pages permitted for the current account are hidden.

Use **My learning** for workshops you have joined, their materials, your submissions and teacher feedback. Approved teachers manage classes and upload slides in **Teaching studio**. **Direct messages** are private conversations; **Team chat** contains group channels and threads; **Discussion forum** holds longer questions and decisions. **Notifications** are personal updates, while **Announcements** are official club notices. **Shared files** is the club document library; course-specific slides stay in the workshop classroom. Search also recognizes familiar names such as Inbox, Channels, Courses and Document library.

## Calendar workspace and faster sign-in

Open **Calendar** from the daily shortcuts. Today, the previous/next period buttons, the date picker and the five view buttons stay visible. Open **Filters**, **Date & export tools** or **Keyboard shortcuts** for the extra controls. All event times are shown in the device’s local timezone, displayed beside the period title. Press Search or Enter to apply a calendar search.

The calendar has these 30 new or expanded capabilities, alongside the existing month view and Today shortcut:

| # | Capability | How it works |
|---|---|---|
| 1 | Week view | Seven dated sections with session details and day shortcuts. |
| 2 | Day view | A chronological list for the selected date. |
| 3 | Agenda view | A rolling 30-day schedule grouped by date. |
| 4 | Year overview | Twelve month summaries that open the chosen month. |
| 5 | Jump to a date | Select a date directly rather than paging month by month. |
| 6 | Jump to a month | Use the month picker under Date & export tools. |
| 7 | Jump to a year | Enter a year between 1900 and 2100. |
| 8 | View-aware previous/next | Move one day, week, month, year or 30-day agenda period. |
| 9 | Adjacent-month navigation | Dates before and after the month are selectable. |
| 10 | Week-start preference | Choose Monday or Sunday. |
| 11 | Calendar search | Search titles, descriptions, locations and learning tracks. |
| 12 | Source filters | Show or hide club events, workshops, course deadlines, tasks and permitted founder meetings. |
| 13 | My schedule | Show enrolled/assigned workshops, own tasks and attendance commitments. |
| 14 | Track filter | Focus on one of the four learning tracks. |
| 15 | Attendance filter | Going, Maybe, Can’t go or Not answered. |
| 16 | Online-session filter | Find sessions with a meeting link or online location. |
| 17 | Upcoming and ongoing filter | Hide items that have ended, keeping in-progress sessions. |
| 18 | Compact month layout | Reduce desktop calendar row height. Phone dates use large date controls and item counts. |
| 19 | Multi-day events | Show an event on every day it occupies; a midnight end is exclusive. |
| 20 | Overlap indicators | Flag overlapping personal sessions with known end times; deadlines and unrelated events do not cause warnings. |
| 21 | Next scheduled item | Jump to the next matching upcoming or ongoing item. |
| 22 | Date links | Copy a link containing the date and view. Other accounts see only their permitted records. |
| 23 | Saved preferences | Remember the view and filters per account on that device. |
| 24 | Keyboard navigation | T, M/W/D/A/Y, [ / ], search with /; arrow keys and Home/End navigate date controls. |
| 25 | Export the selected view | Download all matching period items as one ICS file. |
| 26 | Export individual work | Add workshops and task/course deadlines to Google Calendar or download ICS, as with events and meetings. |
| 27 | Complete printed schedule | Print the visible view plus its full matching item list, including all agenda pages. |
| 28 | Agenda pagination | Display 30 records at a time; exports and printing include the complete period. |
| 29 | Schedule on selected date | Administrators get event forms prefilled for the selected local date. |
| 30 | Completed-work cleanup | Finished tasks and a learner’s completed course deadlines stop appearing. Teachers/admins retain class deadline history. |

Calendar exports use UTC event instants, escaped text and UTF-8 line folding. Items with no end time display “duration not set” and do not cause overlap warnings. Their Google/ICS exports use a one-hour default; deadline exports use one minute. Adjust that duration in the destination calendar if needed. Founder meetings are excluded from member, teacher and investor views and exports. Existing RSVP and Google Meet tools remain available in event details. No database migration is required for this upgrade.

After authentication, sign-in awaits the profile/access check, opens the permitted workspace, loads the visible page first, then hydrates the remaining tools in the background. The logo welcome is compact and nonmodal. The shell shows a loading state while records arrive; private records and capability flags are cleared before a new account is checked. Delayed responses from older accounts cannot restore their capability flags or signed media URLs. Applicants load their private answer before their form opens. Network authentication and access verification still require a response from Supabase; the app does not bypass either.

## SPACE branding

The segmented monochrome logo uses source frames from the club’s supplied recording. The matching animation appears in a small, nonmodal welcome after successful interactive sign-in or signup verification. It can be dismissed and does not cover or lock the workspace. Routine role/access refreshes do not replay it. Reopening the page restores the remembered sign-in. Reduced motion, unsupported video playback and media errors use a still image.

The platform now displays **SPACE** on the website, public pages, installation prompt, offline screen, notifications and app icons. Its GitHub address and existing account/PWA identity stay the same. Existing installed apps may update their launcher name/icon after opening online; if yours keeps the old branding, remove that shortcut and install again.

No SQL migration is needed for the website rename. Email settings and deployed Edge Functions are stored separately in Supabase, so update them there to finish email branding:

1. Under **Authentication → Email Templates**, set **Confirm Signup** to subject `Verify your SPACE account` and use the [verification template](supabase/email-otp-template.html), keeping `{{ .Token }}`. Set **Reset Password** to subject `Set your SPACE password` and use the [password reset template](supabase/email-password-reset-template.html), keeping both `{{ .ConfirmationURL }}` and `{{ .Token }}`. Routine sign-in now uses a password.
2. Under **Authentication → SMTP Settings**, set **Sender name** to `SPACE`.
3. Redeploy **send-approval-emails** using the updated [function source](supabase/functions/send-approval-emails/index.ts), with its existing secrets and verification settings. In the dashboard editor, replace all deployed code with this file and deploy.

Internal preference keys, API globals, cron job names, calendar event UIDs and backup formats retain their established identifiers to preserve notification subscriptions, schedules and records. Existing tab-scoped Auth tokens are migrated to remembered sign-in as described below.

## October 1 workspace upgrade

The workspace now has a warmer visual system, clearer navigation groups and a keyboard-accessible search palette (**Ctrl/Command + K**). Search includes permitted pages and loaded courses, projects, members, events, documents and published technology news; it never indexes application answers. Home combines role-specific priorities, a personal agenda and recent club posts.

Direct messages now separate existing chats from member discovery, retain text/photo/reply drafts per conversation, offer scoped message search, group nearby messages and load earlier history without replacing the current thread. On phones, Back returns to the conversation list and the composer follows the visible keyboard viewport. Photos still open in the existing full-screen viewer.

### Enable the new chat tools

On an already configured club database, run **only** [supabase/upgrade_dm_conversations.sql](supabase/upgrade_dm_conversations.sql) in **Supabase → SQL Editor → New query**. Copy the **entire file**, including the opening `begin;` and final `commit;`, and click **Run**. It is safe to rerun and requires the existing direct-message, media and role migrations listed at the top of the file. It adds private quoted replies, participant reactions, a paginated conversation inbox and a narrowly scoped peer read-receipt function.

Reload the app after SQL succeeds. The additional tools are detected at sign-in; **Reply** and **React** appear when their database support is available. Base messaging, emoji, image sharing and message search continue to work before this upgrade. Sent messages show a single check; a double check appears only when the peer's saved read position covers that message. New-message notifications trigger immediate thread loading where Realtime is available; the open conversation also refreshes every nine seconds. Reactions and read receipts use that refresh rather than a new Realtime publication.

For a practical access check, use two approved members and a third unrelated member. Send a message, quote it, react, and open it as the recipient. Verify the sender sees the read indicator, older messages stay available, and the unrelated account cannot retrieve that conversation, its reactions or another pair's receipt. Check guest, pending, teacher, founder, investor and administrator menus as well.

Run `node scripts/check_workspace.mjs` for the dependency-free frontend regression checks. The mocked runtime checks cover draft/send races, scoped queries, migration fallback, replies, reactions, read positions, history, search escaping and role-specific navigation. Browser screenshots and execution against the live Supabase database still require separate verification.

## Set up Supabase

1. Create a Supabase project and open **SQL Editor**. Run [`supabase/schema.sql`](supabase/schema.sql) once. Use a new project or review existing schema before running it.
2. In **Authentication → Providers → Email**, enable email sign-in and keep **Confirm email** enabled. SPACE uses `signInWithPassword` for routine sign-in and `signUp` for account creation. Under **Authentication → Email Templates → Confirm Signup**, set the subject to `Verify your SPACE account` and use [`supabase/email-otp-template.html`](supabase/email-otp-template.html) so the verification screen receives `{{ .Token }}`. The default confirmation-link template also works. Under **Reset Password**, use [`supabase/email-password-reset-template.html`](supabase/email-password-reset-template.html), subject `Set your SPACE password`, or keep Supabase’s default reset-link template. To email club members beyond your Supabase team's authorized addresses, configure **Authentication → SMTP Settings** with the club sender; the built-in sender is restricted. Existing SMTP credentials stay in Supabase.
3. In **Authentication → URL Configuration**, set the Site URL to `https://turkson225.github.io/Turk-Innovation-CLUB/`. Add both that exact URL and `https://turkson225.github.io/Turk-Innovation-CLUB/reset-password.html` to **Redirect URLs**. For local development, allow your exact local root and reset-password.html URLs separately.
4. In the project's **Connect** dialog, copy the Project URL and **publishable** key into [`config.js`](config.js). These values are designed for browser use. **Never paste a service_role or secret key** into the repository. This repository is configured with the project's public values.
5. Create your account and verify its email first. Then, in SQL Editor, promote your specific user to an administrator using the authenticated user's UUID from **Authentication → Users**:

   ```sql
   update public.profiles set role = 'admin'
   where id = 'YOUR-AUTH-USER-UUID';
   ```

   Check that exactly one row changed. If the membership upgrade has **already** been run, also run `update public.profiles set membership_status = 'approved' where id = 'YOUR-AUTH-USER-UUID';` and check that one row changed. On a new project, the membership upgrade below sets preexisting email-confirmed accounts to approved. The browser cannot promote accounts. An administrator can publish founder bios, courses, events and alerts. Other members can create projects and discussions.

6. Add the founding team only after they agree to have their name and biography shown publicly. SPACE is an independent club led by founders and members. The public About page says the club plans to inform the Dean of Students’ Affairs and seek acknowledgement of its existence; it does not claim patronage, institutional approval or a reporting relationship.

## Activate community pages

After the original schema is in place, open your project's **SQL Editor** and run [`supabase/upgrade_community.sql`](supabase/upgrade_community.sql) **once**. This adds community tables, a private `club-documents` Storage bucket, founder invitation rules and access policies without removing existing member or project data. Until this migration runs, the new pages display a setup notice. The SQL Editor is required because the browser's public key cannot create database tables or change access policies.

Next run [`supabase/upgrade_membership_collaboration.sql`](supabase/upgrade_membership_collaboration.sql) **once**. It adds member applications and approval rules, project teams, chat replies and notifications, RSVPs, report handling and document versions. Existing email-confirmed accounts remain approved; newly verified email accounts become **pending** and only see their own application page until an administrator approves them. A signed-in administrator reviews applications under **Applications**. Review access with a new pending account, an approved member, a founder and an administrator before inviting the wider club.

Run [`supabase/upgrade_admin_application_alerts.sql`](supabase/upgrade_admin_application_alerts.sql) in **SQL Editor** after the membership upgrade. This adds the existing notifications table to Supabase Realtime for immediate in-page application alerts; it is safe to rerun. A signed-in administrator sees a bell with the number of pending accounts and can open **Applications** from the alert. The page also checks every 10 seconds if Realtime disconnects. Sound is optional and must be switched on in that browser. Browser audio permissions may require a click after reopening the site. Background push is a separate, opt-in setup described below; sound from the open page does not play when closed. The existing database trigger creates the alert when signup starts, which can precede email verification and application form submission. Approval is blocked at the database level until both steps have been completed once you run the approval email migration below.

Finally, run [`supabase/upgrade_activity_feed.sql`](supabase/upgrade_activity_feed.sql) **once**. It adds private member posts, comments, likes and moderation support. The activity feed displays a setup notice until this migration runs. Feed posts accept a link or an existing club document; they do not copy external article text or upload new files. Member comments generate an in-app notification to the post author.

Then run [`supabase/upgrade_direct_messages.sql`](supabase/upgrade_direct_messages.sql) **once**. It adds optional member profile details and private messages. Only the sender and recipient can read a message; both must be approved members for a new message to be sent. Direct messages generate in-app notifications and unread counts. The message page displays a setup notice until this migration runs. The appearance switch in the top bar works independently of Supabase and remembers the choice in that browser.

Run [`supabase/upgrade_media_threads.sql`](supabase/upgrade_media_threads.sql) **once**, after direct messages. This adds feed headlines and categories, photo attachments, threaded comment replies, and gallery images in channels and private direct messages. The `club-media` bucket is private and accepts JPG/PNG/WebP/GIF up to 5 MB. Approved members can open images in visible posts or channels; only the two direct message participants can open images shared in their conversation. The uploader retains access to their own uploads. Photos appear through temporary signed links. This upgrade does not enable video uploads or more than one level of comment replies. If you see an error such as `public.is_approved() does not exist`, an earlier migration has not completed: run the files in this section in the order listed.

If replying to a channel thread or feed comment returns a row-level security error, run [`supabase/fix_thread_reply_policies.sql`](supabase/fix_thread_reply_policies.sql) once in SQL Editor. It corrects both reply policies without changing stored content.

If inserting an activity feed comment reports `infinite recursion detected in policy for relation "activity_comments"`, run [`supabase/fix_reply_policy_recursion.sql`](supabase/fix_reply_policy_recursion.sql) in SQL Editor after the reply policy migration. It replaces self-referencing INSERT checks with restricted security-definer parent validators for comments and channel messages. It does not disable row-level security or change stored content.

Then run [`supabase/upgrade_profile_images.sql`](supabase/upgrade_profile_images.sql) **once**. Approved members can upload, replace or remove their own profile photo from the Members page. Photos appear in the directory, feed, channels and direct messages through temporary links. The private `club-media` bucket accepts images up to 5 MB; only approved members can view an approved member's current profile photo. The home page uses original concept artwork in optimized WebP files under `assets/`; it does not depict actual club members or events. Interface motion follows the device's reduced motion preference.

Run [`supabase/upgrade_roles_investors.sql`](supabase/upgrade_roles_investors.sql) **once** after the profile images upgrade. This adds applicant types, administrator assignment of the approved role, a separate investor portal and private investor inquiries. Existing approved users keep their existing roles. New applicants remain pending until an administrator approves them under **Admin dashboard → Applications**. Choosing a type in the sign-in form never grants privileges directly. Teachers can publish courses after approval. Approved investors can read curated investor updates and their own inquiries; they cannot read club channels, posts, documents or private messages. Public founder profiles remain subject to consent. Administrators can publish investor updates from the portal and review inquiries there.

Run [`supabase/upgrade_message_counts.sql`](supabase/upgrade_message_counts.sql) in **SQL Editor** after the roles upgrade. It calculates channel and direct-message unread totals on the server for the signed-in member, so badges do not stop at the browser's first page of messages. This migration is safe to rerun and does not grant access to another member's conversations.

### Approval feedback email

New applicants in all four categories receive an SPACE email once an administrator approves their verified account. This is a separate email from signup verification or password recovery. **Authentication → SMTP Settings** alone cannot deliver this approval message; the private Edge Function below needs its own Gmail App Password. Never put the App Password or a Supabase secret key in the repository, `config.js`, a browser console, or a public chat.

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

For an existing installation, **publish the current website first**, then run [`supabase/upgrade_private_applications.sql`](supabase/upgrade_private_applications.sql) in SQL Editor after the approval-email and privacy-request migrations. It copies existing joining answers into `application_answers`, restricts reads to that applicant and an approved administrator, updates the approval checks, and drops `profiles.application_reason`, which was readable through shared profile rows. The website detects the old and new schema at sign-in; old website code cannot save an application after this migration. The SQL runs as one transaction. Then run the optional read-only [`supabase/verify_private_applications.sql`](supabase/verify_private_applications.sql) with three distinct existing accounts (answer owner, another approved member, administrator). It raises an error if the member can read that answer. Do **not** rerun `upgrade_membership_collaboration.sql` or `upgrade_approval_emails.sql` afterward because those older files reintroduce the profile column or the old approval checks. The admin CSV still includes application answers through the restricted table. See [`docs/approval_email_health.md`](docs/approval_email_health.md) for read-only queue, Cron and worker checks; a database migration alone does not prove email delivery.

Then run [`supabase/upgrade_teacher_materials.sql`](supabase/upgrade_teacher_materials.sql) **once**. It creates a private `club-learning` bucket and learning materials table. Only approved teachers and administrators may upload PDF, PPT, PPTX, DOC and DOCX files, up to 20 MB each. The classroom access migration below limits workshop files to the assigned teaching lead and enrolled learners; general library files remain available to approved club members. Teachers manage uploads in **Teaching studio**; administrators can hide or restore a material. This is separate from the collaborative **Document library**, where approved members may continue sharing general project files.

Approved teachers and administrators can publish hands-on workshops under four learning tracks: Controls and Automation, Software and Programming, Electronics and Robotics, and AI & Machine Learning. The publishing form asks for the prototype learners will build, practical activities and tests, and the tools required. Older course categories are displayed in the closest current track. This uses the existing `courses` table and requires no additional migration.

Run [`supabase/upgrade_course_journey.sql`](supabase/upgrade_course_journey.sql) in **SQL Editor** after the roles and teacher materials upgrades. It adds learner enrollment, repeatable project attempts, teacher feedback, private PDF/image evidence files (up to 10 MB), and completion records. An approved member enrolls from **Courses**, submits build notes and optional evidence, and sees feedback. The assigned teacher or an administrator may request a revision or accept the work; acceptance records completion. Only the learner, assigned teacher and administrator can see a submission and its evidence. For a course published before this migration, an administrator should assign an approved teacher in **Teaching studio** so that the teacher can review submissions. Check the new private `club-course-evidence` bucket in **Storage** after migration.

Run [`supabase/upgrade_teacher_promotions.sql`](supabase/upgrade_teacher_promotions.sql) in **SQL Editor** after the roles, approval emails and course journey upgrades. This adds admin-only, audited teacher role actions and private teaching profiles. If an applicant chose **Member** but should teach, use **Applications → Approve as teacher** after their email is verified and application is submitted; this makes them a teacher directly and queues the normal first-approval email. For an **already approved member**, use **Applications → Approved accounts → Make teacher**. That role change sends an in-app notification but does **not** queue another approval email. In either case the same account gains the teacher sidebar on its next refresh or sign-in. The teacher's **Inbox** links to **Teaching studio**, where they can enter a learning track, experience, practical teaching plan and availability; existing approved teachers can fill the same form. Only that teacher and administrators can read the form, and only that teacher can edit it. Administrators can check submissions through **Applications → Approved accounts → Teaching details**. Access starts immediately: the form records teaching details, not verified qualifications, and it does not currently block course publishing until submitted. Do not rerun `upgrade_roles_investors.sql` after the approval emails upgrade.

Run [`supabase/upgrade_founder_teaching_roles.sql`](supabase/upgrade_founder_teaching_roles.sql) in **SQL Editor** after the teacher promotions, course journey and approval emails upgrades. It enables teaching for approved founders by default while preserving their Founder room and finance review role. In **Applications → Approved accounts**, use **Make founder** for an approved teacher; their teaching details and workshop assignments stay in place, and they gain founder access immediately. Use **Pause teaching** or **Assign teaching** for a founder; an enabled founder can complete the same private teaching profile and be assigned as a workshop teacher. To remove founder leadership, choose **Remove founder role**, then select **Teacher** to retain teaching and assigned workshops or **Member** to remove teaching too. Reassign the founder's workshops before pausing teaching or choosing Member. Role changes preserve the account and audit history and notify the person in-app; they do not send a new approval email. Public founder cards are independent records without linked account IDs: review **Founders → Remove public profile** separately if their biography should no longer appear. Removing a card does not revoke account access. The migration is safe to rerun. Avoid rerunning `upgrade_roles_investors.sql` or `upgrade_course_journey.sql` afterward because they would replace these newer authorization functions.

Run [`supabase/upgrade_founder_portraits.sql`](supabase/upgrade_founder_portraits.sql) in **SQL Editor** after the founder teaching roles upgrade. This adds editing for public founder cards and a dedicated **public** Storage bucket named `club-founder-portraits`. In an administrator account, open **Founders → Edit profile**, choose a JPG, PNG or WebP photo up to 5 MB, and save. A new founder card can also include a photo. The person must agree to public use of their photo and bio before you publish either. Until a portrait is uploaded, visitors see a large initials design; no photo is fabricated. The photo is publicly accessible by URL. Replacing or removing a card also attempts to delete its old image; if the site reports a cleanup failure, delete the orphaned file in **Storage → club-founder-portraits**. Refresh the site after running the migration so the editing controls appear.

Run [`supabase/upgrade_privacy_requests.sql`](supabase/upgrade_privacy_requests.sql) in **SQL Editor** after the roles and profile image upgrades. Members can hide their directory profile from other members and submit an account or content removal request on **Privacy & conduct**. Administrators retain access for reviews and see a request queue in their dashboard. Hiding a profile does not remove contributions, existing messages or files. Removal requests require manual review and fulfillment, including the Auth user, related content and Storage objects; changing a request's status does not delete data. The account completion guard checks that the profile and Auth user were removed; administrators must still clean up related files and content themselves. Review the club's retention obligations and keep a record of the action taken before marking a request complete.

Run [`supabase/upgrade_course_planning.sql`](supabase/upgrade_course_planning.sql) in **SQL Editor** after the course journey, founder teaching roles, privacy requests and membership collaboration upgrades. Existing enrollment records already permit a member to join multiple workshops; this migration adds an optional project deadline, protected schedule and learner assignment actions, a teacher roster, and in-app enrollment and schedule notifications. In **Courses**, members see all their joined workshops across learning tracks. The **Calendar** shows starts and deadlines from workshops a member joined, workshops an assigned teacher leads, or all workshops for an administrator. In **Teaching studio**, an assigned approved teacher (including a founder whose teaching access is enabled) sees the learners in their own workshops, starts and deadlines, and can enroll an approved, verified club member using that member's sign-in email. Administrators can manage all workshops. A teacher can remove a learner only before that learner has submitted or completed work. The teacher roster exposes an enrolled learner's name and course progress even if their directory profile is hidden; it does not reveal their email or other private profile details. Project deadlines are reminders for planning: late submissions and revisions remain open. The schedule and assignment controls require this SQL migration; after running it, sign in again or refresh the site to load the new views.

Run [`supabase/upgrade_course_classroom_access.sql`](supabase/upgrade_course_classroom_access.sql) in **SQL Editor** after the course planning, teacher materials and founder teaching roles upgrades. It keeps the workshop catalog visible to approved club members while limiting course files to that workshop's enrolled or completed learners, its currently assigned approved teacher or teaching founder, and administrators. General learning library files remain available to approved club members. Teachers may upload course files only to their assigned workshops; administrators may upload to any workshop. The migration also adds protected editing of workshop title, track, level, practical description and resource link, and sends inbox notices when a learner submits a project or receives teacher feedback. Existing build notes and feedback remain private to the learner, assigned teacher and administrator. Uploads that fail before a material record is saved can be cleaned up, but a published learning file cannot be deleted from Storage by its uploader. A workshop with attached course materials cannot be deleted until those materials are deliberately handled; deleting it will not turn private files into general library files. The migration is safe to rerun; do not rerun the older `upgrade_teacher_materials.sql` afterward because it would restore the previous broad file policies. Refresh or sign in again after applying it.

Run [`supabase/upgrade_course_lifecycle_reviews.sql`](supabase/upgrade_course_lifecycle_reviews.sql) in **SQL Editor** after the course classroom access upgrade. Assigned teachers (including enabled teaching founders) and administrators can open **Teaching studio → Workshops** to end enrollment or remove a workshop, and **To review** to mark new student submissions as seen before writing feedback. Ending closes enrollment to new learners while current students retain their classroom, materials, submissions and revision path. A workshop with no students, project records or attached materials can be permanently deleted; otherwise **Remove** archives it from the public catalog while preserving history for enrolled students, assigned teachers and administrators. Publish a fresh workshop for a new intake, since a learner has one enrollment per workshop. Student project reviews, completion records and private evidence survive an archive. Refresh or sign in again after running the migration so the controls appear. Run this migration last among the club's course migrations: rerunning earlier course or membership collaboration migrations could restore broader catalog permissions or replace an assignment guard.

Run [`supabase/upgrade_inventory_finance.sql`](supabase/upgrade_inventory_finance.sql) **once** after the roles and investor upgrade to create the base Inventory and Finance tables. Then run [`supabase/upgrade_inventory_finance_approvals.sql`](supabase/upgrade_inventory_finance_approvals.sql) **once** to activate item types and founder approvals. If the first migration was already run, run only the second. The base migration will stop with an error if rerun after the approval upgrade, protecting the newer stock rules. The pages show a setup notice until both migrations are applied.

Next run [`supabase/upgrade_admin_alert_inventory_edits.sql`](supabase/upgrade_admin_alert_inventory_edits.sql) in **SQL Editor** to enable the administrator's **Delete alert** action on Club alerts and the **Update quantity** form on Inventory. Run it after the membership collaboration and inventory approvals migrations. It is safe to rerun. These two actions require the database policy and function in this file; a site update alone cannot enable them.

Run [`supabase/upgrade_inventory_unit_changes.sql`](supabase/upgrade_inventory_unit_changes.sql) next to enable **Inventory → Change unit**. Run it after the inventory approvals migration and, if not already done, the admin alert and quantity edit migration above. It fills in the original unit on existing movement records, then saves the unit on each new movement. The immutable movement trigger is disabled only within this migration's transaction while the new snapshot field is filled, and is restored before commit. Do not rerun the base inventory migration.

Approved club members can view the component, tool, equipment, supply and other stock records. Administrators set each item’s category, unit (such as pcs, cm or g), starting stock, reorder level, condition, location and optional serial number. Quantities are whole numbers: use smaller units such as cm for wire if fractions of a metre matter. **Inventory → Update quantity** lets an administrator set the new in-stock count with a reason; the difference adjusts total stock and is kept in permanent movement history. Existing checkouts remain outstanding. **Inventory → Change unit** allows an administrator to correct the unit label or convert to another unit by entering a recounted whole-number stock quantity, a new low-stock level, and a reason. Checked-out items must be returned first. The change is recorded with old and new values, and older movement rows and history CSV keep their original measurement units. Administrators can receive stock, check out a returnable tool, record a return, or issue components and supplies to a named member for a project. Issued stock reduces both total and available quantity; a checkout only reduces available quantity and must later be returned. Founders and administrators can review permanent movement history, including reasons and before/after details for catalog changes, and download inventory and history CSV files. The database locks stock during movements, prevents overdrawn checkouts and issues, and allows a former borrower to return an outstanding loan even if their membership changes.

Only administrators can record, approve or reject income and expense entries in GHS. The latest officer/finance migration replaces the earlier founder approval workflow while preserving existing entries and review history. Every new approval requires a supporting receipt. The administrator can attach receipts to older records, print transaction vouchers, export the ledger, and close each completed month with an actual balance, discrepancy and review note. Entries, receipts, decisions and monthly reviews remain in history. Approved treasurers can read and export approved monthly reports; they cannot enter, approve or change ledger records or open private receipts. Record an opening balance explicitly with a clear reference. Corrections use a new entry in an open period. See the upgrade instructions below and [backup/restore procedure](docs/backup_restore.md).

The public [About](about/) and [Founders](founders/) pages have their own URLs and page descriptions. The About page introduces SPACE's vision, mission, practical learning tracks, team workflow, values and independent leadership. Its engineering workshop images in `assets/` are illustrative artwork and do not depict actual club members. The Dean is mentioned as someone the club plans to inform and ask to acknowledge its existence; the Dean does not govern or receive reports from the club. Four proposed workshop cards appear on **Courses** until a teacher publishes a real workshop; two proposed project ideas appear on **Projects** until members create real plans. Use the [`content/launch_packet.md`](content/launch_packet.md) and [`content/launch_drafts.json`](content/launch_drafts.json) for reviewable lesson plans, worksheet prompts, matching event briefs and first project tasks. These are drafts with no invented teacher, date, owner, Meet link or consented portrait. Confirm the teacher, venue, equipment, safety plan, event date, project owner and public founder profile permission before publishing through the site. The Founders page loads only administrator-published public profiles.

The entry screen has separate **Create an account** and **I have an account** choices. New applicants set a password, verify their email and complete a pending application. Returning users sign in with email and password on the existing account. Former email-code users set their first password using **Forgot password / Set password**. Account approval and role permissions remain in the database. See **Email and password sign-in** below.

### Sign-in sessions and refresh

SPACE remembers authentication in this browser using localStorage and Supabase refresh tokens. Refreshes, closing/reopening a tab and browser restarts retain a valid session. There is no app-imposed 30-minute inactivity limit or eight-hour maximum. Existing tab-scoped credentials are migrated without requesting credentials again, and old elapsed-time metadata is removed. Signup email verification and administrator approval remain required. Clearing browser data, revoked/invalid refresh tokens or configured Supabase server limits can still require a new sign-in. If browser storage is blocked, only an in-memory session is possible.

### Preview different accounts together

Use **Accounts → Open another account in a new tab** to keep an administrator, teacher and member signed in side by side. The link opens `?account=separate#home` without an opener, and prompts for an existing account's email/password. **Sign in to another account here** changes only the current tab to a separate sign-in; **Return to my main account** restores the usual remembered account. Roles still come from the real authenticated profile and database policies.

The normal remembered browser account is unchanged. Separate account sessions are kept in `sessionStorage`, survive refreshes and routing, and end when their tab closes. Each document uses a distinct Supabase storage/broadcast key, mapped to the current tab's session, so another tab's sign-in or sign-out cannot replace it. Even duplicated tabs have distinct broadcast channels. Separate tabs do not import remembered main-account tokens or write their tokens to localStorage. A confirmation callback received while a main account is remembered also uses a separate session, preserving that main account. No new Supabase migration or redirect configuration is needed.

In-app notifications work for each account. Separate preview tabs do not reassign the browser's device-push subscription, remove its subscription on sign-out or overwrite the installed app's badge; device alerts remain attached to the main account. Password recovery clears only matching-account credentials in the current browser context and still requests server-side revocation for the account whose password changed.

Explicit Sign out immediately clears private UI, drafts and subscriptions, stops refresh and revokes the local Supabase session. A durable sign-out marker prevents reloads from restoring credentials while revocation is pending; credentials are cleared even if the request fails. Other tabs in the same browser clear their workspace immediately. Other projects and non-auth preferences remain intact. Private content is hidden on page exit and reloaded on restoration.

Verify with `node scripts/check_workspace.mjs`, then use a test account: sign in, refresh, close/reopen the site, explicitly sign out and reopen again. A remembered session must return in the first three cases and remain signed out in the last. The authentication change requires no database migration.

### Upgrade: club officers, receipts and monthly finance reviews

In Supabase **SQL Editor → New query**, paste the complete [supabase/upgrade_officer_workspaces_finance.sql](supabase/upgrade_officer_workspaces_finance.sql) file and click **Run**. It requires the existing inventory/finance, finance approvals and learning dashboard migrations. Run the entire file together; it is safe to rerun and preserves historical entries and decisions. Do not rerun an older finance policy migration afterward, since it would restore the earlier founder permissions. Reload the published app after SQL succeeds.

Open **Administration → Roles & offices**, search for an approved, email-verified member, choose one or more offices and save a reason. Available offices: president, vice president, secretary, treasurer, project lead, events coordinator and communications officer. They are added to existing membership, teaching and founder access. Removing an office immediately removes its database access while retaining assignment and work history. Members receive an in-app notification, a personalized Home card and **My office** in the sidebar. Workspaces support tasks, due dates, progress, role-specific records (minutes, budget notes, event plans, project plans or communications), administrator feedback and immutable revision history. Teachers retain their Teaching studio.

Only the administrator sees **Finance** and its raw ledger. Attach a PDF/JPG/PNG/WebP receipt (up to 10 MB) when recording a transaction; if upload fails after the ledger insert, attach it to that pending entry rather than recording the transaction twice. Approval is blocked until a receipt is registered. The private receipt bucket cannot serve files to founders, ordinary members or treasurers. Registered receipts cannot be overwritten or deleted through the app. Vouchers are printable and ledger CSV exports include decision history.

At the start of each month, select the previous month in **Finance → Monthly review**. Resolve pending entries and attach missing receipts, compare the computed closing balance with the actual balance, and close the month with a review note. This is an administrator review workflow, not an automatic accounting decision. After the first closure, close subsequent months in order. Closed periods cannot receive backdated entries or new receipts; use a current-period correction. The review records expected/actual balances and any difference. **Finance reports** gives administrators and assigned treasurers approved transactions, balances, category totals and CSV exports, without raw pending entries or private attachments.

Run `node scripts/check_workspace.mjs` and `SPACE_PGLITE_MODULE=/absolute/path/to/node_modules/@electric-sql/pglite node scripts/check_officers_finance_database.mjs`. Database checks use isolated synthetic accounts and do not apply SQL to your Supabase project. Confirm real administrator/member/treasurer behavior after migration. Include the new private receipt bucket in [file backups](docs/backup_restore.md).

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
- **Content export:** The administrator's **Admin dashboard** offers CSV downloads for applications and members, projects, events, posts, reports, investor inquiries and audit actions. Each CSV requests all authorized rows in batches at download time, independent of the visible page size. Founder and administrator inventory history exports and the administrator finance ledger use the same approach. Run exports during a quiet period: multiple requests cannot provide one point-in-time snapshot if records are concurrently added or removed. Exports omit Auth records, private direct messages, some relational tables and file bytes; they are **not database backups**. Keep a separate database backup and follow [`docs/backup_restore.md`](docs/backup_restore.md) to download the four private Storage buckets and the public founder-portrait bucket with [`scripts/backup_storage.mjs`](scripts/backup_storage.mjs). Run [`scripts/verify_storage_backup.mjs`](scripts/verify_storage_backup.mjs) against a completed download, then rehearse restoration in a separate project. The backup script requires a private secret API key kept only on a trusted computer. See [Supabase database backups](https://supabase.com/docs/guides/platform/backups).
- **Scale note:** Sign-in, page changes and edits load records for the visible page. Automatic page refreshes are staggered between 45 and 60 seconds, pause in hidden/offline tabs, combine duplicate work and back off after failures. Chat and approval alerts retain separate focused checks. Dataset batches run up to six reads together. Directory, project collaborator and attendance collections use stable 500-row pages so retrieval does not stop at the default API row limit. Some pages still fetch their full authorized collection; profile server-side search/pagination and aggregates before a busy launch. Use [`docs/capacity_and_loading.md`](docs/capacity_and_loading.md) to validate the actual Supabase plan and peak workload.
- **Verification:** Test access from separate accounts for pending, approved, founder and admin roles; test a direct database request as a pending user and verify it cannot read channels, documents or meetings. Then test upload, version download, reported content and meeting RSVPs. Keep the SQL migrations in the repository for review.

## Publish on GitHub Pages

The included GitHub Actions workflow publishes the static site on each push to `main`. In **Settings → Pages**, use **GitHub Actions** as the publishing source if GitHub asks you to select one. The expected address is `https://turkson225.github.io/Turk-Innovation-CLUB/`. Check the **Actions** tab for the deployment result. The public site shell works before Supabase is configured; member actions become available after steps 1–4. If Actions deployment is unavailable in your repository, set **Deploy from a branch → main → /(root)** as a fallback.

For a local preview, run `python3 -m http.server 8000` from the repository root and open `http://localhost:8000/`.

### Install the web app

On Android, open the site in Chrome and choose **Install app** from the browser menu, or tap **Install SPACE** in the site menu. On iPhone, open the site in Safari, tap **Share → Add to Home Screen**, and enable **Open as Web App** if offered. The site menu also contains device instructions. Installation requires a supported browser and the HTTPS GitHub Pages address; test on a phone after publishing. The app opens in its own window and has a branded home screen icon.

The worker caches only a small set of public files, including the About and Founders page shells. When disconnected, the member workspace shows a reconnect screen. Chats, courses, approvals, account details, founder portraits and files require an internet connection and are never stored in the worker's offline cache. The public founder directory itself loads live from Supabase. To test the offline screen, load the site while online, then disable network in browser developer tools and reload a member workspace route. Reconnect before signing in or using member features.

### Enable device notifications

Run the database migration, configure the VAPID and worker secrets, deploy the Edge Function and schedule delivery using the exact steps in [`supabase/PUSH_NOTIFICATIONS_SETUP.md`](supabase/PUSH_NOTIFICATIONS_SETUP.md). Until those Supabase steps are complete, the inbox bell and in-app popups work while the site is open, but the **Enable device alerts** control cannot register for background push. Members opt in separately on each device from **Inbox → Alerts on this device**. Direct messages, mentions, replies, course updates, new official announcements and other personal inbox notices can trigger generic system notifications while the app is closed; ordinary channel messages do not notify every member. On iPhone, install and open the Home Screen app first. The OS and browser control lock-screen visibility and whether the icon shows a number or dot. Signing out removes this device's subscription; if both the browser and server fail to remove it, sign-out stops and asks the member to retry. Other opted-in devices remain active.

## Operational notes

- The public repository exposes all static site code and `config.js`. Supabase RLS, not hidden JavaScript, controls database access. Verify RLS after any schema changes.
- The members directory, project data, course content, events and alerts are accessible only to approved club members after the membership migration. Public founder cards are deliberately public.
- The online indicator is approximate, not a surveillance or attendance record. It means a member's open tab updated `last_seen_at` recently; background tabs, network loss and browser shutdowns can delay a change.
- For invite-only membership, turn off public signup in Supabase Auth and invite members administratively; otherwise anyone able to receive an email can create an account. Before public launch, decide the membership admission process.
- Push notifications require the separate Web Push setup and a member's permission. There are no scheduled email reminders, automatic news ingestion or built-in video meetings. Google Meet links can be pasted manually or created through the optional organizer-authorized Google Calendar connection.

## Platform roles

| Role | Abilities |
| --- | --- |
| Visitor | Public home, founders, investors, privacy and conduct pages |
| Applicant | Own application and privacy pages while approval is pending; requested type does not confer access |
| Member | Directory and profiles, private direct messages, activity posts and comments, channels, documents, news, projects and assigned tasks, discussions, events, RSVPs and inbox |
| Teacher | Member abilities plus course publishing, assigned workshop rosters and schedules, learner assignment, learning material uploads and private teaching profile after approval |
| Founder | Member and teaching abilities by default, plus private founder meetings and finance review; an administrator can pause teaching without removing founder leadership |
| Investor | Curated investor updates and own private inquiries, separate from the member workspace |
| Administrator | Member and teaching abilities plus account reviews, role changes, moderation, CSV and JSON export, investor updates and inquiries, publishing, channel creation and founder invitations |

## Members directory

The Members page uses compact profile cards and adapts to phones, tablets and desktops. It adds:

1. Search across names, `@handles`, backgrounds, headlines and skills, with accent-insensitive matching.
2. Grid and list views.
3. A compact density option.
4. Role filters, including teachers and founder teaching leads.
5. Online and self-declared availability filters.
6. Clickable skill chips and an interest selector with member counts.
7. Shared-interest discovery, based on the comma-separated skills in both profiles.
8. A “New here” group and badge for members who joined within the last 30 days.
9. Private member bookmarks and a Saved group.
10. Online-first, alphabetical, newest and shared-interest sorting.
11. “Meet a member” discovery within the current filters; it opens a real profile without sending a message.
12. A personal profile-completion checklist.
13. Protected, copyable profile links that preserve the destination through sign-in.
14. Individual removable filters and one-click reset.
15. Numbered pagination with 24 cards per page and filtered result counts.
16. Keyboard shortcuts: `/` focuses directory search and Escape clears it while search is focused.

Cards include quick profile and messaging actions, clearer presence and availability, and direct access to the existing full-screen photo viewer. Skill chips in the profile dialog also open directory filters. Photos load in place; search focus and cursor position are preserved during directory refreshes.

Bookmarks, grid/list view and density are stored in localStorage under `space.members.<account-id>` on the current device. They do not sync between devices or create follow relationships, and bookmarking does not notify another member. Search and filters reset when the signed-in account changes. Device storage failures retain choices for the current session.

Only approved club profiles visible to the current account appear in directory results, skill counts, discovery, profile dialogs and member results in workspace search. Private profiles remain visible to their owner and administrators; investor and unapproved profiles are excluded. Application answers and email addresses are never rendered in directory cards or profiles. Profile links require an approved club account and respect current visibility; private profiles have no copy-link action. Supabase RLS remains the database access boundary. These additions use existing profile fields and require no new SQL migration.

## References

- [Supabase password authentication](https://supabase.com/docs/guides/auth/passwords)
- [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [GitHub Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)



### Advanced SPACE upgrade: lessons, meetings, events and collaboration

This update adds three focused destinations: **Classroom tools**, **Meetings & actions**, and **Project workspace**. Existing course submissions, Teaching studio, founder meetings, roles and administrator-only finance controls remain connected to them.

**Setup order**

1. If not already applied, run the complete `supabase/upgrade_officer_workspaces_finance.sql` file. It requires the existing learning dashboard and finance approvals upgrades.
2. Run the complete [`supabase/upgrade_advanced_platform.sql`](supabase/upgrade_advanced_platform.sql) file in **Supabase → SQL Editor → New query**. It also expects the existing membership collaboration and latest DM conversation/media upgrades. The new migration is transactional and rerunnable; do not run only a highlighted fragment. No server secret, Edge Function or cron job is required for these new workflows.
3. Reload SPACE. A setup notice appears in new workspaces until their tables are available; existing pages remain usable. Test administrator, teacher, student and officer access with separate accounts. These instructions do not claim that the migration has been run on the live database.

**Where to use the tools**

- **Home → Today & next:** assigned meeting actions, upcoming class sessions, office work, teacher reviews and administrator approval/monthly-review prompts. The calendar includes class sessions and general club meetings. Founder meeting privacy remains separate.
- **Teaching studio → Classroom tools:** select a workshop, publish ordered lessons with a practical outcome and instructions, schedule sessions, record attendance, then assess reviewed classwork. The gradebook uses demonstration 40%, testing/evidence 40% and explanation 20%, each scored out of 100. Grades and revisions are visible only to the learner and assigned teacher/administrator. An assessment does not automatically certify completion. Students see the same workshop's lessons, their own progress, attendance and assessments. Existing final-project completion remains teacher controlled.
- **Classroom tools → Certificates:** after a teacher accepts the final project, the learner creates a certificate and can print/save it as PDF. Public verification is off by default. Opting in enables `certificate.html?code=<unique-code>`; the public RPC returns only holder initials, course title, issue date, validity and club name. The full certificate stays in the permitted classroom. Administrators can revoke a certificate with a reason; changing sharing preferences does not undo revocation.
- **Administration → Roles & offices → Secretary:** the assigned secretary uses **Meetings & actions** for agendas, minutes, attendance and assigned follow-up. Meeting revisions remain in history. Ordinary approved members read general club minutes and update only their own action progress. Secretary/admin manage attendance; founder meetings remain in Founder room. Print/save a meeting record from its page.
- **Projects → Project workspace:** switch a task among To do, In progress, To review and Done; owners/team members and assigned task owners get the appropriate controls. Add build updates with a stable HTTPS evidence link or an existing club document, then open team, milestones and discussions from the plan. Project percentage remains the owner's maintained project record; board states show the current task workflow.
- **Direct messages:** existing replies, reactions, read indicators and server conversation search are joined by pinned messages (maximum 20 per conversation), a private documents panel and document attachments up to 10 MB (PDF, TXT, CSV, ZIP, DOCX, XLSX, PPTX). Only the two participants can access registered private files; administrator status alone grants no DM-file access. Message request UUIDs make unchanged retries idempotent. Text drafts are kept in the signed-in tab and cleared on sign-out/expiry; file bytes stay in memory and must be selected again after a reload. Files & pins lists documents in pages of 40; image messages retain their existing image viewer.
- **Events:** administrators and assigned event coordinators set capacity, preparation/material notes, dates and links. Members reserve a place or join the waiting list. Cancellation promotes the oldest waiting member; increasing capacity also promotes existing waiting members before later applicants. Promoted members receive in-app notifications and push when already configured/enabled. Staff record check-in and export the complete event attendance CSV. Feedback opens after a confirmed attendee has checked in and the event ends. Previous Going RSVPs are imported as confirmed registrations; historical responses remain in their original table. New capacity-aware registrations are authoritative after this upgrade.
- **Notifications:** category and unread filters, pages of 30, popup/sound controls and per-category delivery preferences. Muting a category suppresses new member popups and newly queued push deliveries without deleting inbox records. Push still requires the platform's existing web-push setup and device opt-in. A pre-existing queued push is not retroactively recalled by a preference change. Administrator application alerts retain their dedicated controls.
- **Shared files:** title/author/type search, compact paginated cards and existing revision history.
- **Finance → Monthly review:** the administrator closes the month as before and adds append-only open/resolved discrepancy follow-ups. Print/save the monthly summary and use the approved-month CSV for the complete transaction list. Receipt access and transaction approval remain administrator-only; treasurers retain read-only approved reports.

**Validation and recovery**

Run `node scripts/check_workspace.mjs`, `node scripts/check_certificate_verification.mjs`, and `SPACE_PGLITE_MODULE=/absolute/path/to/node_modules/@electric-sql/pglite node scripts/check_advanced_database.mjs`. The database suite applies the actual SQL in isolated PostgreSQL with synthetic accounts. It tests access boundaries, privacy, certificate revocation, event waiting-list behavior, duplicate-safe messaging and finance follow-ups. These checks are not a live 2,000-user load test or a live restore rehearsal. Keep using the [database and file backup procedure](docs/backup_restore.md); the updated tools include private DM documents in `club-direct-files` alongside the other club buckets.


## Club shop and role acknowledgements — 15 October 2026

Run these **whole files** in Supabase **SQL Editor → New query → Run**, in order, after the existing learning dashboards, officer/finance and advanced-platform upgrades:

1. [`supabase/upgrade_role_acknowledgements.sql`](supabase/upgrade_role_acknowledgements.sql)
2. [`supabase/upgrade_club_shop.sql`](supabase/upgrade_club_shop.sql)

Both are transactional and safe to rerun. They create empty feature tables, indexes, fixed-search-path functions, explicit permissions, owner/admin read policies and a private `club-shop-images` bucket. They do not publish products, change existing roles or apply themselves to your hosted database. No new API secret or Edge Function is needed. Existing push setup can deliver these in-app notifications through the existing notification pipeline; OS delivery still depends on browser permission and the deployed push worker.

### Assign a role with a note

Use **Administration → Membership approvals → Account role**, or **Roles & offices → Assign / remove offices**. Write a useful note explaining the role and next steps. The person receives a bell notification and a **Role updates** page. **Open → Acknowledge & open my workspace** records receipt and refreshes the sidebar/current dashboard. An administrator can use **Role updates → Review all acknowledgements** to see who acknowledged and when. The Home banner keeps unacknowledged updates visible.

Assignments grant access immediately; acknowledgement records receipt and does not grant permissions. Old notices retain their assignment snapshot and note. Opening one uses current database permissions, so acknowledging an old founder/teacher/officer notice cannot restore revoked access. Past notifications are preserved; only future assignments produce the new detailed acknowledgement record. Role notes are private to the recipient and administrators. Investors can read and acknowledge their own role changes without receiving member-only shop access.

### Set up selling

1. Sign in as administrator. Open **Administration → Manage shop → Collection & policy** and enter the actual collection location/process, contact details and cancellation/support policy.
2. Choose **Add product**. Add the real product name, category and description; optionally upload a JPG/PNG/WebP photo up to 5 MB. Save it as a draft while preparing it.
3. Add one or more **stock options**. Each T-shirt size/colour or kit option has a unique SKU, GHS price, unit, quantity on hand and low-stock level. A stock note/recount reason is required. No example products or prices are seeded.
4. Edit the product and select **Publish for approved members**. Members can then browse/search/filter **SPACE shop**, select options, add quantities to their **Basket**, review the total and place an order using their collection name and phone.
5. Under **Manage shop → Orders**, filter the queue, confirm an order, add a collection note, and mark it ready. Buyer and administrator can exchange messages on the order. Members see updates under **My orders** and their notification bell.
6. After receiving the full payment and handing over the items, choose **Collected**, confirm payment/handover and enter the actual receipt/payment reference. This deducts the reserved stock and creates one **pending income** entry in Finance. Open **Finance**, attach the real receipt and approve that entry through the existing controls. Existing monthly closure rules also apply; a failed Finance insert rolls back collection and stock changes together.

Initial fulfilment is **collection**, currency **GHS**, payment **on collection**. There is no card/mobile-money charging API, shipping calculator, automated tax calculation or automatic refund. Administrators handle any refund/support request after collection through the existing Finance process. The printable payment record is an order/payment record, not an automatically issued statutory tax invoice.

Sale stock is separate from loan Inventory. Stock is reserved atomically only on successful checkout, released exactly once on pre-collection cancellation and physically deducted exactly once on collection. Checkout checks prices server-side, requires review if a price changed and uses an idempotency token for same-page retries. After an interrupted request followed by a reload, check **My orders** before creating a new checkout. Archives preserve all orders and stock history. Direct table writes are denied to clients, including administrators; write functions enforce the relevant account permissions. Administrators can export complete matching product/stock or order CSVs across pages; CSV cells are escaped against spreadsheet formula execution. Customer contact details and order messages are owner/admin only.

### Checks and backup

`node scripts/check_commerce_ui.mjs` checks card rendering, role acknowledgement routing, quantity checks, checkout retries, stale requests and bundle integration. `scripts/check_commerce_database.mjs` applies the real migrations to 2,000 synthetic accounts and checks privacy, owner/admin permissions, stock reservations, price snapshots, idempotence, collection/Finance and acknowledgement history. Locally it accepts `SPACE_PGLITE_MODULE`; `.github/workflows/shop-check.yml` runs it against a fresh disposable PostgreSQL 17 service and additionally races simultaneous buyers, duplicate requests and cancellation versus collection. It never connects to hosted Supabase or uses member records.

The Storage backup/verification scripts now include private `club-shop-images` when installed and accept older backups where the shop bucket was not yet present. Keep the separate database-and-Storage restore process documented above; database backups do not contain uploaded image bytes. These automated tests use an isolated SQL Auth/Storage contract; actual hosted Storage uploads, push delivery and live authenticated journeys must still be checked after applying the migrations.


### Product visibility and member alerts — 16 October 2026

Run the whole [`supabase/upgrade_shop_product_alerts.sql`](supabase/upgrade_shop_product_alerts.sql) file after `upgrade_club_shop.sql`. It adds first-publication notifications to the existing shop. **SPACE shop** is now a main sidebar link for every approved club member, with a compact Home shortcut. Course selection does not block access to the shop, basket or orders. Pending applicants and investor-only accounts keep their existing restrictions.

After adding your product, add a priced, active option with stock and choose **Publish to members**. Members see the published catalog and receive an in-app bell update whose **Open** button opens that product. A product saved as published before its stock options are ready sends its first alert when the first active, in-stock option is saved. Live shop viewers refresh from that notification; the existing page poll remains the fallback. The publisher is excluded from their own broadcast. Existing push preferences/permission/worker determine whether that same notification also reaches the device outside SPACE.

Each product sends one launch alert per eligible member. Price edits, stock recounts, hides, archives and republishing the same product do not repeatedly notify everyone. The migration marks the existing orderable catalog as already announced without broadcasting historical products. New members can browse earlier published products even if they joined after the launch alert. This does not send emails or backfill notifications. The announcement claim is atomic and trigger-only; members cannot call it or alter its ledger.


### Store add-product correction — 16 October 2026

The add-product form now includes the opening GHS price, stock quantity, option and unit. New products default to **Publish in the member store**. Saving first creates the product privately, saves its opening stock through the existing stock RPC, then publishes it. A stock or publication error leaves a recoverable record and shows an explicit failure instead of claiming members can see it. Administrators can still uncheck publication to keep a private draft.

**Store / View products** is a main sidebar link and Home shortcut, with a Store button in the header. **Manage shop** shows each product’s Draft/Published status, a direct Publish action and a **View member store** link. Filters reset after product saves and when moving between management and member browsing, so a previous search or category cannot hide the new product. Older drafts are preserved; publish them individually when ready. Editing a product with no option now allows its first price and stock to be entered in the same form.

This correction uses the existing shop migration/functions and needs **no additional SQL migration**. Reload SPACE to download it. The existing `upgrade_shop_product_alerts.sql` is still needed only for new-product notifications. A database regression test now runs the real add-product handler against the SQL fixture and checks that a different approved member can retrieve its published product, price and quantity.


### Product update submission fix — 16 October 2026

The product and stock forms contained hidden controls named `id`. Browser form named-property access can expose that control through `form.id`, so the old submission router could miss the form and allow a normal page navigation instead of calling the save RPC. Both stages of the shop submission router now read the form's `id` attribute directly. Product and stock forms also display saving/errors inside the dialog, and successful updates show a visible confirmation beside the refreshed product details. If the write succeeds but detail refresh fails, the dialog acknowledges the saved change and offers **Reload product** without retrying the write.

This frontend correction uses the existing shop RPCs; **no new SQL migration is required**. Administrator-only management and owner-only orders are unchanged. Regression checks model the browser's hidden-ID collision and exercise product creation, product edits, price/stock updates, error feedback and member readback against the isolated PostgreSQL fixture.


### Platform and club identity — 16 October 2026

The platform name is **SPACE**. The organization is **TURK INNOVATION CLUB**. SPACE logos on the workspace, public pages, certificate verifier and offline screen have no “Engineering Club” subtitle. About and founder content identify the club by its actual name; transaction vouchers, shop records and completion certificates use TURK INNOVATION CLUB as the organization. The installed app name remains SPACE.

The frontend maps the old certificate-verifier issuer label to the corrected club name, so existing deployments need no new SQL migration for the visible correction. The advanced-platform SQL also uses the corrected issuer for future installations. Public offline caches are versioned again so refreshed installations discard the older public branding.


### Order tracking and purchase receipts — 16 October 2026

Run the entire **`supabase/upgrade_shop_order_tracking.sql`** file in Supabase SQL Editor after the shop migration. No new secrets, Edge Functions, bucket or cron job is required. The migration is rerunnable and creates receipt snapshots for older paid, completed orders without sending historical notifications. This repository deploy cannot apply SQL to the live project automatically.

**Administrator:** open **Manage shop → Orders → Update status**. Move the order to **Processing**, **Ready**, or **Delivered**, with a note the member can read. Delivered includes collection or handover and requires confirmation that the full payment was received, with a payment reference. Delivery creates one permanent purchase receipt, deducts stock once and creates one pending Finance income entry. Supporting evidence and administrator approval in Finance are still required for approved reports. Completed and cancelled orders cannot be reopened through this tool.

**Members:** open **My orders → Track order** for the progress tracker, status history, messages and a Refresh status action. Stage updates send the buyer an existing club notification. The open order refreshes with normal page refresh/polling and incoming order notices; opening the same order notification again reloads the latest detail. Receipt-ready notices lead to the order's **View purchase receipt** action. Notification delivery uses the existing in-app/push setup and does not add email delivery.

**Receipts:** the purchase receipt shows TURK INNOVATION CLUB as seller, a stable `TIC-R-…` receipt number, order reference, buyer details, immutable item/price snapshots, total paid, payment reference and timestamps. The buyer and administrators can open it and use **Print / Save PDF**. Administrators can choose **Send receipt to member** with a note, which adds a permanent history entry and a notification; it never charges again or creates another payment. Receipts are read-only to clients, including administrators, and other members cannot access them. Unpaid/cancelled orders cannot receive paid receipts.

For compatibility, the stored states remain `confirmed` and `collected`; the interface, notification titles and CSV exports call them **Processing** and **Delivered**. The upgraded action RPC also accepts `processing` and `delivered` aliases, so existing orders, client versions and stock history remain valid. The frontend stage controls still work with the original shop RPC while the receipt migration is pending; administrators see the exact setup filename if they try opening an unavailable receipt.

Checks cover status authorization, buyer notifications, receipt privacy/immutability, retry safety, old-order backfill without notification spam, closed Finance-period rollback and concurrent deliveries in PostgreSQL.

## Email and password sign-in

SPACE now signs in existing accounts with **email and password**. New applicants choose an account type, create a password, verify their email once, and complete the existing application. Application choices never grant roles: administrator approval and database access policies still control the workspace. No SQL migration is required for this authentication change. Supabase project settings must keep email confirmation enabled; the frontend cannot enforce that server setting.

Members who previously used email codes should open **Sign in → Forgot password / Set password**, enter their existing email, then follow the email link or enter its recovery code on `reset-password.html`. They set a password on their **existing account**, retaining its UUID, role, courses, messages and purchases. They should not create a second account. Future sign-ins use that password, and the remembered session persists until sign-out. Signup verification still supports the project's current 8-digit codes (6–10 digits supported).

The recovery page uses its own tab-scoped Supabase storage key, accepts only a recovery-authorized session, and binds its short-lived recovery state to the verified user. An ordinary workspace session cannot authorize the password form. After a successful change it requests global refresh-session revocation, discards recovery tokens, clears matching workspace credentials, and asks the member to sign in again. Supabase access tokens already issued remain valid until their normal expiration. Reset emails and links expire according to Supabase Auth configuration.

Password fields are never saved in application drafts or profiles. All password changes use Supabase Auth. The static Pages build includes the recovery page; it does not cache it or authentication responses for offline use. Run `node scripts/check_workspace.mjs` and `node scripts/check_password_recovery.mjs` for mocked authentication, recovery and session regression coverage. Live email delivery still needs a test using an account and mailbox you control.

Official references: [password authentication](https://supabase.com/docs/guides/auth/passwords), [password reset](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates).

## Automatic completion certificates

Run [`supabase/upgrade_automatic_course_certificates.sql`](supabase/upgrade_automatic_course_certificates.sql) **last**, after the advanced platform, learning dashboard, course journey, classroom access and founder teaching migrations. It runs in one transaction and can be rerun. Do not rerun older course/advanced migrations afterward; their older certificate function definitions predate automatic issuance. This migration does not change account roles, passwords or existing certificates.

1. Each approved teacher, teaching founder or administrator opens **Teaching studio → Certificate signature**, enters their full name, and chooses **Draw signature**, **Type initials**, or **Upload image** (PNG/JPEG/WebP, maximum 2 MB). The drawing pad accepts a finger, mouse or stylus and has **Undo stroke** and **Clear** controls. Preview the mark above the teacher name, acknowledge that it is your own signature or initials, then **Save signing details**. Drawings and initials become a closely cropped PNG in the same private signature bucket. A returning teacher can select **Use saved** to keep their current signature while updating their name. No additional migration is required for the pad; the automatic certificate migration above must already be active. Signature files are private and immutable; replacing a teacher’s current signing details creates a new version, preserving awards already issued. Project owners can review unused uploads in Storage; the browser cannot delete signature evidence.
2. For a final project, the assigned teacher opens its review, enters feedback, acknowledges completion and chooses **Accept and issue certificate**. The completion and award are committed together. Without a saved signature, acceptance rolls back and displays a setup message. Revision requests still work without signature setup.
3. For a learning course or an assessed practical without a final-project submission, use **Teaching studio → Confirm course completion**. Select the course, search for its enrolled member, choose Learning or Practical, record what confirms completion and acknowledge the requirements are met. The assigned teacher or an administrator can confirm; self-certification is blocked. A submitted final project must be reviewed first. Administrators use their own saved name/signature when they act as assessor.
4. The member receives **Your course certificate is ready** in Notifications. **Open** loads the award directly. It is also available in **My learning → course → Teacher feedback** and **Classroom tools → Certificates**. Choose **Download PDF** for a high-resolution, landscape certificate based on the approved edited Word design. The date is the recorded completion date in UTC. Learning and practical wording reflect the completion basis. No SMTP setup or separate email function is needed for these in-platform notifications.

Issued records preserve the member name, course title, completion date, signing teacher and signature version. Repeating a confirmation returns the same certificate and sends no duplicate notification. Archived courses keep their records. Older completions can be explicitly confirmed/signed through the same teacher action; the migration does not apply a teacher’s signature to old records without acknowledgment. Existing signed or revoked records cannot be renewed or rewritten by a retry.

The member controls optional public verification through **Classroom tools → Certificates → Sharing settings**. The public verification page accepts the printed `TIC-...` number or the underlying UUID; it discloses only holder initials, course, issue date and validity, excluding signatures and private account IDs. Administrators can revoke awards with a reason. The download rechecks access/revocation and shows a REVOKED watermark when applicable; copies already downloaded cannot be erased remotely.

The original template graphic extracted from the approved Word file is in `assets/certificate-template-v1.png`. It contains the club logo and background, without the sample recipient or text. Names and signatures are rendered privately in the signed-in browser and are never stored in drafts, localStorage, a public PDF bucket or a third-party rendering service. Include `club-teacher-signatures` in the existing separate Storage backup/restore plan. Database backups alone do not back up those image bytes.

Checks: `node scripts/check_course_certificates_ui.mjs` and `SPACE_PGLITE_MODULE=/path/to/@electric-sql/pglite node scripts/check_course_certificates_database.mjs`. The dedicated GitHub workflow also tests real PostgreSQL 17, including simultaneous confirmations. The new SQL must still be applied to your Supabase project, and a controlled teacher/member completion should be checked there after setup.

## Administrator order desk and DM read confirmations

Run [`supabase/upgrade_order_desk_dm_reads.sql`](supabase/upgrade_order_desk_dm_reads.sql) in Supabase SQL Editor after the existing shop, shop order tracking, direct message and message counts migrations. It runs in one transaction and can be rerun. It adds order totals and atomic read confirmation functions, restores the pair-scoped sender receipt function, and clears legacy DM alerts already covered by recorded read positions. It does not replace order status, stock, receipt or Finance approval rules. No Auth, SMTP, Storage or Realtime setting changes are required.

Administrators open **Administration → Orders & fulfilment** (`#order-desk`), also linked from Admin dashboard. The desk shows all-status counts, active order value, delivered purchase value, a searchable paginated queue, status filters, complete matching CSV export and shortcuts for **Start processing → Mark ready → Mark delivered**. Each shortcut opens the update form with the next status selected; the administrator reviews it and writes the member-facing note. Delivery still requires confirmation of full payment and handover plus a payment reference. Existing history, member notifications, immutable purchase receipts and separate Finance review continue to apply. Order notifications open the administrator's order desk or the buyer's My orders page according to the signed-in role. New-order notifications refresh an open desk. Totals aggregate the full authorized order history; no full client download is needed. If the new totals function is unavailable, the queue and existing processing controls remain usable.

Opening a visible DM at the latest messages records the actual latest displayed incoming message, clears its covered alerts and refreshes unread badges. A hidden tab or a conversation scrolled away from the latest messages does not mark new messages read. The server preserves a monotonically increasing read cursor and never derives it from a client-supplied timestamp. A newly arriving message remains unread beyond the confirmed snapshot. Sender read ticks use the recipient's pair-scoped receipt, refresh with the conversation (normally within nine seconds), and retry after transient failures. Microsecond timestamps are preserved in read comparisons. Failed reads remain retryable and show a connection notice without falsely clearing badges; stale count responses cannot restore an old badge after a successful read.

Before the migration is applied, the app can save read positions using column-scoped INSERT/UPDATE operations rather than the old upsert, which incorrectly required UPDATE permission on identity columns. The migration enables atomic position/alert updates and authoritative counts in one call. Offline checks cover that fallback, delayed alerts, unread-count races, sender visibility, private admin totals, duplicate processing, immutable receipts and concurrent confirmations in disposable PostgreSQL.


## Chat wave background

Direct messages and team channels use the supplied React Bits GradientWaves shader, adapted to plain JavaScript in `chat-waves.js` with its upstream license notice. The wave icon in the conversation header pauses or resumes the wallpaper; the browser remembers the preference. Light and dark themes keep solid message surfaces. The canvas is decorative, ignores pointer input, and sits outside the scrollable log, so it cannot cover links or interfere with message selection, attachments, read positions or composing.

The renderer is capped at 24 frames per second / 320,000 pixels (18fps / 180,000 pixels on narrow screens); actual device performance has not been measured. A single canvas survives conversation refreshes, stops while offscreen or the document is hidden, and releases its WebGL resources on leaving chat. Reduced motion, data saving, low-resource devices and unavailable/lost WebGL use the still CSS wallpaper without a rendering loop. There is no database migration. Run `node scripts/check_chat_waves.mjs` for lifecycle, failure, preference and resource-budget checks.
