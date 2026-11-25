/**
 * Arc planner — Google Sheets backend.
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

const ARC_ENUMS = {
  status: ['planned', 'discovery', 'building', 'review', 'done'],
  priority: ['critical', 'high', 'medium', 'low'],
  health: ['on_track', 'at_risk', 'blocked'],
  shape: ['star', 'diamond', 'circle', 'flag', 'square'],
  color: ['blue', 'amber', 'teal', 'rose', 'violet', 'slate'].concat(
    Array.from({ length: 18 }, (_, i) => 'color' + (i + 7))),
  itemType: ['initiative', 'milestone', 'increment']
};

// Friendly spellings people may type in the Sheet → stored value.
const ARC_ENUM_ALIASES = {
  in_review: 'review', reviewing: 'review', complete: 'done', completed: 'done',
  ontrack: 'on_track', atrisk: 'at_risk', red: 'rose'
};

const ARC_SETTINGS_SHEET = 'Settings';
const ARC_META_KEYS = ['lastSavedAt', 'lastSavedBy'];
const ARC_SETTINGS_ORDER = ['name', 'description', 'year', 'reviewDateMode', 'reviewDate', 'timelineColor', 'example', 'id',
  'colorScheme', 'customColorSchemes', 'customPaletteRecipes'];
const ARC_SETTINGS_HELP = {
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
const ARC_TABS = [
  { key: 'workstreams', sheet: 'Workstreams', cols: [
    { field: 'id' },
    { field: 'name' },
    { field: 'color', type: 'enum', values: 'color' },
    { field: 'customColor', header: 'customColor (#hex)' },
    { field: 'description', wide: true }
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
    { field: 'notes', wide: true }
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
    { field: 'date', type: 'date' },
    { field: 'done', type: 'bool' },
    { field: 'shape', type: 'enum', values: 'shape' },
    { field: 'color', type: 'enum', values: 'color' },
    { field: 'showLine', type: 'bool' },
    { field: 'increment', type: 'ref', ref: 'Increments' },
    { field: 'initiatives', type: 'list' },
    { field: 'description', wide: true }
  ] },
  { key: 'increments', sheet: 'Increments', cols: [
    { field: 'id' },
    { field: 'title', wide: true },
    { field: 'start', type: 'date' },
    { field: 'end', type: 'date' },
    { field: 'color', type: 'enum', values: 'color' },
    { field: 'description', wide: true }
  ] },
  { key: 'connections', sheet: 'Connections', cols: [
    { field: 'id' },
    { field: 'fromType', type: 'enum', values: 'itemType' },
    { field: 'from' },
    { field: 'toType', type: 'enum', values: 'itemType' },
    { field: 'to' }
  ] }
];
const ARC_REQUIRED = {"workstreams":["name"],"initiatives":["title","stream","start","end"],"outcomes":["title","metric","baseline","target","due"],"milestones":["title","date"],"increments":["title","start","end"],"connections":["fromType","from","toType","to"]};
ARC_TABS.forEach(tab => tab.cols.forEach(c => {
  c.header = c.header || c.field;
  c.type = c.type || 'text';
  c.required = (ARC_REQUIRED[tab.key] || []).indexOf(c.field) >= 0;
}));

/* ------------------------------------------------------------------ */
/* Sheet menu                                                          */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Arc')
    .addItem('Open planner', 'openPlanner')
    .addItem('Set planner link…', 'setPlannerLink')
    .addSeparator()
    .addItem('Reapply tab formatting', 'reapplyFormatting')
    .addToUi();
}

// The deployed web app link: https://script.google.com/[a/macros/<domain>/]macros/s/<id>/exec
// (Workspace links look like https://script.google.com/a/macros/<domain>/s/<id>/exec.)
const ARC_WEB_APP_URL_RE = /^https:\/\/script\.google\.com\/(?:a\/macros\/[^\/\s]+\/|macros\/)s\/[\w-]+\/exec$/;

/**
 * Asks for the web app's /exec link and stores it as the WEB_APP_URL script property.
 * ScriptApp.getService().getUrl() is not used: in a Sheet-bound script it often returns
 * the /dev test link or an older deployment instead of the live one.
 * Returns the saved link, or null if the person cancelled.
 */
