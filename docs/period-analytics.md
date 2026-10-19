# Administrator period analytics

## Activate

Run the **whole** [`supabase/upgrade_analytics_periods.sql`](../supabase/upgrade_analytics_periods.sql) file in Supabase SQL Editor. It requires the existing profile, inventory/finance and finance-review upgrades; it is independent of the manual-metrics migration. It is safe to rerun. It adds two read-only functions and two indexes, with no new key, paid service or Auth setting. Publishing GitHub files does not run SQL on Supabase.

After the updated site is deployed, reload SPACE. Administrators open **Member growth** on the administration/applications page, or **Finance trends** on Finance. These sections load only when expanded. Members, teachers, founders and investors cannot request the new analytics APIs, even with a forged client request.

## Explore

- Choose inclusive **From / Through** dates in **UTC**, then **Days**, **Months** or **Years**. Select **Apply period**. Editing a filter does not change the displayed chart until applied.
- Days allow up to 366 periods. Longer windows require months or years. The maximum window is less than ten years. Presets cover 30 days, this year and the current year plus four previous years.
- Empty periods remain present as zero. First and last month/year buckets are clipped to the requested dates, visible in tooltips, the exact table and CSV. Today is a partial day.
- Toggle coloured series to compare them. At least one stays visible. Hover or tap a point, or focus the chart and use Left/Right/Home/End to inspect periods. Keyboard selections announce values. The exact table is an alternative to the visual chart. Small screens can scroll the plot horizontally while retaining readable labels.
- **Refresh** requests fresh figures. Successful queries are cached in account-scoped memory for up to one minute. No analytics/profile export is saved in browser storage. Account, permission and page changes invalidate outstanding responses.

## Definitions

| View | Date basis | Measures |
| --- | --- | --- |
| Member growth | Profile `created_at` in UTC | Sign-ups grouped by **current** member/teacher/founder/investor/admin role; default includes currently approved accounts, with an **All sign-ups** option |
| Finance trends | Ledger `occurred_on` date | Approved income and expenses, separate overlapping areas on one zero-based GHS axis |

Membership cohorts are **not approval-event history**. A later approval or role change can reclassify an earlier sign-up. The KPI cards cover all current roles; toggles affect only the chart, its exact table and chart CSV. They do not change the member-record export filter. Private application answers, email addresses and chat contents are excluded.

Finance joins only reviews whose decision is approved; pending/rejected entries do not count. Net movement is period income minus expenses. Opening balance is the signed sum of approved entries before the selected start; closing adds the selected period. These are recorded-ledger balances, not independently verified bank balances. Manual observations, shop order values and targets are not mixed into the ledger. Areas overlap and are not stacked. The existing monthly approved-finance report remains available for ledger-detail downloads.

## CSV

**Download chart CSV** includes every bucket, zeros, the selected visible series, filter dates, grouping and generation timestamp. Finance amounts are GHS. **Download member records CSV** includes every matching account across all roles: ID, name, handle, current role/status and sign-up time, plus export filters and creation cutoff. It pages by `(created_at, id)` in batches of 500 rather than relying on the default API row limit.

Every export page rechecks administrator access. A creation cutoff excludes subsequent sign-ups; it does **not** freeze later name/role/status edits. Changed counts, duplicate IDs or failed requests stop the download instead of silently producing a partial file. This export is not an atomic snapshot or a database/storage backup. If data changes during export, refresh and retry. UTF-8 BOM and CSV quoting retain Unicode, quotes and line breaks; formula-like text is prefixed for spreadsheet safety. Negative numeric finance amounts remain numbers.

## Implementation and verification

These are **original, buildless SVG/JavaScript charts**, inspired by the requested grouped-bar and area/crosshair interactions. React Bits Pro blocks are not installed: this project has no React build or configured licence key. No paid source was retrieved, no registry was bypassed and no licence key was embedded in public assets.

Both RPCs use `SECURITY INVOKER`, an empty search path, explicit administrator checks and the existing table RLS. Date bounds and export page sizes are validated on the server. No table policies or write permissions are broadened. Aggregate counts run inside PostgreSQL, avoiding client row limits.

Run `node scripts/check_space_analytics.mjs` for production rendering/controller code under DOM/network doubles. Run `SPACE_PGLITE_MODULE=/path/to/@electric-sql/pglite node scripts/check_analytics_database.mjs` for real migrations/RLS against disposable PostgreSQL and 2,000 synthetic accounts. Checks cover leap days, timezone boundaries, grain reconciliation, zero buckets, current-status filtering, approved finance/decimal amounts, complete multi-page exports, role denial, retries, CSV escaping, crosshair/keyboard interactions and late responses after account/page changes.

These checks do not verify live Supabase deployment, production query latency or physical-device visual appearance. Browser QA was unavailable in this environment; a phone/desktop visual check remains necessary after activation.
