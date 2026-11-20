# Metric trends in SPACE

Apply [the full metric trends migration](../supabase/migrations/20261119010000_metric_trends.sql) in Supabase SQL Editor after the university chapters and chapter operations migrations. Deploy the matching site version and reload SPACE. This adds read-only reporting functions and indexes; it does not change any records, roles or approval policies. GitHub Pages does not apply the migration. The site explains when a chart is awaiting setup.

| Where to open a chart | What it shows |
| --- | --- |
| Chapter Control Centre, a chapter dashboard or a chapter office | Dated join requests, recorded membership approvals and restorations, original activity publications, and task assignments and completions in the available scope. Administrators can see the network; coordinators see their own chapters; other officers see tasks assigned to them in their current offices. |
| My learning, Teaching studio and a classroom → Metrics & progress | Enrolments, submission attempts including resubmissions, and recorded completions. Learners see their own records. Teachers see workshops assigned to them. |
| Inventory → Metrics & progress | Stock records created. Founders and administrators can also view checkout and return records. These count records, so unlike units are never added together. |
| Orders or Order desk → Metrics & progress | Orders placed and orders collected, by their separately recorded dates. Members see their own orders; administrators can see all. These are order counts. |
| Finance reports → Open month → Activity trends | Approved income and expenses grouped by transaction date, for administrators and assigned club treasurers with report access. The trend date filter is independent of the monthly report. |
| Metrics & progress → Open manual records → View trend | The latest corrected observation in each period for the selected metric name, recorder, unit, and workshop. Shows the recorded value and any target. An unrecorded period is blank; zero is shown when recorded. |
| Admin overview, Applications and Finance | Existing membership and approved finance analytics keep their daily, monthly and annual filters. |

Open **Activity trends**, choose **Daily**, **Monthly** or **Annual**, optionally change **From** and **Through**, then select **Apply period**. The presets cover the last 30 days, 12 calendar months or five calendar years through today in UTC. Manual trends default through their selected observation date. The maximum custom range is 366 days with daily grouping or less than ten years with monthly or annual grouping. Use a cursor, tap, or focus the graph and use the arrow keys to inspect a period. Expand **View exact values** for the data table.

Automatic charts fill empty periods with zero when no matching record exists. They show the total, peak and a comparison of the two latest complete periods. The current day, month or year, and any periods cut short by the date filter, are marked as partial and excluded from that comparison. Manual charts use observations only; they do not sum observations or fill gaps. Snapshots such as members pending now, current stock and open tasks are labelled separately. Chapter publications remain in dated aggregates after archiving. The charts use available records and do not recreate unrecorded history.

Run `npm run check:metric-trends` for synthetic database and interaction checks. The tests verify calendar grouping, browser interactions and scope restrictions without querying live member data.