function setPlannerLink() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const current = props.getProperty('WEB_APP_URL');
  let hint = 'In Apps Script choose Deploy → Manage deployments, select the web app, and copy its Web app URL (it ends in /exec).';
  if (current) hint += '\n\nCurrent link:\n' + current;
  for (;;) {
    const res = ui.prompt('Planner link', hint, ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return null;
    const url = res.getResponseText().trim().replace(/[?#].*$/, '');
    if (ARC_WEB_APP_URL_RE.test(url)) {
      props.setProperty('WEB_APP_URL', url);
      return url;
    }
    hint = (/\/dev$/.test(url)
      ? 'That is the /dev test link, which only works for editors and runs unsaved code. '
      : 'That does not look like a web app link. ') +
      'Paste the Web app URL from Deploy → Manage deployments. It ends in /exec.';
  }
}

function openPlanner() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());
  let url = props.getProperty('WEB_APP_URL');
  // Set by apps-script/deploy.mjs in Deployment.gs; used when no link was saved by hand.
  if (!url || !ARC_WEB_APP_URL_RE.test(url)) url = typeof ARC_DEPLOYED_URL === 'string' ? ARC_DEPLOYED_URL : '';
  if (!url || !ARC_WEB_APP_URL_RE.test(url)) url = setPlannerLink();
  if (!url) return;
  const safe = arcEscapeHtml_(url);
  const html = HtmlService.createHtmlOutput(
    '<div style="font:14px/1.5 Arial,sans-serif;padding:4px 2px">' +
    '<p style="margin:0 0 14px">The planner opens in a new browser tab.</p>' +
    '<a href="' + safe + '" target="_blank" rel="noopener" onclick="setTimeout(function(){google.script.host.close()},400)" ' +
    'style="display:inline-block;background:#276d51;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none;font-weight:600">Open Arc planner</a>' +
    '</div>'
  ).setWidth(320).setHeight(120);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Arc planner');
}

function reapplyFormatting() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  arcEnsureSheets_(ss);
  ARC_TABS.forEach(tab => {
    const sh = ss.getSheetByName(tab.sheet);
    arcFormatTab_(ss, sh, tab, arcHeaders_(sh));
  });
  arcFormatSettings_(ss.getSheetByName(ARC_SETTINGS_SHEET));
}

/* ------------------------------------------------------------------ */
/* Web app                                                             */
/* ------------------------------------------------------------------ */

