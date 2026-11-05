/**
 * Сборка Windows-версии Raut: NSIS-установщик + портативный ZIP.
 *
 *   node scripts/build-windows.mjs                 # установщик + zip
 *   node scripts/build-windows.mjs --no-electron   # только сервер/веб + node.exe
 *   node scripts/build-windows.mjs --electron      # плюс Electron-дистрибутив
 *
 * Почему так, а не electron-builder:
 *  приложение Raut — это локальный сервер + веб-клиент. В Windows-поставке
 *  достаточно официального node.exe (npm-пакет node-win-x64) — без 200 МБ
 *  Electron, без установки, без зависимостей. Такой пакет:
 *    • ставится в профиль пользователя (без UAC);
 *    • не требует интернета и сторонних библиотек;
 *    • весит в разы меньше и стартует мгновенно.
 *  Для тех, кому нужна «нативная» оболочка, собирается и Electron-вариант.
 *
 * Компоненты (кешируются в build/cache, в Git не попадают):
 *   1. NSIS 3.13 — makensis для Linux + Windows-стабы
 *      (electron-builder-binaries, zlib/libpng-лицензия);
 *   2. node.exe — npm-пакет node-win-x64@<версия> (официальная сборка Node.js);
 *   3. Electron (опционально) — архив с GitHub Releases.
 *
 * Результат: release/RautSetup-<версия>.exe, release/Raut-<версия>-portable.zip,
 *            контрольные суммы .sha256 рядом.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, 'build', 'cache');
const PAYLOAD = path.join(ROOT, 'build', 'payload');
const RELEASE = path.join(ROOT, 'release');

const argv = new Set(process.argv.slice(2));
const WITH_ELECTRON = argv.has('--electron');
const SKIP_ELECTRON = argv.has('--no-electron');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const NODE_VERSION = '22.23.4';
const ELECTRON_VERSION = (pkg.devDependencies?.electron || '^45.2.3').replace(/^[^\d]*/, '');

const NSIS_URL =
  'https://api.github.com/repos/electron-userland/electron-builder-binaries/contents/artifacts/nsis/nsis-bundle-3.13.tar.gz';
const NODE_TGZ_URL = `https://registry.npmjs.org/node-win-x64/-/node-win-x64-${NODE_VERSION}.tgz`;
const ELECTRON_ZIP_URL = `https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-win32-x64.zip`;

const CLI_NAME = 'Raut-console.cmd';
const log = (...a) => console.log('\x1b[38;5;105m▸\x1b[0m', ...a);
const ok = (...a) => console.log('\x1b[32m✓\x1b[0m', ...a);
const warn = (...a) => console.log('\x1b[33m!\x1b[0m', ...a);

const ensureDir = (d) => fs.mkdirSync(d, { recursive: true });
const mb = (n) => `${(n / 1048576).toFixed(1)} МБ`;

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

/** Скачивание: сначала curl (есть везде), иначе встроенный fetch. */
async function fetchFile(url, dest, extraHeaders = []) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) {
    log(`в кеше: ${path.basename(dest)} (${mb(fs.statSync(dest).size)})`);
    return dest;
  }
  ensureDir(path.dirname(dest));
  log(`скачиваю ${path.basename(dest)}…`);
  const tmp = `${dest}.part`;
  const curlArgs = ['-L', '--fail', '--silent', '--show-error', '--retry', '3', '--connect-timeout', '20'];
  for (const h of extraHeaders) curlArgs.push('-H', h);
  curlArgs.push('-o', tmp, url);
  try {
    execFileSync('curl', curlArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    fs.renameSync(tmp, dest);
    ok(`скачано: ${path.basename(dest)} (${mb(fs.statSync(dest).size)})`);
    return dest;
  } catch (curlErr) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch { /* ignore */ }
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`не удалось скачать ${url}: HTTP ${res.status} (${curlErr.message.split('\n')[0]})`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    ok(`скачано: ${path.basename(dest)} (${mb(buf.length)})`);
    return dest;
  }
}

