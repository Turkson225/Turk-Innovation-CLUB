# SPACE starter programme — editorial draft

**Status: planning copy, not a record of scheduled workshops, stocked equipment, active projects, results, founders, or completed work.** An approved teacher and club administrator should check the materials, facilitator, venue, date and safety plan before publishing anything. The four titles below match the platform's learning tracks and can be entered using **Teaching studio → Practical workshop**. Leave the start date empty until a date is confirmed. Upload a worksheet or slides to the related course only after someone has checked them.

## Four practical workshop drafts

### 1. Controls and Automation

- **Workshop title:** Build a feedback controller for a small fan
- **Learning track:** Controls and Automation
- **Level:** Beginner
- **What will learners build?** A low-voltage sensor-and-fan prototype that reads temperature, switches or adjusts its output based on a setpoint, and shows its current state. Demonstrate what changes when feedback is enabled.
- **Hands-on activities and tests:** Wire and identify the sensor and output; check sensor readings against a second thermometer; record baseline measurements; implement simple on/off control with hysteresis; change the setpoint; test sensor disconnection and restart behavior; compare open-loop and feedback behavior in a short test log.
- **Tools and materials:** Microcontroller, low-voltage temperature sensor, small DC fan or LED as a safe substitute, suitable driver, protected low-voltage power supply, breadboard, wires, computer, thermometer or recorded reference readings.
- **Evidence to collect:** Wiring photo, short code listing, table of setpoint versus measured temperature and output state, one failure test, and a short account of what was improved.
- **Facilitator review:** Verify voltage, current and driver ratings; never connect a mains-powered fan to a breadboard. Confirm the sensor/driver components are available before announcing the workshop.

### 2. Software and Programming

- **Workshop title:** Turn sensor readings into a useful dashboard
- **Learning track:** Software and Programming
- **Level:** Beginner
- **What will learners build?** A mobile-friendly dashboard that displays time-stamped readings, a recent history chart, connection status, and a clear alert when measurements cross a chosen threshold.
- **Hands-on activities and tests:** Start with a supplied sample CSV or simulated data; parse and validate timestamps and values; draw a history chart; distinguish missing data from a zero reading; add a threshold control; test stale readings, empty data and narrow screens; optionally replace sample data with a permitted microcontroller feed.
- **Tools and materials:** Browser and code editor, sample CSV or generated readings, optional ESP32 or equivalent and a suitable low-voltage sensor. No live hardware is required for the first session.
- **Evidence to collect:** Repository or exported source, screenshots at desktop and phone widths, example alert, short test list, and one stated limitation of the data.
- **Facilitator review:** Check that any public demo contains no private data, passwords or secret API keys. Choose the sample dataset before publishing.

### 3. Electronics and Robotics

- **Workshop title:** Calibrate and test a small line-following robot
- **Learning track:** Electronics and Robotics
- **Level:** Beginner
- **What will learners build?** A low-voltage two-motor robot that follows a marked line across a short test course, with measurements of sensor values and repeatable turns.
- **Hands-on activities and tests:** Map motor driver and sensor pins; check motor direction with the wheels lifted; measure sensor values over light and dark surfaces; choose thresholds; tune steering at a low speed; run three trials over the same course and record where tracking fails; add a stop behavior when the line is lost.
- **Tools and materials:** Small chassis, two DC motors and wheels, motor driver, microcontroller, line sensor array or two reflectance sensors, protected low-voltage battery, marked test surface, and a computer. Use a simulator or a stationary sensor rig when kits are unavailable.
- **Evidence to collect:** Pin map, calibration values, three trial observations, short demonstration and a change made after a failed run.
- **Facilitator review:** Confirm motor stall current, battery polarity and safe charging procedure. Keep moving tests clear of people and cables.

### 4. AI & Machine Learning

