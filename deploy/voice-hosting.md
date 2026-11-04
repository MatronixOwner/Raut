# Хостинг, где работают И голос, И текст

Короткий ответ: **нужен VPS с публичным IP и открытым UDP 3478**. Бесплатные
PaaS (Render, Railway, Northflank, Koyeb, Fly.io, Cloud Run) наружу пускают
только HTTP/HTTPS, поэтому на них работает чат, но не работает голос между
двумя разными домашними сетями: своему STUN/TURN негде слушать UDP.
На VPS `deploy/one-shot.sh` поднимает всё сразу — текст, HTTPS/WSS, свой
STUN/TURN, голос и экран — одной командой.

## Почему именно UDP

Raut не использует зарубежные STUN/TURN. Медиа идёт напрямую между клиентами,
а когда NAT мешает — через **свой** coturn на порту `3478/udp`. Поэтому у
площадки должны быть:

| Что | Зачем |
| --- | --- |
| Публичный IPv4 | чтобы друг мог зайти по ссылке |
| Root / Docker | поднять приложение, Caddy и coturn |
| **UDP 3478 + TCP 3478/5349** | свой STUN/TURN — голос и показ экрана |
| TCP 80 / 443 | HTTPS и WSS — чат, друзья, ЛС, сигналинг |
| Постоянный диск | аккаунты и история в `data/state.json` |

