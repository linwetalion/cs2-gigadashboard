# Хостинг и домен

Дата проверки: 22.11.2026. Цены и лимиты меняются; перед деплоем сверяйтесь с сайтом провайдера.

## Короткий вывод

| Задача | Решение | Домен | Цена |
|---|---|---|---|
| Показать сайт сегодня, доступ только мне/друзьям | **локальный ПК + Tailscale Funnel** | `*.ts.net` | 0 |
| Постоянный красивый адрес, сервер дома | **Cloudflare Tunnel + EU.org** | `giga.<name>.eu.org` | 0 |
| Всегда включённый сервер в облаке | **Oracle Cloud Always Free + DuckDNS + Caddy** | `<name>.duckdns.org` | 0 |
| Быстрый публичный демо-стенд | **Cloudflare Quick Tunnel** | `*.trycloudflare.com` | 0 |
| Только UI/демо без Steam-воркера | Render / Koyeb | `*.onrender.com` / `*.koyeb.app` | 0, но засыпает |

**Рекомендация для этого проекта:** локальный ПК + Tailscale Funnel сейчас, параллельно регистрация `eu.org` для постоянного адреса. Steam-логин и refresh-token остаются на вашей машине, наружу торчит только HTTPS-прокси.

Причина: приложению нужен **долгоживущий процесс** (GC-соединение), **локальный диск** (SQLite + кэш демок) и **секреты Steam**. Бесплатные PaaS (Render/Koyeb) засыпают, не дают постоянный диск и плохо подходят для Game Coordinator.

---

## 1. Домены

### 1.1. Бесплатные варианты

| Домен | Уровень | Регистрация | Особенности |
|---|---|---|---|
| `name.is-a.dev` | 3-й | GitHub PR в `is-a-dev/register` | A/AAAA/CNAME/TXT, быстро, для разработчиков |
| `name.eu.org` | 3-й | заявка на `nic.eu.org` | бесплатно с 1996, одобрение 1–7 дней, можно делегировать NS |
| `name.duckdns.org` | 4-й | мгновенно | динамический DNS, A/AAAA, без NS-делегирования |
| `name.js.org` | 3-й | GitHub PR | только для JS-проектов, строгая модерация |
| `random.trycloudflare.com` | 4-й | без регистрации | живёт до перезапуска туннеля |
| `machine.tailnet.ts.net` | 5-й | аккаунт Tailscale | HTTPS из коробки, идеально для локального сервера |

### 1.2. Проверенные имена (22.11.2026)

| Имя | Статус |
|---|---|
| `cs2giga.duckdns.org` | DNS не отвечает → вероятно свободно, регистрация мгновенная |
| `gigadash.duckdns.org` | DNS не отвечает → вероятно свободно |
| `cs2giga.eu.org` | DNS не отвечает; проверить на nic.eu.org (wildcard DNS) |
| `cs2giga.is-a.dev` | проверить через availability tool на is-a.dev (у зоны wildcard DNS) |

DuckDNS-имена можно занять прямо сейчас. Для `eu.org` нужна заявка и ожидание, зато это 3-й уровень и можно делегировать NS в Cloudflare. `is-a.dev` — 3-й уровень, но требует GitHub PR и не даёт NS-делегирование.

### 1.3. Что выбрать

- **Постоянный адрес + Cloudflare Tunnel** → `eu.org`: EU.org умеет делегировать NS, значит домен можно добавить в Cloudflare и использовать Tunnel с кастомным hostname.
- **Постоянный адрес + Oracle VM** → `is-a.dev` (A-запись на IP) или `duckdns.org` (A-запись обновляется скриптом).
- **Прямо сейчас** → Tailscale Funnel, без домена.

---

## 2. Вариант A: локальный ПК + Tailscale Funnel

Плюсы: данные и токены не покидают машину, работает за NAT, HTTPS, не нужен домен.
Минусы: ПК должен быть включён; адрес длинный.

### Шаги

1. Установить Tailscale и войти в аккаунт.
2. Собрать и запустить приложение:

```powershell
npm run build
npm run start
# сервер: http://127.0.0.1:8787
```

3. Включить Funnel:

```powershell
tailscale funnel 8787 on
```

4. Tailscale покажет URL вида `https://desktop-xxxx.tailxxxx.ts.net`. Открыть его.

5. Включить Basic Auth **до** публикации:

```powershell
$env:APP_USER="giga"
$env:APP_PASSWORD="<длинный пароль>"
npm run start
```

Funnel проксирует `127.0.0.1:8787`, поэтому `HOST=127.0.0.1` менять не нужно.

---

## 3. Вариант B: Cloudflare Tunnel + EU.org

Плюсы: постоянный 3-й уровень, HTTPS, DDoS-защита, можно закрыть Cloudflare Access.
Минусы: EU.org одобряет заявку не мгновенно.

### 3.1. Домен

1. Зарегистрировать `name.eu.org` на `https://nic.eu.org`.
2. В заявке указать nameservers Cloudflare (их выдаст Cloudflare при добавлении сайта).
3. Дождаться одобрения.
4. В Cloudflare добавить сайт `name.eu.org`, дождаться активного статуса.

