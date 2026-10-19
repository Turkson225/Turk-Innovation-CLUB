# SPACE metrics and chat insights

## Activate once

In your existing Supabase project, open **SQL Editor → New query**. Copy and run the **entire** `supabase/upgrade_space_metrics.sql` file, including its `begin;` and `commit;` lines. Run it after the learning dashboards and officer/finance migrations. Order charts also require the shop migration. This is a read-only feature migration: it adds one aggregate function and two supporting indexes, without changing existing access policies or records. It is safe to rerun.

Reload SPACE. Open **Metrics & progress** below the page heading on Home, My learning, Teaching studio, a classroom, Inventory, Orders, Admin overview or Finance. The visible scope follows the page and your role. In DMs, use the small bar-chart **Insights** button beside “Your conversations” for your inbox or in the conversation header for that pair. Team chat has the same button in its channel header.

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
| Direct messages | Only conversations the viewer participates in | Sent/received messages, unread within the period, the viewer’s median reply gap, direction comparison and daily activity |
| Team channel | The selected channel under existing RLS | Non-deleted messages, distinct authors, thread replies, messages with images, threads/replies and daily activity |

Periods are **7, 30 or 90 UTC calendar days including today**, whose counts are partial. Snapshot cards explicitly include all dates or say “current.” Zero days are included in daily charts. Current status charts do not reconstruct past state transitions. A percentage or median without a denominator/sample displays **—**, rather than a misleading zero. Exact values are available below every chart.

The learning completion share is completed enrollment rows divided by all enrollment rows in the chosen scope. Submission charts count attempts, not distinct students or assignments; resubmissions are separate attempts. A completion chart counts recorded workshop completions, not every lesson check-off.

Reply gap uses the difference between a message and the immediately preceding message in the same conversation when the sender changes to the viewer. Both timestamps must be inside the selected period. Consecutive outgoing messages are not separate replies. Time away and overnight are included. This is a descriptive interval, not a promise or response target. It does not report the other person’s reply time or their private read positions. Unread within the period can differ from the all-time inbox badge.

Inventory counts records/item types; quantities in metres, pieces, litres and other units are never summed. Finance includes only entries with an approved review and uses transaction dates. Net movement is not the closing balance. Shop paid order value uses creation-date cohorts and current payment flags; it is not cash collected on those dates. It is never added to ledger income, which could count linked purchases twice.

## Privacy and loading

`space_metrics(text, integer, uuid)` is **SECURITY INVOKER** with an empty search path and existing table RLS. It verifies approval, rejects investors and unapproved accounts, requires administrator access for membership/finance, and checks teacher ownership/class enrollment for a target classroom. DM queries explicitly require the caller to be one of the participants. An administrator cannot select another pair’s conversation. The response contains aggregate values and definitions; it contains no message bodies, application answers, names, email addresses, file paths or participant IDs.

Panels are collapsed until opened, including on phones. Chat charts use a separate scrollable modal rather than consuming message space. Requests are aggregated in PostgreSQL, independently of screen pagination or the API row limit. They are deduplicated, time out after twelve seconds and reuse account-scoped in-memory results for sixty seconds. Refresh has a three-second guard against repeated clicks. There are no dedicated polling timers, analytics trackers, external chart services or private offline caches. Leaving a page/peer, signing out or changing account guards against late results. Sign-out clears results and closes insights.

Dark/light colors follow SPACE’s tokens. Bar lengths start at zero; exact counts do not depend on color. Daily marks have focus/hover tooltips, and tables provide the full dates and counts. Loading animation respects reduced-motion preferences.

## Verification and limits

Run `node scripts/check_space_metrics.mjs` for real controller/renderer code under DOM/network doubles. Run `SPACE_PGLITE_MODULE=/path/to/@electric-sql/pglite node scripts/check_metrics_database.mjs` for disposable PostgreSQL checks using the existing 2,000-account fixture and application migrations/RLS. No test contacts the live database or uses real messages.

These checks verify calculations, role access, counts exceeding 1,000 rows, periods, reply samples, account isolation, timeout/error handling and integration. Browser/device layout, live Supabase execution plans and production throughput require separate checks. The frontend can be published before the migration; activation still requires running it in Supabase.
