# Raut на Northflank Sandbox — пошаговая инструкция

Бесплатно навсегда, без засыпания, без карты на странице тарифов, с готовым
HTTPS-адресом. Проверено по документации Northflank на 04.11.2026.

## Сразу про результат

**Заработает полностью:** регистрация и вход по токену, друзья по логину,
запросы в друзья, личные сообщения, присутствие, общий чат, общая история,
вложения, HTTPS и WSS (WebSocket через публичный HTTP-порт поддерживается).
Адрес вида `https://p01--raut--xxxx.code.run` можно сразу отправить другу.

**Ограничение бесплатного Sandbox:** наружу открываются только порты с протоколом
HTTP / HTTP/2. TCP и UDP требуют отдельного Layer 4 балансировщика, а своего
STUN/TURN на бесплатном тарифе поэтому не поднять. Значит **голос и показ экрана
между двумя разными домашними сетями могут не соединиться** — WebRTC не сможет
пробить NAT без TURN. Чат и всё остальное работают. Способы закрыть это — в разделе «Голос и экран» ниже; готовый подбор
хостингов с UDP: [`voice-hosting.md`](voice-hosting.md).

---

## 1. Аккаунт

1. Откройте https://app.northflank.com/signup и зарегистрируйтесь.
2. Тариф **Sandbox** — `Free`, `No card needed`, 2 сервиса, 2 job, 1 БД,
   до $20/мес ресурсов, **always on, no sleeping**: https://northflank.com/pricing
3. Нюанс: страница тарифов пишет «No card needed», а billing-документация местами
   требует платёжный метод для создания ресурсов. Если попросят карту — это
   единственный возможный затык; он у площадки, а не у Raut.

## 2. Проект

**Projects → Create Project**:
- Name: `raut`
- Cloud: **Northflank Cloud** (не BYOC)
- Region: ближайший доступный (например `europe-west`)

## 3. Подключение GitHub

**Account → Integrations → GitHub → Connect**. Репозиторий
`https://github.com/MatronixOwner/Raut` публичный, но подключение нужно, чтобы
Northflank собирал из Git.

> **ВАЖНО:** весь код Raut 1.0.2 лежит в ветке **`arena/d55d4f5c-raut`**,
> а не в `main`. Везде ниже выбирайте именно её. На `main` старая версия.

## 4. Сервис

**Services → Create service → Combined service** (он и собирает из Dockerfile,
и запускает — это важно, отдельный Build service не нужен).

| Поле | Значение |
| --- | --- |
| Name | `raut` |
| Repository | `MatronixOwner/Raut` |
| Branch | **`arena/d55d4f5c-raut`** |
| Build option | **Dockerfile** |
| Dockerfile path | `/Dockerfile` |
| Docker build context | `/` |
| Build engine | BuildKit (по умолчанию) |
| Deployment plan | самый младший из доступных (`nf-compute-50`, 0.5 vCPU / 1 ГБ ≈ $12/мес — внутри бесплатных $20) |
| Instances | `1` |

`Dockerfile` в корне репозитория уже содержит `EXPOSE 8787`, `VOLUME ["/data"]`
и `CMD ["/app/entrypoint.sh"]`. `entrypoint.sh` сам читает `$PORT` (если
Northflank его выставит), иначе берёт `8787`, генерирует `client/config.js`
и создаёт каталог данных. Никаких команд и entrypoint-ов вручную вводить не надо.

## 5. Networking — порт

Northflank сам определяет порт из `EXPOSE`. Проверьте в **Configure → Networking**:

| Параметр | Значение |
| --- | --- |
| Port name | `http` (или `p01`) |
| Internal port | **8787** |
| Protocol | **HTTP** (HTTP/1.1; WebSocket поддерживается) |
| Public | **включено** |
| VPC accessible | выключено |

Публичные порты Northflank выставляет наружу на 80/443 с автоматическим
TLS-сертификатом и даёт домен
`[port-name]--[service-name]--[random].code.run`: https://northflank.com/docs/v1/application/network/configure-ports

Если автоопределение поставило 8080 — либо поправьте Internal port на `8787`,
либо задайте переменную `PORT=8080` (тогда сервер слушает 8080) и оставьте порт
8080. Главное, чтобы **Internal port совпадал с `$PORT` внутри контейнера**.