### 3.2. Туннель

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel login
cloudflared tunnel create giga
cloudflared tunnel route dns giga giga.name.eu.org
```

`%USERPROFILE%\.cloudflared\config.yml`:

```yaml
tunnel: giga
credentials-file: C:\Users\<you>\.cloudflared\<tunnel-id>.json

ingress:
  - hostname: giga.name.eu.org
    service: http://127.0.0.1:8787
  - service: http_status:404
```

Запуск:

```powershell
cloudflared tunnel run giga
```

Как служба Windows:

```powershell
cloudflared service install
```

### 3.3. Защита

В Cloudflare Zero Trust → Access → Application:
- hostname `giga.name.eu.org`;
- policy: Allow → ваш email / one-time PIN.

Либо Basic Auth приложения (`APP_USER` / `APP_PASSWORD`). Для публичного сайта без авторизации приложение сейчас **не готово**: оно показывает всю историю матчей и настройки.

---

## 4. Вариант C: Oracle Cloud Always Free + DuckDNS

Плюсы: настоящий always-on сервер, 200 ГБ диска, Docker.
Минусы: регистрация требует карту, ARM-квоты могут быть заняты, 1 ГБ AMD micro маловат для парсинга демок.

### 4.1. Сервер

1. Создать аккаунт Oracle Cloud Free Tier.
2. Создать VM:
   - ARM `VM.Standard.A1.Flex` (до 4 OCPU / 24 ГБ, если есть ёмкость) или AMD `VM.Standard.E2.1.Micro`;
   - Ubuntu 24.04;
   - 50–100 ГБ boot volume.
3. Открыть в Security List порты 80 и 443.
4. Установить Docker:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

### 4.2. DuckDNS

1. Войти на `https://www.duckdns.org`.
2. Создать `giga`.
3. Указать публичный IP VM.
4. (Опционально) cron-обновление, если IP динамический.

### 4.3. Деплой

```bash
git clone <repo> giga && cd giga
cp .env.example .env
# HOST=0.0.0.0, GIGA_DB=/app/data/giga.db, APP_USER/APP_PASSWORD
docker compose up -d --build
```

### 4.4. HTTPS через Caddy

`Caddyfile`:

```
giga.duckdns.org {
  reverse_proxy 127.0.0.1:8787
  encode zstd gzip
}
```

```bash
docker run -d --name caddy --restart unless-stopped \
  -p 80:80 -p 443:443 \
  -v /opt/caddy/Caddyfile:/etc/caddy/Caddyfile \
  -v caddy_data:/data -v caddy_config:/config \
  caddy:2
```

Caddy сам получит сертификат Let's Encrypt.

### 4.5. Ограничения

- 1 ГБ RAM: добавьте swap 2 ГБ, парсинг демок запускайте на локальной машине.
- SQLite на block volume: делайте ежедневный бэкап `data/giga.db`.
- Steam refresh-token на VM: только в зашифрованном виде и с Basic Auth/Cloudflare Access.

---

## 5. Вариант D: Render / Koyeb (только демо)

| Параметр | Render Free | Koyeb Free |
|---|---|---|
| Процесс | web service, засыпает через ~15 мин | 1 сервис, 512 МБ, засыпает через ~1 ч |
| Диск | нет постоянного | нет volume |
| Postgres | free на 30 дней | нет |
| Домен | `*.onrender.com` | `*.koyeb.app` |
| Для GC | нет | нет |

Можно развернуть **только витрину** с демо-данными:

```bash
# Render: Dockerfile уже есть
# Environment:
GIGA_DEMO=1
GIGA_DB=/tmp/giga.db
HOST=0.0.0.0
```

При каждом холодном старте БД создаётся заново и заполняется демо-данными. Реальный синк и токены — только на локальной машине или Oracle VM.

---

## 6. Переменные окружения

| Переменная | Назначение |
|---|---|
| `PORT` | порт сервера, по умолчанию 8787 |
| `HOST` | `127.0.0.1` локально, `0.0.0.0` в контейнере |
| `GIGA_DB` | путь к SQLite |
| `GIGA_DEMO` | `1` — синтетический датасет |
| `APP_USER` / `APP_PASSWORD` | Basic Auth, обязателен при публикации |
| `STEAM_API_KEY` | Web API key |
| `STEAM_REFRESH_TOKEN` | токен GC-сессии, шифровать |
| `STEAM_SHARED_SECRET` | TOTP для Steam Guard, если используете |

---

## 7. Чек-лист публикации

- [ ] `npm run build` проходит.
- [ ] `APP_USER` и `APP_PASSWORD` заданы.
- [ ] SQLite лежит на постоянном диске.
- [ ] Ежедневный бэкап `data/giga.db`.
- [ ] Steam-токены не в git и не в публичном env.
- [ ] Демо-режим выключен только после реального синка.
- [ ] Проверены `/api/health`, `/api/dashboard`, тултипы.
- [ ] Домен и HTTPS работают.
- [ ] Нет открытых портов, кроме 80/443 (или только Tunnel).
