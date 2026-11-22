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

1. **Логин Steam** — сделано
   - [x] `steam-session` startWithCredentials / QR.
   - [x] Steam Guard: email/TOTP/device + shared_secret.
   - [x] Шифрование refresh-token: AES-256-GCM.
   - [x] Endpoint `POST /api/steam/login`, `POST /api/steam/qr`, `POST /api/steam/guard`, `POST /api/steam/logout`.
   - [x] Автозапуск воркера из сохранённого токена.
   - [ ] Проверка на реальном аккаунте (нужен Steam Guard пользователя).

2. **Синк матчей** — сделано
   - [x] `requestRecentGames` для последних 8.
   - [x] Нормализация в `matches`, `match_players`, `rounds`.
   - [x] K/D/A/HS/счёт/длительность из GC.
   - [x] Импорт истории Leetify (540+ матчей) как `source='leetify'`.
   - [ ] `walkShareCodes` для полной истории напрямую из Steam.
   - [ ] `requestGame(shareCode)` для матчей вне последних 8.

3. **Демки** — базовый парсинг сделан
   - [x] URL `replay*.valve.net/730/{matchId}_{outcomeId}.dem.bz2`.
   - [x] Скачивание, распаковка, `@laihoe/demoparser2`.
   - [x] Карта, имена, kills, damage, ADR, KAST, HLTV 2.0, раунды.
   - [x] `kills` в БД.
   - [x] `shots`, `damage`, `grenades`, `positions` в БД.
   - [x] Accuracy, first-bullet, spray, HS hits, grenade counts.
   - [ ] TTD/TTK/preaim, 2D-реплей, зоны.
   - [ ] `economy` по тикам.
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