## 6. Постоянный том (чтобы аккаунты не исчезали)

**Advanced → Volumes → Add volume**:

| Параметр | Значение |
| --- | --- |
| Name / id | `raut-data` |
| Container mount path | **`/data`** |
| Size | `1024` MiB (1 ГиБ) |
| Access mode | `ReadWriteOnce` |

Именно `/data` — в `Dockerfile` задано `RAUT_DATA_DIR=/data`, там лежат
`state.json` (аккаунты, друзья, ЛС, история), `uploads/` и `server.log`.
Без тома данные живут до первого редеплоя. На Sandbox «Volumes and
persistence» включены в тариф.

## 7. Переменные окружения

**Configure → Environment → Add variable**:

| Ключ | Значение | Обязательно |
| --- | --- | --- |
| `RAUT_DEMO` | `1` | да — создаст пользователей `raut` / `drug` / `team` (пароль = логин + `123`), они уже друг у друга в друзьях |
| `RAUT_NAME` | `Raut — общий сервер` | нет |
| `PORT` | `8787` | нет, но задайте для детерминизма |
| `RAUT_PUBLIC_URL` | `https://p01--raut--xxxx.code.run` | нет. Впишите после первого деплоя, когда станет известен адрес, и сделайте Redeploy. Без неё клиент всё равно работает на том же origin |
| `RAUT_DISCOVERY_URL` | не задавайте | `entrypoint.sh` подставляет корректный URL сам |

Не задавайте `RAUT_STUN` / `RAUT_TURN_URL` — на бесплатном Sandbox UDP наружу
нет, эти значения всё равно не будут работать и только создадут ложные
ICE-кандидаты.

## 8. Health check

**Advanced → Health checks → Add**:

| Параметр | Значение |
| --- | --- |
| Protocol | HTTP |
| Path | `/api/health` |
| Port | `8787` |
| Initial delay | 10 s |
| Period | 60 s |
| Failure threshold | 3 |

## 9. Deploy и проверка

Нажмите **Create service** → дождитесь `COMPLETED`. В правом верхнем углу
сервиса (или **Networking → Ports**) появится ссылка, например:

```
https://p01--raut--k2m7q9abc123.code.run
```

Проверьте её одной командой с любого компьютера:

```bash
node scripts/smoke-test.mjs https://p01--raut--k2m7q9abc123.code.run
```

Тест проверит `/api/health`, `/api/config`, раздачу клиента, WebSocket-handshake
через WSS, регистрацию двух пользователей, дружбу, ЛС, чат и загрузку файла
(на хостинге будет 32 проверки: четыре проверки скачивания `.exe`/ZIP
пропускаются, потому что `release/` не входит в Docker-образ). Он умеет работать
по `https://` → `wss://` автоматически: `wss://` термится на edge Northflank и
уходит внутрь как обычный WebSocket.

Ручная проверка:

```bash
curl https://p01--raut--xxxx.code.run/api/health
# {"ok":true,"name":"Raut — общий сервер","version":"1.0.2","clients":0,...}
```

Откройте ссылку в двух окнах (второе — инкогнито), войдите `raut`/`raut123`
и `drug`/`drug123`, нажмите на карточке друга иконку монитора
**«Позвать играть»**. Кнопка **«Пригласить по ссылке»** копирует адрес другу.

## 10. Чтобы все установленные копии Raut переехали сами

Впишите полученный адрес **одной строкой** в [`SERVER_URL.txt`](../SERVER_URL.txt)
в корне репозитория и запушьте в ветку `arena/d55d4f5c-raut`:

```
https://p01--raut--k2m7q9abc123.code.run
```

При следующем запуске каждая уже установленная копия Raut считает адрес через
публичный GitHub API (`Access-Control-Allow-Origin: *`), запомнит его и откроет
общий сервер. Пользователям не нужно ничего обновлять или настраивать.
Проверить можно так:

```bash
curl -H 'Accept: application/vnd.github.raw+json' \
  'https://api.github.com/repos/MatronixOwner/Raut/contents/SERVER_URL.txt?ref=arena/d55d4f5c-raut'
```

---

## Голос и экран: что делать, если не соединяется

