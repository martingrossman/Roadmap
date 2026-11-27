// Builds the Google Apps Script project from ../roadmap.html.
//   node apps-script/build.mjs
// Output (apps-script/dist): Code.gs, appsscript.json, Index.html (planner + Sheet bridge),
// PdfVendor.html / PdfFonts.html / PdfExport.html (PDF engine, loaded only on export).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'src'), dist = join(here, 'dist');
const input = process.argv[2] || join(here, '..', 'roadmap.html');
let html = readFileSync(input, 'utf8').replace(/\r\n/g, '\n');

function replaceOnce(haystack, find, replacement, label) {
  const first = haystack.indexOf(find);
  if (first < 0 || haystack.indexOf(find, first + 1) >= 0) {
    throw new Error(`Build step "${label}" expected exactly one match. The planner HTML has changed; update build.mjs.`);
  }
  return haystack.slice(0, first) + replacement + haystack.slice(first + find.length);
}

// 1. Pull the PDF engine out of the page.
const pdfOpen = '<script id="pdf-engine">\n', pdfClose = '</script>\n<script>\n';
const a = html.indexOf(pdfOpen), b = html.indexOf(pdfClose, a);
if (a < 0 || b < 0) throw new Error('Could not find the pdf-engine script.');
const engine = html.slice(a + pdfOpen.length, b);
const fontsAt = engine.indexOf(';globalThis.RoadmapPDFFonts=');
const exportAt = engine.indexOf('/* Roadmap PDF export.');
if (fontsAt < 0 || exportAt < fontsAt) throw new Error('Could not split the PDF engine into vendor / fonts / export parts.');
const pdfParts = {
  PdfVendor: engine.slice(0, fontsAt),
  PdfFonts: engine.slice(fontsAt, exportAt),
  PdfExport: engine.slice(exportAt)
};

// 2. Put the Sheet bridge where the engine was, and tag the planner script.
const bridge = readFileSync(join(src, 'sheet-bridge.js'), 'utf8').replace(/\r\n/g, '\n');
if (bridge.includes('</script')) throw new Error('sheet-bridge.js must not contain "</script".');
html = html.slice(0, a) +
  '<script id="roadmap-sheet-boot">window.ROADMAP_SHEET_BOOT=/*ROADMAP_SHEET_BOOT*/null;</script>\n' +
  '<script id="roadmap-sheet-bridge">\n' + bridge + '</script>\n<script id="roadmap-app">\n' +
  html.slice(b + pdfClose.length);

// 3. Small hooks in the planner so it uses the Sheet when the bridge is active.
html = replaceOnce(html,
  "catch(e){initialPlan=validatePlan(samplePlan());startupMessage='The embedded plan could not be loaded. The example plan is shown.';}",
  "catch(e){globalThis.RoadmapLoadError=e&&e.message||String(e);initialPlan=validatePlan(samplePlan());startupMessage='The embedded plan could not be loaded. The example plan is shown.';}",
  'record load error');
html = replaceOnce(html,
  'let loadedPlan=initialPlan;try{const s=localStorage.getItem(STORAGE_KEY);',
  'let loadedPlan=initialPlan;try{const s=globalThis.RoadmapSheet?null:localStorage.getItem(STORAGE_KEY);',
  'skip browser copy in Sheet mode');
html = replaceOnce(html,
  'function persist(){',
  'function persist(){if(globalThis.RoadmapSheet)return RoadmapSheet.persist();',
  'save to Sheet');
html = replaceOnce(html,
  "if(!globalThis.RoadmapPDF)throw Error('The PDF exporter did not load.",
  "if(!globalThis.RoadmapPDF&&globalThis.RoadmapSheet)await RoadmapSheet.loadPdfEngine();if(!globalThis.RoadmapPDF)throw Error('The PDF exporter did not load.",
  'load PDF engine on demand');
html = replaceOnce(html,
  "function exportHTML(){const doc=new DOMParser().parseFromString(ORIGINAL_HTML,'text/html'),snapshot=clone(state.plan);",
  "async function exportHTML(){if(globalThis.RoadmapSheet)try{await RoadmapSheet.loadPdfEngine();}catch(e){}const doc=new DOMParser().parseFromString(ORIGINAL_HTML,'text/html'),snapshot=clone(state.plan);if(globalThis.RoadmapSheet)RoadmapSheet.cleanExport(doc);",
  'clean HTML export');

// 4. Write the project.
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'Index.html'), html);
// Apps Script parses every .html file, so raw JavaScript is rejected as "Malformed HTML".
// Wrapping each part in <script> makes it valid HTML; getPdfEngine() strips the wrapper again.
for (const [name, code] of Object.entries(pdfParts)) {
  if (code.includes('</script')) throw new Error(name + ' must not contain "</script".');
  writeFileSync(join(dist, name + '.html'), '<script>\n' + code + '\n</script>\n');
}
copyFileSync(join(src, 'Code.gs'), join(dist, 'Code.gs'));
// The live demo's example plan, for Roadmap → Load demo plan in the Sheet.
{
  const start = html.indexOf('function samplePlan(){');
  if (start < 0) throw new Error('Build step "demo plan" could not find samplePlan() in the planner HTML; update build.mjs.');
  let depth = 0, end = html.indexOf('{', start);
  for (; end < html.length; end++) { if (html[end] === '{') depth++; else if (html[end] === '}' && --depth === 0) break; }
  const demo = new Function(html.slice(start, end + 1) + ';return samplePlan();')();
  // The example gallery: examplePlans() follows samplePlan() and uses it for the advanced example.
  const ex = html.indexOf('function examplePlans(){');
  if (ex < 0) throw new Error('Build step "examples" could not find examplePlans() in the planner HTML; update build.mjs.');
  let depth2 = 0, end2 = html.indexOf('{', ex);
  for (; end2 < html.length; end2++) { if (html[end2] === '{') depth2++; else if (html[end2] === '}' && --depth2 === 0) break; }
  const examples = new Function(html.slice(start, end + 1) + '\n' + html.slice(ex, end2 + 1) + ';return examplePlans();')()
    .map(x => ({ key: x.key, title: x.title, description: x.description, plan: x.plan }));
  writeFileSync(join(dist, 'DemoPlan.gs'),
    '// Generated by build.mjs from roadmap.html: the live demo plan and the example gallery.\n' +
    'const ROADMAP_DEMO_PLAN = ' + JSON.stringify(demo, null, 1) + ';\n' +
    'const ROADMAP_EXAMPLES = ' + JSON.stringify(examples, null, 1) + ';\n');
}
// `clasp clone` downloads Google's starter Code.js; with our Code.gs it makes clasp report "Conflicting files".
const starter = join(dist, 'Code.js');
if (existsSync(starter) && readFileSync(starter, 'utf8').replace(/[^A-Za-z(){}]/g, '') === 'functionmyFunction(){}') {
  rmSync(starter);
  console.log('Removed the starter Code.js that clasp clone downloaded.');
}
copyFileSync(join(src, 'appsscript.json'), join(dist, 'appsscript.json'));

const kb = s => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
console.log('Index.html', kb(html));
for (const [name, code] of Object.entries(pdfParts)) console.log(name + '.html', kb(code));