function doGet() {
  const boot = { plan: null, revision: null, error: null };
  try {
    const current = arcRead_(arcSpreadsheet_());
    boot.plan = current.plan;
    boot.revision = current.revision;
    boot.problems = current.problems || [];
    boot.savedBy = current.savedBy;
    boot.savedAt = current.savedAt;
  } catch (err) {
    boot.error = arcMessage_(err);
  }
  const html = HtmlService.createHtmlOutputFromFile('Index').getContent();
  const marker = '/*ARC_SHEET_BOOT*/null';
  if (html.indexOf(marker) < 0) throw new Error('Index.html is missing the ARC_SHEET_BOOT marker. Rebuild it with build.mjs.');
  const json = JSON.stringify(boot).replace(/</g, '\\u003c');
  const name = boot.plan && boot.plan.name ? boot.plan.name : 'Arc';
  return HtmlService.createHtmlOutput(html.replace(marker, () => json))
    .setTitle(name + ' — Arc')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** Returns the current plan and its revision hash. */
function getPlan() {
  return arcRead_(arcSpreadsheet_());
}

/** Cheap-enough change check used by the planner when it regains focus. */
function getRevision() {
  const current = arcRead_(arcSpreadsheet_());
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
    const ss = arcSpreadsheet_();
    let current = null;
    try { current = arcRead_(ss); } catch (err) { current = { revision: 'unreadable', error: arcMessage_(err) }; }
    if (!force && current.revision !== baseRevision) {
      return { ok: false, conflict: true, plan: current.plan || null, revision: current.revision,
        savedBy: current.savedBy || '', savedAt: current.savedAt || '', error: current.error || null };
    }
    const plan = JSON.parse(json);
    arcCheckShape_(plan);
    arcWrite_(ss, plan);
    SpreadsheetApp.flush();
    const after = arcRead_(ss);
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

function arcSpreadsheet_() {
  let active = null;
  try { active = SpreadsheetApp.getActiveSpreadsheet(); } catch (err) { active = null; }
  if (active) return active;
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  throw new Error('The planner does not know which Sheet to use yet. Open the Sheet and choose Arc → Open planner once.');
}

/** Reads the plan from the tabs. plan is null when the Sheet has not been set up yet. */
function arcRead_(ss) {
  const settings = ss.getSheetByName(ARC_SETTINGS_SHEET);
  if (!settings) return { plan: null, revision: 'empty', savedBy: '', savedAt: '' };
  const tz = ss.getSpreadsheetTimeZone();
  const plan = { schemaVersion: 1 };
  const meta = {};
  const rows = settings.getDataRange().getValues();
  for (let r = 1; r < rows.length; r++) {
    const key = String(rows[r][0]).trim();
    if (!key || key === 'schemaVersion') continue;
    if (ARC_META_KEYS.indexOf(key) >= 0) { meta[key] = arcCellText_(rows[r][1], tz); continue; }
    plan[key] = arcParseSetting_(key, rows[r][1], tz);
  }
  const problems = [], rowOf = {};
  ARC_TABS.forEach(tab => {
    rowOf[tab.key] = {};
    plan[tab.key] = arcReadTab_(ss, tab, tz, problems, rowOf[tab.key]);
  });
  arcCheckRefs_(plan, rowOf, problems);
  const revision = arcHash_(JSON.stringify(plan));
  return { plan: plan, revision: revision, problems: problems.slice(0, 25),
    savedBy: meta.lastSavedBy || '', savedAt: meta.lastSavedAt || '' };
}

/** Points at links between tabs that lead nowhere, by tab and row. */
function arcCheckRefs_(plan, rowOf, problems) {
  const ids = key => new Set((plan[key] || []).map(r => r.id));
  const sets = { workstreams: ids('workstreams'), outcomes: ids('outcomes'), increments: ids('increments'),
    initiatives: ids('initiatives'), milestones: ids('milestones') };
  const at = (key, rec) => arcTabName_(key) + ' row ' + rowOf[key][rec.id] + ' (' + (rec.title || rec.name || rec.id) + ')';
  const check = (key, field, target, many) => (plan[key] || []).forEach(rec => {
    const values = many ? rec[field] || [] : rec[field] ? [rec[field]] : [];
    values.forEach(v => { if (!sets[target].has(v)) problems.push(at(key, rec) + ': ' + (field === 'stream' ? 'workstream' : field) + ' "' + v + '" is not an id on the ' + arcTabName_(target) + ' tab.'); });
  });
  check('initiatives', 'stream', 'workstreams');
  check('initiatives', 'outcome', 'outcomes');
  check('initiatives', 'increment', 'increments');
  check('initiatives', 'dependencies', 'initiatives', true);
  check('milestones', 'increment', 'increments');
  check('milestones', 'initiatives', 'initiatives', true);
}

function arcTabName_(key) { const tab = ARC_TABS.filter(t => t.key === key)[0]; return tab ? tab.sheet : key; }

function arcParseSetting_(key, value, tz) {
  if (key === 'year') return value === '' ? '' : Number(value);
  if (key === 'example') return arcBool_(value);
  if (value instanceof Date) return arcDate_(value, tz);
  const text = String(value).trim();
  if (/^[\[{]/.test(text)) {
    try { return JSON.parse(text); } catch (err) { throw new Error('Settings → ' + key + ' is not valid JSON.'); }
  }
  return text;
}

function arcReadTab_(ss, tab, tz, problems, rowOf) {
  const sh = ss.getSheetByName(tab.sheet);
  if (!sh) return [];
  const values = sh.getDataRange().getValues();
  if (!values.length) return [];
  const index = arcColumnIndex_(values[0], tab);
  if (index.id < 0) throw new Error('The ' + tab.sheet + ' tab needs an "id" column.');
  const records = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const blank = tab.cols.every(c => index[c.field] < 0 || c.type === 'bool' || arcIsBlank_(row[index[c.field]]));
    if (blank) continue;
    let id = arcCellText_(row[index.id], tz);
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
      const value = arcFromCell_(c, raw, tz);
      rec[c.field] = value;
      if (!problems) return;
      if (c.required && arcIsBlank_(raw)) problems.push(where + ': ' + c.header + ' is empty.');
      else if (c.type === 'date' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) problems.push(where + ': ' + c.header + ' "' + value + '" must be a date like 2027-03-15.');
      else if (c.type === 'number' && value !== '' && !isFinite(value)) problems.push(where + ': ' + c.header + ' "' + raw + '" must be a number.');
      else if (c.type === 'enum' && value && ARC_ENUMS[c.values].indexOf(value) < 0) problems.push(where + ': ' + c.header + ' "' + raw + '" must be one of ' + ARC_ENUMS[c.values].slice(0, 6).join(', ') + '.');
    });
    if (rowOf) rowOf[id] = r + 1;
    records.push(rec);
  }
  return records;
}

function arcFromCell_(col, value, tz) {
  switch (col.type) {
    case 'number':
      if (arcIsBlank_(value)) return col.blank !== undefined ? col.blank : '';
      return typeof value === 'number' ? value : Number(String(value).replace(/[%\s]/g, '').replace(',', '.'));
    case 'bool':
      return arcBool_(value);
    case 'date':
      return value instanceof Date ? arcDate_(value, tz) : arcNormalizeDate_(String(value).trim());
    case 'list':
      return String(value).split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    case 'enum': {
      const text = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
      // Empty → the column default, or undefined so the planner applies its own default.
      if (!text) return col.blank;
      return ARC_ENUM_ALIASES[text] || ARC_ENUM_ALIASES[text.replace(/_/g, '')] || text;
    }
    default:
      return arcCellText_(value, tz);
  }
}

function arcColumnIndex_(headerRow, tab) {
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

function arcWrite_(ss, plan) {
  const created = arcEnsureSheets_(ss);
  arcWriteSettings_(ss.getSheetByName(ARC_SETTINGS_SHEET), plan, created[ARC_SETTINGS_SHEET]);
  ARC_TABS.forEach(tab => arcWriteTab_(ss, tab, plan[tab.key] || [], created[tab.sheet]));
}

/** Creates any missing tabs (in a sensible order) and reports which were new. */
function arcEnsureSheets_(ss) {
  const created = {};
  [ARC_SETTINGS_SHEET].concat(ARC_TABS.map(t => t.sheet)).forEach(name => {
    if (!ss.getSheetByName(name)) { ss.insertSheet(name, ss.getSheets().length); created[name] = true; }
  });
  // A brand-new spreadsheet has an empty "Sheet1"; remove it once our tabs exist.
  const blank = ss.getSheetByName('Sheet1');
  if (blank && created[ARC_SETTINGS_SHEET] && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  return created;
}

function arcWriteSettings_(sh, plan, isNew) {
  const keys = ARC_SETTINGS_ORDER.filter(k => k in plan)
    .concat(Object.keys(plan).filter(k => ARC_SETTINGS_ORDER.indexOf(k) < 0 && k !== 'schemaVersion' &&
      !ARC_TABS.some(t => t.key === k)));
  const rows = [['key', 'value', 'about']];
  keys.forEach(k => {
    const v = plan[k];
    rows.push([k, v !== null && typeof v === 'object' ? JSON.stringify(v) : v, ARC_SETTINGS_HELP[k] || '']);
  });
  rows.push(['lastSavedAt', Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd HH:mm 'UTC'"), ARC_SETTINGS_HELP.lastSavedAt]);
  rows.push(['lastSavedBy', arcUser_(), ARC_SETTINGS_HELP.lastSavedBy]);
  if (isNew) arcFormatSettings_(sh);
  sh.clearContents();
  sh.getRange(1, 1, rows.length, 3).setValues(rows);
}

function arcWriteTab_(ss, tab, records, isNew) {
  const sh = ss.getSheetByName(tab.sheet);
  const existing = sh.getLastRow() > 0 ? sh.getDataRange().getValues() : [];
  const oldHeaders = existing.length ? existing[0].map(h => String(h)) : [];
  const oldIndex = arcColumnIndex_(oldHeaders, tab);
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
    const row = tab.cols.map(c => arcToCell_(c, rec[c.field]));
    out.push(row.concat(extraById[rec.id] || extras.map(() => '')));
  });

  const layoutChanged = isNew || oldHeaders.slice(0, tab.cols.length).join('\u0001') !== headers.slice(0, tab.cols.length).join('\u0001');
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  if (sh.getMaxRows() < out.length + 1) sh.insertRowsAfter(sh.getMaxRows(), out.length + 1 - sh.getMaxRows());
  if (layoutChanged) arcFormatTab_(ss, sh, tab, headers);
  sh.getRange(1, 1, Math.max(existing.length, 1), Math.max(oldHeaders.length, headers.length)).clearContent();
  sh.getRange(1, 1, out.length, headers.length).setValues(out);
}

function arcToCell_(col, value) {
  if (value === undefined || value === null) return col.type === 'bool' ? false : '';
  if (col.type === 'list') return (value || []).join(', ');
  if (col.type === 'bool') return value === true;
  return value;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

function arcFormatTab_(ss, sh, tab, headers) {
  const rows = Math.max(sh.getMaxRows() - 1, 1);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e6f1ec').setFontColor('#172b2b');
  const index = arcColumnIndex_(headers, tab);
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
        .requireValueInList(ARC_ENUMS[c.values], true).setAllowInvalid(true).build());
    }
    if (c.type === 'ref') {
      const target = ss.getSheetByName(c.ref);
      if (target) range.setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInRange(target.getRange('A2:A'), true).setAllowInvalid(true)
        .setHelpText('Pick an id from the ' + c.ref + ' tab, or leave empty.').build());
    }
    if (c.type === 'date') {
      range.setDataValidation(SpreadsheetApp.newDataValidation()
        .requireFormulaSatisfied('=OR(ISBLANK(' + arcA1Col_(at + 1) + '2),REGEXMATCH(TO_TEXT(' + arcA1Col_(at + 1) + '2),"^\\d{4}-\\d{2}-\\d{2}$"))')
        .setAllowInvalid(true).setHelpText('Use yyyy-mm-dd, for example 2027-03-15.').build());
    }
    sh.setColumnWidth(at + 1, c.wide ? 280 : c.field === 'id' ? 150 : 120);
  });
}

