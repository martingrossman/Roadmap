# Roadmap planner on Google Sheets

This runs `roadmap.html` as a Google Apps Script web app. The Google Sheet is where the data lives:

| Tab | One row per… | Notes |
|---|---|---|
| **Initiatives** | initiative (the issue list) | `workstream`, `outcome`, `increment` hold ids from those tabs. `dependencies` is a comma-separated list of initiative ids. |
| **Workstreams** | workstream / swimlane | |
| **Outcomes** | outcome | |
| **Milestones** | milestone | `initiatives` is a comma-separated list of initiative ids. |
| **Increments** | increment | |
| **Connections** | extra dependency link | |
| **Settings** | plan field (key / value) | Plan name, year, reference date, colors. Also `lastSavedAt` / `lastSavedBy`. |

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
4. Optional: turn on **Project Settings → Show "appsscript.json"** and replace that file with `dist/appsscript.json`. It sets the deployment defaults described in step 5.
5. Choose **Deploy → New deployment → Web app**:
   - **Execute as: User accessing the web app.** This is the recommended setting. People can then only open and edit the plan if they have that access to the Sheet itself, so normal Sheet sharing controls everything.
   - **Who has access: Anyone with a Google account**, or your organization only.
   - Click **Deploy** and approve the permissions.
6. Copy the **Web app URL** that the deployment shows. It ends in `/exec`. You can find it again later under **Deploy → Manage deployments**.
7. Reload the Sheet. A new **🗺️ Roadmap** menu appears in the menu bar, and a note in the corner points to it. Choose **🗺️ Roadmap → Open planner**. The first time, it asks for the link from step 6 and saves it as the `WEB_APP_URL` script property. To change the link later, choose **🗺️ Roadmap → Set planner link…**.
   The first time the planner opens, it writes the plan bundled in the page into the Sheet and creates the tabs.

## Sharing

Share the **Sheet** as you normally would:

- **Editor:** can change the plan in the planner and in the Sheet.
- **Viewer:** can open the planner, but sees "view-only access" and nothing they change is saved.

Then send people the web app link (from **🗺️ Roadmap → Open planner** or the deployment page), or tell them to use the 🗺️ Roadmap menu in the Sheet.

The first time each person opens the planner, Google asks them to approve the app. Outside a Google Workspace organization they will also see "Google hasn't verified this app". That's expected for a private script: click **Advanced → Go to …**.

If you would rather people need only the link and no Sheet access, deploy with **Execute as: Me**. Everyone then saves as you, and anyone with the link can change the plan.

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
