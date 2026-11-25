# Roadmap planner

A product roadmap planner in a single HTML file. Plan workstreams, initiatives, milestones and increments on a timeline, link them with dependencies, and export the result as a PDF.

**[Open the live demo →](https://martingrossman.github.io/Roadmap/)**

![Roadmap planner view with workstreams, milestones and dependency arrows](docs/images/roadmap-planner.png)

## Ways to use it

| | Where your data lives | Good for |
|---|---|---|
| **[Live demo](https://martingrossman.github.io/Roadmap/)** | Your browser only. Nobody else sees your changes. | Trying it out |
| **Download [`roadmap.html`](roadmap.html)** and open it | Your browser. **Export → HTML** saves a copy with the plan inside. | Working offline, sharing a snapshot |
| **[On Google Sheets](apps-script/README.md)** | A Google Sheet, shared with your team | Team planning, editing data in the Sheet |

## Google Sheets in short

The Sheet holds the data, one tab per kind of item. Everything starts from the **🗺️ Roadmap** menu in the Sheet's menu bar:

| Menu item | What it does |
|---|---|
| **🚀 Open planner** | Opens the planner in a large window on top of the Sheet. Needs no deployment, so it works in any copy. |
| **↗️ Open in new tab** | Opens the planner in its own browser tab through the web app. Gives you a link you can send. |
| **🔗 Set planner link…** | Saves or changes the web app link that **Open in new tab** uses. |
| **📥 Load demo plan** | Replaces the Sheet's data with the plan the live demo shows. Asks first. |
| **🎨 Reapply tab formatting** | Restores headers, dropdowns and colours on the tabs. |

**Sharing a Sheet so others get their own planner:**

1. Share the Sheet (view access is enough for copying).
2. They choose **File → Make a copy**.
3. In their copy they choose **🗺️ Roadmap → 🚀 Open planner** and approve the script once. The planner works with the copy's own data.
4. Optional: for the planner in its own tab, they choose **↗️ Open in new tab**. Google doesn't copy web app deployments, so the menu walks them through deploying their own (about a minute).

A copy never opens or saves to the original Sheet: the original's web app link and Sheet id are tagged with its script id, and a copy has a different one.

**Things to know:**

- Viewers can't run a Sheet's menu. Send them the web app link instead, and they see the plan read-only.
- Google keeps a margin around the window on top of the Sheet, so **🚀 Open planner** scales the planner down a little (never below 70%) to fit a full year. **↗️ Open in new tab** shows it at full size.
- PDF export may be blocked inside the window on top of the Sheet. If it is, use **↗️ Open in new tab** to export.

Full setup, permissions and limits: [`apps-script/README.md`](apps-script/README.md).

## What it does

- **Views:** roadmap (swimlanes), Gantt, board and table
- **Planning:** workstreams, initiatives, milestones, increments and outcomes with metrics
- **Workstreams hold any mix:** a workstream can hold initiatives, milestones and increments, or only some of them. Milestones and increments without a workstream stay in the plan-wide rows at the top
- **Dependencies:** drag from an item's edge to another item; arrows route around labels
- **Timeline:** full year, a quarter, or a custom range of months (longer ranges scroll sideways)
- **Look:** colour templates, custom palettes and a configurable timeline colour
- **Export:** PDF (selected period or all dates) and standalone HTML
- **Presentation mode**, undo/redo, search and show/hide filters

## Repository layout

```
roadmap.html        The whole app: markup, styles and script in one file. Also served as the demo.
index.html          Sends the demo's root URL to roadmap.html.
apps-script/        Google Sheets version: build script, server code, generated bundle, test page.
docs/               Backlog and images.
```

## Development

Edit `roadmap.html` and open it in a browser; there is no build step for the standalone app. Every push to `master` updates the demo through GitHub Pages.

To update the Google Sheets version:

```powershell
node apps-script/deploy.mjs -d "What changed"
```

This rebuilds `apps-script/dist` from `roadmap.html`, uploads it with clasp, redeploys the existing web app (the link stays the same) and gives the Sheet's menu that link. It needs clasp set up once, as described in the Sheets guide. To only rebuild, run `node apps-script/build.mjs`.

See [`apps-script/README.md`](apps-script/README.md) for the first-time setup and [`docs/Backlog.md`](docs/Backlog.md) for planned work.

## License

[MIT](LICENSE)
