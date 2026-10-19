# SPACE metrics

## Activate once

In your existing Supabase project, open **SQL Editor → New query**. Copy and run the **entire** `supabase/upgrade_space_metrics.sql` file, including its `begin;` and `commit;` lines. Run it after the learning dashboards and officer/finance migrations. Order charts also require the shop migration. This is a read-only feature migration: it adds one aggregate function and two supporting indexes, without changing existing access policies or records. It is safe to rerun.

Reload SPACE. Open **Metrics & progress** below the page heading on Home, My learning, Teaching studio, a classroom, Inventory, Orders, Admin overview or Finance. The visible scope follows the page and your role. Metrics controls are removed from DMs and team channels; opening chat sends no metrics requests.

If setup is missing, the panel explains that metrics await administrator setup. No migration is applied automatically by GitHub Pages. This message does not prevent normal chat, learning or order activity.

## What is measured

| Surface | Population | Metrics and charts |
| --- | --- | --- |
| Administrator Home / Admin / Applications | All account categories, administrator only | Current approved/pending accounts, accounts created during the period, approved accounts last seen in seven days, current application statuses and daily account creation |
| Member Home / My learning / classroom | The signed-in learner’s enrollments and work | Current active/completed enrollments, completed share, current review status of submission attempts created in the period and daily workshop completions |
| Teacher Home / Teaching studio / managed classroom | Workshops the teacher instructs; administrators may view all | Distinct enrolled learners, current active/completed enrollments, completed share, submission attempt status and daily completions |
| Inventory | Existing club-visible stock records | Current item types, low-stock types, types checked out, types needing repair and stock records by item type |
| Administrator Finance | Approved ledger entries, administrator only | Income, expenses, net movement and approved transaction count for transaction dates in the period |
| Orders / administrator Order desk and Shop management | Member’s own purchases; administrator sees all | Orders created in the period, their current fulfilment status, delivered count and currently paid non-cancelled value |

Periods are **7, 30 or 90 UTC calendar days including today**, whose counts are partial. Snapshot cards explicitly include all dates or say “current.” Zero days are included in daily charts. Current status charts do not reconstruct past state transitions. A percentage or median without a denominator/sample displays **—**, rather than a misleading zero. Exact values are available below every chart.

The learning completion share is completed enrollment rows divided by all enrollment rows in the chosen scope. Submission charts count attempts, not distinct students or assignments; resubmissions are separate attempts. A completion chart counts recorded workshop completions, not every lesson check-off.


Inventory counts records/item types; quantities in metres, pieces, litres and other units are never summed. Finance includes only entries with an approved review and uses transaction dates. Net movement is not the closing balance. Shop paid order value uses creation-date cohorts and current payment flags; it is not cash collected on those dates. It is never added to ledger income, which could count linked purchases twice.

## Privacy and loading

`space_metrics(text, integer, uuid)` is **SECURITY INVOKER** with an empty search path and existing table RLS. It verifies approval, rejects investors and unapproved accounts, requires administrator access for membership/finance, and checks teacher ownership/class enrollment for a target classroom. The legacy database chat aggregates remain participant/RLS restricted but are not requested by the chat interface. No new SQL migration is required to remove the chat controls. The response contains aggregate values and definitions; it contains no message bodies, application answers, names, email addresses, file paths or participant IDs.

Panels are collapsed until opened, including on phones. Requests are aggregated in PostgreSQL, independently of screen pagination or the API row limit. They are deduplicated, time out after twelve seconds and reuse account-scoped in-memory results for sixty seconds. Refresh has a three-second guard against repeated clicks. There are no dedicated polling timers, analytics trackers, external chart services or private offline caches. Leaving a page/peer, signing out or changing account guards against late results. Sign-out clears results and closes the manual-record editor.

Dark/light colors follow SPACE’s tokens. Bar lengths start at zero; exact counts do not depend on color. Daily marks have focus/hover tooltips, and tables provide the full dates and counts. Loading animation respects reduced-motion preferences.

## Verification and limits

Run `node scripts/check_space_metrics.mjs` for real controller/renderer code under DOM/network doubles. Run `SPACE_PGLITE_MODULE=/path/to/@electric-sql/pglite node scripts/check_metrics_database.mjs` for disposable PostgreSQL checks using the existing 2,000-account fixture and application migrations/RLS. No test contacts the live database or uses real messages.

These checks verify calculations, role access, counts exceeding 1,000 rows, periods, reply samples, account isolation, timeout/error handling and integration. Browser/device layout, live Supabase execution plans and production throughput require separate checks. The frontend can be published before the migration; activation still requires running it in Supabase.
# Colours, proportions, insights and manual measurements

The enhanced interface uses stable colours for statuses and categories, with direct labels and exact-value tables. Membership status, inventory item types, order status and DM direction default to **doughnut-style pie charts**; use **Bars** for a precise length comparison. A slice's denominator is the sum of the visible mutually exclusive categories. Empty totals do not manufacture a 100% slice. Finance income/expenses remain bars because these are flows, rather than pieces of an accounting balance. Daily activity remains a time chart. Dark and light themes have separate palettes.

**At a glance** shows factual observations derived from the current filtered data: applications waiting for approval, attempts awaiting feedback/revision, completed enrollment share, low stock/repair counts, approved net movement, in-progress orders and daily peaks. It does not call an AI service, infer causes, forecast growth or invent a comparison period. Labels retain the difference between snapshot and period metrics; lack of records is not described as poor performance.

## Activate manual measurements

After the original metrics migration above, run the entire **`supabase/upgrade_manual_metrics.sql`** file in Supabase SQL Editor. No new key, Auth setting or paid service is required. Colours, pie charts and calculated insights use the original metrics API; only saved manual observations require this additional migration.

Administrators can select **Open manual records** inside their non-chat metrics panels. Teachers can open it in Teaching studio to view their records, and in an assigned workshop's classroom to add a measurement. Members and investors cannot create or read these operational observations. A teacher sees only observations they own for courses they still teach; administrators see all. A teacher cannot correct an administrator's separately owned observation. An administrator's correction to a teacher-owned observation preserves that ownership and both authors in the database.

Record a metric name, unit (**count, hours, percent or GHS**), actual value, observation date and source, plus an optional positive target and note. Examples include an attendance count from a signed register, hours recorded in a practical log, outreach contacts counted offline or an operational budget target. These are **self-reported observations**, not verified attendance or approved financial transactions. They remain separate from automatic totals and never update enrollments, stock, payments or the ledger. Counts must be whole numbers; percentages cannot exceed 100. Actual zero is valid. Source and date are required. Future observation dates are rejected; the target is an optional planning value recorded on the observation date.

The manual card compares a recorded value with its optional target, using the same unit; percentage differences are labelled as percentage points. Values from different observations/units are not added together. The date filter selects observations, while **History** includes the selected record's revisions across all dates. Lists and history paginate in batches of 20. Corrections are new immutable rows; **Correct entry** preserves the original source, values, author and timestamps in History. Concurrent corrections to an outdated version are rejected. Save retries reuse a client token to avoid duplicate observations. After an uncertain timeout, check the record list or retry the unchanged form before entering a new measurement.

All manual APIs recheck current approval and workshop ownership. Direct table writes are denied, including to administrators; the save function validates the permitted fields. Reads retain RLS. Sources, notes, labels and chart captions are treated as text. The editor closes on account/role/page changes and does not save drafts or observations in browser storage. Keep `space_manual_metrics` in database backups alongside the other public application tables. No new file bucket is involved.
