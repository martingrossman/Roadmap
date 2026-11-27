/**
 * Roadmap planner — Google Sheets backend.
 *
 * The Sheet is the source of truth. Every record lives on its own row:
 *   Settings     key / value rows for plan-level fields
 *   Workstreams  one row per workstream (swimlane)
 *   Initiatives  one row per initiative (the issue list)
 *   Outcomes     one row per outcome
 *   Milestones   one row per milestone
 *   Increments   one row per increment
 *   Connections  one row per extra dependency link
 *
 * The web app (doGet) serves Index.html with the plan read from these tabs.
 * The planner saves back through savePlan(); a content hash guards against
 * overwriting edits someone else made in the meantime (in the planner or
 * directly in the Sheet).
 */

const ROADMAP_ENUMS = {
  status: ['planned', 'discovery', 'building', 'review', 'done'],
  priority: ['critical', 'high', 'medium', 'low'],
  health: ['on_track', 'at_risk', 'blocked'],
  shape: ['star', 'diamond', 'circle', 'flag', 'square'],
  color: ['blue', 'amber', 'teal', 'rose', 'violet', 'slate'].concat(
    Array.from({ length: 18 }, (_, i) => 'color' + (i + 7))),
  itemType: ['initiative', 'milestone', 'increment']
};

// Friendly spellings people may type in the Sheet → stored value.
const ROADMAP_ENUM_ALIASES = {
  in_review: 'review', reviewing: 'review', complete: 'done', completed: 'done',
  ontrack: 'on_track', atrisk: 'at_risk', red: 'rose'
};

const ROADMAP_SETTINGS_SHEET = 'Settings';
const ROADMAP_META_KEYS = ['lastSavedAt', 'lastSavedBy'];
const ROADMAP_SETTINGS_ORDER = ['name', 'description', 'year', 'reviewDateMode', 'reviewDate', 'timelineColor', 'example', 'id',
  'colorScheme', 'customColorSchemes', 'customPaletteRecipes'];
const ROADMAP_SETTINGS_HELP = {
  name: 'Plan name shown in the planner',
  description: 'Short plan description',
  year: 'Default roadmap year',
  reviewDateMode: '"today" = the reference date is always today (default); "fixed" = use reviewDate below',
  reviewDate: 'Reference date (yyyy-mm-dd) for overdue warnings and the timeline marker. Only used when reviewDateMode is "fixed"',
  timelineColor: 'Timeline header colour (#RRGGBB); empty = default dark grey',
  example: 'TRUE shows an "Example" badge',
  id: 'Internal plan id, do not change',
  colorScheme: 'Color scheme id used by the planner',
  customColorSchemes: 'Custom palettes (JSON, edited from the planner)',
  customPaletteRecipes: 'Palette generator settings (JSON, edited from the planner)',
  lastSavedAt: 'Last save from the planner (read only)',
  lastSavedBy: 'Who saved last from the planner (read only)'
};

// One entry per tab. `field` is the plan property, `header` the column title.
const ROADMAP_TABS = [
  { key: 'workstreams', sheet: 'Workstreams', cols: [
    { field: 'id' },
    { field: 'name' },
    { field: 'color', type: 'enum', values: 'color' },
    { field: 'customColor', header: 'customColor (#hex)' },
    { field: 'description', wide: true },
    // Custom icon: a small PNG as a data URL, set from the planner (Choose image… or Ctrl+V).
    { field: 'icon', header: 'icon', wide: false }
  ] },
  { key: 'initiatives', sheet: 'Initiatives', cols: [
    { field: 'id' },
    { field: 'title', wide: true },
    { field: 'stream', header: 'workstream', type: 'ref', ref: 'Workstreams' },
    { field: 'status', type: 'enum', values: 'status', blank: 'planned' },
    { field: 'priority', type: 'enum', values: 'priority', blank: 'medium' },
    { field: 'health', type: 'enum', values: 'health' },
    { field: 'owner' },
    { field: 'start', type: 'date' },
    { field: 'end', type: 'date' },
    { field: 'progress', type: 'number', blank: 0 },
    { field: 'outcome', type: 'ref', ref: 'Outcomes' },
    { field: 'increment', type: 'ref', ref: 'Increments' },
    { field: 'dependencies', type: 'list' },
    { field: 'description', wide: true },
    { field: 'notes', wide: true },
    // Custom icon: a small PNG as a data URL, set from the planner (Choose image… or Ctrl+V).
    { field: 'icon', header: 'icon', wide: false }
  ] },
  { key: 'outcomes', sheet: 'Outcomes', cols: [
    { field: 'id' },
    { field: 'title', wide: true },
    { field: 'metric', wide: true },
    { field: 'baseline', type: 'number' },
    { field: 'current', type: 'number' },
    { field: 'target', type: 'number' },
    { field: 'unit' },
    { field: 'owner' },
    { field: 'due', type: 'date' },
    { field: 'description', wide: true }
  ] },
  { key: 'milestones', sheet: 'Milestones', cols: [
    { field: 'id' },
    { field: 'title', wide: true },
    // Blank = the plan-wide Milestones row at the top; otherwise the workstream lane it is shown in.
    { field: 'stream', header: 'workstream', type: 'ref', ref: 'Workstreams' },
    { field: 'date', type: 'date' },
    { field: 'done', type: 'bool' },
    { field: 'shape', type: 'enum', values: 'shape' },
    { field: 'color', type: 'enum', values: 'color' },
    { field: 'showLine', type: 'bool' },
    { field: 'increment', type: 'ref', ref: 'Increments' },
    { field: 'initiatives', type: 'list' },
    // Gantt: the initiative whose row this milestone follows. Blank = top of its workstream group.
    { field: 'after', header: 'ganttAfter' },
    { field: 'description', wide: true },
    // Custom icon: a small PNG as a data URL, set from the planner (Choose image… or Ctrl+V).
    { field: 'icon', header: 'icon', wide: false }
  ] },
  { key: 'increments', sheet: 'Increments', cols: [
    { field: 'id' },
    { field: 'title', wide: true },
    // Blank = the plan-wide Increments row at the top; otherwise the workstream lane it is shown in.
    { field: 'stream', header: 'workstream', type: 'ref', ref: 'Workstreams' },
    { field: 'start', type: 'date' },
    { field: 'end', type: 'date' },
    { field: 'color', type: 'enum', values: 'color' },
    // Gantt: the initiative whose row this increment follows. Blank = top of its workstream group.
    { field: 'after', header: 'ganttAfter' },
    { field: 'description', wide: true },
    // Custom icon: a small PNG as a data URL, set from the planner (Choose image… or Ctrl+V).
    { field: 'icon', header: 'icon', wide: false }
  ] },
  { key: 'connections', sheet: 'Connections', cols: [
    { field: 'id' },
    { field: 'fromType', type: 'enum', values: 'itemType' },
    { field: 'from' },
    { field: 'toType', type: 'enum', values: 'itemType' },
    { field: 'to' }
  ] }
];
const ROADMAP_REQUIRED = {"workstreams":["name"],"initiatives":["title","stream","start","end"],"outcomes":["title","metric","baseline","target","due"],"milestones":["title","date"],"increments":["title","start","end"],"connections":["fromType","from","toType","to"]};
ROADMAP_TABS.forEach(tab => tab.cols.forEach(c => {
  c.header = c.header || c.field;
  c.type = c.type || 'text';
  c.required = (ROADMAP_REQUIRED[tab.key] || []).indexOf(c.field) >= 0;
}));