/* ------------------------------------------------------------------- NSIS */

async function ensureNsis() {
  const bundle = path.join(CACHE, 'nsis', 'nsis-bundle');
  const makensis = path.join(bundle, 'makensis');
  if (!fs.existsSync(makensis)) {
    const tgz = path.join(CACHE, 'nsis-bundle-3.13.tar.gz');
    await fetchFile(NSIS_URL, tgz, ['Accept: application/vnd.github.raw+json']);
    const magic = fs.readFileSync(tgz).subarray(0, 2);
    if (magic[0] !== 0x1f || magic[1] !== 0x8b) throw new Error('NSIS-бандл повреждён (ожидался gzip)');
    ensureDir(path.join(CACHE, 'nsis'));
    execFileSync('tar', ['xzf', tgz, '-C', path.join(CACHE, 'nsis')], { stdio: 'inherit' });
  }
  if (process.platform !== 'win32') {
    fs.chmodSync(makensis, 0o755);
    const linux = path.join(bundle, 'linux', 'x64', 'makensis');
    if (fs.existsSync(linux)) fs.chmodSync(linux, 0o755);
  }
  const version = execFileSync(makensis, ['-VERSION'], { encoding: 'utf8' }).trim();
  ok(`NSIS готов: ${version || 'makensis'}`);
  return makensis;
}

/* ------------------------------------------------------------- node.exe */

async function ensureNodeExe() {
  const exe = path.join(CACHE, 'node.exe');
  if (!fs.existsSync(exe)) {
    const tgz = path.join(CACHE, `node-win-x64-${NODE_VERSION}.tgz`);
    await fetchFile(NODE_TGZ_URL, tgz);
    ensureDir(CACHE);
    execFileSync('tar', ['xzf', tgz, '-C', CACHE, 'package/bin/node.exe'], { stdio: 'inherit' });
    fs.renameSync(path.join(CACHE, 'package', 'bin', 'node.exe'), exe);
    fs.rmSync(path.join(CACHE, 'package'), { recursive: true, force: true });
  }
  const info = peInfo(exe);
  ok(`node.exe ${NODE_VERSION}: PE, machine=0x${info.machine.toString(16)}, подсистема=${info.subsystem} (${mb(fs.statSync(exe).size)})`);
  return exe;
}

