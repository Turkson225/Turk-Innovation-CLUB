# InnovateX Engineering Club platform

A responsive club workspace for a TTU engineering community. The site is static and can be hosted on GitHub Pages. Supabase provides email sign-in and a database protected by row level security.

## What is included

- Public home and founders pages. Founder names remain placeholders until approved profiles are added.
- Email one-time-code signup, sign-in and sign-out, member profiles and an online indicator based on a recent heartbeat. Sign-out clears the member's presence; disconnected users disappear from "online" after about 65 seconds.
- Project cards, progress, tasks and discussion threads.
- Member channels with live message updates (and polling fallback), a private document library, and channel file sharing.
- Technology news submitted by members and reviewed by administrators before appearing in the feed.
- Founder invitations, verified-email acceptance, and a private founders' meeting room with Google Meet and calendar links.
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

Once the first administrator has been promoted using step 5 above:

1. Members can use **Channels**, share files up to 10 MB in **Document library**, and submit external stories through **Technology news**. Administrators review submitted news before publication and can create new channels. The news feed is curated by members; it does not automatically ingest third-party articles.
2. An administrator opens **Founder room → Invite founder** and enters the founder's sign-in email address. The founder signs in with that exact email, sees an invitation on **Members**, and clicks **Accept invitation**. The database checks that the email is confirmed before granting founder access. This in-app invitation does not send a separate email; the administrator should tell the founder that an invitation is waiting.
3. Accepted founders and administrators can schedule private meetings with an agenda and an existing Google Meet URL. **Calendar** opens Google Calendar with the meeting details; **ICS** downloads a calendar event. The site does not create a Google Meet room or add the event to anyone's Google account automatically.

The `club-documents` bucket is private. Downloads use short-lived signed links, and each uploader stores files under their own user ID. Every signed-in club member can access shared files; do not upload a file intended only for founders. The founder room and its meeting links are restricted by row level security to founders and administrators.

## Publish on GitHub Pages

The included GitHub Actions workflow publishes the static site on each push to `main`. In **Settings → Pages**, use **GitHub Actions** as the publishing source if GitHub asks you to select one. The expected address is `https://turkson225.github.io/Turk-Innovation-CLUB/`. Check the **Actions** tab for the deployment result. The public site shell works before Supabase is configured; member actions become available after steps 1–4. If Actions deployment is unavailable in your repository, set **Deploy from a branch → main → /(root)** as a fallback.

For a local preview, run `python3 -m http.server 8000` from the repository root and open `http://localhost:8000/`.

## Operational notes

- The public repository exposes all static site code and `config.js`. Supabase RLS, not hidden JavaScript, controls database access. Verify RLS after any schema changes.
- The members directory, project data, course content, events and alerts are accessible only to authenticated club members. Public founder cards are deliberately public.
- The online indicator is approximate, not a surveillance or attendance record. It means a member's open tab updated `last_seen_at` recently; background tabs, network loss and browser shutdowns can delay a change.
- For invite-only membership, turn off public signup in Supabase Auth and invite members administratively; otherwise anyone able to receive an email can create an account. Before public launch, decide the membership admission process.
- There are no push notifications, automatic news ingestion, Google Calendar account integration or built-in video meetings. Google Meet is an external link supplied by an organizer; "Add to calendar" prepares an event in the member's Google Calendar.

## Platform roles

| Role | Abilities |
| --- | --- |
| Visitor | Public home and founders pages |
| Member | Profile, directory and presence; projects and tasks on owned projects; discussions; read courses, events and alerts |
| Founder | Member abilities plus private founder meetings after accepting an invitation |
| Administrator | Member abilities plus publish founders, courses, events and alerts; create channels, review news and invite founders |

## References

- [Supabase passwordless email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [GitHub Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
