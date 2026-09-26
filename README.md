# InnovateX Engineering Club platform

A responsive club workspace for a TTU engineering community. The site is static and can be hosted on GitHub Pages. Supabase provides email sign-in and a database protected by row level security.

## What is included

- Public home and founders pages. Founder names remain placeholders until approved profiles are added.
- Email magic-link sign-in and sign-out, member profiles and an online indicator based on a recent heartbeat. Sign-out clears the member's presence; disconnected users disappear from "online" after about 65 seconds.
- Project cards, progress, tasks and discussion threads.
- Administrator-published courses, alerts and events. Events can include Google Meet links and open in Google Calendar or download as an ICS file.
- Phone, tablet and desktop layouts. Untrusted member text is escaped before display.

## Set up Supabase

1. Create a Supabase project and open **SQL Editor**. Run [`supabase/schema.sql`](supabase/schema.sql) once. Use a new project or review existing schema before running it.
2. In **Authentication → Providers → Email**, enable email sign-in. For magic links, use Supabase's magic-link email template. Configure production SMTP when you are ready for wider membership; the built-in email sender is limited.
3. In **Authentication → URL Configuration**, set the Site URL to `https://turkson225.github.io/Turk-Innovation-CLUB/`. Add that exact URL to Redirect URLs. For local testing, add `http://localhost:8000/` as another Redirect URL.
4. In **Project Settings → API**, copy the Project URL and the **publishable / anon** key into [`config.js`](config.js). These values are designed for browser use. **Never paste a service_role or secret key** into the repository.
5. Sign in at least once. Then, in SQL Editor, promote your specific user to an administrator using the authenticated user's UUID from **Authentication → Users**:

   ```sql
   update public.profiles set role = 'admin'
   where id = 'YOUR-AUTH-USER-UUID';
   ```

   Check that exactly one row changed. The browser cannot promote accounts. An administrator can publish founder bios, courses, events and alerts. Other members can create projects and discussions.

6. Add the founding team only after they agree to have their name and biography shown publicly. The Dean's patronage is an invitation pending acceptance, so the interface does not claim it has been granted.

## Publish on GitHub Pages

The included GitHub Actions workflow publishes the static site on each push to `main`. In **Settings → Pages**, use **GitHub Actions** as the publishing source if GitHub asks you to select one. The expected address is `https://turkson225.github.io/Turk-Innovation-CLUB/`. Check the **Actions** tab for the deployment result. The public site shell works before Supabase is configured; member actions become available after steps 1–4. If Actions deployment is unavailable in your repository, set **Deploy from a branch → main → /(root)** as a fallback.

For a local preview, run `python3 -m http.server 8000` from the repository root and open `http://localhost:8000/`.

## Operational notes

- The public repository exposes all static site code and `config.js`. Supabase RLS, not hidden JavaScript, controls database access. Verify RLS after any schema changes.
- The members directory, project data, course content, events and alerts are accessible only to authenticated club members. Public founder cards are deliberately public.
- The online indicator is approximate, not a surveillance or attendance record. It means a member's open tab updated `last_seen_at` recently; background tabs, network loss and browser shutdowns can delay a change.
- For invite-only membership, turn off public signup in Supabase Auth and invite members administratively; otherwise anyone able to receive an email can create an account. Before public launch, decide the membership admission process.
- This first version has no file uploads, push notifications, Google Calendar account integration or built-in video meetings. Google Meet is an event link supplied by an administrator; "Add to calendar" prepares an event in the member's Google Calendar.

## Platform roles

| Role | Abilities |
| --- | --- |
| Visitor | Public home and founders pages |
| Member | Profile, directory and presence; projects and tasks on owned projects; discussions; read courses, events and alerts |
| Administrator | Member abilities plus publish founders, courses, events and alerts |

## References

- [Supabase email sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithotp)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [GitHub Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
