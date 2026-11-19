# SPACE platform tours

When an approved member first opens **Home** or **My learning**, they can choose **Start tour**. The new member tour shows how to choose tracks, find a university chapter, check the calendar, and use the feed and notifications. It remains available under **Getting started → Platform tours** alongside the existing welcome checklist.

A role update still has its existing acknowledgement and workspace actions. **Explore my role guides** links to the available tours. A member with an active assignment can also find a tour prompt on the corresponding teaching, leadership or office page.

| Current access | Tour |
| --- | --- |
| Member | Learning tracks, chapters, calendar and member activity |
| Teacher or founder with a current club-wide teaching assignment | Profile, workshops, files, reviews and course completion |
| Founder, administrator or investor | The appropriate leadership or partner tools |
| Club officer | The role’s work desk and duties; approved reports for the club treasurer |
| Chapter office holder | The selected campus’s duties, work queue and resources; separate guides for each active office |

A tour offers **Back**, **Next**, and a link to open the related page. On that page, **Next tour step** continues the walkthrough. **Close tour** saves the current position and **Not now** removes the prompt for that guide. Completed and hidden guides can be opened again from **Getting started**. Progress stays in this browser, separately for each signed-in account and each guide.

Tours read existing account permissions and the current user's existing chapter-office list. They never assign a role, acknowledge a notice, join a chapter, create a task or grant access to a page. The existing role and chapter releases must be active for their pages; no new Supabase migration is required for tours.

Run `node scripts/check_space_tours.mjs` for the guide catalogue, scope, navigation, persistence and account transition checks.
