# Deploy — Landing de venda + agendamento (Usina Tracking)

Tudo o que precisa ser feito para colocar `lp.usinadotempo.com.br` no ar
com agendamento real (Google Calendar) e automação de e-mail (Resend).

Os comandos abaixo são para você rodar no seu terminal portátil
(`pwsh.exe` / `git.exe` / `node.exe` da pasta `Portatil\`). O Claude não
executa esta parte.

---

## 1. Aplicar a migration (D1)

Migrations **aditivas**: `0031_demo_bookings.sql` (tabela `demo_bookings`),
`0032_usina_self_tracking.sql` (tenant/workspace interno da Usina +
mapeamento do host da LP + 2 colunas em `workspace_config`) e
`0034_demo_bookings_telegram.sql` (4 flags `tg_*` p/ os avisos da equipe no
Telegram — seção 10). `apply` aplica todas as pendentes de uma vez. Nenhuma
toca em nada existente.

```bash
source ~/.cf-tracking-token
npx wrangler d1 migrations list usina-tracking-db --remote     # confere pendentes
npx wrangler d1 migrations apply usina-tracking-db --remote    # aplica
npx wrangler d1 execute usina-tracking-db --remote --command "PRAGMA table_info(demo_bookings);"
```

## 2. Provisionar o subdomínio `lp.usinadotempo.com.br`

Dois POSTs (mesmo procedimento da memória `project_dns_setup`). Token em
`~/.cf-tracking-token` (`CLOUDFLARE_API_TOKEN`).

```
# 2.1 — adicionar como custom domain do Pages project
POST https://api.cloudflare.com/client/v4/accounts/63ae4eb9d39a6b3083ce162a43cd0b7b/pages/projects/usina-tracking/domains
Body: {"name":"lp.usinadotempo.com.br"}

# 2.2 — criar o CNAME proxied
POST https://api.cloudflare.com/client/v4/zones/cf9b2294f85863bc0bb808f31f960cd9/dns_records
Body: {"type":"CNAME","name":"lp","content":"usina-tracking.pages.dev","proxied":true}
```

Espere ~30s para o SSL provisionar. O roteamento por Host já está no
`functions/_middleware.js` (`MARKETING_HOSTS`) — `lp.usinadotempo.com.br/`
serve `marketing/lp-usina-tracking/index.html`; `/assets/*`, `/partner.png`
e `/api/booking/*` caem direto.

## 3. Google Workspace — service account com delegação

1. **Google Cloud Console** → projeto → **APIs & Services** → habilitar
   **Google Calendar API**.
2. **IAM & Admin → Service Accounts** → criar uma SA → **Keys** → *Add key*
   → JSON. Guarde o JSON (tem `client_email` e `private_key`).
3. Na SA, anote o **Client ID** numérico (Details → Unique ID).
4. **admin.google.com** (Admin Console) → **Segurança → Controles de API →
   Delegação em todo o domínio** → *Adicionar*:
   - Client ID = o da SA
   - Escopo = `https://www.googleapis.com/auth/calendar`
5. Decida qual agenda recebe as reuniões:
   - Agenda principal do dono → `GCAL_CALENDAR_ID = primary` e
     `GCAL_IMPERSONATE = <e-mail do dono>`.
   - Agenda dedicada → compartilhe-a com o `GCAL_IMPERSONATE` com permissão
     **"Fazer alterações nos eventos"** e use o ID dessa agenda.

## 4. Resend — domínio de envio `usinadotempo.com.br`

1. Conta no Resend → **Domains** → *Add Domain* → `usinadotempo.com.br`.
2. Adicione na zona Cloudflare os registros que o Resend mostrar
   (SPF/`TXT`, DKIM `CNAME`s, e o `MX`/DMARC se pedir). O token já tem
   `Zone → DNS:Edit`.
3. Espere "Verified". Remetente usado: `agenda@usinadotempo.com.br`
   (ajustável por `BOOKING_FROM`).

## 5. Secrets no Pages (Settings → Environment variables → Production)

| Variável | Valor |
|---|---|
| `GCAL_SA_EMAIL` | `client_email` do JSON da SA |
| `GCAL_SA_PRIVATE_KEY` | `private_key` do JSON (cole inteiro; `\n` escapados tudo bem) |
| `GCAL_IMPERSONATE` | e-mail Workspace dono da agenda |
| `GCAL_CALENDAR_ID` | `primary` ou o ID da agenda dedicada |
| `RESEND_API_KEY` | chave da conta Resend |
| `BOOKING_NOTIFY_EMAIL` | (opcional) p/ quem vai o aviso interno — default = `GCAL_IMPERSONATE` |
| `BOOKING_FROM` | (opcional) default `Usina do Tempo <agenda@usinadotempo.com.br>` |
| `PUBLIC_BASE` | (opcional) default `https://lp.usinadotempo.com.br` (base do logo nos e-mails) |
| `SYNC_SECRET` | **já existe** — reutilizado pelo cron de lembretes |

> `GCAL_SA_PRIVATE_KEY`: a lib aceita tanto `\n` literais quanto quebras
> reais. Cole o valor do campo `private_key` do JSON exatamente como está.

## 6. Deploy do código

```bash
git add -A
git commit -m "Fase 2: agendamento real (Google Calendar) + Resend + LP lp.usinadotempo.com.br"
git push
```

Cloudflare Pages re-deploya a cada push (integração git). Aguarde o build.

## 7. Agendar o cron de lembretes

`/admin/` → seção de crons (cron-info já lista **"Lembretes de reunião"**).
No **cronjob.org**, crie um job:

- URL: `https://tracking.usinadotempo.com.br/api/sync/booking-reminders`
- Método: `POST`
- Header: `x-sync-secret: <SYNC_SECRET>`
- Cadência: a cada 1 hora (`45 * * * *`)

Cuida de: lembrete 24h e 1h, marcação de no-show (+30min após o fim) e
follow-up D+1 / D+3 / D+7 para quem não compareceu. Idempotente.

## 8. Smoke test (depois do deploy + DNS no ar)

1. `https://lp.usinadotempo.com.br/` carrega a landing (não cai no /admin).
2. Logo, badge Kommo e imagens aparecem (`/assets/...`, `/partner.png`).
3. Seção "agendar": os horários carregam de verdade (`/api/booking/slots`
   → 200, `days` preenchidos). Se der 503 → falta secret do GCAL.
4. Agende uma reunião de teste com seu e-mail:
   - evento aparece no Google Calendar com **Google Meet**;
   - chega o **e-mail de confirmação** (Resend, remetente
     `agenda@usinadotempo.com.br`);
   - chega o **aviso interno** no `BOOKING_NOTIFY_EMAIL`.
5. Tente agendar **o mesmo horário** de novo → deve dar 409 e recarregar a
   grade (anti double-booking).
6. `/admin/agendamentos` (logado como `usina_admin`) lista o agendamento,
   com a origem (UTM/fbclid) capturada; troque o status e salve.
7. Dispare o cron manualmente uma vez (POST com o header) e veja o
   `sync_log` registrar `platform='booking'`.

## 9. Self-tracking da Usina (Meta Ads + Google Ads + GA4)

A LP rastreia a **própria captação da Usina** (anúncio → reunião agendada)
reusando o pipeline do stack. A migration `0032` já criou o workspace
interno **"Usina Tracking — Vendas"** e mapeou `lp.usinadotempo.com.br`
pra ele em `workspace_domains`. Falta só preencher as credenciais.

No **`/admin/`**, abra o workspace **"Usina Tracking — Vendas"** e preencha
em `workspace_config`:

| Campo | Pra quê |
|---|---|
| `meta_pixel_id` | Pixel da Usina — browser **e** CAPI |
| `meta_access_token` | Token CAPI da Usina (server-side, resiste a ITP/adblock) |
| `meta_test_event_code` | (opcional) testar no Events Manager |
| `ga4_measurement_id` | GA4 da Usina (browser + Measurement Protocol) |
| `ga4_api_secret` | Segredo do GA4 MP (server-side) |
| `google_ads_aw_id` | `AW-XXXXXXXXX` da conta Google Ads da Usina (tag do browser) |
| `google_ads_conversion_label` | Label da conversão "Reunião agendada" |
| `meta_ads_account_id` + `meta_ads_access_token` | Pra sincronizar gasto → CPA/ROAS da própria captação no dashboard |

Como funciona depois de configurado:
- A LP busca os IDs públicos em `/api/booking/tracking-config` e monta
  Meta Pixel + GA4 + tag do Google Ads sozinha.
- No agendamento confirmado dispara, com o **mesmo `event_id`**:
  - Meta Pixel `Schedule` (browser) **+** `/tracker` → Meta CAPI
    (server-side) — o Meta deduplica os dois;
  - GA4 `generate_lead` (browser) **+** GA4 Measurement Protocol via
    `/tracker` (server-side);
  - Google Ads `conversion` (tag do browser, usa o gclid automaticamente).
- O `/tracker` resolve o workspace da Usina pelo Host (workspace_domains),
  loga em `event_log` → aparece em **Leads** e **Saúde do tracking** do
  dashboard da Usina. Sem credenciais preenchidas, ele só loga (não envia)
  — nada quebra.
- Conversão Google Ads server-side por gclid (em vez da tag do browser)
  fica como endurecimento futuro: o upload existe em `_core.js` pra
  compras; pra esse lead a tag do browser já cobre o caso padrão.

> A conversão Google Ads "Reunião agendada" precisa existir na conta
> Google Ads (Ferramentas → Conversões → nova, tipo *Lead*/site). Pegue o
> `AW-id` e o `label` do snippet que o Google gera e cole nos campos acima.

