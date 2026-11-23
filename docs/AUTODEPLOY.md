# Автокоммит и автодеплой

## Что настроено

| Механизм | Файл | Что делает |
|---|---|---|
| Правило для агента | `AGENTS.md` | каждый шаг коммитится и пушится, проверки перед коммитом |
| Скрипт | `scripts/autopublish.mjs` | `git add -A` → commit → push origin main → Render deploy hook |
| npm script | `package.json` → `autopublish` | короткая команда для скрипта |

Workflow-файлы GitHub Actions в репозиторий не коммитятся: OAuth-токен без scope `workflow`
не даёт их пушить, а деплой и без них полностью закрывается хуком Render.

## Как пользоваться

```bash
npm run autopublish
npm run autopublish -- "Add team funnel comparison"
```

## Автодеплой на Render

1. Render → сервис `cs2-gigadashboard` → Settings → Deploy Hook → **Copy URL**.
2. Положить URL в `.env` (файл в `.gitignore`, в репозиторий не попадает):

   ```
   RENDER_DEPLOY_HOOK_URL=https://api.render.com/deploy/srv-...?key=...
   ```

   Либо добавить его в Render → Environment, если хук должен вызываться из самого сервиса.

3. `npm run autopublish` после пуша делает `POST` на хук — Render собирает свежий коммит.

Если хук не настроен, скрипт печатает подсказку и завершается успешно; деплой запускается
вручную: Render → **Manual Deploy → Deploy latest commit**.

Альтернатива — включить Render GitHub integration (Settings → Connect), тогда достаточно пуша.

## Проверка после деплоя

```bash
curl https://cs2-gigadashboard.onrender.com/api/health
# {"ok":true,"demo":false,"metrics":538,...}

curl -u giga:<password> https://cs2-gigadashboard.onrender.com/api/teams
```

## Запрещено

- Коммитить `.env`, токены, пароли, `data/auth/`.
- Пушить в `main` без прохождения `typecheck`, `test`, `build`.
- Публиковать реальные ники и steamid других игроков: публичный снимок использует псевдонимы.