function arcFormatSettings_(sh) {
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#e6f1ec').setFontColor('#172b2b');
  sh.getRange(1, 2, Math.max(sh.getMaxRows(), 1), 1).setNumberFormat('@');
  sh.setColumnWidth(1, 170); sh.setColumnWidth(2, 320); sh.setColumnWidth(3, 420);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function arcCheckShape_(plan) {
  if (!plan || plan.schemaVersion !== 1) throw new Error('This is not an Arc plan (schemaVersion 1).');
  ARC_TABS.forEach(tab => {
    if (plan[tab.key] !== undefined && !Array.isArray(plan[tab.key])) throw new Error('Plan field ' + tab.key + ' must be a list.');
    (plan[tab.key] || []).forEach(rec => {
      if (!rec || typeof rec.id !== 'string' || !rec.id) throw new Error('Every ' + tab.key + ' record needs an id.');
    });
  });
}

function arcIsBlank_(v) { return v === '' || v === null || v === undefined; }
function arcBool_(v) { return v === true || /^(true|yes|y|1|x|✓)$/i.test(String(v).trim()); }
function arcDate_(d, tz) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); }
/** Accepts 2027-3-5, 2027/03/05 and 5.3.2027 (day.month.year); anything else is returned unchanged. */
function arcNormalizeDate_(text) {
  const pad = n => String(n).padStart(2, '0');
  let m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/.exec(text);
  if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  m = /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})$/.exec(text);
  if (m) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
  return text;
}
function arcCellText_(v, tz) { return v instanceof Date ? arcDate_(v, tz) : String(v).trim(); }
function arcA1Col_(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function arcHeaders_(sh) { return sh.getLastRow() > 0 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : []; }
function arcEscapeHtml_(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function arcMessage_(err) { return String(err && err.message ? err.message : err); }

function arcHash_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
  return bytes.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function arcUser_() {
  try { return Session.getActiveUser().getEmail() || 'someone'; } catch (err) { return 'someone'; }
}
