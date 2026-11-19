# Chapter control centre and offices

**Administration → Chapter control centre** shows all campuses from the same SPACE account. Select **Manage chapter** to see one campus's membership, publications and officer work. Existing chapters, members and activity listings are retained.

## Enable it

1. Back up the existing SPACE database. Verify that `20261118000000_university_chapters.sql` was applied; this update depends on the pilot and does not recreate its chapters.
2. Apply [`20261119000000_chapter_operations.sql`](../supabase/migrations/20261119000000_chapter_operations.sql) before publishing the frontend. On a dashboard-managed project, open the existing project, paste the entire file into **SQL Editor → New query**, and run it once. On a CLI-managed project, use your established tracked migration flow. Do not replay the fresh-database baseline on an existing project.
3. Publish the matching frontend and sign in as the central admin. No new credentials, storage bucket, or hosting project are needed. When prompted for recent administrator verification, complete it and retry the original change.

## Appoint people and assign work

1. Open **Administration → Chapter control centre → Manage chapter → People & roles**. Use the search if the campus has many members.
2. Approve club membership and chapter membership first. Pending chapter applications remain in the chapter's **People & applications** section, linked from the control centre.
3. Use **Chapter role** for the existing Member, Coordinator, Teacher and Secretary roles. This changes the person's primary chapter role. Existing coordinator, teacher and secretary roles already grant their matching local office.
4. Use **Edit office appointments** to add or remove deputy coordinator, secretary, treasurer, teaching lead, events lead, projects lead and communications officer. One person can hold more than one office. To remove an inherited Secretary office, change the primary chapter role as well as removing any separate Secretary appointment.
5. Use **Assign task** next to an officer, select the office, and enter the work and due date. The officer sees the assignment in **My chapter offices** and gets an in-app notification. Office appointments and chapter role changes also notify the member.
6. Officers submit a progress note from their work queue. The coordinator or central admin can mark submitted work complete or return it with a note. Completed and cancelled tasks retain their history. If an open task loses its assignee's access, management can cancel it with a reason and assign a replacement. Coordinators cannot complete their own work.
7. To change the chapter's name, description, or open/archive status, select **Open chapter → Edit chapter** as central admin.

Central admins control chapter role assignments. Coordinators supervise tasks and review membership within their campus. Other officers can see and submit only their own authorized office tasks; deputies do not inherit coordinator permissions. Local Treasurer is for chapter work such as budget notes; it does not open the club's finance ledger. Chapter offices give no club-wide role or private access to other chapters. If a chapter role or office is revoked, the person's office access stops; its records remain available to authorized leadership. Archiving makes the operations records read-only for central admins and closes local offices.

## Read the metrics

| Metric | Definition |
|---|---|
| Active and pending | Current eligible chapter memberships and applications, independent of the reporting period |
| New requests | Applications received within the selected rolling 30 or 90 days |
| Announcements, events, projects and workshops | Unarchived listings published within the reporting period; this does not measure attendance or course completion |
| Open and awaiting review | Current office tasks that are open or submitted |
| Completed | Tasks marked complete within the selected period |
| Overdue | Open or submitted tasks where the due date is before today (UTC) |
| Tasks without access | Open tasks whose assignee is no longer an eligible office holder |

The central network counts memberships, so a person in two chapters counts twice. Network totals include all campuses, including retained records from archived chapters. Drill down to see task counts by office and active chapter member. Officers see the same task definitions for their own work. Dashboard queries calculate the totals from live records; no manual entry or estimates are required.

## Pilot check

Create a separate test task for each of two campuses. Confirm that the admin can compare both and that each local officer can see only their own work. Submit one task, return it for changes, then complete it from a different authorized account. Compare the work queue and metrics before sharing with more members.

`npm run check:chapter-operations` runs SQL and UI checks with synthetic data. It does not connect to the production Supabase project.
