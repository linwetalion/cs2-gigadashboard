# Deploy

| Файл | Для чего |
|---|---|
| `Dockerfile` | образ приложения (Oracle VM, любой Docker-хост) |
| `docker-compose.yml` | запуск с volume `./data` |
| `Caddyfile.example` | HTTPS для Oracle + DuckDNS |
| `cloudflared.config.example.yml` | Cloudflare Tunnel для `giga.name.eu.org` |
| `giga.service.example` | systemd unit для Oracle VM без Docker |
| `is-a-dev.json.example` | заявка на бесплатный `name.is-a.dev` |
| `NORTHFLANK.md` | пошаговый деплой на бесплатный Northflank Sandbox |
| `../render.yaml` | fallback: бесплатный Render (демо, без диска) |

Полная инструкция: [`../docs/HOSTING.md`](../docs/HOSTING.md).

## Минимум для Oracle VM

```bash
git clone <repo> /opt/giga
cd /opt/giga
cp .env.example .env
# HOST=0.0.0.0, APP_USER, APP_PASSWORD
docker compose up -d --build
```

## Минимум для домашнего ПК

```powershell
npm run build
$env:APP_USER="giga"; $env:APP_PASSWORD="<password>"
npm run start
tailscale funnel 8787 on
```
