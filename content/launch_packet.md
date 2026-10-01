# SPACE practical launch packet

**Editorial status: draft.** These are ready-to-review lesson plans, not announced workshops, uploaded materials, booked events, active projects, stocked equipment, or approved public founder profiles. The administrator and a confirmed teacher must check every plan against the actual equipment, venue, duration, accessibility needs and safety arrangements before publication. The [starter programme](starter_workshops_and_projects.md) remains the source for the full project concepts; [launch_drafts.json](launch_drafts.json) has the fields laid out for the current site forms. Nothing in either file writes to Supabase.

## Publication sequence

1. An approved teacher or teaching-enabled founder claims each workshop. Agree on a location, capacity, start time, duration, project deadline and materials; review the safety notes below.
2. In **Teaching studio → Publish workshop**, copy the matching course fields from `launch_drafts.json`, enter the **confirmed** start and project deadline, and publish. If the administrator creates a course for a teacher, assign that teacher through the existing course assignment control. Confirm the assigned teacher can see the roster and upcoming deadline.
3. Turn the reviewed worksheet below into a PDF or DOCX with the facilitator's name, accessible text and the actual hardware list. In **Teaching studio → Upload learning material**, attach it to the published course as **worksheet**. Slides may follow the suggested slide outline; upload them as **slides** only after technical review. Do not add attendance names or private learner work to the shared file.
4. In **Events → Schedule event**, create the matching event using the **confirmed** start and end, venue or Google Meet URL. Ensure the event and workshop show the same timezone and date. A Meet link is optional; add it only after an authorized organizer has created or approved the meeting.
5. An approved member claims a project brief in **Projects → New project**. They enter the agreed scope and maintain its tasks and milestones. Keep its status at **planning** until work actually begins, and publish work photos or results only with consent.
6. Obtain and record a founder's permission for the exact name, role, bio, profile link and public photo separately. The administrator then publishes or edits the public Founders card. Founders' account role is separate from the public card.

## Four workshop teaching plans

Use these plans as a one-session baseline; adjust time and group size when the teacher and venue are confirmed. Each learner submits their own build notes and evidence through the course journey. A teacher reviews and requests a revision or records completion against the stated outcome. No certificate or measured result is promised in advance.

### Controls and Automation — Feedback controller for a small fan

**Build outcome:** A low-voltage temperature sensor changes a DC fan or LED output around a chosen setpoint. The learner can show the difference between fixed output and sensor feedback.

**Suggested flow:** Identify component ratings and draw the circuit; check sensor readings against a reference; wire the output driver with power disconnected; log a fixed-output baseline; add on/off control with hysteresis; adjust the setpoint; test a disconnected sensor and restart. Use an LED instead of a fan if suitable parts are unavailable.

**Worksheet for the teacher to finalize:**

- Circuit voltage, fan/LED rating, driver rating and power source: ______
- Reference temperature and sensor reading at three points: ______
- Setpoint and hysteresis band: ______
- Test table: time / temperature / setpoint / output / observation. Include a fixed-output run and a feedback run.
- What happened when the sensor was disconnected? What is the safe default? ______
- Attach: wiring diagram or photo, annotated code, test table and one change made after a failed test.

**Completion review:** The measured readings are plausible against the reference; the output responds to the documented threshold; the log distinguishes fixed output from feedback; the learner explains a failure mode. The teacher verifies only protected low-voltage parts are used. No mains appliance is connected to a breadboard.

**Slide outline:** Problem and feedback loop → rated circuit and safe wiring → setpoint and hysteresis → measurement table → failure test → build evidence.

### Software and Programming — Sensor readings dashboard

**Build outcome:** A responsive dashboard parses timestamped sample readings, displays recent history and connection status, and warns when a user-selected threshold is crossed.

**Suggested flow:** Inspect the supplied sample CSV and its units; parse timestamps and numbers; show a current value and trend; chart recent samples; add stale-data logic and threshold controls; test empty, malformed and delayed data; review the dashboard at phone width. Use a simulated feed first; live hardware integration is optional.

**Worksheet for the teacher to finalize:**

- Source and licence of the sample dataset (or teacher-generated readings): ______
- Units, sample interval and timezone: ______
- Test cases: valid sample / empty file / malformed row / missing reading / zero reading / stale feed / threshold crossing / narrow display.
- For each case, note expected display, actual display and fix: ______
- Attach: code or repository link, desktop and mobile screenshots, alert example and a known limitation.

**Completion review:** The interface labels units and time; zero differs from missing; stale readings do not appear live; the threshold alert is reproducible; mobile layout is usable. The public demo contains no passwords, tokens or personal data.

**Slide outline:** Data contract → valid and missing readings → history chart → threshold and stale states → responsive demo → test evidence.