Проверка: оба в «Игровой», в голосовой панели нет RTT/статистики, в
`chrome://webrtc-internals` состояние `failed` — это ровно отсутствие TURN.

Варианты, от простого к полному:

1. **Оба в одной сети / у одного есть белый IP / есть IPv6** — WebRTC
   соединится и без TURN, ничего делать не надо.
2. **Добавить свой TURN на машине с UDP.** Бесплатный тестовый VPS в РФ
   (Beget 30 дней, SpaceWeb, Timeweb) + `sudo bash deploy/one-shot.sh` поднимает
   coturn; затем в переменных Northflank задайте
   `RAUT_TURN_URL=turn:YOUR_IP:3478?transport=udp` и
   `RAUT_TURN_USER` / `RAUT_TURN_PASS` из сгенерированного `deploy/.env`.
   Приложение остаётся на Northflank, наружу уходит только TURN.
3. **Layer 4 load balancer** у Northflank (TCP/UDP) — отдельный ресурс, на
   бесплатном Sandbox не входит; это уже платный путь.
4. Полностью автономный вариант без этого ограничения — любой VPS по
   [`voice-hosting.md`](voice-hosting.md): там `one-shot.sh` поднимает приложение,
   TLS и свой TURN одной командой и проверяет UDP 3478.

## Если что-то не так

| Симптом | Причина | Лечение |
| --- | --- | --- |
| 502 / 503 / `Application failed to respond` | не совпали порты | `PORT` в env == Internal port == `8787`, протокол HTTP, Public включён |
| «соединение потеряно» сразу | порт объявлен как HTTP/2 или закрыт | поставьте Protocol = **HTTP**, проверьте WSS в smoke-тесте |
| При каждом редеплое пропадают аккаунты | не примонтирован том | Advanced → Volumes → `/data`, 1024 MiB |
| Старая версия / нет кнопки «Позвать играть» | собрана ветка `main` | Branch = **`arena/d55d4f5c-raut`**, Redeploy |
| Сборка не видит `deploy/entrypoint.sh` | `.dockerignore` | в репозитории уже исправлено: `deploy/*` + `!deploy/entrypoint.sh` |
| Пустой экран, но `/api/health` отвечает | кэш старого `config.js` | откройте ссылку в инкогнито; при смене `RAUT_PUBLIC_URL` сделайте Redeploy |
| Просят карту при регистрации | расхождение pricing и billing docs | это политика площадки; альтернатива — Render Free (карта точно не нужна) |

## Дополнительно: одна команда через API

Если вместо кликов удобнее API (или вы хотите, чтобы деплой сделал я — дайте
API-токен с правом `Project > Services > General > Create` и имя проекта):

```bash
NORTHFLANK_API_TOKEN=xxx PROJECT_ID=raut bash deploy/northflank-api.sh
```

Скрипт создаёт Combined service со всеми настройками выше: ветка
`arena/d55d4f5c-raut`, Dockerfile `/Dockerfile`, порт 8787 HTTP public, том
`/data` на 1 ГиБ, `RAUT_DEMO=1`, health check `/api/health`. Затем печатает
выданный `*.code.run` адрес.

```bash
DRY_RUN=1 NORTHFLANK_API_TOKEN=x PROJECT_ID=x bash deploy/northflank-api.sh
```

покажет и проверит JSON без обращения к API. Схема взята из официальной
документации Northflank; на живом аккаунте не прогонялась — если площадка
отвергнёт `nf-compute-20` или `statefulSet`, переопределите `RAUT_PLAN`
(например `RAUT_PLAN=nf-compute-50`) или используйте основной путь через UI.

## Ссылки

- Тариф Sandbox: https://northflank.com/pricing
- Порты и протоколы: https://northflank.com/docs/v1/application/network/configure-ports
- Сетевые возможности (WebSockets, L4): https://northflank.com/docs/v1/application/network/networking-on-northflank
- Combined service из Dockerfile: https://northflank.com/guides/how-to-deploy-pocketbase-step-by-step-deployment-guide
- Тома: https://northflank.com/guides/deploy-a-onepassword-connect-server-on-northflank
- API combined service: https://northflank.com/docs/v1/api/project/services/create-combined-service
- Все бесплатные площадки: [`free-hosting.md`](free-hosting.md)