/** Мини-разбор PE: машина и подсистема. */
function peInfo(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(4096);
  fs.readSync(fd, head, 0, 4096, 0);
  fs.closeSync(fd);
  if (head.toString('latin1', 0, 2) !== 'MZ') throw new Error(`${file}: не PE-файл`);
  const pe = head.readUInt32LE(0x3c);
  if (head.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error(`${file}: нет сигнатуры PE`);
  const machine = head.readUInt16LE(pe + 4);
  const subsystem = head.readUInt16LE(pe + 24 + 68);
  return { machine, subsystem };
}

/**
 * Переводит PE-файл из консольной подсистемы (3) в оконную (2) и пересчитывает
 * контрольную сумму. Так же устроен pythonw.exe: запуск без чёрного окна.
 * Код внутри не меняется — только заголовок PE.
 */
function toGuiSubsystem(exePath, outPath) {
  const data = Buffer.from(fs.readFileSync(exePath));
  if (data.toString('latin1', 0, 2) !== 'MZ') throw new Error('не PE-файл');
  const pe = data.readUInt32LE(0x3c);
  if (data.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('нет сигнатуры PE');
  const magic = data.readUInt16LE(pe + 24);
  if (magic !== 0x10b && magic !== 0x20b) throw new Error('неизвестный optional header');
  const subsystemOffset = pe + 24 + 68;
  const checksumOffset = pe + 24 + 64;
  if (data.readUInt16LE(subsystemOffset) !== 3) {
    // уже GUI — просто копируем
    fs.copyFileSync(exePath, outPath);
    return { alreadyGui: true };
  }
  data.writeUInt16LE(2, subsystemOffset);

  // пересчёт контрольной суммы PE (поле считаем нулевым)
  data.writeUInt32LE(0, checksumOffset);
  let total = 0;
  for (let i = 0; i < data.length - (data.length % 2); i += 2) {
    total += data[i] | (data[i + 1] << 8);
    total = (total & 0xffff) + (total >> 16);
  }
  total = (total & 0xffff) + (total >> 16);
  total = (total + data.length) >>> 0;
  data.writeUInt32LE(total, checksumOffset);
  fs.writeFileSync(outPath, data);
  return { alreadyGui: false, checksum: total };
}

/**
 * Запуск из командной строки (диагностика и --stop).
 * Пишется в Raut-console.cmd: .exe/.com окружение не запускает как командный файл,
 * а batch-текст в файле с именем node.exe просто не исполняется.
 * Собственное окно консоли не нужно: без start процесс живёт в окне, из которого
 * его вызвали, а stdout сервер и так дублирует в data\server.log.
 */
const CLI_LAUNCHER = Buffer.from(
  '@echo off\r\n' +
  'setlocal\r\n' +
  'chcp 65001 >nul\r\n' +
  'cd /d "%~dp0"\r\n' +
  'title Raut\r\n' +
  '"%~dp0Raut.exe" "%~dp0app\\server\\index.js" %*\r\n' +
  'set RAUT_CODE=%ERRORLEVEL%\r\n' +
  'if not "%RAUT_CODE%"=="0" (\r\n' +
  '  echo.\r\n' +
  '  echo Raut завершился с кодом %RAUT_CODE%. Журнал: "%~dp0data\\server.log"\r\n' +
  '  pause\r\n' +
  ')\r\n' +
  'endlocal\r\n',
  'utf8');

/* ------------------------------------------------------------ payload */

function copyRecursive(src, dst, skip = []) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dst);
    for (const name of fs.readdirSync(src)) {
      if (skip.includes(name)) continue;
      copyRecursive(path.join(src, name), path.join(dst, name), skip);
    }
  } else {
    ensureDir(path.dirname(dst));
    fs.copyFileSync(src, dst);
  }
}

async function buildPayload(nodeExe) {
  log('собираю payload…');
  fs.rmSync(PAYLOAD, { recursive: true, force: true });
  ensureDir(path.join(PAYLOAD, 'app'));

  // сервер: без тестов и node_modules
  ensureDir(path.join(PAYLOAD, 'app', 'server'));
  for (const f of ['index.js', 'app.js', 'ws.js', 'store.js', 'util.js']) {
    fs.copyFileSync(path.join(ROOT, 'server', f), path.join(PAYLOAD, 'app', 'server', f));
  }
  // веб-клиент: без исходников сервера
  copyRecursive(path.join(ROOT, 'web'), path.join(PAYLOAD, 'app', 'web'), ['node_modules']);

  // Raut.exe — node.exe с оконной подсистемой (без консоли при запуске)
  const gui = toGuiSubsystem(nodeExe, path.join(PAYLOAD, 'Raut.exe'));
  // командный файл для диагностики и --stop (не .exe: batch-текст в .exe не работает)
  const cli = path.join(PAYLOAD, CLI_NAME);
  fs.writeFileSync(cli, CLI_LAUNCHER);
  fs.chmodSync(cli, 0o755);
  const peAfter = peInfo(path.join(PAYLOAD, 'Raut.exe'));
  ok(`Raut.exe: подсистема ${peAfter.subsystem} (2 = без консоли)${gui.alreadyGui ? ', уже была GUI' : ''}`);
  fs.copyFileSync(path.join(ROOT, 'build', 'icon.ico'), path.join(PAYLOAD, 'Raut.ico'));
  fs.copyFileSync(path.join(ROOT, 'installer', 'README.txt'), path.join(PAYLOAD, 'README.txt'));
  fs.copyFileSync(path.join(ROOT, 'LICENSE.txt'), path.join(PAYLOAD, 'LICENSE.txt'));

  // проверка синтаксиса всего, что попадёт в установщик
  for (const f of fs.readdirSync(path.join(PAYLOAD, 'app', 'server'))) {
    execFileSync(process.execPath, ['--check', path.join(PAYLOAD, 'app', 'server', f)], { stdio: 'inherit' });
  }
  ok('payload собран, синтаксис серверных файлов проверен');
}

