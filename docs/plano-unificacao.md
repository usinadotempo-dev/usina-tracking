# Plano de unificação — plataforma Usina do Tempo

> Status: **proposta v2** (2026-11-01). Nada aqui foi implementado ainda.
> Alvo: **um único sistema** em `app.usinadotempo.com.br`, na infra do Usina Tracking
> (Cloudflare Pages/Workers + D1 + R2), com cobrança de módulos por cliente.

---

## 1. Sistemas de origem

| Sistema | Stack | O que tem de real | Destino |
|---|---|---|---|
| **Usina Tracking** (`krob-tracking-stack`) | Cloudflare Pages Functions + D1 | Tracking server-side (Meta CAPI/GA4/Google Ads), webhooks Hotmart/Eduzz/Kiwify, Kommo, sync Meta Marketing/IG/Página, dashboard, multi-tenant, agendamentos e prospecção da Usina | **Base do sistema unificado** |
| **usina-do-tempo** | Next.js + Supabase (Vercel) | Camada de gestão: papéis owner/manager/analyst, autoatendimento, planos/módulos, branding, bloqueio de conta. Módulos = telas vazias | Portar a gestão; desligar |
| **video-automation** | FastAPI + Supabase (Render/Hetzner), React | Pipeline de vídeo (Gemini → TTS → banco de mídia/Pexels → MoviePy → YouTube/Instagram, aprovação Telegram), Content AI (6 prompts), CRM simples (kanban), gestor de anúncios Meta/Google/TikTok + **motor de regras**, benchmark (prompts), cobrança Asaas com planos | Portar lógica aproveitável; desligar |
| **Skill `youtube-agent`** (Jakeschincariol, MIT) | 11 skills Claude + 6 scripts Python sem dependências | Método editorial para YouTube: plano, tendências, roteiro com ganchos, título+thumb, SEO, capítulos, decupagem, cortes, retenção, comentários, auditoria | Base dos **agentes do Estúdio de Vídeo** |
| **Skill `fazer-video`** (local) | Remotion + ffmpeg + whisper.cpp | Edição premium: transcrição por palavra, cortes, recorte de fundo, palco 3D, legenda palavra a palavra | Trilha "premium" do Estúdio |

## 2. Decisões tomadas (2026-11-01)

| # | Decisão |
|---|---|
| D1 | CRM com **3 opções por cliente**: Kommo (já integrado), **RD Station CRM**, ou **CRM nativo simples** para quem não usa nenhum |
| D2 | Introduzir **build leve** no front-end (Tailwind compilado + componentes), tirando `unsafe-eval` da CSP |
| D3 | Domínio do produto: **`app.usinadotempo.com.br`** |
| D4 | Clientes a migrar: **Usina do Tempo** e **Chaves Imobiliária** → migração manual, sem script |
| D5 | Pasta do projeto vai para `Claude Usina` |
| D6 | video-automation **não está no ar**; mesmo assim, desligar serviços residuais (Hetzner, Render, pg_cron) por garantia |
| D7 | **Cobrança dentro da plataforma via Asaas** (planos com módulos) — entra na Fase 1 |
| D8 | **Render:** motor de render atrás de uma fila, com dois executores — ffmpeg em **Cloudflare Containers** (trilhas A e B) e Remotion (trilha C) com prova de conceito no Container e **Remotion Lambda** como alternativa já escolhida se o Container não aguentar. Render local só para edições da própria Usina na transição |
| D9 | IA de texto: **Claude** |
| D10 | Narração **gratuita**: modelo open-source rodando no próprio container (Kokoro ou Piper, vozes pt-BR — escolher pela qualidade no teste) |
| D11 | **TikTok entra**: anúncios (Business API, lógica do video-automation) e publicação (Content Posting API) |
| D12 | `app.usinadotempo.com.br` está em uso hoje; o corte de DNS para o sistema unificado acontece na Fase 3 |
| D13 | Tudo sob as contas **usinadotempo** (GitHub `usinadotempo-dev`, Cloudflare `suporte@usinadotempo.com.br`) |

---

## 3. Fase 0 — Segurança (antes de qualquer feature)

