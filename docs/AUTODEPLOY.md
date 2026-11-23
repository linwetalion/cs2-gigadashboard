# Автокоммит и автодеплой

## Что настроено

| Механизм | Файл | Что делает |
|---|---|---|
| Правило для агента | `AGENTS.md` | каждый шаг коммитится и пушится, проверки перед коммитом |
| Скрипт | `scripts/autopublish.mjs` | `git add -A` → commit → push origin main |
| npm script | `package.json` → `autopublish` | короткая команда для скрипта |
| CI/CD | `.github/workflows/deploy.yml` | typecheck + test + build, затем Render Deploy Hook |

## Как пользоваться

```bash
npm run autopublish
npm run autopublish -- "Add team funnel comparison"
```

## Автодеплой на Render

Есть два независимых канала, достаточно одного:

1. **Render Deploy Hook (рекомендуется).**
   - Render → сервис `cs2-gigadashboard` → Settings → Deploy Hook → Copy URL.
   - GitHub → репозиторий → Settings → Secrets and variables → Actions →
     New repository secret → `RENDER_DEPLOY_HOOK_URL`.
   - После этого каждый пуш в `main` собирает и публикует сервис.

2. **Render GitHub integration.**
   - Render → сервис → Settings → Connect → авторизовать GitHub.
   - `render.yaml` уже содержит `autoDeploy: true`.

Если ни один канал не активен, деплой запускается вручную:
Render → Manual Deploy → **Deploy latest commit**.

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