/* --------------------------------------------------------- BUILDINFO */

async function writeBuildInfo(nodeExe) {
  const nodeSha = await sha256(nodeExe);
  const lines = [
    `RAUT ${VERSION} — СОСТАВ СБОРКИ И ПРОВЕРКА ПОДЛИННОСТИ`,
    '='.repeat(60),
    '',
    'В установщике нет скриптов WSH/VBS, автозапуска без вашего ведома,',
    'скрытых загрузчиков и консольного окна. Запуск — напрямую Raut.exe',
    '(тот же node.exe с GUI-подсистемой PE, как pythonw.exe) с параметрами',
    'app/server/index.js --open --no-console. Журнал: data/server.log.',
    '',
    'СОСТАВ',
    '  app/server/     сервер Raut: аккаунты, серверы, каналы, сигналинг',
    '  app/web/        веб-клиент (HTML/CSS/JS)',
    `  ${'Raut.exe'.padEnd(17)}Node.js ${NODE_VERSION} для Windows x64 (GUI-подсистема)`,
    `  ${CLI_NAME.padEnd(17)}запуск из командной строки и stop`,
    `  ${'Raut.ico'.padEnd(17)}иконка`,
    `  ${'README.txt'.padEnd(17)}инструкция`,
    `  ${'LICENSE.txt'.padEnd(17)}MIT и лицензии компонентов`,
    '',
    'ОТКУДА БИНАРНИКИ',
    `  Raut.exe: npm-пакет node-win-x64@${NODE_VERSION} (registry.npmjs.org),`,
    '            официальная сборка Node.js (MIT). Изменено только поле',
    '            Subsystem в PE-заголовке (3 → 2) и пересчитана контрольная',
    '            сумма PE — код Node.js не менялся.',
    '  установщик: NSIS 3.13 (electron-builder-binaries), сжатие LZMA.',
    '  шумодав: GTCRN (MIT) и RNNoise (BSD-3), WebAssembly, локально.',
    '',
    'КОНТРОЛЬНЫЕ СУММЫ',
    `  ${CLI_NAME}: ${await sha256(path.join(PAYLOAD, CLI_NAME))}`,
    `  Raut.exe SHA-256: ${await sha256(path.join(PAYLOAD, 'Raut.exe'))}`,
    '  установщик SHA-256: см. RautSetup-' + VERSION + '.exe.sha256',
    '',
    'ПРОВЕРИТЬ САМОСТОЯТЕЛЬНО (PowerShell)',
    `  Get-FileHash .\\RautSetup-${VERSION}.exe -Algorithm SHA256`,
    '  Get-FileHash .\\Raut.exe -Algorithm SHA256',
    '',
    'ПЕРЕСОБРАТЬ ИЗ ИСХОДНИКОВ',
    '  git clone https://github.com/MatronixOwner/Raut',
    '  node scripts/build-windows.mjs',
    '',
    'ЕСЛИ АНТИВИРУС РУГАЕТСЯ',
    '  Установщик не подписан (нет Code Signing сертификата) — обычная',
    '  причина срабатывания эвристик SmartScreen на любых NSIS-сборках.',
    '  Проверьте хэш, файл на virustotal.com или используйте портативный ZIP.',
    '',
  ];
  fs.writeFileSync(path.join(PAYLOAD, 'BUILDINFO.txt'), lines.join('\r\n'), 'utf8');
  ok(`BUILDINFO.txt: SHA-256 Raut.exe = ${nodeSha.slice(0, 16)}…`);
}

/* ----------------------------------------------------------- makensis */