## 10. Avisos da equipe no Telegram

A equipe é avisada no **grupo do Telegram** a cada evento do ciclo da
reunião: **agendamento, lembrete 24h, lembrete 1h e no-show**. Bot:
**@usinadotempo_bot** ("Usina do Tempo"). Independente do e-mail — um canal
não bloqueia o outro (flags `tg_*` próprias na `demo_bookings`).

1. **Migration 0034** (`0034_demo_bookings_telegram.sql`, aditiva, 4 colunas
   `tg_*`): aplicada junto das pendentes na seção 1
   (`npx wrangler d1 migrations apply usina-tracking-db --remote`).
2. **Adicionar o @usinadotempo_bot ao grupo** da equipe como membro.
3. **Descobrir o `chat_id`** (uma vez): no grupo, mande
   `/start@usinadotempo_bot` (comando endereçado fura o modo privacidade);
   logo em seguida abra `https://api.telegram.org/bot<TOKEN>/getUpdates` e
   copie o `chat.id` (negativo, começa em `-100`).
   Grupo atual: `TELEGRAM_CHAT_ID = -1003937304323`.
4. **Secrets no Pages** (Settings → Environment variables → Production):

   | Variável | Valor |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | token do @usinadotempo_bot (do @BotFather) |
   | `TELEGRAM_CHAT_ID` | `-1003937304323` |