### Electronics and Robotics — Calibrate a line-following robot

**Build outcome:** A low-voltage two-motor prototype follows a marked line on a short course, with recorded sensor calibration and repeatable trials. A stationary sensor rig or simulator is an acceptable alternative when complete kits are unavailable.

**Suggested flow:** Label wires and build a pin map; check battery polarity and motor current; test motor direction with wheels lifted; record light/dark readings; choose thresholds; tune steering at low speed; run three trials on the same course; add a stop response when the line is lost.

**Worksheet for the teacher to finalize:**

- Controller, motor driver, battery and sensor ratings: ______
- Pin map and motor direction test: ______
- Light and dark readings for each sensor; threshold choice: ______
- Three trial table: course / speed / successful sections / failure point / adjustment.
- Lost-line behavior and stopping demonstration: ______
- Attach: circuit or pin map, calibration readings, three trial observations and short demonstration.

**Completion review:** The robot responds to the line or the equivalent rig demonstrates the same control logic; thresholds are grounded in readings; three comparable trials are recorded; a lost line stops the motion. Check safe charging and keep the test area free of people and loose cables.

**Slide outline:** Block diagram → component ratings and pin map → calibration → steering logic → trials → stopping and improvements.

### AI & Machine Learning — Classify device states

**Build outcome:** A small reproducible classifier or browser demo labels documented sensor records as “normal” or “needs inspection,” compares with a simple baseline, and states uncertainty and limitations.

**Suggested flow:** Define labels and obtain an authorized sample dataset; inspect missing values and class balance; split by session or device; establish a baseline rule; train one small model; report precision, recall and confusion matrix on held-out records; test an out-of-range reading; write cautious display copy.

**Worksheet for the teacher to finalize:**

- Dataset source, usage rights, feature units, label rules and personal-data review: ______
- Number of sessions/devices and examples in each class: ______
- Split method and reason records from the same session are kept together: ______
- Baseline versus model confusion matrices, precision and recall: ______
- Out-of-range test, uncertainty display, and limitation: ______
- Attach: notebook or code, dataset description, result table and limitations note.

**Completion review:** Code reruns from a documented dataset; held-out groups were not used for training; metrics are calculated correctly; the demo labels uncertainty and does not claim safety certification. Remove personal data and do not use the output to make safety-critical decisions.

**Slide outline:** Problem and labels → dataset provenance → leakage-resistant split → baseline → confusion matrix → limitations and demo.

## Matching event briefs

Create these in **Events** only after the course, teacher, start/end time and venue are confirmed. The form requires both start and end; it rejects an end before the start. A project deadline belongs on the workshop schedule, not as an invented event.

| Draft event title | Description focus | Required confirmations |
| --- | --- | --- |
| Build session: Feedback controller for a small fan | Low-voltage sensor and actuator build; bring a laptop if available. | Teacher, equipment, safety, location, start, end, capacity |
| Build session: Sensor readings dashboard | Build and test a dashboard from a documented sample dataset. | Teacher, dataset rights, laptop access, location or Meet, start, end |
| Build session: Line-following robot | Calibrate sensors, run repeated low-speed trials and show a safe stop. | Teacher, kits or simulator, safe test area, location, start, end |
| Build session: Device-state classifier | Train a simple model and report a held-out evaluation against a baseline. | Teacher, dataset rights, laptop access, location or Meet, start, end |

## First two project openings

The concepts in the starter programme are suitable calls for volunteers, **not active projects yet**. For the energy bench, recruit an owner plus a measurement reviewer; use only low-voltage test loads and document calibration. For the inventory scanner, recruit an owner plus an administrator to review permissions; keep all early scans on sample records. Each owner can create the project and add the first three tasks from `launch_drafts.json`. A real task assignee and due date are added only after that person agrees.

## Facts needed before publication

| Item | Provide or confirm | Who acts |
| --- | --- | --- |
| Each of four workshops | Approved teacher/founder, their course assignment, confirmed start and deadline, length and capacity, venue or online method, equipment and safety review | Teacher and administrator |
| Learning files | Reviewed worksheet/slides, attribution or dataset rights, accessible file, no secrets or private learner data | Teacher |
| Matching events | Real start/end in local timezone, venue or authorized Meet link, attendee instructions | Administrator |
| Each project | Approved member owner, agreed scope, collaborators, first tasks and safe test resources | Owner and administrator as needed |
| Each founder profile | Exact name/role/bio/link, written public portrait permission if a photo is used, approved image and removal contact | Founder and administrator |

When these are confirmed, publish one workshop and event at a time and check them in a member account. Do not call the four plans “scheduled” or the two concepts “active” before records and real participation exist.
