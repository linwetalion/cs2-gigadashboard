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
| Режим | `GIGA_DEMO=1`, SQLite в `/tmp/giga.db` |
| Реальные данные | только локально: GC-синк и демки не переносятся на Render |
| Basic Auth | пользователь `giga`, пароль задан в Render Environment |

Пароль в репозиторий не записывается. Он хранится только в Render → Environment → `APP_PASSWORD`.

## Ограничения Render Free

- Сервис засыпает после ~15 минут без запросов; первый запрос после сна может занять 50+ секунд.
- Нет постоянного диска: при рестарте SQLite создаётся заново и заполняется демо-данными.
- 512 МБ RAM: хватает для UI/API, но не для тяжёлого парсинга демок.
- Для реального GC-синка и сохранения истории нужен Oracle Always Free, Northflank с картой или другой always-on хост с volume.

## Проверка

```bash
curl https://cs2-gigadashboard.onrender.com/api/health
# {"ok":true,"demo":true,"metrics":538,"registryVersion":"1.538.2026-11-22"}

curl -u giga:<password> https://cs2-gigadashboard.onrender.com/api/dashboard | head
```

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
