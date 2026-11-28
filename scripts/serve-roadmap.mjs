import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';

// Keep the same origin on every start so the browser can reopen its saved plan.
const host = '127.0.0.1';
const port = 6744;
const url = `http://${host}:${port}/`;
const planner = new URL('../roadmap.html', import.meta.url);

function openBrowser() {
  console.log(`Open ${url}`);
  execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], error => {
    if (error) console.error('Open the address above in your browser.');
  });
}

const server = createServer(async (request, response) => {
  const path = request.url.split('?')[0];
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  if (path !== '/' && path !== '/roadmap.html') {
    response.writeHead(404).end();
    return;
  }
  try {
    const html = await readFile(planner);
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : html);
  } catch (error) {
    console.error(error.message);
    response.writeHead(500).end('Could not read roadmap.html.');
  }
});

server.on('error', async error => {
  if (error.code === 'EADDRINUSE') {
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(3000) });
      const existing = await response.text();
      const local = await readFile(planner, 'utf8');
      if (response.ok && existing.replaceAll('\r\n', '\n') === local.replaceAll('\r\n', '\n')) {
        openBrowser();
        return;
      }
    } catch { /* Report the occupied port below. */ }
    console.error(`Port ${port} is in use. Close the other server and run the launcher again.`);
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log('Roadmap is running. Press Ctrl+C in this window to stop it.');
  openBrowser();
});
