#!/usr/bin/env node
/**
 * Raut server.
 *
 *   node server/index.js                        # локальный сервер на 8787
 *   node server/index.js --port 9000 --data D:\Raut\data
 *   node server/index.js --open                 # открыть браузер после старта
 *   node server/index.js --stop                 # остановить запущенный Raut
 *   node server/index.js --minimized            # автозапуск: сервер без окна
 *
 * В упакованном Windows-приложении запускается через nodew.exe (скрытая
 * консоль), поэтому журнал дублируется в <данные>/server.log.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')
    ? argv[i + 1]
    : process.env[name.replace(/^-+/, '').replace(/-/g, '_').toUpperCase()] ?? fallback;
};
const flag = (name) => argv.includes(name) || process.env[name.replace(/^-+/, '').replace(/-/g, '_').toUpperCase()] === '1';

const port = Number(arg('--port', process.env.PORT || 8787));
const host = arg('--host', process.env.HOST || '0.0.0.0');
const dataDir = path.resolve(arg('--data', process.env.RAUT_DATA || path.join(__dirname, '..', 'data')));
// --minimized ставит автозапуск из установщика: сервер поднимается, окно не открываем
const minimized = flag('--minimized') || flag('--hidden');
const shouldOpen = (flag('--open') || flag('-o')) && !minimized;
const stopMode = flag('--stop');
const silent = flag('--no-console');

const PID_FILE = path.join(dataDir, 'raut.pid');
const STOP_FLAG = path.join(dataDir, 'stop.flag');
const LOG_FILE = path.join(dataDir, 'server.log');
const LOG_LIMIT = 512 * 1024;

/* ------------------------------------------------------------------ logs */

function rotateLog() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > LOG_LIMIT) fs.renameSync(LOG_FILE, LOG_FILE + '.old');
  } catch { /* файла ещё нет */ }
}

function teeToFile() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    rotateLog();
  } catch { /* readonly dir */ }
  const write = (line) => {
    try {
      fs.appendFileSync(LOG_FILE, line + '\n');
    } catch { /* ignore */ }
  };
  const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
  const wrap = (orig, prefix) => (...args) => {
    write(`${stamp()} ${prefix}${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`);
    orig(...args);
  };
  console.log = wrap(console.log.bind(console), '');
  console.error = wrap(console.error.bind(console), '[ERR] ');
  if (silent) {
    // в оконном режиме консоли нет — зачем писать в мёртвый stdout
    const noop = () => {};
    const fileOnly = (...args) => write(`${stamp()} ${args.map(String).join(' ')}`);
    console.log = fileOnly;
    console.error = (err, ...rest) => fileOnly('[ERR]', err?.stack || err, ...rest);
    void noop;
  }
}

/* ------------------------------------------------------------ stop / open */

function stopRunning() {
  let pid;
  try {
    pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
  } catch {
    console.log('Raut не запущен');
    return 1;
  }
  if (!pid || Number.isNaN(pid)) {
    console.log('pid-файл повреждён — удаляю');
    fs.rmSync(PID_FILE, { force: true });
    return 1;
  }
  try {
    process.kill(pid);
    fs.rmSync(PID_FILE, { force: true });
    console.log(`Raut остановлен (pid ${pid})`);
    return 0;
  } catch (err) {
    console.log(`Не удалось остановить процесс ${pid}: ${err.message}`);
    fs.rmSync(PID_FILE, { force: true });
    return 1;
  }
}

/**
 * Открывает клиент. По возможности — «окном приложения» (Edge/Chrome --app),
 * как Discord: без адресной строки и вкладок. Иначе — обычный браузер.
 */
function openClient(url) {
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    // Общий профиль с обычным браузером: так ключи устройства (E2E) одни
    // и те же в окне приложения и во вкладке.
    for (const exe of candidates) {
      if (!exe || !fs.existsSync(exe)) continue;
      const args = [
        `--app=${url}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=Translate,MediaRouter',
        '--window-size=1360,880',
      ];
      try {
        const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
        child.on('error', () => {});
        child.unref();
        console.log(`окно приложения: ${path.basename(exe)}`);
        return true;
      } catch { /* пробуем следующий */ }
    }
  }
  openBrowser(url);
  return false;
}

function openBrowser(url) {
  const platform = process.platform;
  let cmd;
  let args;
  if (platform === 'win32') {
    cmd = 'cmd.exe';
    args = ['/c', 'start', '', url];
  } else if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
    console.log(`открываю браузер: ${url}`);
  } catch (err) {
    console.log('не удалось открыть браузер:', err.message);
  }
}

/* ------------------------------------------------------------------- run */

if (stopMode) process.exit(stopRunning());
try {
  fs.rmSync(STOP_FLAG, { force: true });
} catch { /* ignore */ }

if (silent || process.platform === 'win32') teeToFile();

const app = createApp({ dataDir, rateLimitScale: Number(process.env.RAUT_RATE_SCALE || 1) || 1, port });
const server = http.createServer();
app.attach(server);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Второй запуск из ярлыка: сервер уже работает — просто открываем его.
    const url = `http://localhost:${port}`;
    console.error(`порт ${port} уже занят`);
    if (shouldOpen) {
      openClient(url);
      setTimeout(() => process.exit(0), 1200);
      return;
    }
    console.error(`\n  Порт ${port} уже занят. Запустите с другим портом:  npm start -- --port 8788\n`);
    process.exit(1);
  }
  console.error('[fatal]', err);
  process.exit(1);
});

server.listen(port, host, () => {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid));
  } catch { /* ignore */ }

  const nets = os.networkInterfaces();
  const lan = Object.values(nets)
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
  const line = '─'.repeat(54);

  console.log(`\n\x1b[38;5;105m${line}\x1b[0m`);
  console.log('  \x1b[1mRaut\x1b[0m  ·  голос, видео и серверы для своих');
  console.log(`  версия 0.2.0 · Node ${process.version}`);
  console.log(`\n  Локально:   \x1b[36mhttp://localhost:${port}\x1b[0m`);
  for (const ip of lan) console.log(`  В сети:     \x1b[36mhttp://${ip}:${port}\x1b[0m`);
  console.log(`  Данные:     ${dataDir}`);
  console.log(`  Журнал:     ${LOG_FILE}`);
  console.log(`  WebSocket:  ws://${host === '0.0.0.0' ? 'localhost' : host}:${port}/ws`);
  console.log(`\x1b[38;5;105m${line}\x1b[0m\n`);

  if (shouldOpen) openClient(`http://localhost:${port}`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  ${signal}: сохраняем данные и закрываем Raut…`);
  try {
    fs.rmSync(STOP_FLAG, { force: true });
  } catch { /* ignore */ }
  app.close();
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
    if (pid === process.pid) fs.rmSync(PID_FILE, { force: true });
  } catch { /* ignore */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

// Установщик/деинсталлятор не может корректно завершить GUI-процесс:
// он оставляет файл stop.flag, а сервер сам закрывается, увидев его.
setInterval(() => {
  if (fs.existsSync(STOP_FLAG)) shutdown('stop-flag');
}, 1000).unref();

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('[fatal]', err?.stack || err);
});
