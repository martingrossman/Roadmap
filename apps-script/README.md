# Roadmap planner on Google Sheets

This runs `roadmap.html` as a Google Apps Script web app. The Google Sheet is where the data lives:

| Tab | One row per… | Notes |
|---|---|---|
| **Initiatives** | initiative / epic (the dated bars) | `workstream`, `outcome`, `increment` hold ids from those tabs. `checklist` has one item per line: `[x] done item` or `[ ] open item`. |
| **Stories** | story | `epic` is the id of its initiative. `increment` is the increment it is planned into; blank means the backlog. `points` is optional. `checklist` as on Initiatives. |
| **Workstreams** | workstream / swimlane | |
| **Outcomes** | outcome | |
| **Milestones** | milestone | `workstream` puts it in that workstream's lane; blank means the plan-wide Milestones row. `ganttAfter` is the initiative whose Gantt row it follows; blank puts it at the top of its workstream group. |
| **Increments** | increment | `workstream` puts it in that workstream's lane; blank means the plan-wide Increments row. `capacity` is the story points it can take (optional). `ganttAfter` is the initiative whose Gantt row it follows; blank puts it at the top of its workstream group. |
| **Connections** | dependency (prerequisite → dependent) | The only place dependencies are stored. Older Sheets with a `dependencies` column (Initiatives) or an `initiatives` column (Milestones) are moved here on the next save. |
| **Settings** | plan field (key / value) | Plan name, year, reference date, colors, `itemLabel` (initiative, epic or feature). Also `lastSavedAt` / `lastSavedBy`. |

You can work in either place:

- **In the planner:** each change is saved to the Sheet about a second later. The status at the top reads **Saved to Sheet**.
- **In the Sheet:** edit cells, add rows, sort, filter. A new row you add without an `id` gets one automatically. Status, priority and health accept friendly spellings ("In review", "High", "At risk"); the dropdown only warns. Dates use `yyyy-mm-dd`, and `5.3.2027` or `2027/3/5` are converted too. If you copy a row, clear its `id` cell so it gets a new one. A duplicated id is reported with both row numbers. When you switch back to the planner, it reloads the changes, provided you have no unsaved edits there.
- **Your own columns:** you can add columns such as "Jira link". They are kept and stay with their row when the planner saves.

If two people change the plan at the same time, the planner does not silently overwrite. It asks whether to load the Sheet's version or replace it with yours.

If someone types data into the Sheet that the planner can't use, such as a bad date or a workstream id that doesn't exist, the planner opens in read-only mode. A banner then lists the exact tab and row to fix.

The PDF engine (pdf-lib plus Open Sans) is about 1.1 MB, so it lives in separate files (`PdfVendor`, `PdfFonts`, `PdfExport`). The browser loads it only when someone exports a PDF or a standalone HTML copy. That keeps the planner quick to open.

## Setup (once, about 10 minutes)