### 0.A — video-automation (urgente SE estiver no ar)
| Gravidade | Problema |
|---|---|
| **Crítico** | `POST /admin/deploy` executa `/home/usina/deploy.sh` para o admin de **qualquer** workspace — e o cadastro (`POST /workspaces`, signup) é público: qualquer pessoa cria conta e roda o script no servidor |
| **Alto** | `POST /pipeline/trigger`, `/tasks/status`, `/tasks/revoke`, `/debug/my-context` sem autenticação |
| **Alto** | Webhooks Telegram e Asaas aceitam tudo se o segredo não estiver configurado; checkout marca assinatura ativa antes do pagamento |
| **Alto** | Tokens YouTube/Meta/Telegram em texto puro; Fernet com salt fixo e `decrypt` que aceita texto puro em silêncio; RLS decorativo (service role + policies que nunca casam) |
| Médio | Credencial de teste em texto puro em `DEPLOY_HETZNER.md` |

**Ação (D6):** não está no ar; por garantia, desligar serviços residuais — systemd no Hetzner (`usina-api`, `usina-celery`, `usina-beat` + remover `/etc/sudoers.d/usina-deploy`), serviço no Render, jobs `pipeline-hourly-trigger` e `storage-purge-weekly` do pg_cron. Na Fase 3, revogar as chaves de API do `.env`. Como ele será desligado, não vale corrigir o resto.

### 0.B — Usina Tracking

**Alto**
| # | Problema | Onde | Correção |
|---|---|---|---|
| S1 | Segredos de todos os clientes devolvidos ao navegador (`SELECT *` em `workspace_config`; `SYNC_SECRET` no cron-info) | `admin/workspaces/[id].js:51`, `admin/cron-info.js:92` | Redigir (`{set, last4}`), PATCH só sobrescreve valor novo |
| S2 | Segredos em texto puro no D1 | `workspace_config`, `platform_config` | AES-256-GCM (Web Crypto) com chave em env; recadastrar |
| S3 | Compra forjada noutro cliente: slug de webhook global + sem verificar assinatura | `webhook/*`, `_core.js`, `checkout-session.js` | Slug por workspace + workspace do slug = do `trk`; hottok/HMAC por plataforma |
| S4 | "Esqueci a senha" tranca a conta de qualquer pessoa (senha trocada na hora) | `auth/forgot-password.js:49` | Token de redefinição separado; senha atual vale até o uso; rate limit |
| S5 | Login sem limite de tentativas | `auth/login.js` | Rate Limiting Cloudflare em `/auth/*` + bloqueio por e-mail |

**Médio:** S6 Purchase duplicado em reenvio de webhook · S7 `landing_url` controla links do Telegram e tenant do MeetingHeld · S8 agendamento público sem Turnstile/rate limit · S9 `/tracker` cria lead no Kommo sem limite e aceita `value` livre · S10 `SYNC_SECRET` faz tudo e está no cron-job.org (separar segredos; migrar para Cron Triggers) · S11 webhook Kommo confia no payload · S12 troca obrigatória de senha só na UI · S13 senha provisória devolvida ao admin mesmo com e-mail enviado · S14 não existe desativar cliente.

**Baixo:** comparação de segredo com `!==`; `err.message` cru nas respostas; `kommo_subdomain` sem validação; HTML do cold e-mail sem escape; `INSERT OR REPLACE` no `checkout-session`; `ad_spend` sem `workspace_id` na chave; POST admin sem checar `Origin`; Tailwind CDN sem SRI. **A confirmar:** previews `*.usina-tracking.pages.dev` usando o D1 de produção.