- **Workshop title:** Classify simple device states from sensor data
- **Learning track:** AI & Machine Learning
- **Level:** Beginner
- **What will learners build?** A small reproducible classifier that labels a documented set of simulated or collected device readings as normal or needs inspection, and explains when the prediction is uncertain.
- **Hands-on activities and tests:** Define the labels and collect or inspect examples; separate training and test data by session or device to reduce leakage; build a simple baseline rule; train one small model; compare precision, recall and a confusion matrix; test a reading outside the training range; show a cautious result in a demo screen.
- **Tools and materials:** Computer, Python notebook or accessible browser-based ML tool, documented sample dataset or permission to collect low-voltage sensor measurements. No costly cloud service is required.
- **Evidence to collect:** Dataset description and consent if applicable, baseline and model metrics on held-out data, confusion matrix, code/notebook, and a limitations note. Do not advertise a model accuracy figure before measuring it.
- **Facilitator review:** Remove personal data; do not use the output for safety-critical decisions. Confirm source and licence of any external dataset.

## Proposed cross-track project briefs

These are **ideas for members to claim and plan**, not entries to seed into `projects`: the database requires an approved member as owner. Once someone volunteers, that member can use **Projects → New project**, add tasks and milestones, and keep the status at `planning` until work starts.

### Prototype A: Instrumented low-voltage energy bench

- **One-line summary:** Visualize low-voltage device usage and explain anomalies through a dashboard.
- **Description and goal:** Define a safe low-voltage load, collect voltage and current readings with sensors appropriate to the circuit, and display power estimates and time history. First prove sensor scaling against a trusted meter, then compare normal operation with an intentionally disconnected or overloaded *test load within rated limits*. Document measurement uncertainty and alert behavior. The device should default to showing a fault when readings are missing.
- **Suggested first tasks:** Confirm circuit and component ratings; record initial bench readings; calibrate the measurement; build a dashboard using sample data; connect live data; review one safe fault case; publish test notes.
- **Tracks involved:** Controls and Automation, Software and Programming, Electronics and Robotics.
- **Success evidence:** Wiring diagram, calibration comparison, time series, alert screenshot and limits of the measurement. This brief does not claim a certified protection device or mains-current testing.

### Prototype B: Assistive workshop inventory scanner

- **One-line summary:** Help members check tools in and out with a clear audit trail.
- **Description and goal:** Prototype a QR or barcode workflow against non-sensitive sample inventory, then map scans to the club's existing inventory records only after the administrator has reviewed permissions and duplicate handling. Test a missing item, duplicate scan, return and offline failure without changing real stock during the prototype phase.
- **Suggested first tasks:** Agree on sample item IDs; sketch check-out and return flows; build a scanner interface or mock input; test duplicate and malformed codes; review access with the administrator; demonstrate with sample data.
- **Tracks involved:** Software and Programming, Electronics and Robotics, AI & Machine Learning only if an actual vision-based scanner is justified and evaluated.
- **Success evidence:** Demo video or screenshots, test table and a permission review. Do not publish real member borrowing records in public posts.

## Publishing checklist

1. **Workshops:** Confirm a teacher or administrator, duration, equipment, accessibility and safety review. In **Teaching studio**, enter the relevant draft under the matching track. Add a real start date only after it is agreed; course publication is immediate. Attach reviewed slides or a worksheet through **Upload learning material**.
2. **Projects:** Invite a real approved member to own each chosen brief. Let the owner create the project in **Projects** and replace assumptions with their agreed scope. No owner is invented by this file.
3. **Events:** Ask the administrator to schedule the first confirmed workshop in **Events** with the real time, venue and optional Google Meet link. No date or meeting URL is invented here.
4. **Founders:** Obtain each person's approval for the name, role, short bio and optional link **before** adding a public Founders card. Approved founder account access and consent to a public biography are separate decisions. Leave unconfirmed profiles as the site's existing “Profile coming soon” placeholders.
5. **Progress:** Use photos, results and participation numbers only after they exist and members have agreed to their use. Mark draft project ideas as ideas until there is a team and actual work.
