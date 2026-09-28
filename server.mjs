import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ModelManager } from './lib/manager.mjs';
import { AppError, checkSafeJson, isObject } from './lib/catalog.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']]
]);

async function readBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new AppError('请求需要 JSON 内容。', 415);
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 4 * 1024 * 1024) throw new AppError('配置超过 4 MB，请缩小内容。', 413);
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError('请求不是有效的 JSON。'); }
  if (!isObject(body)) throw new AppError('请求需要一个 JSON 对象。');
  checkSafeJson(body);
  return body;
}

export async function createApp({ manager, port = 0 } = {}) {
  const token = randomBytes(32).toString('hex');
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const send = (status, value, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
    };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      if (req.headers.host !== new URL(origin).host) throw new AppError('仅允许本机地址访问。', 403);
      if (req.headers.origin && req.headers.origin !== origin) throw new AppError('已拒绝跨站请求。', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new AppError('已拒绝跨站请求。', 403);
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [name, mime] = assets.get(url.pathname);
        return send(200, await fs.readFile(path.join(root, 'public', name)), mime);
      }
      if (req.method === 'GET' && url.pathname === '/api/session') return send(200, { token });
      if (url.pathname.startsWith('/api/')) {
        if (req.headers['x-app-token'] !== token) throw new AppError('会话已失效，请刷新页面。', 403);
        if (req.method === 'GET' && url.pathname === '/api/state') return send(200, await manager.getState());
        if (req.method !== 'POST') throw new AppError('不支持的请求方式。', 405);
        const body = await readBody(req);
        let value;
        switch (url.pathname) {
          case '/api/refresh': value = await manager.refresh(); break;
          case '/api/settings': value = await manager.setCli(body.cliPath); break;
          case '/api/custom': value = await manager.saveCustom(body); break;
          case '/api/preview': value = await manager.previewDraft(body.models); break;
          case '/api/apply': value = await manager.apply(body); break;
          case '/api/restore': value = await manager.restore(body); break;
          default: throw new AppError('接口不存在。', 404);
        }
        return send(200, value);
      }
      throw new AppError('页面不存在。', 404);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) send(error.status || 500, { error: error.message, detail: error.detail || '' });
    }
  });
  server.requestTimeout = 35000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

function parseArgs(args) {
  const options = { port: 4317, dataDir: path.join(root, 'data'), open: false };
  const values = { '--port': 'port', '--data-dir': 'dataDir', '--codex-home': 'codexHome', '--cli': 'cliPath' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--open') options.open = true;
    else if (args[i] === '--help') options.help = true;
    else if (values[args[i]]) {
      const name = values[args[i]];
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${args[i]} 缺少参数。`);
      options[name] = args[++i];
    } else throw new Error(`未知参数：${args[i]}`);
  }
  options.port = Number(options.port);
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('端口必须在 0–65535 之间。');
  return options;
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => console.log('请手动在浏览器打开上面的地址。'));
  child.unref();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Codex Model Manager\nnode server.mjs [--open] [--port 4317] [--data-dir <目录>] [--codex-home <目录>] [--cli <可执行文件>]');
    return;
  }
  const manager = new ModelManager(options);
  await fs.mkdir(manager.dataDir, { recursive: true });
  // Only one process may maintain this data directory at a time.
  const lockPath = path.join(manager.dataDir, 'server.lock');
  const acquire = () => fs.open(lockPath, 'wx', 0o600);
  let lock;
  try { lock = await acquire(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let old;
    try { old = JSON.parse(await fs.readFile(lockPath, 'utf8')); } catch {}
    let alive = true;
    if (Number.isInteger(old?.pid) && old.pid > 0) {
      try { process.kill(old.pid, 0); } catch (failure) { if (failure.code === 'ESRCH') alive = false; }
    }
    if (alive) throw new Error(`已有工具进程使用此数据目录。${old?.url ? '请打开 ' + old.url : '请先关闭旧进程。'}`);
    await fs.unlink(lockPath);
    lock = await acquire();
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  let server;
  const release = async () => { await lock.close(); await fs.unlink(lockPath).catch(() => {}); };
  try {
    await manager.initialize();
    const app = await createApp({ manager, port: options.port });
    server = app.server;
    await lock.truncate(0);
    await lock.write(JSON.stringify({ pid: process.pid, url: app.url }), 0, 'utf8');
    console.log(`\nCodex 模型管理器已启动\n${app.url}\n数据目录：${manager.dataDir}\n配置文件：${manager.configPath}\n按 Ctrl+C 退出。\n`);
    if (options.open) openBrowser(app.url);
    let closing = false;
    const stop = () => {
      if (closing) return;
      closing = true;
      server.close(async () => { await release(); process.exit(0); });
      server.closeIdleConnections();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (error) { server?.close(); await release(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`启动失败：${error.message}`); process.exitCode = 1; });
}