### Status da Fase 0.B (2026-11-01) — código escrito, aguardando deploy
| Item | Implementação |
|---|---|
| S1 | `GET /admin/workspaces/:id` devolve segredos só como `{set, last4}` (`_lib/secrets.js` → `redactWorkspaceRow`); PATCH em branco mantém, `clear_secrets` remove; `cron-info` não devolve mais o `SYNC_SECRET`; tela ajustada |
| S2 | AES-256-GCM com `env.SECRETS_KEY` (`_lib/secrets.js`); decifra centralizada em `loadWorkspaceConfig`, `listWorkspacesWithMetaAds`, `platform-config`, `booking-events`, `kommo-meta`; `POST /admin/secrets/encrypt-existing` cifra o legado |
| S3 | Slug de webhook por workspace (`hotmart/kiwify/eduzz_webhook_slug`, gerados ao salvar a config) + verificação de hottok/HMAC quando o segredo está cadastrado; trk de outro workspace é ignorado; slug global do env só na transição |
| S4 | Provisória fica pendente (`pending_password_hash`); senha atual vale até o uso; 1 envio/10 min por conta, 10 pedidos/h por IP |
| S5 | `auth_rate_limits`: 5 falhas/15 min por e-mail+IP, 30/15 min por IP (bloqueio 15 min) |
| S6 | Checagem de `transaction_id` antes do disparo + `event_id` determinístico |
| Extra | `kommo_subdomain` validado; respostas 500 dos webhooks sem `err.message` |

S1–S6 **no ar** desde 2026-11-01 (commit a875a99, migration 0041; 13 credenciais cifradas).

### Rodada 2 — médios e baixos (código escrito, aguardando deploy)
| Item | Implementação |
|---|---|
| S7 | Links do Telegram com origem fixa (`BOOKING_PUBLIC_ORIGIN`, padrão `lp.usinadotempo.com.br`); MeetingHeld sempre em `usina-vendas` |
| S8 | `booking/create`: 5/h por IP, máx. 2 reuniões futuras por e-mail; Turnstile exigido quando `TURNSTILE_SECRET` existir (**falta o widget na LP**) |
| S9 | `/tracker`: valor do navegador só para evento do catálogo; Kommo 10 leads/h por IP com sessão, 3/h sem sessão |
| S10 | `SYNC_SECRET` só para crons (comparação constante via `_lib/cron-auth.js`); links de booking com `BOOKING_HMAC_KEY` + expiração (7 dias após a reunião); descadastro com `UNSUB_HMAC_KEY` |
| S11 | Kommo: etapa e valor lidos da API, não do payload |
| S12 | `requireAuth` bloqueia tudo exceto troca de senha enquanto a senha é provisória |
| S13 | Senha provisória só volta ao admin se o e-mail falhou |
| S14 | `tenants.is_active` (migration 0042) — bloqueia login e sessões; chave "Ativo" no formulário do tenant |
| Baixos | Escape do nome no cold e-mail; `checkout-session` não troca o workspace de um `trk`; anti-CSRF por `Origin` em `/admin` e `/auth`; erros 500 genéricos no tracker/checkout |

**Pendente (baixo, vai para a Fase 1):** `err.message` nas respostas 500 de `api/*` (só usuários autenticados veem); `ad_spend` sem `workspace_id` na chave (tabela legada); Tailwind compilado + CSP sem `unsafe-eval` (depende do build, D2).

**A confirmar com webhook real antes de preencher o segredo:** formato da assinatura Kiwify (HMAC-SHA1) e Eduzz (HMAC-SHA256 / api_key).

---

## 4. Fase 1 — Fundação da plataforma

1. **Domínio** `app.usinadotempo.com.br` (D3) — ver conflito em §8.
2. **Build do front-end** (D2): Vite + Tailwind compilado; admin e portal do cliente quebrados em telas/componentes; CSP sem `unsafe-eval`.
3. **Papéis e permissões:** `usina_admin`, `tenant_owner`, `tenant_manager`, `tenant_viewer`; helper único `requirePermission` no servidor.
4. **Cliente:** `is_active`, `plan`, `active_modules`, `brand_color`, `logo_key`; usuário com `avatar_key`.
5. **Arquivos:** **R2** (logos, avatares, mídia, vídeos), upload só via Function com validação.
6. **Portal do cliente** (owner/manager/viewer): usuários, integrações (segredos redigidos), identidade visual, perfil, módulos contratados.
7. **Planos e cobrança:** reaproveitar os planos e a integração **Asaas** do video-automation (decisão pendente P2), corrigindo: ativar só no pagamento confirmado, aplicar `modulos`, trial e limites de uso com contador atômico.
8. **Jobs:** Cron Triggers nativos + Queues + Workflows (substituem cron-job.org, pg_cron e Celery).

