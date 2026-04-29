# Cron de sincronização Meta (Marketing API + Instagram + Pages)

A Usina Tracking não roda jobs internamente — Cloudflare Pages não tem cron triggers nativos. Os syncs Meta são puxados por um **cron externo** que bate em endpoints HTTP da plataforma.

## Endpoints disponíveis

Todos exigem header `x-sync-secret: <SYNC_SECRET>` (gerado durante deploy, gravado em `~/.cf-tracking-token` no host do operador). Sem ele, retornam `401`.

| Endpoint | O que sincroniza | Cadência sugerida |
|---|---|---|
| `POST /api/sync/meta-marketing` | Campanhas + ad sets + ads + insights diários (campaign + ad level) | a cada **1h** (spend muda em tempo real) |
| `POST /api/sync/meta-instagram`  | Perfil IG + 50 posts + insights diários + audiência | a cada **4h** |
| `POST /api/sync/meta-pages`      | Page profile + 50 posts + insights diários | a cada **6h** |

**Body opcional** (todos os 3 endpoints):

```json
{ "date_from": "YYYY-MM-DD", "date_to": "YYYY-MM-DD" }
```

Default: `date_from` = 7 dias atrás (Marketing) / 30 dias atrás (IG, Pages); `date_to` = hoje.

## Sync histórico inicial (one-shot)

Quando cadastrar um workspace novo, dispare um sync amplo (1-2 anos atrás) **uma única vez** pra trazer o histórico completo de campanhas. Depois disso, o cron horário cobre o dia-a-dia.

```bash
# Faculdade Vidal — sync histórico de 18 meses
curl -X POST "https://admin.tracking.usinadotempo.com.br/api/sync/meta-marketing" \
  -H "x-sync-secret: $SYNC_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"date_from":"2024-11-01","date_to":"2026-04-29"}'
```

A Meta API limita time_range a ~37 meses, então 2-3 anos atrás é o máximo prático.

## Cron schedule recomendado

Usar **cronjob.org** (free tier suficiente: 50 jobs, intervalo mínimo 1 min, 1.5MB resposta).

### Job 1 — Marketing (campanhas + insights)

- **URL**: `https://admin.tracking.usinadotempo.com.br/api/sync/meta-marketing`
- **Method**: POST
- **Headers**: `x-sync-secret: <valor>` + `Content-Type: application/json`
- **Body**: `{}`
- **Schedule**: a cada hora, minuto `5` (`5 * * * *`)
- **Timeout**: 60s

### Job 2 — Instagram

- **URL**: `https://admin.tracking.usinadotempo.com.br/api/sync/meta-instagram`
- **Method**: POST
- **Headers**: idem
- **Body**: `{}`
- **Schedule**: a cada 4h, minuto `15` (`15 */4 * * *`)
- **Timeout**: 90s

### Job 3 — Pages

- **URL**: `https://admin.tracking.usinadotempo.com.br/api/sync/meta-pages`
- **Method**: POST
- **Headers**: idem
- **Body**: `{}`
- **Schedule**: a cada 6h, minuto `25` (`25 */6 * * *`)
- **Timeout**: 90s

> **Por que esses minutos diferentes**: distribuir os jobs em minutos diferentes da hora reduz pressão em rate-limit da Meta API (que é por app + por ad account).

## Como saber se o cron está rodando

1. **No painel `/dash`** — cada seção (Campanhas, Instagram, Página Facebook) mostra `· última sync X min atrás` no canto superior. Se não atualizar, cron parou.
2. **No D1** — `sync_log` tem 1 linha por workspace por execução, com `status`, `rows_upserted`, `error_message`, `duration_ms`.
3. **No cronjob.org** — aba "Execution history" mostra HTTP code retornado. `200` ou `207` = OK; `4xx`/`5xx` = problema.

## Resposta 207 (Multi-Status)

Se um workspace falhar mas outro passar, o endpoint responde `207`. A resposta detalha por workspace:

```json
{
  "ok": false,
  "totals": { "workspaces": 2, "ok": 1, "failed": 1, ... },
  "results": [
    { "workspace_id": "abc...", "status": "ok", "campaigns": 20, ... },
    { "workspace_id": "def...", "status": "error", "error": "Meta API 403: ..." }
  ]
}
```

O `cronjob.org` deve marcar 207 como sucesso (configura "Allowed status codes": `200, 207`).

## Troubleshooting

### `401 Unauthorized`
- Header `x-sync-secret` ausente ou incorreto. Verificar valor em `~/.cf-tracking-token` no host do operador.

### `skipped: platform_config.meta_long_lived_token not set`
- Token global da Usina não foi cadastrado em `/admin/platform`. Cadastrar o System User token long-lived com scopes Marketing+IG+Pages.

### `Meta API 403: Ad account owner has NOT grant...`
- O `meta_ads_account_id` do workspace está incorreto OU o token não tem acesso àquele ad account. Confirmar via `/me/adaccounts` no Graph API Explorer.

### `Meta API 4: rate limit`
- Chamamos com retry automático (3 tentativas com back-off 800/1600/2400ms). Se persistir, reduzir cadência ou usar System User token (rate limit maior que User token).

### Sync IG retorna `partial`
- Métrica `audience` ou `account_insights` parcialmente indisponível — geralmente porque a conta tem <100 seguidores (Meta esconde demographics nesse caso). Outros dados (perfil, media) seguem OK.

## Alternativas ao cronjob.org

- **EasyCron** (free 50 jobs)
- **GitHub Actions** com `schedule:` cron — workflow simples chamando `curl`. Limitação: GitHub agenda mas pode atrasar até 5 min.
- **Cloudflare Worker Cron Triggers** — requer projeto Worker separado (não Pages); mais robusto mas exige setup extra.

## Token expira em 60 dias?

Se você está usando um **User Token long-lived** (gerado via Graph API Explorer + `oauth/access_token`), ele expira em **60 dias**. O painel `/admin/platform` mostra um aviso amarelo quando faltam ≤30 dias.

Migrar para **System User Token** (Business Manager → System Users → Generate Token) elimina a expiração — recomendado pra produção.
