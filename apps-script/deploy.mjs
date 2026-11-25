// Builds, uploads and deploys the planner to your Apps Script project in one step,
// and tells the Sheet's Roadmap menu the web app link, so nobody has to paste it.
//
//   node apps-script/deploy.mjs                  redeploy the existing web app (link stays the same)
//   node apps-script/deploy.mjs -d "What changed" set the deployment description
//   node apps-script/deploy.mjs --id AKfy...      choose a deployment when there are several
//
// Needs clasp, logged in, and apps-script/dist/.clasp.json (see README → Using clasp).
// The link is written to dist/Deployment.gs (git-ignored, specific to your project).
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const linkFile = join(dist, 'Deployment.gs');

const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

if (!existsSync(join(dist, '.clasp.json'))) {
  console.error('apps-script/dist/.clasp.json is missing. Link your Apps Script project first: see README → Using clasp.');
  process.exit(1);
}

const clasp = cmd => execSync('clasp ' + cmd, { cwd: dist, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const quote = s => '"' + String(s).replace(/"/g, '\\"') + '"';

// 1. Build.
execSync('node ' + quote(join(here, 'build.mjs')), { stdio: 'inherit' });

// 2. Pick the web app deployment to update.
let id = arg('--id');
if (!id && existsSync(linkFile)) {
  const m = readFileSync(linkFile, 'utf8').match(/\/s\/([\w-]+)\/exec/);
  if (m) id = m[1];
}
const deployments = JSON.parse(clasp('list-deployments --json'));
if (id && !deployments.some(d => d.deploymentId === id)) {
  console.error(`Deployment ${id} no longer exists. Run again with --id, or delete dist/Deployment.gs to choose automatically.`);
  process.exit(1);
}
if (!id) {
  // The @HEAD deployment (no version number) is the /dev test link; skip it.
  const live = deployments.filter(d => d.versionNumber);
  if (live.length > 1) {
    console.error('Several deployments exist. Choose one with --id:\n' +
      live.map(d => `  ${d.deploymentId}  @${d.versionNumber}  ${d.description || ''}`).join('\n'));
    process.exit(1);
  }
  if (live.length === 1) {
    id = live[0].deploymentId;
  } else {
    console.log('No web app deployment yet. Creating one.');
    clasp('push --force');
    const out = clasp('create-deployment -d ' + quote('Roadmap planner'));
    const m = out.match(/AKfyc[\w-]+/);
    if (!m) { console.error('Could not read the new deployment id from clasp:\n' + out); process.exit(1); }
    id = m[0];
  }
}
const url = `https://script.google.com/macros/s/${id}/exec`;

// 3. Tell the Roadmap menu the link, upload, and point the deployment at the new code.
writeFileSync(linkFile,
  '// Written by apps-script/deploy.mjs. The web app link Roadmap → Open planner uses.\n' +
  `const ROADMAP_DEPLOYED_URL = '${url}';\n`);
clasp('push --force');
let description = arg('-d') || arg('--description');
if (!description) {
  try { description = execSync('git log -1 --format=%s', { cwd: here, encoding: 'utf8' }).trim(); } catch (e) { description = 'Roadmap planner'; }
}
process.stdout.write(clasp(`update-deployment ${id} -d ${quote(description.slice(0, 100))}`));

console.log('\nDeployed. Reload the Sheet, then choose 🗺️ Roadmap → Open planner.\nWeb app link: ' + url);