---

## 5. Fase 2 — Módulos

| Ordem | Módulo | Fonte | Trabalho |
|---|---|---|---|
| 1 | **Gestão de Tráfego** | Sync Meta do Tracking (completo) + **motor de regras** do video-automation (condições CPA/ROAS/CTR/gasto…, ações pausar/ativar/ajustar orçamento/notificar) | Portar regras para Worker; `notify` enviando de verdade (Telegram/e-mail); Google Ads quando o developer token liberar; TikTok Ads opcional (P6) |
| 2 | **Funis** | `api/funnel` do Tracking | Só expor como módulo |
| 3 | **CRM** (D1) | Kommo (Tracking) + CRM simples do video-automation (contatos, tags, etapas, negócios, atividades, kanban, import CSV/XLSX) | Camada de adaptadores: Kommo · **RD Station CRM** (novo) · Nativo. Lead do tracking vai para o CRM escolhido |
| 4 | **Produtos Digitais** | `purchase_log`/`purchase_items` | Visões de produtos, clientes/alunos, recorrência, reembolsos |
| 5 | **Estúdio de Vídeo** | §6 | Maior módulo — ver abaixo |
| 6 | **Conteúdo (textos)** | 6 prompts do Content AI (copy de anúncio, legenda, roteiro, artigo, resposta a comentário, e-mail) | Unificar com o Estúdio (mesmo perfil de voz e base de conhecimento) |
| 7 | **Relatórios** | Endpoints `/api/*` | Snapshot periódico + PDF + envio por e-mail |
| 8 | **Benchmark** | 2 prompts do video-automation (coleta era stub) + radar de tendências do Estúdio (`yt-viral`) + Meta Ad Library | Coleta real de concorrentes (YouTube público, IG Business Discovery) e resumo semanal |

---

## 6. Estúdio de Vídeo — do A ao Z, integrado ao Tracking

Objetivo: para cada cliente (workspace), planejar, roteirizar, produzir, aprovar, publicar no **YouTube** e no **Instagram**, medir e realimentar — e provar **quais vídeos geram leads e vendas**, que é o que o Tracking sabe e nenhuma ferramenta de vídeo sabe.

### 6.1 Análise dos 11 agentes do `youtube-agent`

| Agente | O que faz (na skill) | No Estúdio vira | Adaptação necessária |
|---|---|---|---|
| `yt-plan` | Semana pelas horas disponíveis: 1 vídeo âncora, 1 barato, 3 Shorts | **Planejador** semanal por workspace | Incluir Reels/carrossel do Instagram; usar desempenho real (views + leads/vendas) do Tracking como sinal |
| `yt-viral` | Acha o que funciona no nicho: views ÷ mediana do próprio canal (`swipe.py`) | **Radar de tendências** (alimenta Benchmark) | Coleta automática via YouTube Data API (público) e IG Business Discovery, no lugar do JSON manual |
| `yt-script` | 5 ganchos de 21 fórmulas, pontuados (`hookscore.py`), top 2; virada em 0:15–0:45; corpo por batidas com `[ON SCREEN]`; um único pedido; **nunca inventar número** | **Roteirista** | Fórmulas em PT-BR; perfil de voz **por cliente** (hoje é um `voice.md` global); números só da base de conhecimento do cliente; recalibrar a pontuação com dados de retenção reais |
| `yt-package` | Valida título + thumbnail como par (`title.py`) | **Embalagem** | + gerador de thumbnail (IA de imagem + texto); capa do Reel |
| `yt-seo` | Descrição, tags que valem, 3 buscas-alvo | **SEO e legenda** | **Link rastreado do Tracking na descrição**; versão Instagram (legenda + hashtags) |
| `yt-chapters` | Capítulos da transcrição, validados pelas regras do YouTube (`chapters.py`) | **Capítulos** | Transcrição automática (sem SRT manual) |
| `yt-edit` | Lista de cortes: silêncio, vícios, regravações (`deadair.py`) | **Decupagem** → alimenta o render | Unir com o método de decupagem da `fazer-video` (corte travado na palavra) |
| `yt-shorts` | Trechos de 20–55 s com pensamento completo, virada e fecho; nova 1ª linha, texto de tela, ponto de loop, nota de enquadramento vertical | **Cortador** → Shorts **e Reels** | Executar o reenquadramento vertical de fato e queimar legenda |
| `yt-retention` | Lê CSV de retenção: vazamento do gancho, quedas, deslize (`retention.py`) | **Leitor de retenção** | Dados puxados da YouTube Analytics API; Reels com insights do IG (mais limitados) |
| `yt-comment` | 4 pilhas, rascunhos de resposta na voz, qual fixar | **Comentários** | API de comentários YouTube + IG; resposta só após aprovação |
| `yt-audit` | Revisão do canal terminando em **uma** correção | **Auditoria mensal** | Usa dados sincronizados; inclui Instagram e atribuição |