/* ------------------------------------------------------------------ */
/* Sheet menu                                                          */
/* ------------------------------------------------------------------ */

function onOpen() {
  // Menus cannot show images, so an emoji makes the menu easy to spot in the menu bar.
  SpreadsheetApp.getUi().createMenu('🗺️ Roadmap')
    .addItem('🚀 Open planner', 'openPlanner')
    .addItem('↗️ Open in new tab', 'openPlannerInTab')
    .addItem('🔗 Set planner link…', 'setPlannerLink')
    .addSeparator()
    .addItem('📥 Load example plan…', 'loadDemoPlan')
    .addItem('🎨 Reapply tab formatting', 'reapplyFormatting')
    .addToUi();
  // Point people at the menu each time the Sheet opens.
  SpreadsheetApp.getActiveSpreadsheet().toast('Open the planner from the 🗺️ Roadmap menu.', '🗺️ Roadmap planner', 8);
  try { roadmapRememberSheet_(SpreadsheetApp.getActiveSpreadsheet()); } catch (err) { /* using the menu sets it too */ }
}

/*
 * A copy of the Sheet (File → Make a copy) gets a copy of this script, including
 * Deployment.gs and possibly the script properties, but not the web app deployment.
 * Every saved link and Sheet id is therefore tagged with the script id it belongs to,
 * and a copy ignores the original's values instead of opening (and saving to) the
 * original Sheet.
 */
function roadmapRememberSheet_(ss) {
  PropertiesService.getScriptProperties().setProperties({
    SPREADSHEET_ID: ss.getId(),
    SPREADSHEET_SCRIPT_ID: ScriptApp.getScriptId()
  });
}

// The deployed web app link: https://script.google.com/[a/macros/<domain>/]macros/s/<id>/exec
// (Workspace links look like https://script.google.com/a/macros/<domain>/s/<id>/exec.)
const ROADMAP_WEB_APP_URL_RE = /^https:\/\/script\.google\.com\/(?:a\/macros\/[^\/\s]+\/|macros\/)s\/[\w-]+\/exec$/;

/** This script's own web app link, or null when this copy has none yet. */
function roadmapWebAppUrl_() {
  const props = PropertiesService.getScriptProperties();
  const scriptId = ScriptApp.getScriptId();
  const saved = props.getProperty('WEB_APP_URL');
  if (saved && props.getProperty('WEB_APP_SCRIPT_ID') === scriptId && ROADMAP_WEB_APP_URL_RE.test(saved)) return saved;
  // Written by apps-script/deploy.mjs in Deployment.gs.
  if (typeof ROADMAP_DEPLOYED_URL === 'string' && typeof ROADMAP_DEPLOYED_SCRIPT_ID === 'string' &&
      ROADMAP_DEPLOYED_SCRIPT_ID === scriptId && ROADMAP_WEB_APP_URL_RE.test(ROADMAP_DEPLOYED_URL)) return ROADMAP_DEPLOYED_URL;
  return null;
}

/**
 * Asks for the web app's /exec link and saves it for this script only.
 * ScriptApp.getService().getUrl() is not trusted: in a Sheet-bound script it often
 * returns the /dev test link or an older deployment instead of the live one.
 * Returns the saved link, or null if the person cancelled.
 */
