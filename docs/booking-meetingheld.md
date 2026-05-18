# MeetingHeld — evento server-side de comparecimento (passo 3)

## O que é

Dois níveis de evento para a reunião de apresentação da LP de venda:

| Evento | Quando | Para que serve |
|---|---|---|
| `Schedule` | No agendamento (browser + `/tracker`) | Sinal de **volume** — já existia |
| `MeetingHeld` | Quando você toca **✅ Compareceu** no Telegram | Sinal de **qualidade** — otimizar a campanha por reunião comparecida, não por lead |

`MeetingHeld` é disparado **server-side** por [functions/_lib/booking-events.js](../functions/_lib/booking-events.js)
a partir de [functions/api/booking/mark.js](../functions/api/booking/mark.js), usando a
atribuição já gravada no agendamento (`fbp`/`fbc`/`fbclid`/`email`/`ip`/`ua`).
Não há navegador — a linha do D1 carrega tudo.

- **Idempotente:** gateado por `demo_bookings.held_event_sent`. Tocar o botão
  de novo (ou reabrir o link) não redispara.
- **Best-effort:** roda em `waitUntil`, nunca derruba a marcação de status.
- **Value-based:** envia `value` (BRL) proxy do potencial do lead pela faixa
  de verba do form (`booking-actions.js` → `meetingValue`), habilitando
  value-based bidding no Meta. **Não é receita** — é sinal relativo.

| Faixa de verba | `value` enviado |
|---|---|
| Mais de R$50k/mês | 3000 |
| R$20k–50k/mês | 1500 |
| R$5k–20k/mês | 600 |
| Menos de R$5k/mês | 100 |
| Não invisto | 50 |
| Não informado | 300 |

## Ativação (fica OFF por padrão)

O fan-out só dispara com a chave ligada. Sem ela, o botão ainda marca
`realizada`/`held_at` normalmente — só não manda evento para anúncio.

**Cloudflare Pages → Settings → Environment variables:**

| Variável | Valor | Efeito |
|---|---|---|
| `BOOKING_HELD_FANOUT` | `on` | Liga o disparo Meta + GA4 |
| `BOOKING_HELD_EVENT_NAME` | *(opcional)* | Renomeia o evento Meta (default `MeetingHeld`) |

As credenciais reaproveitam o `workspace_config` do workspace da LP
(`meta_pixel_id`, `meta_access_token`, `ga4_measurement_id`,
`ga4_api_secret`, `default_country_code`) — as mesmas que o `Schedule` já
usa. Nada novo de secret.

## O que criar ANTES de ligar

### Meta (Gerenciador de Eventos)
1. Confirme que o evento `MeetingHeld` chega: deixe `meta_test_event_code`
   no `workspace_config`, ligue a flag, marque uma reunião de teste como
   "Compareceu" e veja o evento em **Testar Eventos**. Remova o test code
   depois.
2. **Criar uma Conversão Personalizada** baseada no evento `MeetingHeld`.
3. (Recomendado) Trocar a otimização da campanha de agendamento para essa
   conversão e ativar **lances por valor** (value-based) usando o `value`
   que já enviamos.

### GA4
- Marcar o evento `meeting_held` como **Evento principal** (key event) em
  Admin → Eventos. Importável no Google Ads depois, se quiser.

### Google Ads — deferido (não implementado)
O uploader server-side existe em `webhook/_core.js` mas depende do
**developer token** (bloqueado — ver memória `project_google_ads_multitenant`).
Quando destravar: plugar offline click conversion por `booking.gclid` com a
conversionAction "MeetingHeld" do workspace e o mesmo `value`. Gancho marcado
no fim de `booking-events.js`. Até lá, o `gclid` segue gravado no
agendamento, então nada de atribuição se perde.

## Limitações conhecidas
- **GA4 client_id:** capturado do `_ga` original no agendamento (migration
  0036) — costura na sessão GA4 real. Fallback para id sintético estável só
  em agendamentos antigos (pré-0036) ou visitante sem cookie `_ga`.
- `action_source: system_generated` (evento de CRM, sem ação direta do
  usuário no momento do disparo) — correto para evento de bastidor.

## Teste end-to-end
1. Ligar `BOOKING_HELD_FANOUT=on` + `meta_test_event_code` no workspace.
2. Agendar reunião de teste na LP escolhendo, p.ex., verba `R$20k–50k`.
3. No Telegram, tocar **✅ Compareceu**.
4. Meta → Testar Eventos: `MeetingHeld` com `value: 1500`, `currency: BRL`,
   `em`/`fbp`/`fbc` presentes.
5. `/admin/agendamentos`: status `realizada`, e o evento não redispara ao
   reabrir o link (idempotência).
6. Remover o `meta_test_event_code`.
