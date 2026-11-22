# Roadmap

## Сделано (v0.1)

- [x] ТЗ на 538 метрик и 27 доменов.
- [x] Парсер ТЗ → `data/metrics.yaml` + `metrics.json`.
- [x] SQLite-схема: матчи, игроки, раунды, значения метрик, sync state.
- [x] Демо-датасет: 24 матча, 538 значений, детерминированная генерация.
- [x] Fastify API + Basic Auth + CSV export.
- [x] Гигадашборд: 10 секций, 100+ виджетов, 9 фильтров, чипы, permalink.
- [x] Тултипы: hover + drawer с формулой, N, уверенностью, бенчмарком, источниками.
- [x] Share-code codec с тестами.
- [x] Web API walker `GetNextMatchSharingCode`.
- [x] GC-очередь и opt-in Steam worker (`STEAM_SYNC=1`).
- [x] Dockerfile, compose, Caddy/Cloudflared/systemd примеры.
- [x] `docs/HOSTING.md` с бесплатными вариантами.

## Ближайшее (v0.2) — Steam и реальные данные

1. **Логин Steam**
   - `steam-session` startWithCredentials / QR.
   - Steam Guard: email/mobile code + shared_secret.
   - Шифрование refresh-token: AES-256-GCM, ключ через DPAPI.
   - Endpoint `POST /api/steam/login`, `GET /api/steam/qr`, `POST /api/steam/guard`.
   - Acceptance: токен переживает перезапуск, пароль не хранится.

2. **Синк матчей**
   - `requestRecentGames` для последних 8.
   - `walkShareCodes` для истории.
   - `requestGame(shareCode)` → `matchList`.
   - Нормализация в `matches`, `match_players`, `rounds`.
   - Acceptance: матч появляется в списке без демки, K/D/A/ADR совпадают со счётом.

3. **Демки**
   - URL `replay*.valve.net/730/{matchId}_{outcomeId}.dem.bz2`.
   - Скачивание, распаковка, `@laihoe/demoparser2`.
   - `shots`, `kills`, `damage`, `grenades`, `economy`, `positions`.
   - Acceptance: KIL/ACC/AIM/UTL/ECO считаются из событий, а не из демо-генератора.

4. **Метрики v1**
   - 50–70 ключевых метрик: KIL, ACC, AIM, UTL, ECO, ENT, TRD, CLT, MLT.
   - Пересчёт при новом матче.
   - Acceptance: значения воспроизводимы, N и confidence проставлены.

## Later (v0.3+)

- Полный реестр 538 метрик.
- Бенчмарки по рангам и сезонам.
- 2D/3D-реплей.
- Зоны и heatmaps.
- Focus Areas, training, достижения.
- Live-режим, prematch scouting.
- Публичный хостинг с Cloudflare Access.