function setPlannerLink() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const current = roadmapWebAppUrl_();
  let hint = 'In Apps Script choose Deploy → Manage deployments, select the web app, and copy its Web app URL (it ends in /exec).';
  if (current) hint += '\n\nCurrent link:\n' + current;
  for (;;) {
    const res = ui.prompt('Planner link', hint, ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return null;
    const url = res.getResponseText().trim().replace(/[?#].*$/, '');
    if (ROADMAP_WEB_APP_URL_RE.test(url)) {
      props.setProperties({ WEB_APP_URL: url, WEB_APP_SCRIPT_ID: ScriptApp.getScriptId() });
      return url;
    }
    hint = (/\/dev$/.test(url)
      ? 'That is the /dev test link, which only works for editors and runs unsaved code. '
      : 'That does not look like a web app link. ') +
      'Paste the Web app URL from Deploy → Manage deployments. It ends in /exec.';
  }
}

/**
 * Opens the planner in a large window on top of the Sheet. It runs from this Sheet's
 * own script, so it needs no deployment and works in every copy straight away.
 * A small launcher measures the screen first, then asks for the full-size window.
 */
function openPlanner() {
  roadmapRememberSheet_(SpreadsheetApp.getActiveSpreadsheet());
  const launcher = HtmlService.createHtmlOutput(
    '<div style="font:14px/1.5 Arial,sans-serif;padding:6px 2px;color:#334">Opening the planner…</div>' +
    '<script>google.script.run' +
    '.withFailureHandler(function(e){document.body.textContent="The planner could not open: "+(e&&e.message||e);})' +
    '.showPlannerWindow(Math.min(screen.availWidth,window.outerWidth||screen.availWidth)-24,screen.availHeight-180);</script>'
  ).setWidth(260).setHeight(70);
  SpreadsheetApp.getUi().showModalDialog(launcher, '🗺️ Roadmap');
}

/** Called by the launcher in openPlanner(); replaces it with the planner window. */
function showPlannerWindow(width, height) {
  // Google may make the window smaller than asked to fit the browser; the page then scales itself to fit.
  const w = Math.max(760, Math.min(3840, Math.round(Number(width) || 1200)));
  const h = Math.max(520, Math.min(2160, Math.round(Number(height) || 760)));
  const page = roadmapPage_();
  const output = HtmlService.createHtmlOutput(roadmapFitPage_(page.output.getContent()));
  SpreadsheetApp.getUi().showModalDialog(output.setWidth(w).setHeight(h), '🗺️ ' + page.name);
}

/**
 * Google's window on top of the Sheet leaves less room than a browser tab. This wraps the
 * planner in an inner frame that is laid out about FIT px wide and scaled down to fit, so
 * more of the timeline shows. The planner keeps its own coordinates inside the frame, so
 * dragging and dependency arrows stay accurate. If the inner frame cannot reach Google's
 * script API (a stricter sandbox), the wrapper shows the planner unscaled instead.
 */
function roadmapFitPage_(html) {
  const json = JSON.stringify(html).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;height:100%;overflow:hidden;background:#fff}' +
    '#app{position:absolute;left:0;top:0;border:0;transform-origin:0 0}</style></head><body>' +
    '<iframe id="app" title="Roadmap planner"></iframe><script>' +
    '(function(){var FIT=1600,MIN=0.7,html=' + json + ',f=document.getElementById("app");' +
    'function plain(){document.open();document.write(html);document.close();}' +
    'function fit(){var s=Math.max(MIN,Math.min(1,innerWidth/FIT));' +
    'f.style.width=Math.ceil(innerWidth/s)+"px";f.style.height=Math.ceil(innerHeight/s)+"px";' +
    'f.style.transform=s<1?"scale("+s+")":"";}' +
    'try{if(!window.google||!google.script)throw 0;' +
    'f.onload=function(){try{if(!f.contentWindow.google)throw 0;f.contentWindow.focus();}catch(e){plain();}};' +
    'f.srcdoc=html.replace("<head>","<head><script>window.google=parent.google;<\\/script>");' +
    'fit();addEventListener("resize",fit);}catch(e){plain();}})();' +
    '</script></body></html>';
}

/**
 * Opens the planner in its own browser tab through this script's web app. A copy of
 * the Sheet has no web app until someone deploys one in the copy, so this explains how.
 */
function openPlannerInTab() {
  const ui = SpreadsheetApp.getUi();
  roadmapRememberSheet_(SpreadsheetApp.getActiveSpreadsheet());
  let url = roadmapWebAppUrl_();
  if (!url) {
    const answer = ui.alert('Set up the planner in its own tab',
      'This Sheet has no web app of its own yet. That is normal for a copy, and 🚀 Open planner works without it.\n\n' +
      'To open the planner in its own browser tab (about a minute, once per copy):\n' +
      '1. Choose Extensions → Apps Script.\n' +
      '2. Choose Deploy → New deployment. Click the gear next to "Select type" and choose Web app.\n' +
      '3. Set "Execute as" to "User accessing the web app", and "Who has access" to "Anyone with a Google account" or your organization.\n' +
      '4. Click Deploy, approve the permissions, and copy the Web app URL.\n\n' +
      'Click OK to paste the link now, or Cancel to do it later with 🔗 Set planner link….',
      ui.ButtonSet.OK_CANCEL);
    if (answer !== ui.Button.OK) return;
    url = setPlannerLink();
    if (!url) return;
  }
  const safe = roadmapEscapeHtml_(url);
  const html = HtmlService.createHtmlOutput(
    '<div style="font:14px/1.5 Arial,sans-serif;padding:4px 2px">' +
    '<p style="margin:0 0 14px">The planner opens in a new browser tab.</p>' +
    '<a href="' + safe + '" target="_blank" rel="noopener" onclick="setTimeout(function(){google.script.host.close()},400)" ' +
    'style="display:inline-block;background:#276d51;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none;font-weight:600">Open Roadmap planner</a>' +
    '</div>'
  ).setWidth(320).setHeight(120);
  ui.showModelessDialog(html, '🗺️ Roadmap planner');
}

/**
 * Replaces the Sheet's plan with the example plan from the live demo (roadmap.html).
 * ROADMAP_DEMO_PLAN is generated by build.mjs in DemoPlan.gs, so it always matches the demo.
 */
function loadDemoPlan() {
  const ui = SpreadsheetApp.getUi();
  if (typeof ROADMAP_EXAMPLES === 'undefined') {
    ui.alert('DemoPlan.gs is missing. Rebuild with build.mjs and upload it, then try again.');
    return;
  }
  const cards = ROADMAP_EXAMPLES.map(x => '<button class="card" onclick="pick(\'' + roadmapEscapeHtml_(x.key) + '\',this)"><b>' + roadmapEscapeHtml_(x.title) +
    '</b><span>' + roadmapEscapeHtml_(x.description) + '</span></button>').join('');
  const html = HtmlService.createHtmlOutput(
    '<style>body{font:14px/1.45 Arial,sans-serif;margin:0;color:#334155}.card{display:grid;gap:3px;width:100%;text-align:left;margin:0 0 8px;padding:10px 12px;border:1px solid #CBD5E1;border-radius:8px;background:#fff;cursor:pointer;font:inherit}' +
    '.card:hover{border-color:#64748B}.card b{color:#0F172A}.card span{font-size:13px}p{margin:0 0 10px}.note{color:#64748B;font-size:12px}</style>' +
    '<p>Choose an example. It replaces everything on the planner tabs; your own extra columns are kept but their cells are cleared.</p>' + cards +
    '<p class="note" id="status"></p><script>function pick(key,btn){document.querySelectorAll(".card").forEach(function(b){b.disabled=true;});' +
    'document.getElementById("status").textContent="Loading…";google.script.run.withSuccessHandler(function(){google.script.host.close();})' +
    '.withFailureHandler(function(e){document.getElementById("status").textContent="Could not load: "+(e&&e.message||e);document.querySelectorAll(".card").forEach(function(b){b.disabled=false;});}).loadExample(key);}</script>'
  ).setWidth(460).setHeight(520);
  ui.showModalDialog(html, '📥 Load an example plan');
}

/** Writes one of the ready-made examples to the Sheet (called from the Load demo plan dialog). */
function loadExample(key) {
  const example = (typeof ROADMAP_EXAMPLES !== 'undefined' ? ROADMAP_EXAMPLES : []).filter(x => x.key === key)[0];
  if (!example) throw new Error('Unknown example: ' + key);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('The Sheet is busy saving another change. Try again in a moment.');
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const plan = JSON.parse(JSON.stringify(example.plan));
    roadmapCheckShape_(plan);
    roadmapSafeWrite_(ss, plan);
    ss.toast('Loaded "' + plan.name + '". Reload any open planner tab to see it.', '🗺️ Roadmap planner', 8);
  } finally {
    lock.releaseLock();
  }
}

function reapplyFormatting() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  roadmapEnsureSheets_(ss);
  ROADMAP_TABS.forEach(tab => {
    const sh = ss.getSheetByName(tab.sheet);
    roadmapFormatTab_(ss, sh, tab, roadmapHeaders_(sh));
  });
  roadmapFormatSettings_(ss.getSheetByName(ROADMAP_SETTINGS_SHEET));
}

