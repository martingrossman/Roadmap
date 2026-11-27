# Epics, stories and checklists, plus review fixes

Branch `worktree-epics-stories-tasks`. Decided in discussion on 2026-11-27.

## Part A — fixes from the external review (done first, one commit each)

| # | Problem | Fix |
|---|---|---|
| A1 | A failed Sheet save could leave the plan unreadable: tabs were cleared one by one, and a payload missing a collection erased it and still reported success. | `savePlan` validates the whole plan first: every collection is present, required fields are filled, references resolve, and ids are unique. It then builds every tab's rows before touching the Sheet and snapshots the current values. If any write fails, it restores every tab from the snapshot and reports the error. |
| A2 | A red dependency arrow could disagree with the initiative: warnings only looked at `initiative.dependencies`. | Prerequisites live in **one place**, the `connections` list (prerequisite → dependent). Arrows, initiative warnings ("Starts before X finishes", for initiatives, milestones and increments) and milestone readiness all read the same `prerequisites()` helper. Old plans are migrated: `initiative.dependencies` and `milestone.initiatives` become connections, deduplicated. The Sheet columns and workbook columns for those lists are read once for migration and then dropped. Scheduling stays soft. |
| A3 | Re-importing an unchanged CSV could rewire links: rows and prerequisites were matched by title only. | The CSV export adds **ID** and **Depends on (IDs)** columns. Import matches by id first and by title second. An ambiguous or unknown prerequisite name is listed in the preview and the existing link is kept. |
| A4 | A plan named `[Q4] Launch` broke reloading from the Sheet and Excel: any value starting with `[` or `{` was parsed as JSON. | Settings are parsed by their declared type. Only the palette settings (`customColorSchemes`, `customPaletteRecipes`) are JSON. |

## Part B — epics, stories and checklists

Hierarchy: **Workstream → Epic → Story (checklist inside)**.

- **Epic** is today's bar item. Its data key stays `initiatives`, so there is no migration. What the level is called is a plan setting, **`itemLabel`**: `initiative` (the default for existing plans), `epic` (the default for new plans) or `feature`. Labels in the UI read it from one helper.
- **Story** is a new record: `{id, title, epic, increment, status, points, owner, description, checklist, order}`.
  - `epic` is required.
  - `increment` blank means the story is in the backlog; otherwise the story is planned into that increment, which can be a sprint or a PI.
  - The workstream comes from the epic.
- **Checklist** on epics and stories: `[{text, done}]`, at most 50 items of 200 characters each.
  - In the Sheet and Excel it is one cell with one line per item, `[x] text` or `[ ] text`, so it can be edited by hand.
- **Increment capacity**: a new optional `capacity` field, in points.

**Roll-ups** are computed, never stored:
- Story progress = ticked ÷ all checklist items.
- Epic progress:
  - from its stories' points when it has stories: done points ÷ all points, or by story count when nothing is sized;
  - otherwise from its checklist when it has items;
  - otherwise it stays manual, as today.
- Ticking the last checklist item offers to mark the story Done.

**Schema version 2.** Version-1 plans load and are saved as version 2. Older app copies refuse version 2 instead of silently dropping stories.

**Where it shows:**
- **Epic details:** a Stories list ("Add story"), and a Checklist.
- **Story details window:** fields, checklist, epic and increment pickers.
- **Board:** a level switch between Epics and Stories. The story board has status columns, and its cards show the epic chip, points and checklist count.
- **Backlog view** (new section):
  - Unplanned stories on the left.
  - One column per increment, showing points against capacity.
  - Drag a story to plan it, or use the increment picker.
- **Google Sheet:** a new **Stories** tab, a `checklist` column on Initiatives, `capacity` on Increments, and `itemLabel` in Settings.
- **Excel workbook:** the same tabs.

**Not in this branch (follow-ups):** Jira CSV preset, stories in the PDF, story dependencies.