Проверено: [Northflank, Render, Railway](https://northflank.com/docs/v1/application/network/configure-ports)
и остальные PaaS открывают наружу только HTTP/HTTP2, а TCP/UDP требуют
отдельного Layer 4 балансировщика.

## Бесплатные VPS в России (без зарубежной карты)

| Провайдер | Бесплатно | Карта | Нюанс |
| --- | --- | --- | --- |
| **Beget** | до 30 дней | не нужна на старте | самый длинный тест; уточните, что берёте именно **VPS/VDS**, а не виртуальный хостинг без root |
| **SmartApe** | 14 дней | не нужна | полноценный VPS |
| **Timeweb** | 10 дней | не нужна на старте | до 3 бесплатных доменов .RU/.РФ — можно обойтись без `sslip.io` |
| **Selectel** | бонус на 1–3 месяца | уточняйте | облачный сервер по бонусу |
| **RuWeb** | 6 дней | возвращаемый депозит 200 ₽ | закрыты только почтовые порты 25/465/587 |
| **SpaceWeb (sweb.ru)** | 3 дня, бывает акция «1-й месяц 0 ₽» | не нужна, подтверждение по телефону | сразу с Docker и Node.js |
| **RuVDS** | 3 дня | только телефон и почта на их странице теста | тариф дешевле 3000 ₽; часть обзоров пишет про привязку карты — проверьте при заказе |
| **vds.guru** | 24 часа | не нужна | Амстердам, полный root, без карты |
| **AdminVPS** | 5–7 дней | — | только для юрлиц и ИП |
| **Oracle Cloud Always Free** | навсегда | **нужна зарубежная карта** | лучший «насовсем», но из РФ регистрация почти недоступна; два файрвола (Security List + iptables) |

Источники: [hostinghub.ru — рейтинг бесплатных VPS](https://hostinghub.ru/top/vds/free),
[vc.ru — тестовые периоды 2026](https://vc.ru/rating_top/2916800-luchshie-vps-vds-provaideri-s-testovym-periodom),
[ruvds.com/vps_test](https://ruvds.com/vps_test/),
[sweb.ru — бесплатный VDS](https://sweb.ru/vds/free/),
[ruweb.net — 6 дней](https://ruweb.net/test-vds),
[vds.guru — 24 часа](https://vds.guru/trial/),
[vpsindex.ru](https://vpsindex.ru/s-testovym-periodom),
[Oracle Cloud: два файрвола](https://www.computerandmobile.com/oracle-cloud-free-tier-vps/).

**Мой выбор:** Beget или SmartApe — дольше всего, без карты, российский IP.
Хотите просто проверить вечером — RuVDS на 3 дня или vds.guru на сутки.
После теста самый дешёвый постоянный VPS — от ~129–300 ₽/мес.

## Что делать (4 шага)

### 1. Закажите VPS

Ubuntu 22.04/24.04, 1 vCPU, 1 ГБ RAM, 10 ГБ диск, **публичный IPv4**.
Запомните IP и SSH-доступ.

### 2. Откройте порты В ПАНЕЛИ ХОСТЕРА

Это второй файрвол, который `one-shot.sh` не может обойти:

```
TCP 80, 443, 3478, 5349
UDP 3478          ← без него голоса не будет
```

У Oracle Cloud это **Security List** (Ingress Rules, source `0.0.0.0/0`) **плюс**
iptables внутри ВМ — там в конце INPUT стоит `REJECT`, правила надо вставлять
выше него. У RuVDS/Timeweb/Beget — раздел «Файрвол» / «Сетевой экран» в панели.

### 3. Одна команда

```bash
sudo apt-get update -qq && sudo apt-get install -y -qq git
sudo git clone -b arena/d55d4f5c-raut --depth 1 https://github.com/MatronixOwner/Raut.git /opt/raut
sudo bash /opt/raut/deploy/one-shot.sh
```

Домен покупать не надо: скрипт сам определит IP и возьмёт
`https://raut.1-2-3-4.sslip.io` с сертификатом Let's Encrypt. Если есть свой
домен (например бесплатный .RU от Timeweb):

```bash
sudo bash /opt/raut/deploy/one-shot.sh chat.example.ru
```

Скрипт сам: откроет `ufw`/`iptables`/`firewalld`, поставит Docker, сгенерирует
пароль TURN, пропишет `external-ip` для coturn если VPS за NAT, поднимет
приложение + Caddy + coturn, создаст пользователей и **проверит голос**.

Перед деплоем можно посмотреть конфиги без изменения системы:

```bash
DRY_RUN=1 RAUT_CONFIG_DIR=/tmp/raut-cfg bash /opt/raut/deploy/one-shot.sh
```

### 4. Проверьте, что голос реально есть

```bash
python3 /opt/raut/deploy/check-voice.py chat.example.ru
node /opt/raut/scripts/smoke-test.mjs https://chat.example.ru
```

`check-voice.py` проверяет `/api/health`, наличие своего STUN и TURN с
креденшелами в `/api/config`, и **реально отправляет STUN Binding Request на
UDP 3478** — то есть убеждается, что порт открыт и coturn отвечает. Если
видите `✗ UDP 3478 отвечает` — порт закрыт в панели хостера, откройте его.

Дальше: откройте ссылку в двух окнах (второе инкогнито), `raut`/`raut123` и
`drug`/`drug123`, нажмите на карточке друга **«Позвать играть»**. Впишите адрес
одной строкой в `SERVER_URL.txt` репозитория — и все установленные копии Raut
переедут на общий сервер сами.

## Про «без зарубежных сервисов»

STUN и TURN — **свои**, на том же VPS; Google STUN удалён. Медиа не уходит к
третьим лицам. TLS-сертификат выдаёт Let's Encrypt (это центр сертификации, а не
рантайм-зависимость) — после его получения приложение работает без обращений к
зарубежным сервисам. Если не хотите даже DNS-зависимости от `sslip.io`,
возьмите бесплатный .RU/.РФ домен у Timeweb и передайте его в `one-shot.sh`.

## Если голос всё равно не соединяется

| Проверка | Команда |
| --- | --- |
| Порт открыт на ВМ | `ss -lunp \| grep 3478`, `docker compose logs coturn` |
| Порт открыт снаружи | `python3 deploy/check-voice.py <домен>` |
| TURN креденшелы совпадают | `grep TURN_PASSWORD deploy/.env` и `/api/config` |
| VPS за NAT | в `turnserver.conf` должна быть строка `external-ip=<публичный IP>` |
| ICE-кандидаты | `chrome://webrtc-internals` → должен появиться кандидат типа `relay` |

## Ссылки по репозиторию

- Все бесплатные площадки и PaaS: [`free-hosting.md`](free-hosting.md)
- Northflank (только текст): [`northflank.md`](northflank.md)
- Общая инструкция деплоя: [`README.md`](README.md)
- Проверка голоса: [`check-voice.py`](check-voice.py)