/* ------------------------------------------------------------------ */
/* Web app                                                             */
/* ------------------------------------------------------------------ */

/**
 * Builds the planner page with the Sheet's plan baked in. Used by the web app and the in-Sheet window.
 */
function roadmapPage_() {
  const boot = { plan: null, revision: null, error: null };
  try {
    const current = roadmapRead_(roadmapSpreadsheet_());
    boot.plan = current.plan;
    boot.revision = current.revision;
    boot.problems = current.problems || [];
    boot.savedBy = current.savedBy;
    boot.savedAt = current.savedAt;
  } catch (err) {
    boot.error = roadmapMessage_(err);
  }
  const html = HtmlService.createHtmlOutputFromFile('Index').getContent();
  const marker = '/*ROADMAP_SHEET_BOOT*/null';
  if (html.indexOf(marker) < 0) throw new Error('Index.html is missing the ROADMAP_SHEET_BOOT marker. Rebuild it with build.mjs.');
  const json = JSON.stringify(boot).replace(/</g, '\\u003c');
  const name = boot.plan && boot.plan.name ? boot.plan.name : 'Roadmap';
  return { name: name, output: HtmlService.createHtmlOutput(html.replace(marker, () => json)) };
}

function doGet() {
  const page = roadmapPage_();
  return page.output
    .setTitle(page.name + ' — Roadmap')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** Returns the current plan and its revision hash. */
function getPlan() {
  return roadmapRead_(roadmapSpreadsheet_());
}

/** Cheap-enough change check used by the planner when it regains focus. */
function getRevision() {
  const current = roadmapRead_(roadmapSpreadsheet_());
  return { revision: current.revision, savedBy: current.savedBy, savedAt: current.savedAt };
}

/**
 * Saves the whole plan. `baseRevision` is the revision the planner last saw;
 * if the Sheet has changed since, nothing is written and the current version
 * is returned so the planner can ask the person what to do.
 */
function savePlan(json, baseRevision, force) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('The Sheet is busy saving another change. Try again in a moment.');
  try {
    const ss = roadmapSpreadsheet_();
    let current = null;
    try { current = roadmapRead_(ss); } catch (err) { current = { revision: 'unreadable', error: roadmapMessage_(err) }; }
    if (!force && current.revision !== baseRevision) {
      return { ok: false, conflict: true, plan: current.plan || null, revision: current.revision,
        savedBy: current.savedBy || '', savedAt: current.savedAt || '', error: current.error || null };
    }
    const plan = JSON.parse(json);
    roadmapCheckShape_(plan);
    roadmapValidate_(plan);
    roadmapSafeWrite_(ss, plan);
    const after = roadmapRead_(ss);
    return { ok: true, revision: after.revision, savedBy: after.savedBy, savedAt: after.savedAt };
  } finally {
    lock.releaseLock();
  }
}

