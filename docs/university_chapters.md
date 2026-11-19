# Pilot university chapters in SPACE

TURK INNOVATION CLUB keeps one SPACE site and one account per person. **Community → University chapters** is the new signed-in directory. Each open chapter has a stable link, such as `#chapters/ttu`. Only approved club accounts can use the directory. Investors retain their own workspace.

## Enable the pilot in Supabase

1. Confirm the existing administrator authenticator flow and the security hardening migration from [Security hardening](security_hardening.md) are active on the target project.
2. Back up the database and test the new migration on a disposable or staging database first. The migration is additive: it creates the chapter tables and RPCs and leaves existing members, courses, certificates, finance, chat and applications in place.
3. Apply the complete [university chapters migration](../supabase/migrations/20261118000000_university_chapters.sql). Use the established versioned migration workflow if the project already tracks migrations. For a project managed through the dashboard, paste the entire file into **Supabase → SQL Editor → New query** and run it as one query. Do not replay the legacy baseline on a live project.
4. Publish the matching SPACE frontend. GitHub Pages deployment does not update Supabase. If the frontend is released before the SQL, the new screen displays a setup message until the migration is in place.
5. Sign in as the central admin. If asked to verify your authenticator again, complete that check and retry the action.

No new keys, secrets, bucket, trigger outside the database, or hosting project are required.

## Create a chapter and appoint the first leader

1. Open **Community → University chapters → New chapter**.
2. Enter the chapter name, university, a short lowercase link name such as `ttu`, and a directory description. Use **Draft** until the chapter is ready. Use a university name on a chapter only when the club is ready to represent that relationship.
3. Edit the chapter, set its status to **Open**, and save. Share its link with approved SPACE members. People with a pending SPACE account still need the regular club approval first.
4. Ask the intended coordinator to open the chapter from their own account and choose **Request to join**. Open **People & applications → Pending** in your admin account and approve them.
5. In **People & applications → Active**, use **Assign chapter role → Coordinator**. Repeat the request and approval flow for additional teachers and officers. Assigning a chapter role does not change a person's club-wide role.

In the pilot, there is one role per account **per chapter**. A person can be a teacher in one and a member or coordinator in another. A coordinator can also post workshop listings for their chapter. A secretary is a chapter designation; the existing club-wide secretary workspace is a separate permission.

## Run the first chapter

- **Central admin:** create, open, update and archive chapters; manage chapter membership and assign local roles. Creation, chapter status changes and membership/role administration require recent authenticator verification.
- **Coordinator:** review ordinary membership requests, remove and restore ordinary members' chapter access, and post or update announcements, events, projects and workshop listings in their chapter. Central administrators manage staff roles and staff access.
- **Teacher:** post and update their own workshop listings for that chapter using the four existing learning tracks.
- **Approved chapter member:** view that chapter's activities. Applicants can view the chapter description and their own request status while waiting. Member names in the approval roster are visible only to authorized chapter leadership.
- **History:** the admin can archive a chapter to stop new joins and writes without deleting its records. Active members of an archived chapter can still view its existing listings. New chapters and changing campuses do not move or delete legacy learning records.

Chapter content is scoped on the server. It is not part of the club-wide search, calendar or exports in this release. Current finance workflows remain central. Workshop and project listings do not yet have chapter-specific submissions, enrollment, attendance, certificates, task boards, or file uploads. Chat, Google Forms, welcome emails and finance are not connected to chapter membership in the pilot.

## Verify the pilot before sharing broadly

1. Create a draft and an open chapter as admin. A regular approved member should see only the open chapter.
2. Have the same member apply to two chapters. Approve one request. Confirm their dashboard opens local activity only for the chapter that approved them.
3. Assign a coordinator in one chapter and confirm they can review local applications but cannot review the other chapter or assign global roles.
4. Post a chapter announcement, an event with an accurate start time, and a workshop. Check them with a member and an account without chapter membership.
5. Archive a test chapter and confirm new applications are unavailable and current members can still see existing listings.

Run `npm run check:chapters` for database and browser-module checks against synthetic accounts. These checks do not connect to the live Supabase project or change the live site.
