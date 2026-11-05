/** Диалоги: настройки, создание сервера, приглашения, профиль, палитра команд. */

import { icon } from './icons.js';
import { colorFor, confirmDialog, escapeAttr, escapeHtml, modal, promptDialog, relTime, toast } from './ui.js';
import { STATUS_LABEL, plural } from './views.js';

const EMOJIS = [
  '😀', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😜', '🤪', '🤔', '🤨', '😐',
  '😑', '😶', '🙄', '😏', '😴', '😌', '😔', '😢', '😭', '😤', '😠', '🤯', '😱', '🥵', '🥶', '🤗', '🤭', '🤫',
  '🤝', '🙏', '👏', '👍', '👎', '👌', '✌️', '🤞', '💪', '🫡', '🫶', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤',
  '🔥', '✨', '🎉', '🎧', '🎮', '🎬', '🚀', '🌈', '☕', '🍕', '🍕', '🌙', '⭐', '💡', '✅', '❌', '⚠️', '🔒',
  '🔊', '🎤', '🎵', '📌', '📎', '💬', '👀', '🤖', '🧠', '🛠️', '🐱', '🐶', '🦊', '🐼', '🐸', '🦄',
];

/* --------------------------------------------------------------- emoji */

export function openEmojiPicker(anchorEl, onPick) {
  const prev = document.querySelector('.emoji-pop');
  if (prev) prev.remove();
  const pop = document.createElement('div');
  pop.className = 'emoji-pop';
  pop.style.cssText = `position:fixed;z-index:280;background:var(--bg-panel);border:1px solid var(--line-strong);
    border-radius:12px;box-shadow:var(--shadow);padding:8px;width:320px;display:grid;
    grid-template-columns:repeat(9,1fr);gap:2px;max-height:260px;overflow-y:auto`;
  for (const e of EMOJIS) {
    const b = document.createElement('button');
    b.textContent = e;
    b.style.cssText = 'font-size:20px;padding:4px;border-radius:6px;line-height:1.2';
    b.onmouseenter = () => (b.style.background = 'var(--bg-hover)');
    b.onmouseleave = () => (b.style.background = 'none');
    b.onclick = () => {
      onPick(e);
      pop.remove();
    };
    pop.appendChild(b);
  }
  const rect = anchorEl.getBoundingClientRect();
  document.body.appendChild(pop);
  const pr = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(rect.left - pr.width + rect.width, innerWidth - pr.width - 8))}px`;
  pop.style.top = `${Math.max(8, rect.top - pr.height - 8)}px`;
  const off = (ev) => {
    if (!pop.contains(ev.target)) {
      pop.remove();
      document.removeEventListener('mousedown', off, true);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', off, true), 0);
}

/* ------------------------------------------------------------ settings */

export function openSettings(app, tab = 'voice') {
  const S = app.S;
  const tabs = [
    ['voice', 'Голос и видео'],
    ['profile', 'Профиль'],
    ['notify', 'Уведомления'],
    ['look', 'Оформление'],
    ['about', 'О программе'],
  ];
  const ref = {};
  const m = modal({
    title: 'Настройки',
    wide: true,
    body: `
      <div class="settings-grid">
        <div class="settings-nav">
          ${tabs.map(([id, label]) => `<button data-tab="${id}" class="${id === tab ? 'on' : ''}">${label}</button>`).join('')}
        </div>
        <div class="settings-body" data-body></div>
      </div>`,
    onMount(el) {
      const body = el.querySelector('[data-body]');
      const paint = (id) => {
        el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
        body.innerHTML = settingsBody(app, id);
        wire(app, body, id, ref);
      };
      el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => paint(b.dataset.tab)));
      queueMicrotask(() => paint(tab));
    },
  });
  ref.close = m.close;
  return m;
}

function settingsBody(app, id) {
  const S = app.S;
  const s = S.settings;
  if (id === 'voice') {
    const devices = S.devices?.length
      ? S.devices
      : [{ id: '', label: 'Микрофон по умолчанию' }];
    return `
      <h4>Голос и видео</h4>
      <p class="lead">Цепочка обработки работает прямо в браузере: шумодав, компрессор, выравнивание громкости.</p>

      <div class="field"><label>Микрофон</label>
        <select data-set="micDeviceId">
          <option value="">По умолчанию</option>
          ${devices.map((d) => `<option value="${escapeAttr(d.id)}" ${s.micDeviceId === d.id ? 'selected' : ''}>${escapeHtml(d.label)}</option>`).join('')}
        </select>
      </div>

      <div class="field"><label>Шумоподавление</label>
        <select data-set="denoise">
          ${[['gtcrn', 'GTCRN — нейросеть (рекомендуется)'], ['rnnoise', 'RNNoise — лёгкий нейро-фильтр'], ['browser', 'Встроенный шумодав браузера'], ['off', 'Выключено']]
            .map(([v, l]) => `<option value="${v}" ${s.denoise === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <div class="hint">Нейро-модель убирает кулер, клавиатуру, гул улицы, не съедая голос.</div>
      </div>

      <div class="setting-row">
        <div class="txt"><b>Эхоподавление</b><small>Чтобы не было слышно собеседника дважды</small></div>
        <div class="switch ${s.echoCancellation ? 'on' : ''}" data-toggle="echoCancellation"></div>
      </div>
      <div class="setting-row">
        <div class="txt"><b>Автогромкость</b><small>AGC: ровный голос без «то тихо, то громко»</small></div>
        <div class="switch ${s.autoGainControl ? 'on' : ''}" data-toggle="autoGainControl"></div>
      </div>
      <div class="setting-row">
        <div class="txt"><b>Мониторинг микрофона</b><small>Слышать себя — удобно проверять шумодав</small></div>
        <div class="switch ${s.monitor ? 'on' : ''}" data-toggle="monitor"></div>
      </div>

      <div class="field" style="margin-top:14px"><label>Громкость микрофона — <span data-out="inputVolume">${Math.round((s.inputVolume ?? 1) * 100)}%</span></label>
        <input type="range" min="0" max="2" step="0.05" value="${s.inputVolume ?? 1}" data-set="inputVolume" />
        <div class="meter" style="margin-top:8px"><i data-meter="mic"></i></div>
      </div>

      <div class="field"><label>Громкость собеседников — <span data-out="outputVolume">${Math.round((s.outputVolume ?? 1) * 100)}%</span></label>
        <input type="range" min="0" max="1.5" step="0.05" value="${s.outputVolume ?? 1}" data-set="outputVolume" />
      </div>

      <div class="row" style="margin-top:16px">
        <button class="btn ghost sm" data-test-tone>${icon('speaker', 'sm')} Проверить динамики</button>
        <button class="btn ghost sm" data-test-mic>${icon('mic', 'sm')} Проверить микрофон</button>
      </div>
      <p class="small muted" style="margin-top:10px">Наушники сильно улучшают качество: без них включается эхоподавление и голос звучит «телефонно».</p>`;
  }

  if (id === 'profile') {
    const me = S.me;
    return `
      <h4>Профиль</h4>
      <p class="lead">Видно всем, с кем вы общаетесь на этом сервере.</p>
      <div class="user-card">
        ${avatarBig(me)}
        <div><b>${escapeHtml(me.displayName)}</b><small>@${escapeHtml(me.username)} · в Raut с ${new Date(me.createdAt || Date.now()).toLocaleDateString('ru-RU')}</small></div>
      </div>
      <div class="field"><label>Отображаемое имя</label>
        <input data-set="displayName" value="${escapeAttr(me.displayName)}" maxlength="32" /></div>
      <div class="field"><label>Цвет аватара</label>
        <div class="row" style="flex-wrap:wrap">
          ${['#5865f2', '#3ba55d', '#faa61a', '#ed4245', '#eb459e', '#9b59b6', '#1abc9c', '#e67e22', '#3498db', '#e91e63']
            .map((c) => `<button data-color="${c}" style="width:30px;height:30px;border-radius:50%;background:${c};border:2px solid ${me.avatarColor === c ? '#fff' : 'transparent'}"></button>`)
            .join('')}
        </div>
      </div>
      <div class="field"><label>Ключ устройства (отпечаток)</label>
        <div class="mono-box" data-fingerprint>…</div>
        <div class="hint">Сверьте отпечаток с собеседником лично — так вы убедитесь, что переписку не подменили.</div>
      </div>
      <div class="row" style="margin-top:16px">
        <button class="btn sm" data-save-profile>Сохранить</button>
        <button class="btn ghost sm" data-change-password>Сменить пароль</button>
        <button class="btn danger sm" data-logout style="margin-left:auto">${icon('logOut', 'sm')} Выйти</button>
      </div>`;
  }

  if (id === 'notify') {
    return `
      <h4>Уведомления</h4>
      <p class="lead">Raut может подсвечивать новые сообщения, когда окно свёрнуто.</p>
      <div class="setting-row">
        <div class="txt"><b>Уведомления на рабочем столе</b><small>${typeof Notification === 'undefined' ? 'Не поддерживается' : Notification.permission === 'granted' ? 'Разрешены' : Notification.permission === 'denied' ? 'Запрещены в браузере' : 'Нужно разрешение'}</small></div>
        <button class="btn ghost sm" data-notify>${icon('bell', 'sm')} Включить</button>
      </div>
      <div class="setting-row">
        <div class="txt"><b>Звук новых сообщений</b><small>Тихий сигнал при упоминании</small></div>
        <div class="switch ${s.sound ? 'on' : ''}" data-toggle="sound"></div>
      </div>
      <div class="setting-row">
        <div class="txt"><b>Счётчик в заголовке</b><small>Показывать непрочитанные в названии окна</small></div>
        <div class="switch ${s.badge !== false ? 'on' : ''}" data-toggle="badge"></div>
      </div>`;
  }

  if (id === 'look') {
    return `
      <h4>Оформление</h4>
      <p class="lead">Плотность интерфейса и акцент.</p>
      <div class="setting-row">
        <div class="txt"><b>Компактные сообщения</b><small>Больше строк на экране</small></div>
        <div class="switch ${s.compact ? 'on' : ''}" data-toggle="compact"></div>
      </div>
      <div class="setting-row">
        <div class="txt"><b>Показывать участников справа</b><small>Список людей в канале</small></div>
        <div class="switch ${S.membersOpen ? 'on' : ''}" data-toggle="members"></div>
      </div>
      <div class="field"><label>Акцентный цвет</label>
        <div class="row" style="flex-wrap:wrap">
          ${[['#a273ff', 'лаванда'], ['#59e3c8', 'мята'], ['#ff7ab8', 'фламинго'], ['#7cc4ff', 'небо'], ['#ffb454', 'янтарь']]
            .map(([c, n]) => `<button title="${n}" data-accent="${c}" style="width:30px;height:30px;border-radius:8px;background:${c};border:2px solid ${s.accent === c ? '#fff' : 'transparent'}"></button>`)
            .join('')}
        </div>
      </div>`;
  }

  return `
    <h4>О программе</h4>
    <p class="lead">Raut — открытый мессенджер с голосом и видео. Ваш сервер, ваши правила.</p>
    <div class="kv">
      <b>Клиент</b><span>${escapeHtml(S.version)} ${S.desktop ? '(приложение)' : '(веб)'}</span>
      <b>Сервер</b><span>${escapeHtml(S.serverLabel)}</span>
      <b>Соединение</b><span>${S.connection === 'ready' ? 'активно' : escapeHtml(S.connection)}</span>
      <b>Шифрование</b><span>ECDH P-256 + AES-256-GCM</span>
      <b>Шумодав</b><span>GTCRN / RNNoise (WASM)</span>
    </div>
    <p class="small muted">Сообщения хранятся на вашем сервере в зашифрованном виде — администратор сервера
    видит только шифротекст. Ключи каналов живут на устройствах участников.</p>
    <div class="row" style="margin-top:14px">
      <button class="btn ghost sm" data-copy="${escapeAttr(location.origin)}">${icon('copy', 'sm')} Скопировать адрес</button>
      ${S.desktop?.openDataDir ? `<button class="btn ghost sm" data-open-data>${icon('server', 'sm')} Папка с данными</button>` : ''}
    </div>`;
}