**Limitações da base que o plano resolve:**
1. **Só escreve** — não grava, não edita, não publica ("Nothing here publishes").
2. **Só YouTube** — nada de Instagram.
3. **Um criador só** — `voice.md` global; precisamos de N clientes.
4. **Entradas manuais** (SRT, CSV, JSON) — no Estúdio vêm das APIs e da transcrição.
5. **Heurísticas em inglês**; o próprio autor diz que `hookscore` separa ganchos ruins dos bons, mas **mal distingue acertos de erros do próprio criador** — tratar como filtro, não como oráculo.
6. Licença MIT: podemos reaproveitar texto das skills e portar os 6 scripts (são pequenos e sem dependências) para JS, mantendo a atribuição.

### 6.2 Agentes novos para fechar o ciclo

| Agente | Função |
|---|---|
| **Briefing e base de conhecimento** | Produto, oferta, provas, números permitidos, página de venda — única fonte de fatos para todos os agentes |
| **Perfil de voz** | Construído a partir de 3 vídeos do cliente (método do `yt-script`), guardado no workspace |
| **Thumbnail e capa** | Gera opções de imagem e passa pela Embalagem |
| **Narração** | TTS gratuito open-source no container (D10) para vídeos sintéticos; ou gravação do próprio cliente |
| **Montador (render)** | Executa a decupagem, legenda palavra a palavra, cortes, formatos 16:9 e 9:16 |
| **Adaptador Instagram** | Reel, capa, legenda, hashtags, colaborador, carrossel derivado do roteiro |
| **Publicador** | YouTube + Instagram, agendamento, reprocessamento com fila |
| **Atribuição** | Views → cliques → leads → vendas por vídeo (via Tracking) |

### 6.3 Fluxo do vídeo (estados)

`ideia` → `pauta aprovada` → `roteiro aprovado` → `material recebido` → `decupado` → `renderizado` → **`revisão do cliente`** (portal ou Telegram) → `agendado` → `publicado` → `analisado` (D+2, D+7, D+28) → aprendizados voltam ao **Planejador**.

Cada passo com IA termina como no `youtube-agent`: proposta + "aprovar ou ajustar?". Nada é publicado sem aprovação humana.

### 6.4 Três trilhas de produção

| Trilha | Quando | Como |
|---|---|---|
| **A. Gravado pelo cliente** (principal) | Especialista/corretor gravando | Upload do bruto para R2 → transcrição por palavra → Decupagem → render → vídeo longo 16:9 + cortes 9:16 → Shorts e Reels |
| **B. Sintético rápido** | Volume, conteúdo de apoio | Roteiro → narração → banco de mídia do cliente + Pexels → montagem simples (lógica do video-automation, **corrigindo**: cron que não montava vídeo, validador quebrado, falha com narração < 60 s, imagens do banco não baixadas, legenda sem sincronia, 720p) |
| **C. Premium** | Lançamentos, anúncios | Estilo da `fazer-video` (palco 3D, Remotion). Começa semi-manual (render local) e só vai para a nuvem se a prova de conceito no Container aguentar |

### 6.5 Integração com o Tracking (diferencial)
- Todo vídeo ganha **link rastreado** (UTM por plataforma e por vídeo, ou link curto `/v/<código>` servido pelo próprio app, que registra a sessão).
- Painel por vídeo: views, retenção, cliques, **leads, vendas e receita**.
- O Planejador e a Auditoria passam a otimizar por **resultado de negócio**, não só por views.
- Os dados do Instagram já sincronizados pelo Tracking (`meta_ig_media`) são reaproveitados.