/** PDF export code, loaded by the planner only when someone exports a PDF. */
function getPdfEngine() {
  return ['PdfVendor', 'PdfFonts', 'PdfExport']
    // Each file is <script>…</script> so Apps Script accepts it as HTML; return just the code.
    .map(name => HtmlService.createHtmlOutputFromFile(name).getContent()
      .replace(/^\s*<script[^>]*>/i, '').replace(/<\/script>\s*$/i, ''))
    .join('\n;\n');
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

function roadmapSpreadsheet_() {
  let active = null;
  try { active = SpreadsheetApp.getActiveSpreadsheet(); } catch (err) { active = null; }
  if (active) return active;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  const owner = props.getProperty('SPREADSHEET_SCRIPT_ID');
  // owner is empty for ids saved before copies were handled; those are accepted and
  // re-tagged the next time the Sheet opens. A copy ignores the original's tagged id.
  if (id && (!owner || owner === ScriptApp.getScriptId())) return SpreadsheetApp.openById(id);
  throw new Error('The planner does not know which Sheet to use yet. Open the Sheet and choose 🗺️ Roadmap → Open planner once.');
}

/** Reads the plan from the tabs. plan is null when the Sheet has not been set up yet. */
function roadmapRead_(ss) {
  const settings = ss.getSheetByName(ROADMAP_SETTINGS_SHEET);
  if (!settings) return { plan: null, revision: 'empty', savedBy: '', savedAt: '' };
  const tz = ss.getSpreadsheetTimeZone();
  const plan = { schemaVersion: 1 };
  const meta = {};
  const rows = settings.getDataRange().getValues();
  for (let r = 1; r < rows.length; r++) {
    const key = String(rows[r][0]).trim();
    if (!key || key === 'schemaVersion') continue;
    if (ROADMAP_META_KEYS.indexOf(key) >= 0) { meta[key] = roadmapCellText_(rows[r][1], tz); continue; }
    plan[key] = roadmapParseSetting_(key, rows[r][1], tz);
  }
  const problems = [], rowOf = {};
  ROADMAP_TABS.forEach(tab => {
    rowOf[tab.key] = {};
    plan[tab.key] = roadmapReadTab_(ss, tab, tz, problems, rowOf[tab.key]);
  });
  roadmapCheckRefs_(plan, rowOf, problems);
  const revision = roadmapHash_(JSON.stringify(plan));
  return { plan: plan, revision: revision, problems: problems.slice(0, 25),
    savedBy: meta.lastSavedBy || '', savedAt: meta.lastSavedAt || '' };
}

/** Points at links between tabs that lead nowhere, by tab and row. */
function roadmapCheckRefs_(plan, rowOf, problems) {
  const ids = key => new Set((plan[key] || []).map(r => r.id));
  const sets = { workstreams: ids('workstreams'), outcomes: ids('outcomes'), increments: ids('increments'),
    initiatives: ids('initiatives'), milestones: ids('milestones') };
  const at = (key, rec) => roadmapTabName_(key) + (rowOf ? ' row ' + rowOf[key][rec.id] : '') + ' (' + (rec.title || rec.name || rec.id) + ')';
  const check = (key, field, target, many) => (plan[key] || []).forEach(rec => {
    const values = many ? rec[field] || [] : rec[field] ? [rec[field]] : [];
    values.forEach(v => { if (!sets[target].has(v)) problems.push(at(key, rec) + ': ' + (field === 'stream' ? 'workstream' : field) + ' "' + v + '" is not an id on the ' + roadmapTabName_(target) + ' tab.'); });
  });
  check('initiatives', 'stream', 'workstreams');
  check('initiatives', 'outcome', 'outcomes');
  check('initiatives', 'increment', 'increments');
  check('initiatives', 'dependencies', 'initiatives', true);
  check('milestones', 'stream', 'workstreams');
  check('milestones', 'increment', 'increments');
  check('increments', 'stream', 'workstreams');
  check('milestones', 'initiatives', 'initiatives', true);
}

function roadmapTabName_(key) { const tab = ROADMAP_TABS.filter(t => t.key === key)[0]; return tab ? tab.sheet : key; }

function roadmapParseSetting_(key, value, tz) {
  if (key === 'year') return value === '' ? '' : Number(value);
  if (key === 'example') return roadmapBool_(value);
  if (value instanceof Date) return roadmapDate_(value, tz);
  const text = String(value).trim();
  if (/^[\[{]/.test(text)) {
    try { return JSON.parse(text); } catch (err) { throw new Error('Settings → ' + key + ' is not valid JSON.'); }
  }
  return text;
}

function roadmapReadTab_(ss, tab, tz, problems, rowOf) {
  const sh = ss.getSheetByName(tab.sheet);
  if (!sh) return [];
  const values = sh.getDataRange().getValues();
  if (!values.length) return [];
  const index = roadmapColumnIndex_(values[0], tab);
  if (index.id < 0) throw new Error('The ' + tab.sheet + ' tab needs an "id" column.');
  const records = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const blank = tab.cols.every(c => index[c.field] < 0 || c.type === 'bool' || roadmapIsBlank_(row[index[c.field]]));
    if (blank) continue;
    let id = roadmapCellText_(row[index.id], tz);
    if (!id) {
      // Someone added a row by hand: give it an id so the planner can track it.
      id = Utilities.getUuid();
      sh.getRange(r + 1, index.id + 1).setValue(id);
    }
    const rec = { id: id };
    const where = tab.sheet + ' row ' + (r + 1) + ' (' + id + ')';
    if (problems && rowOf && rowOf[id]) {
      problems.push(where + ': the id is also used on row ' + rowOf[id] + '. Copied rows need their id cleared, then a new one is filled in.');
    }
    tab.cols.forEach(c => {
      if (c.field === 'id') return;
      const at = index[c.field];
      const raw = at < 0 ? '' : row[at];
      const value = roadmapFromCell_(c, raw, tz);
      rec[c.field] = value;
      if (!problems) return;
      if (c.required && roadmapIsBlank_(raw)) problems.push(where + ': ' + c.header + ' is empty.');
      else if (c.type === 'date' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) problems.push(where + ': ' + c.header + ' "' + value + '" must be a date like 2027-03-15.');
      else if (c.type === 'number' && value !== '' && !isFinite(value)) problems.push(where + ': ' + c.header + ' "' + raw + '" must be a number.');
      else if (c.type === 'enum' && value && ROADMAP_ENUMS[c.values].indexOf(value) < 0) problems.push(where + ': ' + c.header + ' "' + raw + '" must be one of ' + ROADMAP_ENUMS[c.values].slice(0, 6).join(', ') + '.');
    });
    if (rowOf) rowOf[id] = r + 1;
    records.push(rec);
  }
  return records;
}

function roadmapFromCell_(col, value, tz) {
  switch (col.type) {
    case 'number':
      if (roadmapIsBlank_(value)) return col.blank !== undefined ? col.blank : '';
      return typeof value === 'number' ? value : Number(String(value).replace(/[%\s]/g, '').replace(',', '.'));
    case 'bool':
      return roadmapBool_(value);
    case 'date':
      return value instanceof Date ? roadmapDate_(value, tz) : roadmapNormalizeDate_(String(value).trim());
    case 'list':
      return String(value).split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    case 'enum': {
      const text = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
      // Empty → the column default, or undefined so the planner applies its own default.
      if (!text) return col.blank;
      return ROADMAP_ENUM_ALIASES[text] || ROADMAP_ENUM_ALIASES[text.replace(/_/g, '')] || text;
    }
    default:
      return roadmapCellText_(value, tz);
  }
}

function roadmapColumnIndex_(headerRow, tab) {
  const norm = h => String(h).trim().toLowerCase().replace(/\s*\(.*\)\s*$/, '');
  const headers = headerRow.map(norm);
  const index = {};
  tab.cols.forEach(c => {
    let at = headers.indexOf(norm(c.header));
    if (at < 0) at = headers.indexOf(c.field.toLowerCase());
    index[c.field] = at;
  });
  return index;
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Writes the plan so that a failure part-way never leaves a half-written Sheet:
 * every tab's rows are prepared before anything is written, the current values are
 * kept, and if any write fails every tab is put back as it was.
 */
function roadmapSafeWrite_(ss, plan) {
  const snapshot = roadmapSnapshot_(ss);
  try {
    roadmapWrite_(ss, plan);
    SpreadsheetApp.flush();
  } catch (err) {
    let restored = true;
    try { roadmapRestore_(ss, snapshot); SpreadsheetApp.flush(); } catch (again) { restored = false; }
    throw new Error('The plan could not be saved to the Sheet (' + roadmapMessage_(err) + '). ' + (restored
      ? 'The Sheet was left as it was before; try saving again.'
      : 'The Sheet may be incomplete. Restore it from File → Version history, then save again from the planner.'));
  }
}

function roadmapWrite_(ss, plan) {
  const created = roadmapEnsureSheets_(ss);
  // Prepare everything first: nothing below can fail half-way through because of the data.
  const settings = roadmapSettingsRows_(plan);
  const tabs = ROADMAP_TABS.map(tab => roadmapPrepareTab_(ss, tab, plan[tab.key] || [], created[tab.sheet]));
  roadmapWriteSettings_(ss.getSheetByName(ROADMAP_SETTINGS_SHEET), settings, created[ROADMAP_SETTINGS_SHEET]);
  tabs.forEach(roadmapApplyTab_);
}

/** The current values of every planner tab (null for a tab that does not exist yet). */
function roadmapSnapshot_(ss) {
  return [ROADMAP_SETTINGS_SHEET].concat(ROADMAP_TABS.map(t => t.sheet)).map(name => {
    const sh = ss.getSheetByName(name);
    return { name: name, values: sh && sh.getLastRow() > 0 ? sh.getDataRange().getValues() : sh ? [] : null };
  });
}

function roadmapRestore_(ss, snapshot) {
  snapshot.forEach(s => {
    const sh = ss.getSheetByName(s.name);
    if (!sh) return;
    if (sh.getLastRow() > 0) sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 1)).clearContent();
    if (s.values && s.values.length) sh.getRange(1, 1, s.values.length, s.values[0].length).setValues(s.values);
  });
}

/** Creates any missing tabs (in a sensible order) and reports which were new. */
function roadmapEnsureSheets_(ss) {
  const created = {};
  [ROADMAP_SETTINGS_SHEET].concat(ROADMAP_TABS.map(t => t.sheet)).forEach(name => {
    if (!ss.getSheetByName(name)) { ss.insertSheet(name, ss.getSheets().length); created[name] = true; }
  });
  // A brand-new spreadsheet has an empty "Sheet1"; remove it once our tabs exist.
  const blank = ss.getSheetByName('Sheet1');
  if (blank && created[ROADMAP_SETTINGS_SHEET] && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  return created;
}

function roadmapWriteSettings_(sh, rows, isNew) {
  if (isNew) roadmapFormatSettings_(sh);
  sh.clearContents();
  sh.getRange(1, 1, rows.length, 3).setValues(rows);
}

function roadmapSettingsRows_(plan) {
  const keys = ROADMAP_SETTINGS_ORDER.filter(k => k in plan)
    .concat(Object.keys(plan).filter(k => ROADMAP_SETTINGS_ORDER.indexOf(k) < 0 && k !== 'schemaVersion' &&
      !ROADMAP_TABS.some(t => t.key === k)));
  const rows = [['key', 'value', 'about']];
  keys.forEach(k => {
    const v = plan[k];
    rows.push([k, v !== null && typeof v === 'object' ? JSON.stringify(v) : v, ROADMAP_SETTINGS_HELP[k] || '']);
  });
  rows.push(['lastSavedAt', Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd HH:mm 'UTC'"), ROADMAP_SETTINGS_HELP.lastSavedAt]);
  rows.push(['lastSavedBy', roadmapUser_(), ROADMAP_SETTINGS_HELP.lastSavedBy]);
  return rows;
}

/** Works out a tab's new rows (keeping columns people added themselves) without writing anything. */
function roadmapPrepareTab_(ss, tab, records, isNew) {
  const sh = ss.getSheetByName(tab.sheet);
  const existing = sh.getLastRow() > 0 ? sh.getDataRange().getValues() : [];
  const oldHeaders = existing.length ? existing[0].map(h => String(h)) : [];
  const oldIndex = roadmapColumnIndex_(oldHeaders, tab);
  const canonicalAt = new Set(tab.cols.map(c => oldIndex[c.field]).filter(i => i >= 0));

  // Columns people added themselves are kept and follow their row's id.
  const extras = [];
  oldHeaders.forEach((h, i) => { if (h.trim() && !canonicalAt.has(i)) extras.push({ header: h, at: i }); });
  const extraById = {};
  if (extras.length && oldIndex.id >= 0) {
    for (let r = 1; r < existing.length; r++) {
      const id = String(existing[r][oldIndex.id]).trim();
      if (id) extraById[id] = extras.map(x => existing[r][x.at]);
    }
  }

  const headers = tab.cols.map(c => c.header).concat(extras.map(x => x.header));
  const out = [headers];
  records.forEach(rec => {
    const row = tab.cols.map(c => roadmapToCell_(c, rec[c.field]));
    out.push(row.concat(extraById[rec.id] || extras.map(() => '')));
  });

  const layoutChanged = isNew || oldHeaders.slice(0, tab.cols.length).join('\u0001') !== headers.slice(0, tab.cols.length).join('\u0001');
  return { ss: ss, sh: sh, tab: tab, headers: headers, out: out, layoutChanged: layoutChanged,
    oldRows: existing.length, oldCols: oldHeaders.length };
}

function roadmapApplyTab_(p) {
  const ss = p.ss, sh = p.sh, tab = p.tab, headers = p.headers, out = p.out, layoutChanged = p.layoutChanged;
  const existing = { length: p.oldRows }, oldHeaders = { length: p.oldCols };
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  if (sh.getMaxRows() < out.length + 1) sh.insertRowsAfter(sh.getMaxRows(), out.length + 1 - sh.getMaxRows());
  if (layoutChanged) roadmapFormatTab_(ss, sh, tab, headers);
  sh.getRange(1, 1, Math.max(existing.length, 1), Math.max(oldHeaders.length, headers.length)).clearContent();
  sh.getRange(1, 1, out.length, headers.length).setValues(out);
}

function roadmapToCell_(col, value) {
  if (value === undefined || value === null) return col.type === 'bool' ? false : '';
  if (col.type === 'list') return (value || []).join(', ');
  if (col.type === 'bool') return value === true;
  return value;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

function roadmapFormatTab_(ss, sh, tab, headers) {
  const rows = Math.max(sh.getMaxRows() - 1, 1);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e6f1ec').setFontColor('#172b2b');
  const index = roadmapColumnIndex_(headers, tab);
  tab.cols.forEach(c => {
    const at = index[c.field];
    if (at < 0) return;
    const range = sh.getRange(2, at + 1, rows, 1);
    range.setDataValidation(null);
    if (c.type !== 'bool' && c.type !== 'number') range.setNumberFormat('@');
    if (c.type === 'bool') range.insertCheckboxes();
    if (c.type === 'enum') {
      range.setDataValidation(SpreadsheetApp.newDataValidation()
        // Warn instead of reject, so friendly spellings like "In review" can be typed.
        .requireValueInList(ROADMAP_ENUMS[c.values], true).setAllowInvalid(true).build());
    }
    if (c.type === 'ref') {
      const target = ss.getSheetByName(c.ref);
      if (target) range.setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInRange(target.getRange('A2:A'), true).setAllowInvalid(true)
        .setHelpText('Pick an id from the ' + c.ref + ' tab, or leave empty.').build());
    }
    if (c.type === 'date') {
      range.setDataValidation(SpreadsheetApp.newDataValidation()
        .requireFormulaSatisfied('=OR(ISBLANK(' + roadmapA1Col_(at + 1) + '2),REGEXMATCH(TO_TEXT(' + roadmapA1Col_(at + 1) + '2),"^\\d{4}-\\d{2}-\\d{2}$"))')
        .setAllowInvalid(true).setHelpText('Use yyyy-mm-dd, for example 2027-03-15.').build());
    }
    sh.setColumnWidth(at + 1, c.wide ? 280 : c.field === 'id' ? 150 : 120);
  });
}

function roadmapFormatSettings_(sh) {
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#e6f1ec').setFontColor('#172b2b');
  sh.getRange(1, 2, Math.max(sh.getMaxRows(), 1), 1).setNumberFormat('@');
  sh.setColumnWidth(1, 170); sh.setColumnWidth(2, 320); sh.setColumnWidth(3, 420);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function roadmapCheckShape_(plan) {
  if (!plan || plan.schemaVersion !== 1) throw new Error('This is not an Roadmap plan (schemaVersion 1).');
  ROADMAP_TABS.forEach(tab => {
    if (plan[tab.key] !== undefined && !Array.isArray(plan[tab.key])) throw new Error('Plan field ' + tab.key + ' must be a list.');
    (plan[tab.key] || []).forEach(rec => {
      if (!rec || typeof rec.id !== 'string' || !rec.id) throw new Error('Every ' + tab.key + ' record needs an id.');
    });
  });
}

/**
 * Checks a plan sent by the planner before anything is written: every collection is
 * present, required fields are filled, ids are unique and every reference resolves.
 * The planner checks the same rules; this guards the Sheet against a broken or partial payload.
 */
function roadmapValidate_(plan) {
  const problems = [];
  if (typeof plan.name !== 'string' || !plan.name.trim()) problems.push('The plan has no name.');
  ROADMAP_TABS.forEach(tab => { if (!Array.isArray(plan[tab.key])) problems.push('The plan has no ' + tab.key + ' list.'); });
  if (problems.length) throw new Error('Nothing was saved: ' + problems.join(' '));
  if (!plan.workstreams.length) problems.push('A plan needs at least one workstream.');
  const ids = {};
  ROADMAP_TABS.forEach(tab => {
    ids[tab.key] = new Set();
    plan[tab.key].forEach(rec => {
      if (ids[tab.key].has(rec.id)) problems.push(tab.sheet + ': the id "' + rec.id + '" is used twice.');
      ids[tab.key].add(rec.id);
      (ROADMAP_REQUIRED[tab.key] || []).forEach(f => {
        if (roadmapIsBlank_(rec[f]) || (typeof rec[f] === 'string' && !rec[f].trim())) problems.push(tab.sheet + ' "' + (rec.title || rec.name || rec.id) + '": ' + f + ' is empty.');
      });
    });
  });
  const refs = [];
  roadmapCheckRefs_(plan, null, refs);
  problems.push.apply(problems, refs);
  const typeKey = { initiative: 'initiatives', milestone: 'milestones', increment: 'increments' };
  plan.connections.forEach(c => {
    if (!typeKey[c.fromType] || !typeKey[c.toType]) problems.push('Connections: a dependency has an unknown item type.');
    else if (!ids[typeKey[c.fromType]].has(c.from) || !ids[typeKey[c.toType]].has(c.to)) problems.push('Connections: a dependency points to a missing item.');
  });
  if (problems.length) throw new Error('Nothing was saved: ' + problems.slice(0, 5).join(' ') + (problems.length > 5 ? ' (and ' + (problems.length - 5) + ' more)' : ''));
}

function roadmapIsBlank_(v) { return v === '' || v === null || v === undefined; }
function roadmapBool_(v) { return v === true || /^(true|yes|y|1|x|✓)$/i.test(String(v).trim()); }
function roadmapDate_(d, tz) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); }
/** Accepts 2027-3-5, 2027/03/05 and 5.3.2027 (day.month.year); anything else is returned unchanged. */
function roadmapNormalizeDate_(text) {
  const pad = n => String(n).padStart(2, '0');
  let m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/.exec(text);
  if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  m = /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})$/.exec(text);
  if (m) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
  return text;
}
function roadmapCellText_(v, tz) { return v instanceof Date ? roadmapDate_(v, tz) : String(v).trim(); }
function roadmapA1Col_(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function roadmapHeaders_(sh) { return sh.getLastRow() > 0 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : []; }
function roadmapEscapeHtml_(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function roadmapMessage_(err) { return String(err && err.message ? err.message : err); }

function roadmapHash_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
  return bytes.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function roadmapUser_() {
  try { return Session.getActiveUser().getEmail() || 'someone'; } catch (err) { return 'someone'; }
}
