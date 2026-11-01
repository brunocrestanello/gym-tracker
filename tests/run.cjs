// Real IndexedDB in an isolated Chromium profile. No access to the installed PWA.
const { webpack } = require('next/dist/compiled/webpack/webpack');
const { spawn } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const http = require('node:http');
(async () => {
  mkdirSync('work', { recursive: true });
  await new Promise((resolve, reject) => webpack({ mode: 'development', devtool: false, entry: path.resolve('tests/browser.js'), output: { path: path.resolve('work/tests'), filename: 'suite.js' }, resolve: { extensions: ['.ts', '.tsx', '.js'], alias: { '@': path.resolve('src') } }, module: { rules: [{ test: /\.tsx?$/, use: path.resolve('tests/ts-loader.cjs') }] } }, (error, stats) => error || stats.hasErrors() ? reject(error || Error(stats.toString())) : resolve()));
  const profile = mkdtempSync(path.join(tmpdir(), 'gym-tracker-test-'));
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<script>' + readFileSync('work/tests/suite.js', 'utf8').replaceAll('</script', '<\\/script') + '</script>'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const chrome = spawn(process.env.CHROMIUM_PATH || 'chromium', ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank']);
  let ws;
  const timeout = setTimeout(() => { console.error('Browser tests timed out'); chrome.kill(); process.exitCode = 1; }, 60000);
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let log = '';
      chrome.stderr.on('data', chunk => { log += chunk; const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) resolve(match[1]); });
      chrome.on('error', reject);
      chrome.on('exit', code => reject(Error('Chromium exited: ' + code)));
    });
    ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0;
    const callbacks = new Map();
    ws.onmessage = ({data}) => { const message = JSON.parse(data); if (callbacks.has(message.id)) { const {resolve,reject} = callbacks.get(message.id); callbacks.delete(message.id); if (message.error) reject(Error(JSON.stringify(message.error))); else resolve(message.result); } };
    const send = (method, params = {}, sessionId) => new Promise((resolve,reject) => { const next = ++id; callbacks.set(next, {resolve,reject}); ws.send(JSON.stringify({id: next, method, params, sessionId})); });
    const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
    const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
    await send('Page.enable', {}, sessionId);
    await send('Page.navigate', {url: `http://127.0.0.1:${server.address().port}`}, sessionId);
    let result;
    for (let attempt = 0; attempt < 100; attempt++) {
      result = await send('Runtime.evaluate', {expression: 'window.testResults', awaitPromise: true, returnByValue: true}, sessionId);
      if (result.result.value) break;
      await new Promise(r => setTimeout(r, 100));
    }
    if (!result.result.value) throw Error('No test result: ' + JSON.stringify(result));
    for (const test of result.result.value) console.log(`${test.error ? 'FAIL' : 'PASS'} ${test.name}${test.error ? '\n' + test.error : ''}`);
    if (result.result.value.some(t => t.error)) process.exitCode = 1;
    console.log(`${result.result.value.filter(t => !t.error).length}/${result.result.value.length} passed`);
  } finally { clearTimeout(timeout); ws?.close(); chrome.kill(); server.close(); setTimeout(() => rmSync(profile, {recursive: true, force: true}), 500); }
})().catch(error => { console.error(error); process.exitCode = 1; });