async function buildInstaller(makensis) {
  ensureDir(RELEASE);
  const out = path.join(RELEASE, `RautSetup-${VERSION}.exe`);
  fs.rmSync(out, { force: true });
  log(`компилирую установщик ${path.basename(out)}…`);
  execFileSync(
    makensis,
    [
      '-V3',
      '-INPUTCHARSET', 'UTF8',
      `-DRAUT_VERSION=${VERSION}`,
      `-DRAUT_PAYLOAD=${PAYLOAD}`,
      `-DRAUT_OUTFILE=${out}`,
      `-DRAUT_ICON=${path.join(PAYLOAD, 'Raut.ico')}`,
      path.join(ROOT, 'installer', 'raut.nsi'),
    ],
    { stdio: 'inherit', cwd: path.join(CACHE, 'nsis', 'nsis-bundle') },
  );

  const info = peInfo(out);
  const hash = await sha256(out);
  fs.writeFileSync(`${out}.sha256`, `${hash}  ${path.basename(out)}\r\n`);
  ok(`установщик: release/${path.basename(out)} (${mb(fs.statSync(out).size)}), PE machine=0x${info.machine.toString(16)}`);
  ok(`SHA-256: ${hash}`);
  return out;
}

/* ---------------------------------------------------------- portable */

async function buildPortable() {
  const out = path.join(RELEASE, `Raut-${VERSION}-portable.zip`);
  const launcher = [
    '@echo off',
    'rem Raut portable launcher — без установки, реестра и WSH',
    'cd /d "%~dp0"',
    'start "" "Raut.exe" "app\\server\\index.js" --open %*',
  ].join('\r\n');

  await new Promise(async (resolve, reject) => {
    const { createWriteStream } = await import('node:fs');
    void createWriteStream;
    try {
      const AdmZip = null;
      void AdmZip;
      const zipPy = path.join(CACHE, 'zip-portable.py');
      fs.writeFileSync(
        zipPy,
        [
          'import os, sys, zipfile',
          'payload, out, version = sys.argv[1], sys.argv[2], sys.argv[3]',
          'launcher = sys.argv[4]',
          'with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:',
          '    z.writestr(f"Raut-{version}/Запустить Raut.cmd", launcher.encode("utf-8"))',
          '    for base, _, files in os.walk(payload):',
          '        for name in files:',
          '            full = os.path.join(base, name)',
          '            rel = os.path.relpath(full, payload).replace(os.sep, "/")',
          '            z.write(full, f"Raut-{version}/{rel}")',
        ].join('\n'),
        'utf8',
      );
      execFileSync('python3', [zipPy, PAYLOAD, out, VERSION, launcher], { stdio: 'inherit' });
      resolve();
    } catch (err) {
      reject(err);
    }
  });

  const hash = await sha256(out);
  fs.writeFileSync(`${out}.sha256`, `${hash}  ${path.basename(out)}\r\n`);
  ok(`портативная версия: release/${path.basename(out)} (${mb(fs.statSync(out).size)})`);
  return out;
}

/* ------------------------------------------------------- Electron (опция) */

