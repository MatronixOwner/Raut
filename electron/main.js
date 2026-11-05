/**
 * Raut Desktop — Electron-оболочка.
 *
 * Логика:
 *  • В приложении уже есть сервер Raut. Если пользователь не указал внешний —
 *    поднимаем локальный (0.0.0.0, чтобы к вам можно было подключиться из сети).
 *  • Окно грузит тот же веб-клиент с локального сервера, поэтому веб и десктоп
 *    всегда синхронны, а обновления не ломают совместимость.
 *  • Безопасность: contextIsolation, sandbox, без nodeIntegration;
 *    наружу — только whitelisted-методы через preload.
 */

import { app, BrowserWindow, Menu, Tray, Notification, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const IS_MAC = process.platform === 'darwin';

let mainWindow = null;
let tray = null;
let localServer = null;
let localPort = null;
let quitting = false;

const DEFAULT_PORT = 8787;

/* --------------------------------------------------------------- storage */

function dataDir() {
  const dir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function configPath() {
  return path.join(app.getPath('userData'), 'raut-config.json');
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(patch) {
  const cfg = { ...readConfig(), ...patch };
  try {
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
  } catch (err) {
    console.error('[config]', err.message);
  }
  return cfg;
}

function logFile() {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'desktop.log');
  } catch {
    return null;
  }
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  console.log(line.trim());
  try {
    const f = logFile();
    if (f) fs.appendFileSync(f, line);
  } catch { /* ignore */ }
}

/* ----------------------------------------------------------- local server */

function freePort(from = DEFAULT_PORT) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(freePort(from + 1)));
    srv.once('listening', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.listen(from, '0.0.0.0');
  });
}

async function startLocalServer() {
  const port = await freePort(DEFAULT_PORT);
  localPort = port;
  // Импортируем сервер как модуль — отдельный процесс не нужен, но и не мешает.
  const { createApp } = await import(pathToFileURL(path.join(ROOT, 'server', 'app.js')).href);
  const http = await import('node:http');
  const instance = createApp({ dataDir: dataDir() });
  const server = http.createServer();
  instance.attach(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });
  localServer = { server, instance, port };
  log(`local server on http://0.0.0.0:${port} (data: ${dataDir()})`);
  return localServer;
}

function baseUrl() {
  const cfg = readConfig();
  if (cfg.serverUrl && cfg.serverUrl.trim()) return cfg.serverUrl.trim().replace(/\/+$/, '');
  if (localServer) return `http://127.0.0.1:${localServer.port}`;
  return `http://127.0.0.1:${DEFAULT_PORT}`;
}

async function waitForServer(url, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url + '/api/health', { signal: AbortSignal.timeout(2500) });
      if (res.ok) return true;
    } catch { /* ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

/* ----------------------------------------------------------------- window */

function appIcon() {
  const png = path.join(ROOT, 'build', 'icon.png');
  const ico = path.join(ROOT, 'build', 'icon.ico');
  if (fs.existsSync(png)) return nativeImage.createFromPath(png);
  if (fs.existsSync(ico)) return nativeImage.createFromPath(ico);
  return nativeImage.createEmpty();
}

async function createWindow() {
  const icon = appIcon();
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#14101b',
    show: false,
    autoHideMenuBar: true,
    icon: icon.isEmpty() ? undefined : icon,
    title: 'Raut',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (ev) => {
    if (!quitting && readConfig().minimizeToTray !== false) {
      ev.preventDefault();
      mainWindow.hide();
      if (!tray) createTray();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // внешние ссылки — в системный браузер
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  const url = baseUrl();
  log('loading', url);
  const ok = await waitForServer(url);
  if (!ok) {
    await mainWindow.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(`<!doctype html><html lang="ru"><meta charset="utf-8">
        <body style="font:16px/1.5 system-ui;background:#14101b;color:#ece7f5;display:grid;place-items:center;height:100vh;margin:0;text-align:center">
        <div style="max-width:520px;padding:24px">
          <div style="width:64px;height:64px;border-radius:20px;margin:0 auto 20px;display:grid;place-items:center;font:800 28px system-ui;background:linear-gradient(145deg,#a273ff,#6b3fd4)">R</div>
          <h1 style="font-size:24px;margin:0 0 8px">Сервер Raut не отвечает</h1>
          <p style="color:#a89cb9">Адрес: <b>${url}</b><br>Проверьте, что сервер запущен, или укажите другой адрес в настройках.</p>
          <p style="color:#6f6482;font-size:13px">Папка данных: ${dataDir()}</p>
        </div></body></html>`),
    );
    return;
  }
  await mainWindow.loadURL(url);

  // сообщаем веб-клиенту, что он в приложении
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('raut:context', {
      version: app.getVersion(),
      platform: process.platform,
      dataDir: dataDir(),
      serverUrl: baseUrl(),
    });
  });
}

