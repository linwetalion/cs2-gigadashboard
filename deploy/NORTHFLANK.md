# Northflank: внешний хостинг

Northflank Sandbox — бесплатный тариф без карты: **2 сервиса, 1 база, always-on без засыпания, persistent volumes**, до $20 ресурсов в месяц. Это лучший бесплатный вариант для этого приложения: нужен постоянный процесс для Steam GC и диск для SQLite.

Ограничение: 0,5 vCPU / 1 ГБ хватает для дашборда и GC-синка, но парсинг демок лучше делать локально или поднять план на время бэкфилла.

## 1. Аккаунт и репозиторий

1. Зарегистрироваться: https://app.northflank.com/signup (GitHub OAuth, карта не нужна).
2. Установить Northflank GitHub App на репозиторий `linwetalion/cs2-gigadashboard` (private).
3. Создать проект `giga`, регион `Europe` (Frankfurt).

## 2. Сервис

В проекте: **Create service → Combined service**.

| Поле | Значение |
|---|---|
| Name | `web` |
| Repository | `linwetalion/cs2-gigadashboard` |
| Branch | `main` |
| Build type | Dockerfile |
| Dockerfile path | `/Dockerfile` |
| Build context | `/` |
| Compute plan | `nf-compute-50` (0.5 vCPU / 1 GB) |
| Instances | 1 |
| Port | `8787`, protocol HTTP, public |
| Health check | `/api/health` |

## 3. Volume

В сервисе: **Volumes → Add volume**.

| Поле | Значение |
|---|---|
| Name | `data` |
| Size | 1 GiB |
| Mount path | `/app/data` |

SQLite будет лежать в `/app/data/giga.db` и переживёт рестарт.

## 4. Environment

**Environment → Add variable**:

```dotenv
HOST=0.0.0.0
PORT=8787
GIGA_DB=/app/data/giga.db
GIGA_DEMO=1
APP_USER=giga
APP_PASSWORD=<длинный пароль>
```

`GIGA_DEMO=1` оставить, пока не подключён Steam. Демо-датасет создастся при первом старте.

## 5. Деплой

Нажать **Deploy**. Сборка Dockerfile занимает 2–5 минут.

После деплоя Northflank выдаст домен вида:

```
https://web-<project>-<hash>.code.run
```

Проверка:

```bash
curl -u giga:<password> https://web-....code.run/api/health
```

Ожидаемый ответ:

```json
{"ok":true,"demo":true,"metrics":538,"registryVersion":"1.538.2026-11-22"}
```

## 6. Свой домен

1. Купить/занять бесплатный домен: `cs2giga.eu.org` (3-й уровень) или `cs2giga.duckdns.org` (4-й).
2. В Northflank: **Networking → Domains → Add domain**.
3. Создать CNAME:

```
cs2giga.eu.org  CNAME  web-<project>-<hash>.code.run
```

4. Northflank выпустит TLS автоматически (Let's Encrypt).
5. Включить Basic Auth (уже включён через `APP_USER`/`APP_PASSWORD`) или Northflank IP policy.

## 7. Обновления

`main` → auto deploy включён. После `git push` Northflank пересоберёт сервис.

## 8. Ограничения Sandbox

- 2 сервиса, 2 job, 1 addon.
- До $20 ресурсов в месяц; `nf-compute-50` ≈ $12/мес, остаётся запас.
- Нет autoscaling и HA — для личного дашборда не нужно.
- Парсинг демок на 1 ГБ может упираться в память: запускайте бэкфилл на локальной машине, а на Northflank держите только API/UI и лёгкий GC-синк.

## 9. Альтернатива: Render

`render.yaml` в корне — бесплатный web service. Но у Render free:
- нет постоянного диска (`GIGA_DB=/tmp/giga.db`, данные теряются при рестарте);
- сервис засыпает через ~15 минут, GC-сессия рвётся.

Подходит только как публичное демо. Для реального синка — Northflank или Oracle VM.