5. **Redeploy** (push ou "Retry deployment" — env var só vale em deploy
   novo). Sem os 2 secrets, `telegramConfig` retorna `ok:false` e tudo
   segue sem Telegram (degradação silenciosa, igual ao Resend).

Smoke test: agende uma reunião de teste na LP → "🗓️ Nova apresentação
agendada" cai no grupo em segundos. Se não cair, cheque `sync_log`
(`platform='booking'`) e os logs do Pages (`telegramConfig ok:false` =
secret faltando ou deploy não refeito). O modo privacidade do bot **não**
precisa ser desligado — o código só envia, nunca lê o grupo.

## Notas / decisões

- `lp.usinadotempo.com.br` resolve como `kind='workspace'` no `resolveHost`,
  mas o `_middleware.js` intercepta **antes** de qualquer lógica de
  tracking — a LP não escreve em `sessions`. A atribuição do lead é
  capturada pela própria página (UTM/fbclid/gclid/`_fbp`/`_fbc`) e gravada
  em `demo_bookings`.
- O Google manda o convite nativo (`sendUpdates=all`); o Resend manda os
  e-mails de marca por cima. Os dois lembram o lead — redundância proposital.
- `marketing/_copy-assets.js` é obsoleto e pode ser apagado quando puder.
- HMAC/verificação de assinatura nos endpoints `/api/booking/*` foi
  deliberadamente omitida (são públicos por natureza, como o `/tracker`);
  o anti-spam fica para um endurecimento futuro se o volume pedir.