1. Create a new Google Sheet, for example "Roadmap".
2. Choose **Extensions → Apps Script**.
3. In the Apps Script editor, create these files and paste in the contents from `apps-script/dist/`:

   | Editor file | Paste from | How to create it |
   |---|---|---|
   | `Code.gs` | `dist/Code.gs` | Already exists. Replace its contents. |
   | `Index.html` | `dist/Index.html` | **+ → HTML**, name it `Index` |
   | `PdfVendor.html` | `dist/PdfVendor.html` | **+ → HTML**, name it `PdfVendor` |
   | `PdfFonts.html` | `dist/PdfFonts.html` | **+ → HTML**, name it `PdfFonts` |
   | `PdfExport.html` | `dist/PdfExport.html` | **+ → HTML**, name it `PdfExport` |

   The PDF files are large (500–600 KB each), so the editor may take a few seconds to accept the paste. Select all the text in a new file before pasting. To avoid pasting altogether, see [Using clasp](#using-clasp-optional) below.
4. Optional: turn on **Project Settings → Show "appsscript.json"** and replace that file with `dist/appsscript.json`. It sets the deployment defaults described in step 6.
5. Reload the Sheet. A new **🗺️ Roadmap** menu appears in the menu bar, and a note in the corner points to it. Choose **🗺️ Roadmap → 🚀 Open planner**. The planner opens in a large window on top of the Sheet. This needs no deployment.
   The first time the planner opens, it writes the plan bundled in the page into the Sheet and creates the tabs.
   To start from a ready-made roadmap, choose **🗺️ Roadmap → 📥 Load example plan…** and pick one of the five examples (the *Advanced* one is the plan the live demo shows). It replaces the data on the planner tabs. The build (`build.mjs`) copies the examples from `roadmap.html` into `DemoPlan.gs`, so they always match the planner.
6. Optional, for the planner in its own browser tab and a link you can send: choose **Deploy → New deployment → Web app**.
   - **Execute as: User accessing the web app.** This is the recommended setting. People can then only open and edit the plan if they have that access to the Sheet itself, so normal Sheet sharing controls everything.
   - **Who has access: Anyone with a Google account**, or your organization only.
   - Click **Deploy**, approve the permissions, and copy the **Web app URL**. It ends in `/exec`.
   - In the Sheet, choose **🗺️ Roadmap → ↗️ Open in new tab** and paste the link when asked. To change it later, choose **🔗 Set planner link…**. With [deploy.mjs](#deploy-with-one-command), the link is set for you.

## Sharing

Share the **Sheet** as you normally would:

- **Editor:** can change the plan in the planner and in the Sheet.
- **Viewer:** can open the planner, but sees "view-only access" and nothing they change is saved.

Then tell people to use **🗺️ Roadmap → 🚀 Open planner** in the Sheet, or send them the web app link (**↗️ Open in new tab** shows it). Viewers can't run the Sheet's menu, so send them the web app link.

The first time each person opens the planner, Google asks them to approve the app. Outside a Google Workspace organization they will also see "Google hasn't verified this app". That's expected for a private script: click **Advanced → Go to …**.

If you would rather people need only the link and no Sheet access, deploy with **Execute as: Me**. Everyone then saves as you, and anyone with the link can change the plan.

### When someone makes a copy

Anyone who can open the Sheet can choose **File → Make a copy**. The copy gets its own copy of the script, so in the copy:

- **🗺️ Roadmap → 🚀 Open planner** works straight away with the copy's own data. Google asks the person to approve the script the first time.
- **↗️ Open in new tab** needs a web app of the copy's own. Google does not copy deployments. The menu explains the steps (step 6 above, about a minute) and saves the new link.
- The copy never opens or saves to your Sheet. Your web app link and Sheet id are tagged with your script's id, and a copy has a different one, so it ignores them.

## Updating the planner

After changing `roadmap.html`, rebuild and paste the files that changed (usually just `Index.html`):

```powershell
node apps-script/build.mjs
```

Then choose **Deploy → Manage deployments → Edit → Version: New version**. The link stays the same.

The build makes a few small, exact edits to the planner's script: where it loads and saves, and where it loads the PDF engine. If the planner code changes in those places, the build stops with a message naming the step to update.

## Using clasp (optional)

```powershell
npm install -g @google/clasp
clasp login
cd apps-script/dist
clasp clone <SCRIPT_ID>      # from Apps Script → Project Settings → Script ID
node ../build.mjs
clasp push
```

### Deploy with one command

Once clasp is set up, this builds the files, uploads them, deploys a new version of the web app and saves its link for the **🗺️ Roadmap** menu:

```powershell
node apps-script/deploy.mjs
```

It reuses your existing web app deployment, so the link stays the same. If there is none, it creates one. If there are several, it lists them and asks you to choose one with `--id <deploymentId>`. Use `-d "What changed"` to set the version description. If you leave it out, the last commit message is used.

The link is saved in `dist/Deployment.gs`. Git ignores that file because the link belongs to your own project. With it in place, **🗺️ Roadmap → Open planner** opens the right page without asking. A link you set by hand with **🗺️ Roadmap → Set planner link…** still takes priority.

## Local test harness

`apps-script/test/index.html` runs the real `Code.gs` and `Index.html` against a fake, in-memory Sheet, with no Google account. To use it, serve the repository folder:

```powershell
python -m http.server 8765
```

Then open http://localhost:8765/apps-script/test/index.html.

The harness covers:

- the first save that creates the tabs
- round trip (plan → rows → plan, unchanged)
- conflict detection, "Load Sheet version", and "Overwrite Sheet"
- rows added by hand, with ids filled in and spellings normalized
- custom columns being kept
- error banners with tab and row
- view-only users
- on-demand PDF loading
- HTML export

What it can't cover is how the real Google services behave: sign-in and permissions, how long saves take, and downloads from inside Google's sandboxed frame. Check those once after you deploy.

## Limits

- The whole plan is rewritten on each save. That's fine for hundreds of rows. At thousands of initiatives, saves will take several seconds.
- A single cell holds at most 50,000 characters, which is more than enough for initiative notes (the planner allows 10,000).
- People's edits are merged per save, not per field. If two people edit at the same moment, the second person is asked to choose a version.
- **🚀 Open planner** asks for a window as large as the browser, but Google keeps a margin and its own title bar around it. To make up for that, the planner inside is scaled down to fit about 1,600 pixels of layout (never below 70%), so a full year fits. **↗️ Open in new tab** shows it at full size.
- Downloads, such as PDF and HTML export, may be blocked inside the window on top of the Sheet. If they are, export from **↗️ Open in new tab**.
- Viewers can't run the Sheet's menu, so they can't use **🚀 Open planner**. Send them the web app link.
