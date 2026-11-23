# Правила работы с репозиторием

## Автокоммит

1. Любое изменение кода, данных, документации или конфигов **сразу** коммитится в `main`.
   Отдельная просьба «закоммить» не нужна.
2. Один логический шаг — один коммит. Сообщение в императиве, на английском, до 72 символов.
3. Перед коммитом обязательно:
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
4. Если менялась схема БД или данные — пересобрать публичный снимок:
   - `npm run seed:make`
   - `npm run seed:audit`
   - закоммитить `data/seed/giga.db`.
5. Никогда не коммитить:
   - `data/giga.db`, `data/*.db-*`, `data/demos/`, `data/auth/`, `.env*`;
   - токены, пароли, `APP_PASSWORD`, `STEAM_REFRESH_TOKEN`, Leetify access token.
6. Быстрый путь: `npm run autopublish` — добавляет всё, коммитит и пушит.

## Автодеплой

1. Пуш в `main` — это и есть триггер публикации.
2. Основной канал: GitHub Actions → Render Deploy Hook (`RENDER_DEPLOY_HOOK_URL` в Secrets).
3. Если хук не настроен или Render не подключён к GitHub — деплой вручную:
   Render → сервис `cs2-gigadashboard` → **Manual Deploy → Deploy latest commit**.
4. После деплоя проверить:
   - `GET /api/health` → `demo:false`, `metrics:538`;
   - `GET /api/teams` → непустой список составов;
   - версия ассетов в HTML совпадает со свежим билдом.
5. Не публиковать секреты в переменных окружения репозитория. Пароль Basic Auth живёт только
   в Render → Environment → `APP_PASSWORD`.

## Definition of done

- фича работает на локальной базе;
- формулы метрик описаны в `docs/TZ-gigadashboard.md`;
- у каждой цифры есть тултип с формулой;
- изменения запушены;
- публичный стенд обновлён (или явно указано, почему нет).
