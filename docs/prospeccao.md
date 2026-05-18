# Prospecção outbound — lista de ICP + cadência de cold e-mail

Módulo no admin (`/admin/prospeccao`) que ingere a lista de ICP, roda a
cadência de cold e-mail via Resend (LGPD-safe) e fecha o loop com o funil de
agendamento. Motor de aquisição #1 do playbook (Parte 3).

## 1. A lista (ICP #1 — agências/gestores de tráfego)

Não fabricamos contatos. Extraia real e importe no formato abaixo.

| Segmento (`segmento`) | Onde extrair | Filtro |
|---|---|---|
| `agencia` | Apollo / LinkedIn Sales Nav | cargo: sócio/CEO/head de mídia/gestor de tráfego · setor Marketing · 2–50 func · Brasil · tech Meta/Google Ads |
| `gestor_solo` | Instagram/LinkedIn (bio "gestor de tráfego") · Google Maps | anuncia ativo (Biblioteca de Anúncios) |
| `infoproduto` | LinkedIn/Instagram, comunidades | roda lançamento/perpétuo |

**Só e-mail corporativo** (domínio próprio). gmail/hotmail/outlook/yahoo/uol/
etc. são **rejeitados na importação** — cold a frio em e-mail pessoal não é
legítimo interesse B2B sob a LGPD.

**Formato de import (colar CSV no admin):**

```
nome,empresa,email,cargo,segmento,origem,gancho,anuncio_url
Maria Silva,Agência X,maria@agenciax.com.br,Sócia,agencia,apollo,vi seu anúncio de e-commerce rodando,https://...
```

`gancho` = 1ª linha personalizada do 1º e-mail (ex.: "vi seu anúncio de
e-commerce rodando"). Vazio → fallback neutro por segmento. **Preencher o
gancho é o que mais sobe a taxa de resposta.**

## 2. Setup (uma vez)

### 2.1 Subdomínio de envio no Resend (isola reputação do domínio do booking)
1. Resend → Domains → Add Domain: **`mail.usinadotempo.com.br`** (subdomínio).
2. Adicione no DNS (Cloudflare zone usinadotempo.com.br) os registros
   SPF/DKIM/DMARC que o Resend mostrar para esse subdomínio.
3. Aguarde verificar (Verified).

### 2.2 Variáveis (Cloudflare Pages → Settings → Environment variables)

| Variável | Valor | Obrigatória |
|---|---|---|
| `OUTREACH_FROM` | `Usina do Tempo <contato@mail.usinadotempo.com.br>` | **Sim** — sem ela o cron NÃO envia (cold nunca cai no domínio transacional) |
| `OUTREACH_DAILY_CAP` | `30` (suba ~+10/semana se sem bounce) | não (default 30) |
| `OUTREACH_REPLY_TO` | e-mail real onde você lê respostas | recomendado |
| `OUTREACH_BASE_URL` | `https://lp.usinadotempo.com.br` | não (default) |

Reaproveita `RESEND_API_KEY` e `SYNC_SECRET` já existentes.

### 2.3 Cron (cronjob.org — mesmo provider dos outros syncs)
Novo job **horário**: `POST https://lp.usinadotempo.com.br/api/outreach/run`
com header `x-sync-secret: <SYNC_SECRET>`. O endpoint respeita sozinho a
janela comercial (seg–sex 9–17h BRT) e o teto diário — pode rodar de hora em
hora o dia todo sem risco.

## 3. Como operar (fluxo solo)

1. **Importar** lista no `/admin/prospeccao` (botão "Importar lista").
2. Abrir cada prospect novo → **"▶ Iniciar cadência"** (ou em lote, um a um).
   Status vira `em_cadencia`; o cron manda o e-mail 1 na próxima janela.
3. Cadência de e-mail automática (5 toques): dias **0, 4, 7, 13, 18**.
4. **Toques manuais de LinkedIn** (playbook toques 2 e 5, ~dia 2 e ~dia 9):
   o sistema lembra no card; você executa à mão (WhatsApp/LinkedIn frio em
   massa é proibido por LGPD).
5. **Respondeu** → marque "respondeu" (cadência para; vira trabalho do
   closer). **Agendou na LP** → casa por e-mail automaticamente: status
   `agendou` + linka ao agendamento → daí o funil (qualificação, Telegram,
   MeetingHeld) assume.
6. **Opt-out**: link no rodapé de todo e-mail (`/api/outreach/unsubscribe`),
   ou responda "sair", ou botão no admin. Suprime para sempre.

## 4. Guarda-corpos (não mexer)

- Só e-mail corporativo (validação na importação).
- Identificação (Usina do Tempo + CNPJ) + link de descadastro em **todo**
  e-mail (LGPD art. 7º IX — legítimo interesse B2B).
- Para automaticamente em: `respondeu`, `opt_out`, `bounce`, `agendou`.
- Teto diário + janela comercial + ramp-up de volume (reputação).
- 1 link por e-mail (a LP), texto enxuto (deliverability).
- Cadência de e-mail = 5 toques; depois para sozinha (operador decide
  `perdido`).

## 5. Loop fechado

`prospects` → (agenda na LP, casa por e-mail) → `demo_bookings` →
qualificação ICP → Telegram → ✅ Compareceu → `MeetingHeld` (Meta/GA4).
Tudo medível: do cold e-mail ao custo por reunião comparecida.

Schema: migration `0037_prospects.sql` (tabelas `prospects`, `outreach_log`).
