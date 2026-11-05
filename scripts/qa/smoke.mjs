/**
 * Браузерная проверка интерфейса и звонка.
 *
 *   node server/index.js --port 8801 --data /tmp/raut-data &   # сервер
 *   npm i -D puppeteer-core @sparticuz/chromium                # один раз
 *   bash scripts/qa/nss-stub.sh /tmp/runlibs                   # если нет libnss3
 *   LD_LIBRARY_PATH=/tmp/runlibs node scripts/qa/smoke.mjs
 *
 * Проверяет: регистрацию, создание сервера и канала, сообщение в канал,
 * расшифровку у второго участника, вход в голосовой канал (в контейнере без
 * /dev/snd — режим слушателя), выход из канала, мобильный viewport 390 px.
 * Скриншоты складывает в qa-out/.
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const BASE = process.env.RAUT_URL || 'http://127.0.0.1:8801';
const OUT = process.env.QA_OUT || 'qa-out';
const MOBILE = process.env.QA_MOBILE === '1';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const browsers = [];

async function launch() {
  const browser = await puppeteer.launch({
    executablePath: await chromium.executablePath(),
    headless: true,
    args: [
      ...chromium.args,
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-proxy-server',
      '--lang=ru-RU',
      // фейковый микрофон: в CI нет звуковой карты
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
    protocolTimeout: 120000,
  });
  browsers.push(browser);
  return browser;
}

async function register(browser, display, login) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`${display}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${display}: ${m.text()}`);
  });
  await page.setViewport(
    MOBILE ? { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { width: 1440, height: 900 },
  );
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await sleep(500); // дать клиенту отрисовать форму входа
  await page.click('[data-mode="register"]');
  await sleep(350);
  await page.type('input[name="username"]', login + Math.floor(Math.random() * 9000));
  await page.type('input[name="displayName"]', display);
  await page.type('input[name="password"]', 'raut-demo-2026');
  await page.type('input[name="password2"]', 'raut-demo-2026');
  await page.click('button[type="submit"]');
  try {
    await page.waitForSelector('[data-act="create-server"]', { timeout: 20000 });
  } catch (err) {
    // покажем, что написано на форме — чаще всего это ошибка валидации
    const text = await page.evaluate(() => document.querySelector('.auth-card')?.innerText.replace(/\s+/g, ' ').slice(0, 300));
    console.error(`регистрация не прошла (${display}): ${text}`);
    throw err;
  }
  await sleep(300);
  return page;
}

const check = (name, ok, extra = '') => console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);

const a = await register(await launch(), 'Алиса', 'alice');
await a.click('[data-act="create-server"]');
await sleep(450);
await a.type('.modal input[name="name"]', 'Проверка');
await a.click('.modal [data-create]');
await sleep(1700);
const invite = await a.evaluate(() => document.querySelector('.mono-box')?.textContent.trim());
check('сервер создан, код приглашения есть', !!invite, invite);

const bob = await register(await launch(), 'Боб', 'bob');
await bob.click('[data-act="join-invite"]');
await sleep(500);
const inviteInput = await bob.$('.modal input');
await inviteInput.click();
await inviteInput.type(invite);
await bob.click('.modal [data-join]');
await sleep(2200);
check('Боб вошёл по приглашению', await bob.evaluate(() => window.Raut.S.servers.length === 1));

await bob.click('[data-input]');
await bob.type('[data-input]', 'привет от Боба');
await bob.keyboard.press('Enter');
await sleep(1800);
const inbox = await a.evaluate(() => [...document.querySelectorAll('.msg-body')].map((e) => e.textContent.trim()));
check('Алиса расшифровала сообщение Боба', inbox.includes('привет от Боба'), JSON.stringify(inbox));
check('нерасшифрованных сообщений нет', (await a.evaluate(() => document.querySelectorAll('.msg-locked').length)) === 0);

for (const page of [a, bob]) {
  if (MOBILE) {
    // на телефоне панель каналов выдвижная
    await page.evaluate(() => document.querySelector('[data-act="toggle-side"]')?.click());
    await sleep(500);
  }
  const voice = await page.$('[data-act="open-voice"]');
  if (voice) {
    await voice.click();
    await sleep(800);
    const join = await page.$('[data-act="join-voice"]');
    if (join) {
      await join.click();
      await sleep(3000);
    }
  }
}
await sleep(4000);
const stats = (p) =>
  p.evaluate(() => {
    const v = window.Raut.S.voice;
    return { joined: v.joined, peers: v.peers.size, mic: v.micUnavailable };
  });
const sa = await stats(a);
const sb = await stats(bob);
check('оба в голосовом канале', sa.joined && sb.joined, `алиса ${JSON.stringify(sa)}, боб ${JSON.stringify(sb)}`);
if (!MOBILE) check('участники видят друг друга', sa.peers >= 1 && sb.peers >= 1);
await a.screenshot({ path: `${OUT}/call.png` });

const hang = await a.$('[data-act="hangup"]');
if (hang) {
  await hang.click();
  await sleep(1200);
}
check('выход из канала не вешает экран', !(await a.evaluate(() => window.Raut.S.voice.joined)));
const back = await a.$('[data-input]');
check('после выхода поле ввода снова на месте', !!back);

const overflow = await a.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('нет горизонтального переполнения', overflow <= 0, `${overflow} px`);
check('нет ошибок в консоли', errors.length === 0, errors.slice(0, 3).join(' | '));

await a.screenshot({ path: `${OUT}/final.png` });
await Promise.all(browsers.map((b) => b.close()));
process.exit(errors.length ? 1 : 0);