function avatarBig(user) {
  const color = user.avatarColor || colorFor(user.id);
  return `<span class="avatar" style="width:56px;height:56px;font-size:20px;background:${color}">${escapeHtml((user.displayName || '?').slice(0, 2).toUpperCase())}</span>`;
}

function wire(app, body, id, ref) {
  const m = ref;
  const S = app.S;
  body.querySelectorAll('[data-set]').forEach((el) => {
    const key = el.dataset.set;
    const handler = () => {
      let value = el.type === 'range' ? Number(el.value) : el.value;
      if (key === 'inputVolume' || key === 'outputVolume') {
        value = Number(value);
        body.querySelector(`[data-out="${key}"]`).textContent = `${Math.round(value * 100)}%`;
      }
      app.saveSetting(key, value);
      if (key === 'micDeviceId' || key === 'denoise' || key === 'echoCancellation' || key === 'autoGainControl') {
        app.restartMicIfActive();
      }
      if (key === 'inputVolume') app.audio.setInputVolume(value);
      if (key === 'outputVolume') app.applyOutputVolume();
    };
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', handler);
  });

  body.querySelectorAll('[data-toggle]').forEach((el) => {
    el.onclick = () => {
      const key = el.dataset.toggle;
      if (key === 'members') {
        S.membersOpen = !S.membersOpen;
        el.classList.toggle('on', S.membersOpen);
        app.paint();
        return;
      }
      const on = !el.classList.contains('on');
      el.classList.toggle('on', on);
      app.saveSetting(key, on);
      if (key === 'monitor') app.setMonitor(on);
      if (key === 'compact') document.body.classList.toggle('compact', on);
    };
  });

  body.querySelector('[data-test-tone]')?.addEventListener('click', () => app.audio.playTestTone());
  body.querySelector('[data-test-mic]')?.addEventListener('click', async () => {
    try {
      await app.ensureMic();
      toast('Говорите — индикатор ниже покажет уровень', 'ok');
    } catch (err) {
      toast('Нет доступа к микрофону: ' + err.message, 'err');
    }
  });

  body.querySelector('[data-notify]')?.addEventListener('click', async () => {
    try {
      const res = await Notification.requestPermission();
      toast(res === 'granted' ? 'Уведомления включены' : 'Разрешение не выдано', res === 'granted' ? 'ok' : 'err');
      ref.close();
      openSettings(app, 'notify');
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  body.querySelectorAll('[data-accent]').forEach((b) => {
    b.onclick = () => {
      document.documentElement.style.setProperty('--accent', b.dataset.accent);
      app.saveSetting('accent', b.dataset.accent);
      body.querySelectorAll('[data-accent]').forEach((x) => (x.style.borderColor = 'transparent'));
      b.style.borderColor = '#fff';
    };
  });

  body.querySelectorAll('[data-color]').forEach((b) => {
    b.onclick = async () => {
      try {
        const r = await app.api.patch('/api/me', { avatarColor: b.dataset.color });
        S.me = { ...S.me, ...r.user };
        app.paint();
        body.querySelectorAll('[data-color]').forEach((x) => (x.style.borderColor = 'transparent'));
        b.style.borderColor = '#fff';
        toast('Цвет обновлён', 'ok');
      } catch (err) {
        toast(err.message, 'err');
      }
    };
  });

  body.querySelector('[data-save-profile]')?.addEventListener('click', async () => {
    const input = body.querySelector('[data-set="displayName"]');
    try {
      const r = await app.api.patch('/api/me', { displayName: input.value.trim() });
      S.me = { ...S.me, ...r.user };
      app.paint();
      toast('Профиль сохранён', 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  body.querySelector('[data-change-password]')?.addEventListener('click', async () => {
    const cur = await promptDialog({ title: 'Смена пароля', label: 'Текущий пароль' });
    if (cur === null) return;
    const next = await promptDialog({ title: 'Смена пароля', label: 'Новый пароль (от 8 символов)' });
    if (next === null) return;
    try {
      const r = await app.api.post('/api/me/password', { current: cur, next });
      app.setToken(r.token);
      toast('Пароль изменён, остальные сессии закрыты', 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  body.querySelector('[data-logout]')?.addEventListener('click', async () => {
    if (await confirmDialog({ title: 'Выйти из Raut?', message: 'Ключи останутся на устройстве — сможете войти снова.' })) {
      app.logout();
      ref.close();
    }
  });

  body.querySelectorAll('[data-copy]').forEach((b) => {
    b.onclick = async () => {
      await navigator.clipboard.writeText(b.dataset.copy).catch(() => {});
      toast('Скопировано', 'ok', 1500);
    };
  });

  body.querySelector('[data-open-data]')?.addEventListener('click', () => app.desktop?.openDataDir?.());

  const fp = body.querySelector('[data-fingerprint]');
  if (fp) app.cryptoModule.fingerprint(S.identity.pub).then((v) => (fp.textContent = v));

  // микрофонный индикатор в настройках
  const meter = body.querySelector('[data-meter="mic"]');
  if (meter) {
    app.audio.levelCb = (level) => {
      if (meter.isConnected) meter.style.width = `${Math.min(100, level * 120)}%`;
    };
  } else {
    app.audio.levelCb = null;
  }
}

/* ------------------------------------------------------ create / join */

export function openCreateServer(app) {
  modal({
    title: 'Создать сервер',
    lead: 'Место для своей компании: каналы, голос, история — всё на вашем сервере.',
    body: `
      <div class="field"><label>Название</label>
        <input name="name" maxlength="48" placeholder="Например, «Наш подвал»" /></div>
      <div class="row" style="align-items:center;gap:14px;margin-top:4px">
        <div class="avatar" data-preview style="width:56px;height:56px;font-size:20px;border-radius:18px;background:var(--accent-soft);border:1px dashed var(--line-strong);cursor:pointer">
          ${icon('image', 'lg')}
        </div>
        <div class="small muted">Иконка (необязательно)<br><button class="btn link" data-pick>выбрать файл</button></div>
        <input type="file" accept="image/*" data-file class="hidden" />
      </div>`,
    actions: `<button class="btn ghost" data-close>Отмена</button><button class="btn" data-create>Создать</button>`,
    onMount(el, close) {
      let iconData = null;
      const nameInput = el.querySelector('input[name="name"]');
      const preview = el.querySelector('[data-preview]');
      const fileInput = el.querySelector('[data-file]');
      el.querySelector('[data-pick]').onclick = () => fileInput.click();
      fileInput.onchange = async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        iconData = await app.resizeImage(file, 96);
        preview.style.background = `url(${iconData}) center/cover`;
        preview.innerHTML = '';
      };
      const submit = async () => {
        const name = nameInput.value.trim();
        if (name.length < 2) return toast('Название — минимум 2 символа', 'err');
        try {
          await app.createServer(name, iconData);
          close();
        } catch (err) {
          toast(err.message, 'err');
        }
      };
      el.querySelector('[data-create]').onclick = submit;
      nameInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') submit();
      });
    },
  });
}

export function openJoinInvite(app, preset = '') {
  modal({
    title: 'Войти по приглашению',
    lead: 'Вставьте код или ссылку вида raut://invite/abc123.',
    body: `<div class="field"><label>Код приглашения</label><input name="code" value="${escapeAttr(preset)}" placeholder="например, x7k2m9p" /></div>`,
    actions: `<button class="btn ghost" data-close>Отмена</button><button class="btn" data-join>Войти</button>`,
    onMount(el, close) {
      const input = el.querySelector('input');
      const go = async () => {
        const code = input.value.trim();
        if (!code) return;
        try {
          await app.joinInvite(code);
          close();
        } catch (err) {
          toast(err.message, 'err');
        }
      };
      el.querySelector('[data-join]').onclick = go;
      input.addEventListener('keydown', (ev) => ev.key === 'Enter' && go());
    },
  });
}

/* --------------------------------------------------------------- profile */

export function openUserCard(app, userId) {
  const S = app.S;
  const u = S.authors[userId] || S.memberIndex[userId] || (userId === S.me.id ? S.me : null);
  if (!u) return toast('Профиль не найден', 'err');
  const isMe = u.id === S.me.id;
  const presence = S.presence[u.id]?.status || (isMe ? 'online' : 'offline');
  const m = modal({
    title: '',
    body: `
      <div class="user-card">
        <span class="avatar" style="width:72px;height:72px;font-size:26px;background:${u.avatarColor || colorFor(u.id)}">${escapeHtml((u.displayName || '?').slice(0, 2).toUpperCase())}</span>
        <div><b style="font-size:20px">${escapeHtml(u.displayName)}</b>
          <small>@${escapeHtml(u.username || '')}</small><br>
          <span class="pill-tag ${presence !== 'offline' ? '' : 'dim'}">${STATUS_LABEL[presence] || presence}</span>
        </div>
      </div>
      <div class="field"><label>Отпечаток ключа</label><div class="mono-box" data-fp>вычисляем…</div>
        <div class="hint">Сверьте с собеседником: одинаковый отпечаток = защищённый канал.</div></div>
      ${isMe ? '' : `<div class="row">
        <button class="btn sm" data-msg>${icon('messageCircle', 'sm')} Написать</button>
        <button class="btn ghost sm" data-call>${icon('phone', 'sm')} Позвонить</button>
        <button class="btn ghost sm" data-vcall>${icon('camera', 'sm')} Видео</button>
      </div>`}`,
    onMount(el, close) {
      if (u.publicKey) app.cryptoModule.fingerprint(u.publicKey).then((v) => (el.querySelector('[data-fp]').textContent = v));
      else el.querySelector('[data-fp]').textContent = 'нет ключа (старая версия клиента)';
      el.querySelector('[data-msg]')?.addEventListener('click', async () => {
        close();
        await app.startDm(u.id);
      });
      el.querySelector('[data-call]')?.addEventListener('click', () => {
        close();
        app.callUser(u.id, false);
      });
      el.querySelector('[data-vcall]')?.addEventListener('click', () => {
        close();
        app.callUser(u.id, true);
      });
    },
  });
  return m;
}

/* --------------------------------------------------- find user / palette */

export function openFindUser(app) {
  const m = modal({
    title: 'Найти человека',
    lead: 'Введите имя пользователя — Raut найдёт его на этом сервере.',
    body: `
      <div class="field"><input name="q" placeholder="имя или @username" autocomplete="off" /></div>
      <div data-results class="stack"></div>`,
    onMount(el) {
      const input = el.querySelector('input');
      const box = el.querySelector('[data-results]');
      let seq = 0;
      const run = async () => {
        const q = input.value.trim();
        if (q.length < 2) {
          box.innerHTML = '<div class="small muted">Минимум 2 символа</div>';
          return;
        }
        const mySeq = ++seq;
        try {
          const r = await app.api.get('/api/users?q=' + encodeURIComponent(q));
          if (mySeq !== seq) return;
          box.innerHTML = r.users.length
            ? r.users.map((u) => `
              <button class="member" data-open="${u.id}" style="border:1px solid var(--line);border-radius:10px">
                <span class="avatar" style="width:34px;height:34px;font-size:13px;background:${u.avatarColor || colorFor(u.id)}">${escapeHtml((u.displayName || '?').slice(0, 2).toUpperCase())}</span>
                <span class="nm"><b>${escapeHtml(u.displayName)}</b><small>@${escapeHtml(u.username)}</small></span>
                <span class="pill-tag ${u.known ? '' : 'dim'}">${u.known ? 'на связи' : 'новый контакт'}</span>
              </button>`).join('')
            : '<div class="small muted">Никого не нашли. Проверьте написание имени.</div>';
          box.querySelectorAll('[data-open]').forEach((b) => {
            b.onclick = async () => {
              m.close();
              await app.startDm(b.dataset.open);
            };
          });
        } catch (err) {
          box.innerHTML = `<div class="form-err">${escapeHtml(err.message)}</div>`;
        }
      };
      let t;
      input.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(run, 200);
      });
      input.addEventListener('keydown', (ev) => ev.key === 'Enter' && run());
      run();
    },
  });
}

export function openPalette(app) {
  const S = app.S;
  if (document.querySelector('.cmdk')) return;
  const entries = [];
  for (const s of S.servers) {
    for (const c of s.channels) {
      entries.push({
        icon: c.type === 'voice' ? 'volume' : 'hash',
        label: `#${c.name}`,
        hint: s.name,
        run: () => app.openChannel(c.type === 'voice' ? 'voice' : 'channel', c.id, s.id),
      });
    }
  }
  for (const dm of S.dms) {
    if (!dm.user) continue;
    entries.push({
      icon: 'messageCircle',
      label: dm.user.displayName,
      hint: 'личный диалог',
      run: () => app.openChannel('dm', dm.channelId),
    });
  }
  entries.push(
    { icon: 'plus', label: 'Создать сервер', hint: 'действие', run: () => openCreateServer(app) },
    { icon: 'link', label: 'Войти по приглашению', hint: 'действие', run: () => openJoinInvite(app) },
    { icon: 'search', label: 'Найти человека', hint: 'действие', run: () => openFindUser(app) },
    { icon: 'settings', label: 'Настройки', hint: 'действие', run: () => openSettings(app) },
    { icon: 'micOff', label: 'Выключить/включить микрофон', hint: 'звонок', run: () => app.toggleMute() },
    { icon: 'headphonesOff', label: 'Выключить/включить звук', hint: 'звонок', run: () => app.toggleDeafen() },
  );

  const layer = document.createElement('div');
  layer.className = 'cmdk';
  layer.innerHTML = `
    <div class="cmdk-box">
      <input placeholder="Куда идём? Название канала, человек или команда…" />
      <div class="cmdk-list"></div>
    </div>`;
  document.body.appendChild(layer);
  const input = layer.querySelector('input');
  const list = layer.querySelector('.cmdk-list');
  let filtered = entries;
  let cursor = 0;

  const paint = () => {
    list.innerHTML = filtered.length
      ? filtered.slice(0, 40).map((e, i) => `
        <div class="cmdk-item ${i === cursor ? 'on' : ''}" data-i="${i}">
          ${icon(e.icon, 'sm')}<span>${escapeHtml(e.label)}</span><small>${escapeHtml(e.hint || '')}</small>
        </div>`).join('')
      : '<div class="cmdk-empty">Ничего не найдено</div>';
    list.querySelectorAll('[data-i]').forEach((el) => {
      el.onmousedown = (ev) => {
        ev.preventDefault();
        choose(Number(el.dataset.i));
      };
    });
  };
  const choose = (i) => {
    const e = filtered[i];
    if (!e) return;
    close();
    e.run();
  };
  const close = () => layer.remove();

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    filtered = q ? entries.filter((e) => (e.label + ' ' + (e.hint || '')).toLowerCase().includes(q)) : entries;
    cursor = 0;
    paint();
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      cursor = Math.min(filtered.length - 1, cursor + 1);
      paint();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      cursor = Math.max(0, cursor - 1);
      paint();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      choose(cursor);
    } else if (ev.key === 'Escape') {
      close();
    }
  });
  layer.addEventListener('mousedown', (ev) => {
    if (ev.target === layer) close();
  });
  paint();
  input.focus();
}

/* -------------------------------------------------------- server admin */

export function openServerSettings(app) {
  const S = app.S;
  const server = S.servers.find((s) => s.id === S.view.serverId);
  if (!server) return;
  const isOwner = server.role === 'owner';
  const members = S.members[server.id] || [];
  const m = modal({
    title: 'Управление сервером',
    wide: true,
    body: `
      <div class="tabs" data-tabs>
        <button class="on" data-t="main">Основное</button>
        <button data-t="members">Участники — ${members.length}</button>
        <button data-t="invite">Приглашения</button>
        ${isOwner ? '<button data-t="danger">Опасная зона</button>' : ''}
      </div>
      <div data-panel></div>`,
    onMount(el, close) {
      const panel = el.querySelector('[data-panel]');
      const paint = (tab) => {
        el.querySelectorAll('[data-tabs] button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
        if (tab === 'main') {
          panel.innerHTML = `
            <div class="field"><label>Название</label>
              <input data-name value="${escapeAttr(server.name)}" ${isOwner ? '' : 'disabled'} maxlength="48" /></div>
            <div class="field"><label>Иконка</label>
              <div class="row">
                <div class="avatar" data-ico style="width:52px;height:52px;border-radius:16px;background:${server.icon ? `url('${escapeAttr(server.icon)}') center/cover` : 'var(--bg-hover)'}">${server.icon ? '' : escapeHtml(server.name.slice(0, 2).toUpperCase())}</div>
                ${isOwner ? '<button class="btn ghost sm" data-pick>Выбрать</button><input type="file" class="hidden" accept="image/*" data-file />' : ''}
              </div>
            </div>
            ${isOwner ? `<button class="btn sm" data-save-server>Сохранить</button>` : ''}
            ${!isOwner ? `<div class="row" style="margin-top:20px"><button class="btn danger sm" data-leave>${icon('logOut', 'sm')} Покинуть сервер</button></div>` : ''}`;
          let newIcon = undefined;
          panel.querySelector('[data-pick]')?.addEventListener('click', () => panel.querySelector('[data-file]').click());
          panel.querySelector('[data-file]')?.addEventListener('change', async (ev) => {
            const file = ev.target.files?.[0];
            if (!file) return;
            newIcon = await app.resizeImage(file, 128);
            panel.querySelector('[data-ico]').style.background = `url(${newIcon}) center/cover`;
            panel.querySelector('[data-ico]').textContent = '';
          });
          panel.querySelector('[data-save-server]')?.addEventListener('click', async () => {
            const name = panel.querySelector('[data-name]').value.trim();
            try {
              await app.updateServer(server.id, { name, ...(newIcon !== undefined ? { icon: newIcon } : {}) });
              toast('Сервер обновлён', 'ok');
              close();
            } catch (err) {
              toast(err.message, 'err');
            }
          });
          panel.querySelector('[data-leave]')?.addEventListener('click', async () => {
            if (!(await confirmDialog({ title: 'Покинуть сервер?', message: 'Вы сможете вернуться по новому приглашению.' }))) return;
            try {
              await app.api.post(`/api/servers/${server.id}/leave`);
              close();
            } catch (err) {
              toast(err.message, 'err');
            }
          });
        } else if (tab === 'members') {
          panel.innerHTML = members.map((u) => `
            <div class="member" style="cursor:default">
              <span class="avatar" style="width:32px;height:32px;font-size:12px;background:${u.avatarColor || colorFor(u.id)}">${escapeHtml((u.displayName || '?').slice(0, 2).toUpperCase())}</span>
              <span class="nm"><b>${escapeHtml(u.displayName)} ${u.role === 'owner' ? '👑' : ''}</b><small>@${escapeHtml(u.username)}</small></span>
              ${isOwner && u.role !== 'owner' ? `<button class="btn danger sm" data-kick="${u.id}">Исключить</button>` : ''}
            </div>`).join('');
          panel.querySelectorAll('[data-kick]').forEach((b) => {
            b.onclick = async () => {
              if (!(await confirmDialog({ title: 'Исключить участника?', message: 'Он потеряет доступ к каналам сервера.' }))) return;
              try {
                await app.api.post(`/api/servers/${server.id}/kick`, { userId: b.dataset.kick });
                b.closest('.member').remove();
                toast('Участник исключён', 'ok');
              } catch (err) {
                toast(err.message, 'err');
              }
            };
          });
        } else if (tab === 'invite') {
          panel.innerHTML = `
            <p class="lead">Отправьте код тому, кого хотите позвать. Ключ канала он получит автоматически.</p>
            <div class="copy-row">
              <div class="mono-box" data-code>${escapeHtml(server.inviteCode || '—')}</div>
              <button class="btn ghost sm" data-copy>${icon('copy', 'sm')}</button>
              ${isOwner ? '<button class="btn ghost sm" data-new>Новый код</button>' : ''}
            </div>
            <div class="field" style="margin-top:14px"><label>Ссылка</label>
              <div class="mono-box" data-link>raut://invite/${escapeHtml(server.inviteCode || '')}</div></div>
            ${isOwner ? '<p class="small muted">Пересоздание кода отключит старые приглашения.</p>' : ''}`;
          const code = server.inviteCode || '';
          panel.querySelector('[data-copy]')?.addEventListener('click', async () => {
            await navigator.clipboard.writeText(code).catch(() => {});
            toast('Код скопирован', 'ok', 1500);
          });
          panel.querySelector('[data-new]')?.addEventListener('click', async () => {
            try {
              const r = await app.api.post(`/api/servers/${server.id}/invites`);
              server.inviteCode = r.code;
              paint('invite');
              toast('Новый код создан', 'ok');
            } catch (err) {
              toast(err.message, 'err');
            }
          });
        } else {
          panel.innerHTML = `
            <p class="lead">Действия необратимы. Будьте уверены.</p>
            <div class="setting-row">
              <div class="txt"><b>Очистить историю всех каналов</b><small>Сообщения удалятся у всех участников</small></div>
              <button class="btn ghost sm" data-clear>Очистить</button>
            </div>
            <div class="setting-row">
              <div class="txt"><b>Удалить сервер</b><small>Каналы, сообщения и ключи будут удалены</small></div>
              <button class="btn danger sm" data-delete>Удалить</button>
            </div>`;
          panel.querySelector('[data-clear]')?.addEventListener('click', async () => {
            if (!(await confirmDialog({ title: 'Очистить историю?', message: 'Все сообщения всех каналов исчезнут.' }))) return;
            try {
              for (const c of server.channels.filter((x) => x.type === 'text')) {
                await app.api.del(`/api/channels/${c.id}/messages`);
              }
              toast('История очищена', 'ok');
            } catch (err) {
              toast(err.message, 'err');
            }
          });
          panel.querySelector('[data-delete]')?.addEventListener('click', async () => {
            const typed = await promptDialog({
              title: 'Удалить сервер',
              label: `Введите название сервера «${server.name}» для подтверждения`,
              confirmLabel: 'Удалить навсегда',
            });
            if (typed !== server.name) return toast('Название не совпало — отмена', 'err');
            try {
              await app.api.del(`/api/servers/${server.id}`);
              close();
            } catch (err) {
              toast(err.message, 'err');
            }
          });
        }
      };
      el.querySelectorAll('[data-tabs] button').forEach((b) => (b.onclick = () => paint(b.dataset.t)));
      paint('main');
    },
  });
  return m;
}

/* --------------------------------------------------------- channel menu */

export function openChannelMenu(app, channelId) {
  const S = app.S;
  const server = S.servers.find((s) => s.id === S.view.serverId);
  const ch = server?.channels.find((c) => c.id === channelId);
  if (!ch) return;
  const isOwner = server.role === 'owner';
  modal({
    title: `#${ch.name}`,
    body: `
      <div class="stack">
        ${isOwner ? `<button class="btn ghost sm" data-rename>${icon('pen', 'sm')} Переименовать</button>` : ''}
        <button class="btn ghost sm" data-copy-link>${icon('link', 'sm')} Скопировать приглашение сервера</button>
        ${ch.type === 'text' ? `<button class="btn ghost sm" data-clear>${icon('trash', 'sm')} Очистить историю канала</button>` : ''}
        ${isOwner && server.channels.length > 2 ? `<button class="btn danger sm" data-delete>${icon('trash', 'sm')} Удалить канал</button>` : ''}
      </div>`,
    onMount(el, close) {
      el.querySelector('[data-rename]')?.addEventListener('click', async () => {
        const name = await promptDialog({ title: 'Новое название', value: ch.name });
        if (!name) return;
        try {
          await app.api.patch(`/api/channels/${ch.id}`, { name });
          close();
        } catch (err) {
          toast(err.message, 'err');
        }
      });
      el.querySelector('[data-copy-link]')?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(server.inviteCode || '').catch(() => {});
        toast('Код приглашения скопирован', 'ok', 1600);
      });
      el.querySelector('[data-clear]')?.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Очистить канал?', message: 'История этого канала исчезнет у всех.' }))) return;
        try {
          await app.api.del(`/api/channels/${ch.id}/messages`);
          S.channels[ch.id] = { messages: [], loaded: true, hasMore: false };
          app.paintMessages({ force: true });
          toast('Канал очищен', 'ok');
        } catch (err) {
          toast(err.message, 'err');
        }
      });
      el.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Удалить канал?', message: `#${ch.name} исчезнет вместе с историей.` }))) return;
        try {
          await app.api.del(`/api/channels/${ch.id}`);
          close();
        } catch (err) {
          toast(err.message, 'err');
        }
      });
    },
  });
}