### 6.6 Infra
- **R2:** brutos, renders, thumbs; regra de expiração para brutos.
- **Workflows:** orquestração durável de cada vídeo; **Queues:** publicação e reprocessamento; **Cron Triggers:** análises periódicas.
- **Render (D8):** fila de jobs → executor ffmpeg em **Cloudflare Containers** (cortes, legenda, reenquadramento, narração); executor Remotion com prova de conceito no Container e **Remotion Lambda** como alternativa. A interface do executor é a mesma, então trocar de motor não mexe no resto.
- **Transcrição:** Whisper via Workers AI ou no Container.
- **IA de texto:** Claude (D9). **Imagem (thumb):** a definir.
- **TikTok (D11):** publicação via Content Posting API (exige auditoria do app; antes disso, posts ficam privados).
- **YouTube:** OAuth por canal do cliente. Atenção: projetos de API **não verificados têm uploads travados como privados** → iniciar cedo a verificação do app Google e a auditoria da YouTube API; cota padrão diária limita poucos uploads/dia por projeto → pedir aumento.
- **Instagram:** permissão `instagram_content_publish` via revisão do app Meta (o Tracking já tem app Meta); o vídeo precisa de URL pública temporária (R2 assinada).

### 6.7 Ordem de entrega do Estúdio
| Etapa | Entrega | Valor |
|---|---|---|
| E1 | Base de conhecimento + perfil de voz + Roteirista + Embalagem + SEO/legenda com link rastreado | Valor imediato, só texto |
| E2 | Publicador (OAuth YouTube + Instagram, agendamento) para vídeos prontos + Atribuição | Fecha publicar → medir |
| E3 | Trilha A: upload, transcrição, Decupagem, Cortador, render no Container | Produção de verdade |
| E4 | Retenção, Comentários, Auditoria, Radar de tendências, Planejador com dados reais | Ciclo de aprendizado |
| E5 | Trilha B (sintética) e Trilha C (premium) | Escala e acabamento |

---

## 7. Fase 3 — Migração e desligamento

1. **Clientes (D4):** recriar manualmente Usina do Tempo e Chaves Imobiliária (tenant + workspaces + usuários com senha provisória); logos para R2.
2. **video-automation:** exportar o que valer (negócios, banco de mídia, templates, contatos do CRM) se houver dado real.
3. Apontar `app.usinadotempo.com.br` para o Cloudflare (ver §8).
4. Desligar: projeto Vercel (usina-do-tempo), servidor Hetzner/Render (video-automation), projetos Supabase (manter export) — e revogar as chaves de API que ficarem órfãs.

## 8. Pendências restantes

As pendências P1–P8 da v2 viraram as decisões D6–D13 (§2). Restam pontos que só se resolvem na execução:

| # | Ponto | Quando |
|---|---|---|
| R1 | Licença do Remotion: gratuita para empresas de até 3 pessoas; acima disso exige licença de empresa | Antes da trilha C |
| R2 | Resultado da prova de conceito de render no Container (tempo e custo por minuto de vídeo, limite de memória) | Estúdio E3 |
| R3 | Qualidade das vozes pt-BR (Kokoro × Piper) | Estúdio E3/E5 |
| R4 | TikTok: publicação por app não auditado fica privada — iniciar auditoria do app cedo (igual ao YouTube) | Fase 1 |
| R5 | E-mail de autor dos commits no repositório `usinadotempo-dev` (o Cloudflare Pages pode exigir vínculo, como a Vercel exigiu) | Primeiro commit da Fase 0 |

## 9. Ordem de execução
1. P1 → se necessário, Fase 0.A imediatamente.
2. Fase 0.B (S1–S5, depois médios e baixos).
3. Fase 1 (fundação + build + domínio).
4. Fase 2: Tráfego → Funis → CRM → Produtos → **Estúdio E1→E5** → Conteúdo → Relatórios → Benchmark.
5. Fase 3 (migração manual dos 2 clientes) e desligamento dos sistemas antigos.
