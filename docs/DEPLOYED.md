# Публичный деплой

## Текущий стенд

| Параметр | Значение |
|---|---|
| Хостинг | Render, Hobby (free) |
| URL | https://cs2-gigadashboard.onrender.com |
| Сервис | `srv-dc164rff3r2c73bouncg` |
| Blueprint | `exs-dc164j6c6qcc73cmoru0` |
| Репозиторий | https://github.com/linwetalion/cs2-gigadashboard (public) |
| Ветка | `main` |
| Режим | `GIGA_DEMO=0`, реальные данные из seed-снимка |
| База | SQLite в `/tmp/giga.db`, при старте копируется из `/app/data/seed/giga.db` |
| Basic Auth | пользователь `giga`, пароль задан в Render Environment |

Пароль в репозиторий не записывается. Он хранится только в Render → Environment → `APP_PASSWORD`.

## Реальные данные на публичном стенде

Render Free не даёт постоянный диск, поэтому база собирается при старте из
закоммиченного снимка `data/seed/giga.db` (2,2 МБ).

Снимок содержит **547 реальных матчей** и только те таблицы, которые читает
дашборд:

| Таблица | Содержимое |
|---|---|
| `matches` | карта, счёт, дата, режим, сезон, результат |
| `match_players` | только строка игрока (`is_me = 1`), агрегаты K/D/A, ADR, HS, KAST, рейтинги |
| `shots` | 18 112 выстрелов, steamid обнулён |
| `damage` | 4 286 попаданий, attacker/victim обнулены |
| `grenades` | 1 179 гранат, thrower обнулён |

Из снимка удалены: ники и steamid других игроков, киллфид, раунды, экономика,
позиции, demo URL и share-коды. Снимок безопасно публиковать в открытом репозитории.

Пересобрать снимок после новых матчей:

```bash
npm run seed:make
npm run seed:audit
git add data/seed/giga.db && git commit -m "Refresh real-data seed" && git push
```

## Ограничения Render Free

- Сервис засыпает после ~15 минут без запросов; первый запрос после сна может занять 50+ секунд.
- Нет постоянного диска: изменения в `/tmp/giga.db` теряются при рестарте, база
  снова копируется из seed. Стенд работает в режиме read-only.
- 512 МБ RAM: хватает для UI/API, но не для тяжёлого парсинга демок.
- Steam-логин на публичном стенде не используется: токены и демки остаются локально.
- Для записи новых матчей нужен хост с volume (Oracle Always Free, Northflank с картой и т.п.).

## Проверка

```bash
curl https://cs2-gigadashboard.onrender.com/api/health
# {"ok":true,"demo":false,"metrics":538,"registryVersion":"1.538.2026-11-22"}

curl -u giga:<password> https://cs2-gigadashboard.onrender.com/api/dashboard | head
```

Ожидаемо: `demo=false`, 547 матчей, 11 594 раунда, win rate 49,5%.

## Обновление

```bash
git push origin main
```

Render пересоберёт сервис автоматически (Blueprint, `autoDeploy: true`).

## Домен

Render Hobby включает 2 custom domain, но в текущем дашборде секция Custom Domains не отображается (особенность интерфейса/аккаунта). Публичный адрес пока `*.onrender.com`.

Когда секция станет доступна:

1. Render → сервис → Settings → Custom Domains → Add.
2. `cs2giga.is-a.dev` (CNAME на `cs2-gigadashboard.onrender.com`) или `cs2giga.duckdns.org`.
3. Дождаться TLS.