export function openIncomingCall(app, invite) {
  const el = document.createElement('div');
  el.className = 'call-overlay-pill';
  el.style.cssText = 'position:fixed;right:20px;bottom:88px;left:auto;top:auto;width:320px;z-index:220';
  el.innerHTML = `
    <span class="avatar" style="width:38px;height:38px;font-size:14px;background:${invite.from?.avatarColor || colorFor(invite.from?.id || '')}">
      ${escapeHtml((invite.from?.displayName || '?').slice(0, 2).toUpperCase())}</span>
    <div class="grow"><b>${escapeHtml(invite.from?.displayName || 'Звонок')}</b>
      <small>${invite.video ? 'видеозвонок' : 'голосовой звонок'} · Raut</small></div>
    <button class="call-btn" data-no title="Отклонить">${icon('phoneOff', 'sm')}</button>
    <button class="call-btn" data-yes style="background:var(--ok);color:#0b2818" title="Ответить">${icon('phone', 'sm')}</button>`;
  document.body.appendChild(el);
  const close = () => el.remove();
  const timer = setTimeout(close, 30000);
  el.querySelector('[data-no]').onclick = () => {
    clearTimeout(timer);
    close();
    app.sendWs({ t: 'dm:ring-decline', channelId: invite.channelId, to: invite.from?.id });
  };
  el.querySelector('[data-yes]').onclick = async () => {
    clearTimeout(timer);
    close();
    await app.acceptCall(invite);
  };
  return el;
}

export { EMOJIS, relTime, plural };
