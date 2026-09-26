# InnovateX Engineering Club platform

A responsive club workspace for a TTU engineering community. The site is static and can be hosted on GitHub Pages. Supabase provides email sign-in and a database protected by row level security.

## What is included

- Public home and founders pages. Founder names remain placeholders until approved profiles are added.
- Email one-time-code signup, sign-in and sign-out, member profiles and an online indicator based on a recent heartbeat. Sign-out clears the member's presence; disconnected users disappear from "online" after about 65 seconds.
- Project cards, progress, tasks and discussion threads.
- Member channels with live message updates (and polling fallback), a private document library, and channel file sharing.
- Technology news submitted by members and reviewed by administrators before appearing in the feed.
- Founder invitations, verified-email acceptance, and a private founders' meeting room with Google Meet and calendar links.
- Administrator-approved member applications, threaded channel replies, reactions, mentions, unread counts, search and in-app notifications.
- Three-column member activity feed with project updates, resource links, shared club documents, comments, likes, recent stories and active members.
- Member profiles with a headline, bio and availability, plus private one-to-one messaging and unread counts. Optional dark theme is saved in the browser.
- Blog-style engineering posts with an optional headline, topic, cover image, links and document attachments; comments support one level of replies. Channel messages can include an image selected from the member's gallery.
- Project collaborators, milestones and task assignments; meeting RSVPs, document versions, reports and moderation actions.
- Administrator-published courses, alerts and events. Events can include Google Meet links and open in Google Calendar or download as an ICS file.
- Phone, tablet and desktop layouts. Untrusted member text is escaped before display.

## Set up Supabase

1. Create a Supabase project and open **SQL Editor**. Run [`supabase/schema.sql`](supabase/schema.sql) once. Use a new project or review existing schema before running it.
2. In **Authentication → Providers → Email**, enable email sign-in and leave email confirmation enabled. Under **Authentication → Email Templates**, edit **Magic Link / OTP**: set the subject to `Your InnovateX verification code` and replace the HTML body with [`supabase/email-otp-template.html`](supabase/email-otp-template.html). Because a new user can receive the **Confirm Signup** template, set its subject to `Verify your InnovateX account` and use the same HTML body there too. Both templates must contain `{{ .Token }}` rather than an authentication link for the site's code entry screen to work. Save each template. To email club members beyond your Supabase team's authorized addresses, configure **Authentication → SMTP Settings** with a verified sender and set the sender name to `InnovateX Engineering Club`; Supabase's built-in sender is restricted.
3. In **Authentication → URL Configuration**, set the Site URL to `https://turkson225.github.io/Turk-Innovation-CLUB/`. Add that exact URL to Redirect URLs. For local testing, add `http://localhost:8000/` as another Redirect URL.
4. In the project's **Connect** dialog, copy the Project URL and **publishable** key into [`config.js`](config.js). These values are designed for browser use. **Never paste a service_role or secret key** into the repository. This repository is configured with the project's public values.
5. Sign in at least once. Then, in SQL Editor, promote your specific user to an administrator using the authenticated user's UUID from **Authentication → Users**:

   ```sql
   update public.profiles set role = 'admin'
   where id = 'YOUR-AUTH-USER-UUID';
   ```

   Check that exactly one row changed. The browser cannot promote accounts. An administrator can publish founder bios, courses, events and alerts. Other members can create projects and discussions.

6. Add the founding team only after they agree to have their name and biography shown publicly. The Dean's patronage is an invitation pending acceptance, so the interface does not claim it has been granted.

## Activate community pages

After the original schema is in place, open your project's **SQL Editor** and run [`supabase/upgrade_community.sql`](supabase/upgrade_community.sql) **once**. This adds community tables, a private `club-documents` Storage bucket, founder invitation rules and access policies without removing existing member or project data. Until this migration runs, the new pages display a setup notice. The SQL Editor is required because the browser's public key cannot create database tables or change access policies.

Next run [`supabase/upgrade_membership_collaboration.sql`](supabase/upgrade_membership_collaboration.sql) **once**. It adds member applications and approval rules, project teams, chat replies and notifications, RSVPs, report handling and document versions. Existing email-confirmed accounts remain approved; newly verified email accounts become **pending** and only see their own application page until an administrator approves them. A signed-in administrator reviews applications under **Applications**. Review access with a new pending account, an approved member, a founder and an administrator before inviting the wider club.

Finally, run [`supabase/upgrade_activity_feed.sql`](supabase/upgrade_activity_feed.sql) **once**. It adds private member posts, comments, likes and moderation support. The activity feed displays a setup notice until this migration runs. Feed posts accept a link or an existing club document; they do not copy external article text or upload new files. Member comments generate an in-app notification to the post author.

Then run [`supabase/upgrade_direct_messages.sql`](supabase/upgrade_direct_messages.sql) **once**. It adds optional member profile details and private messages. Only the sender and recipient can read a message; both must be approved members for a new message to be sent. Direct messages generate in-app notifications and unread counts. The message page displays a setup notice until this migration runs. The appearance switch in the top bar works independently of Supabase and remembers the choice in that browser.

Run [`supabase/upgrade_media_threads.sql`](supabase/upgrade_media_threads.sql) **once**, after direct messages. This adds feed headlines and categories, photo attachments, threaded comment replies, and gallery images in channels and private direct messages. The `club-media` bucket is private and accepts JPG/PNG/WebP/GIF up to 5 MB. Approved members can open images in visible posts or channels; only the two direct message participants can open images shared in their conversation. The uploader retains access to their own uploads. Photos appear through temporary signed links. This upgrade does not enable video uploads or more than one level of comment replies. If you see an error such as `public.is_approved() does not exist`, an earlier migration has not completed: run the files in this section in the order listed.

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
- **Content export:** The administrator's **Export content JSON** button downloads shared club content currently loaded in the browser. It deliberately excludes private direct messages, authentication users and file bytes (including images) and may be limited by Supabase query limits; it is **not a complete backup**. Use Supabase database backups or CLI dumps, and independently preserve important Storage files. See [Supabase database backups](https://supabase.com/docs/guides/platform/backups).
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
| Visitor | Public home, founders, privacy and conduct pages |
| Applicant | Own application and privacy pages while approval is pending |
| Member | Directory and profiles, private direct messages, activity posts and comments, channels, documents, news, projects and assigned tasks, discussions, events, RSVPs and inbox |
| Founder | Member abilities plus private founder meetings after accepting an invitation |
| Administrator | Member abilities plus account reviews, moderation, content export, publishing, channel creation and founder invitations |

## References

- [Supabase passwordless email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [GitHub Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
