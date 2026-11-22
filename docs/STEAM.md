# Подключение Steam

## Где подключать

Только на **локальном** сервере (`http://localhost:5173`). Публичный Render-стенд не имеет постоянного диска: refresh-token и SQLite там теряются при рестарте, а пароль отправлять на публичный сервер не нужно.

## Как подключить

1. Открыть `http://localhost:5173`.
2. Нажать **«Подключить Steam»**.
3. Выбрать:
   - **Логин и пароль** — ввести account name и пароль, затем код Steam Guard;
   - **QR-код** — отсканировать в мобильном приложении Steam и подтвердить вход.
4. Дождаться статуса `Steam online` и `GC connected`.

Пароль не сохраняется. Refresh-token шифруется AES-256-GCM ключом из `data/auth/key.bin` и лежит в `data/auth/steam.json`; оба файла в `.gitignore`.

## Что происходит после входа

- `steam-user` логинится по refresh-token.
- `node-cs2` подключается к Game Coordinator.
- Воркер запрашивает последние матчи (`requestRecentGames`).
- Матчи сразу пишутся в SQLite: счёт, K/D/A, HS, раунды, demo URL.
- Демки скачиваются и парсятся: карта, имена игроков, ADR, KAST, HLTV 2.0, киллфид.

## Импорт реальных матчей

```powershell
npm run demos:parse
```

Скрипт берёт все матчи с `demo_url` и `demo_status != 'parsed'`, качает `.dem.bz2` с `replay*.valve.net`, распаковывает, парсит `@laihoe/demoparser2`, обновляет БД и удаляет демку.

Демки Valve живут около 30 дней, поэтому синк лучше запускать сразу после игры. Повторный запуск безопасен: уже распарсенные матчи пропускаются.

## Steam Guard

Поддерживаются:

- код из email;
- TOTP из мобильного аутентификатора;
- подтверждение в приложении Steam (DeviceConfirmation).

Если есть `shared_secret`, его можно ввести в расширенном поле — тогда TOTP сгенерируется автоматически.

## Автозапуск

При старте сервер читает `data/auth/steam.json` и автоматически поднимает воркер, если `STEAM_AUTOSTART` не равен `0`. Отключить: `STEAM_AUTOSTART=0`.

## Отключение

В модалке **«Отключить»** удаляет токен и останавливает воркер.

## API

```text
GET  /api/steam/status
POST /api/steam/login   {accountName, password, sharedSecret?}
POST /api/steam/guard   {code}
POST /api/steam/qr
POST /api/steam/cancel
POST /api/steam/logout
POST /api/sync
```

Все маршруты закрыты Basic Auth, если заданы `APP_USER` / `APP_PASSWORD`.

## Ограничения

- Steam может потребовать повторный вход при смене пароля/отзыве сессий.
- Не запускайте несколько экземпляров сервера с одним аккаунтом одновременно.
- Game Coordinator — неофициальный протокол; при обновлениях CS2 возможны поломки `node-cs2`.
- Не публикуйте `data/auth` и не коммитьте `.env`.