async function buildElectronPortable() {
  const zip = path.join(CACHE, `electron-v${ELECTRON_VERSION}-win32-x64.zip`);
  const distDir = path.join(ROOT, 'build', 'electron-dist');
  try {
    await fetchFile(ELECTRON_ZIP_URL, zip);
  } catch (err) {
    warn(`Electron-вариант пропущен: ${err.message}`);
    warn('Это не влияет на основной установщик — он использует node.exe.');
    return null;
  }
  fs.rmSync(distDir, { recursive: true, force: true });
  ensureDir(distDir);
  execFileSync('unzip', ['-q', '-o', zip, '-d', distDir], { stdio: 'inherit' });

  // app.asar
  const stage = path.join(ROOT, 'build', 'electron-app');
  fs.rmSync(stage, { recursive: true, force: true });
  copyRecursive(path.join(ROOT, 'web'), path.join(stage, 'web'));
  ensureDir(path.join(stage, 'server'));
  for (const f of ['index.js', 'app.js', 'ws.js', 'store.js', 'util.js']) {
    fs.copyFileSync(path.join(ROOT, 'server', f), path.join(stage, 'server', f));
  }
  copyRecursive(path.join(ROOT, 'electron'), path.join(stage, 'electron'));
  fs.writeFileSync(
    path.join(stage, 'package.json'),
    JSON.stringify({ name: 'raut', productName: 'Raut', version: VERSION, description: pkg.description, main: 'electron/main.js', type: 'module', license: 'MIT', private: true }, null, 2),
  );
  const asar = await import('@electron/asar');
  await asar.createPackage(stage, path.join(distDir, 'resources', 'app.asar'));
  fs.rmSync(path.join(distDir, 'resources', 'default_app.asar'), { force: true });

  const from = path.join(distDir, 'electron.exe');
  const to = path.join(distDir, 'Raut.exe');
  if (fs.existsSync(from)) fs.renameSync(from, to);
  try {
    const { default: ResEdit } = await import('resedit');
    const data = fs.readFileSync(to);
    const exe = ResEdit.NtExecutable.from(data, { ignoreCert: true });
    const res = ResEdit.NtExecutableResource.from(exe);
    const icon = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(ROOT, 'build', 'icon.ico')));
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, icon.icons.map((i) => i.data));
    const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
    vi.setFileVersion(...VERSION.split('.').map(Number), 0);
    vi.setProductVersion(...VERSION.split('.').map(Number), 0);
    vi.setStringValues({ lang: 1033, codepage: 1200 }, {
      ProductName: 'Raut',
      FileDescription: 'Raut — голос, видео и серверы для своих',
      CompanyName: 'Raut',
      LegalCopyright: 'MIT',
      OriginalFilename: 'Raut.exe',
    });
    vi.outputToResourceEntries(res.entries);
    res.outputResource(exe);
    fs.writeFileSync(to, Buffer.from(exe.generate()));
    ok('ресурсы Raut.exe обновлены (иконка, версия)');
  } catch (err) {
    warn('ресурсы .exe не обновлены:', err.message);
  }

  const out = path.join(RELEASE, `Raut-${VERSION}-win-x64-electron.zip`);
  ensureDir(RELEASE);
  execFileSync('zip', ['-qr', '-9', out, '.'], { cwd: distDir });
  const hash = await sha256(out);
  fs.writeFileSync(`${out}.sha256`, `${hash}  ${path.basename(out)}\r\n`);
  ok(`Electron-сборка: release/${path.basename(out)} (${mb(fs.statSync(out).size)})`);
  return out;
}

/* --------------------------------------------------------------- run */

(async () => {
  console.log(`\n  Raut ${VERSION} — сборка для Windows x64\n  Node ${NODE_VERSION} · NSIS 3.13${WITH_ELECTRON ? ` · Electron ${ELECTRON_VERSION}` : ''}\n`);
  await fsp.mkdir(ROOT, { recursive: true });
  ensureDir(CACHE);
  ensureDir(RELEASE);
  if (!fs.existsSync(path.join(ROOT, 'build', 'icon.ico'))) {
    throw new Error('нет build/icon.ico — выполните: npm run icon');
  }

  const makensis = await ensureNsis();
  const nodeExe = await ensureNodeExe();
  await buildPayload(nodeExe);
  await writeBuildInfo(nodeExe);
  const setup = await buildInstaller(makensis);
  const portable = await buildPortable();
  let electron = null;
  if (WITH_ELECTRON && !SKIP_ELECTRON) electron = await buildElectronPortable();

  console.log('\n  Готово:');
  for (const f of [setup, portable, electron].filter(Boolean)) {
    console.log(`    • ${path.relative(ROOT, f)}  ${mb(fs.statSync(f).size)}`);
  }
  console.log('');
})().catch((err) => {
  console.error('\n\x1b[31mСборка не удалась:\x1b[0m', err.message);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
