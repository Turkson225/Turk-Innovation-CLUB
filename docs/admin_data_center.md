# SPACE Data Center

Open **Administration → Data Center**. An approved administrator with the usual authenticator verification can see the dataset catalogue. Browsing and exporting data requires a recent authenticator verification (the existing 15-minute window). A prompt can appear again during a long export; if it does, restart with a narrower filter. In-app changes still take place in their original areas, such as Finance, Teaching studio or Membership approvals.

| View | What it contains | When to use it |
| --- | --- | --- |
| Current records | Selected operational fields from the live tables, including records created before Data Center was installed. | Inspect or export members, enrollments, submissions, grades, courses, chapters, projects, events, inventory, finance, shop orders, moderation and other club records. |
| Change history | Additions, removals and changes to selected fields after activation. Includes time, affected record, fields changed, selected before/after state and the authenticated actor if available. The unfiltered view also records Data Center views and export requests. | Investigate what changed or when a record was removed. An export audit entry confirms a request, not a completed download. |
| Daily activity | Daily counts by dataset and operation for completed UTC days after activation. Includes counts of chat, notifications, reactions and other high-volume actions. No names, account IDs, message contents, coordinates, files or credentials. | Compare activity over time, build charts, or use as an input for aggregate model experiments. Counts measure recorded database operations, not visits or unique active members. |

For each view, select a dataset and UTC date range, then **Load records**. Use **Export CSV** for spreadsheet analysis or **Export JSON** for notebooks and other tools. Exports fetch the whole selected result in cursor pages. Results above 30,000 rows fail with guidance to split the export by date or dataset. Some records, such as order line items, have no record date; the UI says when the date filter does not apply. Current-record exports read live data rather than a point-in-time snapshot; if edits are ongoing, run exports in a quiet window when consistency matters.

The table and column catalogue is fixed on the server. It includes roles and core operations without storing passwords, private message bodies, contact and payment details, private application responses, exact member locations, tokens or file contents in Data Center. It doesn't collect keystrokes, browsing history, or hidden user activity. Private message and notification changes are counted without identifying their participants; counts can include retries and edits if the database committed them. Aggregate output is provided for analysis, not automatically sent anywhere or used to train a model. Check whether very small groups are appropriate before sharing aggregate results outside the club.

## Activate on an existing project

1. Apply the earlier migrations for the features installed in SPACE. In **Supabase → SQL Editor**, run the complete [Data Center migration](../supabase/migrations/20261124000000_admin_data_center.sql). Rerunning it preserves the existing history. It does not create artificial history for earlier dates.
2. Deploy the matching site update. Use an approved administrator account to open **Administration → Data Center**, load Members, and export a short date range. A regular member must not be able to open the route or call its database functions.
3. Make a test change to a project or equipment record, then confirm it appears in Change history. The Daily activity view intentionally starts showing that day's totals after the UTC day has ended.
4. Keep database and uploaded-file backups separately; a Data Center export does not include credentials, full database state or file bytes. Follow [Backup and recovery](backup_restore.md). Future change history grows with use. Review database usage after onboarding and set a retention policy appropriate to the club before it becomes large. This migration does not silently delete historic events.

## Technical checks

`node scripts/check_data_center_database.mjs` installs the tracked migrations on a disposable PostgreSQL engine, tests authentication and MFA, verifies existing-row exports and keyset paging, and checks that changes are transactional and private content stays out of daily aggregates. `node scripts/check_data_center_ui.mjs` tests navigation, pagination, CSV handling, step-up responses and cancellation on account switch. These are local checks; confirm the behavior on the deployed test project before using live data.