function createTray() {
  const icon = appIcon().resize({ width: 18, height: 18 });
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Raut');
  updateTrayMenu({ unread: 0 });
  tray.on('click', () => {
    if (!mainWindow) return createWindow();
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

function updateTrayMenu(state = {}) {
  if (!tray) return;
  const unread = state.unread || 0;
  tray.setToolTip(unread ? `Raut — ${unread} новых` : 'Raut');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: unread ? `Непрочитанных: ${unread}` : 'Raut', enabled: false },
      { type: 'separator' },
      {
        label: 'Открыть Raut',
        click: () => {
          if (!mainWindow) return createWindow();
          mainWindow.show();
          mainWindow.focus();
        },
      },
      { label: 'Скопировать приглашение сервера', click: () => { /* из веб-клиента */ } , visible: false },
      {
        label: 'Папка с данными',
        click: () => shell.openPath(dataDir()),
      },
      { type: 'separator' },
      {
        label: 'Выход',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

/* --------------------------------------------------------------- menu/ipc */

function buildMenu() {
  const template = [
    ...(IS_MAC ? [{ role: 'appMenu' }] : []),
    {
      label: 'Файл',
      submenu: [
        {
          label: 'Сменить сервер…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send('raut:open-settings'),
        },
        { type: 'separator' },
        IS_MAC ? { role: 'close' } : { role: 'quit', label: 'Выход' },
      ],
    },
    { role: 'editMenu', label: 'Правка' },
    {
      label: 'Вид',
      submenu: [
        { role: 'reload', label: 'Перезагрузить' },
        { role: 'forceReload', label: 'Перезагрузить полностью' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Обычный масштаб' },
        { role: 'zoomIn', label: 'Крупнее' },
        { role: 'zoomOut', label: 'Мельче' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'На весь экран' },
        { role: 'toggleDevTools', label: 'Инструменты разработчика' },
      ],
    },
    {
      label: 'Помощь',
      submenu: [
        {
          label: 'О Raut',
          click: () =>
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Raut',
              message: `Raut ${app.getVersion()}`,
              detail:
                `Голос, видео и серверы для своих.\n\nСервер: ${baseUrl()}\nДанные: ${dataDir()}\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome}\n\nE2E: ECDH P-256 + AES-256-GCM\nЗвук: WebRTC Opus + GTCRN/RnNoise`,
              buttons: ['Хорошо'],
            }),
        },
        {
          label: 'Папка с журналами',
          click: () => shell.showItemInFolder(logFile() || dataDir()),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc() {
  ipcMain.handle('raut:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    dataDir: dataDir(),
    serverUrl: baseUrl(),
    localPort,
  }));

  ipcMain.handle('raut:set-server-url', async (_ev, url) => {
    const clean = typeof url === 'string' ? url.trim().replace(/\/+$/, '') : '';
    writeConfig({ serverUrl: clean || '' });
    if (mainWindow) {
      mainWindow.loadURL(baseUrl());
    }
    return { ok: true, serverUrl: baseUrl() };
  });

  ipcMain.handle('raut:open-data-dir', () => shell.openPath(dataDir()));

  ipcMain.handle('raut:set-tray', (_ev, state) => {
    updateTrayMenu(state || {});
    return true;
  });

  ipcMain.handle('raut:set-badge', (_ev, count) => {
    if (IS_MAC) app.dock?.setBadge(count ? String(count) : '');
    if (mainWindow) mainWindow.setTitle(count ? `(${count}) Raut` : 'Raut');
    return true;
  });

  ipcMain.handle('raut:copy', (_ev, text) => {
    clipboard.writeText(String(text ?? ''));
    return true;
  });

  ipcMain.handle('raut:notify', (_ev, { title, body } = {}) => {
    if (Notification.isSupported()) {
      const n = new Notification({ title: title || 'Raut', body: body || '', silent: false });
      n.on('click', () => {
        if (!mainWindow) return;
        mainWindow.show();
        mainWindow.focus();
      });
      n.show();
    }
    return true;
  });

  ipcMain.on('raut:unread', (_ev, count) => {
    updateTrayMenu({ unread: count });
    if (mainWindow) mainWindow.setTitle(count ? `(${count}) Raut` : 'Raut');
  });
}

/* ------------------------------------------------------------- lifecycle */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    log('starting Raut', app.getVersion());
    try {
      const cfg = readConfig();
      if (!cfg.serverUrl) await startLocalServer();
    } catch (err) {
      log('local server failed:', err?.stack || err?.message || String(err));
      dialog.showErrorBox('Raut', 'Не удалось запустить локальный сервер:\n' + (err?.message || err));
    }
    buildMenu();
    registerIpc();
    await createWindow();
    if (readConfig().minimizeToTray !== false) createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else mainWindow?.show();
    });
  });

  app.on('before-quit', () => {
    quitting = true;
    try {
      localServer?.instance?.close();
      localServer?.server?.close();
    } catch { /* ignore */ }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

export { app };
