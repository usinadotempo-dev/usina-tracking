# Playbook Comercial — Usina Tracking + Serviços

> Documento de processo. Pressupõe conhecimento **mediano** do produto.
> Tudo é "faça X, depois Y". Decisões de negócio marcadas como **[DECIDIR]**.
> Operação atual: **solo** (você é prospecção + venda + entrega). O processo
> está desenhado para uma pessoa só, com o que automatizar antes de contratar.
> Última atualização: 2026-05-18.

---

## PARTE 0 — Arquitetura da oferta (leia antes de tudo)

Você não vende um produto só. Vende um **ecossistema de performance**, mas
**entra sempre pela ponta de lança**. Esta é a decisão estratégica central:

### Ponta de lança + Expansão (land-and-expand)

| Camada | O que é | Papel | Por quê |
|---|---|---|---|
| **Ponta de lança** | **Usina Tracking** (SaaS server-side) | Traz o cliente e a recorrência | ROI claro, diferenciado (ninguém entrega igual), baixa fricção, **vendável e entregável por 1 pessoa** |
| **Expansão** | CRM (Kommo), landing pages, gestão de tráfego, estratégia/consultoria | Aumenta ticket nos clientes que já confiam | O tracking **gera o dado que justifica e direciona** o serviço; cliente que já paga compra expansão com CAC ≈ 0 |

**Por que entrar pelo tracking e não vender o pacote completo de cara:**

1. **É o único diferenciado.** Tráfego, LP e CRM são commodity — qualquer
   agência oferece. Server-side com dashboard de atribuição próprio não. Lidere
   pelo que te separa do mercado.
2. **Escala solo.** Tracking é software: vende-se uma vez, entrega-se quase
   sem mão de obra recorrente. Tráfego/estratégia consomem seu tempo e **não
   escalam** numa operação de uma pessoa. Se você liderar por serviço, vira
   refém da entrega e para de vender.
3. **O tracking abre a venda do serviço sozinho.** O dashboard mostra onde o
   cliente perde dinheiro. Isso **é** o pitch do serviço: "seu dado mostra que
   o problema está na LP / no tráfego — quer que a gente resolva isso também?"
   Você vende serviço com prova, não com promessa.
4. **Risco a evitar:** virar "agência que faz tudo" genérica. Isso dilui o
   diferencial e te coloca a competir por preço. O tracking é a âncora.

### Pacotes (estrutura: **setup + mensalidade** em todos) — [DECIDIR valores]

| Pacote | Conteúdo | Cobrança |
|---|---|---|
| **Starter** | Usina Tracking (instância + dashboard) | Setup (implantação) + mensalidade SaaS |
| **Growth** | Tracking + CRM (Kommo) + landing page | Setup maior + mensalidade SaaS + retainer mensal |
| **Performance/Partner** | Tracking + tráfego + estratégia | Setup + mensalidade SaaS + fee de gestão (fixo + % de verba ou variável por resultado) |

> Solo: venda **Starter** como padrão (recorrência que escala). **Growth/Partner**
> é upsell seletivo, ofertado só depois que o tracking provou valor — e a
> entrega dos serviços você terceiriza sob sua estratégia (freelancer de
> tráfego/LP que você orquestra) ou limita o nº de contas. Nunca prometa
> serviço que você não tem braço para entregar bem.

### O que você vende (linguagem de vendedor)

Você não vende "rastreamento server-side". Vende **duas dores em dinheiro**:

1. **"Você paga tráfego por dados que nem chegam até você."** Pós-iOS 14.5,
   campanhas só com pixel perdem ~**40%** dos dados de conversão. Server-side
   (CAPI) recupera de **+24% até 95%** (casos reais). Menos dado → algoritmo
   do Meta otimiza pior → **CPA mais caro e ROAS pior com a mesma verba**.
2. **"Você não consegue provar de onde veio cada venda."** A Usina guarda a
   origem (UTM, fbp/fbc, gclid, sessão) de **cada lead e cada venda** num
   dashboard de receita/atribuição/saúde. Para quem investe, é a prova de ROAS.

**Como ganhamos do Stape (o concorrente que o lead conhece):**

| Critério | Stape / GTM Server-Side | Usina Tracking |
|---|---|---|
| Preço | A partir de ~US$150/mês, **escala por volume** | Setup + mensalidade **fixa**, sem custo por evento |
| Setup | Exige montar GTM Server (consultor: R$1–3k) | Sem GTM; instância entregue configurada |
| Dados | Hospedagem compartilhada | Instância dedicada, dados na infra do cliente |
| Visão | Só envia evento | Dashboard de receita + atribuição + saúde pronto |
| Expansão | Não tem | CRM/LP/tráfego/estratégia no mesmo parceiro |

> Concorrente BR: **fogo.cx** (R$29–99/mês, foco e-commerce, "identifica
> pessoas"). Posicionam volume de clique barato. Nosso diferencial: instância
> dedicada + dashboard de receita/atribuição + sem GTM + ecossistema de serviço.

**Regra de ouro:** fale de **dinheiro perdido e ROAS**, nunca de feature.
Feature só na tela, amarrada à dor que o lead acabou de verbalizar.

---

## PARTE 1 — PLANEJAMENTO DE VENDAS (GTM)

### 1.1 ICP — para quem vendemos (ordem de prioridade)

Melhor custo/benefício = vender para **quem multiplica**.

| Prioridade | Perfil | Por que é o alvo | Sinal de qualificação |
|---|---|---|---|
| **1 (foco)** | **Agências / gestores de tráfego** com verba somada relevante | Têm a dor, entendem rápido, **1 agência = N clientes**, e são compradores naturais dos serviços de expansão | Gerencia ≥ R$20–50k/mês de mídia somada |
| **2** | **Infoprodutores / lançadores / experts** | Alto volume pago, dor aguda de atribuição em lançamento | Roda lançamento/perpétuo com tráfego próprio |
| **3** | **E-commerce / DTC com volume** | Sentem a perda iOS e **pagam Stape caro por volume** | Volume de pedidos em faixa alta de Stape |
| **4 (secundário)** | High-ticket com agendamento (clínica, advocacia, imobiliária) | Ticket alto, ciclo mais educacional | Investe em Meta/Google para captação |

**80% do esforço inicial na Prioridade 1.**

### 1.2 Preço e ROI (use em toda conversa)

Estrutura definida: **setup + mensalidade** (ver pacotes na Parte 0).
Ancore **sempre no custo de NÃO ter**, nunca no preço isolado:

> "Você gasta R$30k/mês em Meta. Recuperar ~20% de eficiência são ~R$6k/mês
> de volta. O setup se paga no primeiro mês e a mensalidade é fração do que
> você recupera. A pergunta não é se cabe — é quanto você deixa na mesa por
> mês sem isso."

O **setup** tem função dupla: captura o valor da implantação **e filtra
curioso** (quem paga setup tem intenção real — protege sua agenda solo).

### 1.3 Canais de aquisição — ranqueados por custo/benefício

Baseado em benchmarks B2B 2025–2026 e na realidade de operação solo:

**#1 — Outbound direcionado (melhor custo/benefício para começar)**
Lead Ad converte ~**2%** para reunião vs **17%** de landing page; ICP estreito
+ abordagem 1:1 bate mídia paga em CAC. Custo baixo, controle total do ICP.
Scripts prontos na **Parte 3**.

**#2 — Meta Ads → AGENDAMENTO (canal pago primário)**
**Não usar Lead Ad** (SQL/opp Meta só 5–10%). Tráfego para **VSL/LP →
agendamento** (a `lp.usinadotempo.com.br` já tem booking). Otimizar por
**reunião comparecida**, não por lead. Roteiro na **Parte 4**, criativos na
**Parte 5**.

**#3 — Parcerias / canal (maior alavancagem média)**
Agências e comunidades como indicadoras comissionadas. 1 parceiro = vários
clientes. Melhor LTV/CAC.

**#4 — Conteúdo (compounding)** → **#5 — Google Ads (médio prazo:** "alternativa
stape", "api de conversões", "rastreamento server-side").**

### 1.4 Lista de ICP e conformidade LGPD

**Ferramentas:** Apollo.io / LinkedIn Sales Navigator (cargo, setor, porte),
Google Maps / Instagram (agências e gestores se anunciam). Listas pequenas e
cirúrgicas > exports gigantes.

**LGPD (siga, não improvise):**
- **Cold e-mail B2B é legal** sob legítimo interesse (Art. 7º, IX) se: e-mail
  **corporativo**, conteúdo **relevante**, **opt-out** visível, remetente
  **identificado**. ✅
- **WhatsApp**: base legal restrita — só follow-up **após** o contato
  responder/agendar ou em inbound. ❌ Disparo frio em massa.
- **Nunca**: lista comprada duvidosa, ignorar descadastro, dado sensível, spam.

### 1.5 Processo para operação SOLO (você faz tudo)

Você acumula prospecção + venda + entrega. A regra é **automatizar a entrada
para proteger seu tempo de venda e entrega**:

| Etapa | Como rodar solo | Automatizar |
|---|---|---|
| Geração | Outbound (cadência Parte 3) + Meta→booking | Sequência de e-mail automatizada; campanha sempre no ar |
| Qualificação | **Formulário no agendamento** com 3–4 perguntas que auto-desqualificam antes de ocupar sua agenda | Form do booking + regra: sem verba/decisor → não confirma slot |
| Reunião 20min | Só você, só com quem passou o filtro | Lembrete 24h/1h (já há alerta Telegram) |
| Proposta | Modelo pronto por pacote, enviado em < 24h | Templates por pacote no CRM |
| Fechamento/onboarding | Você fecha; onboarding agendado na mesma call | Checklist de onboarding padronizado |
| Pós / expansão | Check-in em 7 e 30 dias; usar dashboard para abrir upsell de serviço | Lembretes automáticos no Kommo |

**Antes de contratar alguém, contrate nesta ordem:** (1) automação de cadência
e CRM; (2) entrega de serviço terceirizada (freelancer de tráfego/LP sob sua
estratégia); (3) só então um SDR para tirar prospecção do seu colo. **Sua
primeira contratação tira a entrega ou a prospecção de você — nunca a venda.**

### 1.6 Pipeline (etapas, critério, SLA)

1. Prospecção → 2. Qualificação (form auto-filtra) → 3. **Reunião 20min** →
4. Proposta (< 24h) → 5. Fechamento + onboarding (mesma call) → 6. Pós →
**6b. Expansão** (upsell de CRM/LP/tráfego com base no dado do dashboard).

**Definições:** Lead = no ICP · MQL = engajou · SQL = tráfego pago + volume +
decisor · Oportunidade = passou nas 3 perguntas (Parte 2).
**Follow-up:** mínimo **7 toques**. Velocidade de resposta é o maior fator de
conversão — responda inbound em **< 1h**.

### 1.7 KPIs (semanal)

CPL · **custo por reunião comparecida** (métrica-rainha) · show rate ·
reunião→proposta · proposta→fechamento · CAC por canal · ciclo · LTV ·
**taxa de expansão** (clientes Starter que viram Growth/Partner) · ROAS de aquisição.

> **Como o comparecimento é medido:** o agendamento dispara `Schedule`
> (volume). Após a call você toca **✅ Compareceu / 🚫 No-show** no botão do
> aviso de Telegram (lembrete de 1h) → status `realizada`/`no_show` no
> mini-CRM. O evento server-side de qualidade (`MeetingHeld` → Meta CAPI /
> GA4 / Google Ads, usando a atribuição já gravada no agendamento) é o
> **passo 3**, a revisar antes de ativar — é ele que vai deixar otimizar a
> campanha por reunião comparecida, não por lead.

### 1.8 Fases de execução

| Fase | Janela | Foco | Avança quando |
|---|---|---|---|
| 0 Fundação | Sem 1–2 | ICP, lista 200–500, pacotes/preço, VSL, one-pager, deck 20min, caso Grupo Vidal, Kommo, scripts, form de qualificação | Materiais + CRM prontos |
| 1 Validação | Mês 1–2 | Outbound + Meta→agendamento em paralelo | CAC/reunião e taxa de fechamento medidos |
| 2 Escala | Mês 3–4 | Escalar canal vencedor; iniciar parcerias; primeiro upsell de serviço | CAC < LTV/3 |
| 3 Expansão | Mês 5+ | Google Ads + parcerias + esteira de expansão de serviços | Pipeline previsível |

---

## PARTE 2 — PLAYBOOK DA REUNIÃO (20 MIN)

Estrutura *Tell–Show–Tell* + descoberta + as 3 perguntas como **escada de
compromisso ANTES do preço** (alinhado a NEPQ/commitment questions e ao método
Cole Gordon: concordância → recap → transição → compromisso).

### 2.0 Pré-call (5 min antes)
- [ ] Pesquisou: site, anúncios ativos (Biblioteca de Anúncios Meta), nicho, porte.
- [ ] Hipótese de dor anotada.
- [ ] CRM, deck e dashboard de demo abertos.
- [ ] Sabe quem está na call e se é o decisor.

### 2.1 Roteiro minuto a minuto

**0–2 min · Abertura / enquadramento (permissão)**
> "Obrigado pelo tempo. Pra ser produtivo nesses 20min: entendo rápido como
> vocês rodam tráfego hoje, te mostro na prática onde o dinheiro está vazando,
> e no fim a gente decide **juntos** se faz sentido seguir — pode ser?"

**2–7 min · Descoberta (situação → problema, quantificar em R$)**
- "Quanto investem em Meta/mês, somando clientes?"
- "Como rastreiam conversão hoje — pixel, GTM, Stape, server-side?"
- "Desde o iOS sentem diferença no dado / no CPA?"
- "Como você prova hoje, pro cliente, de onde veio cada venda?"
- "Quanto você acha que isso custa por mês em verba mal otimizada?"

O **lead** verbaliza a dor e o número. Você pergunta — não afirma.

**7–13 min · Demonstração focada (Show — pirâmide invertida)**
2–3 telas, a maior dor primeiro, cada uma amarrada ao que ele falou. Sem tour.
Feche: "Faz sentido pro seu cenário?"

**13–16 min · As 3 perguntas (escada — ANTES do preço)**
1. **Prioridade:** "De 0 a 10, quão prioritário é resolver essa perda de dados
   / esse ROAS nos próximos 30 dias?" → **<7**: "O que faria virar 9?" Sem
   urgência real, **não avance**, agende futuro. **≥7** segue.
2. **Crença:** "Pelo que viu, você acredita que a Usina resolve isso pra
   você?" → **Não/dúvida**: isole a objeção e trate AQUI (é valor, não preço).
   **Sim** segue.
3. **Viabilidade:** "Se isso devolve ~R$X/mês em verba bem otimizada, um
   investimento de [setup + faixa]/mês é viável agora — e essa decisão é sua
   ou tem mais alguém?" → qualifica **orçamento + decisor**.

> Só passa para preço/proposta quem deu **3 sins**.

**16–19 min · Preço, recap, objeções**
Recap dos benefícios (1 frase cada) → diga o preço **com confiança e fique em
silêncio** → objeção: **isole → reenquadre no custo de não fazer → re-confirme**.

**19–20 min · Próximo passo concreto**
Saia **sempre com data**: onboarding agendado / contrato / call com decisor.
Nunca "vou pensar".

### 2.2 Desqualificação (siga sem dó)
Não avance se: sem tráfego pago relevante · prioridade <7 sem urgência · não é
e não traz o decisor · sem orçamento mínimo. Desqualificar rápido = proteger
sua agenda solo.

### 2.3 Gancho de expansão (no pós, não na primeira call)
Quando o dashboard mostrar o gargalo: *"Seu dado mostra que o tráfego converte
mas a LP perde — quer que a gente assuma isso também?"* Venda de serviço com
prova, no cliente que já confia.

### 2.4 Banco de objeções

| Objeção | Resposta (resumo) |
|---|---|
| "Tá caro / sem orçamento" | Reancore no custo de não fazer; setup se paga no 1º mês. Isole se é preço ou prioridade. |
| "Meu gestor já faz" | "Ele usa CAPI server-side ou só pixel? Como te mostra a atribuição por venda? Te mando um diagnóstico de 5 min." |
| "Já uso Stape" | "Ótimo, você já entende o valor. Stape cobra por volume e exige GTM; a gente é fixo, sem GTM, com dashboard pronto e instância sua. Te mostro a diferença no seu volume." |
| "Não sei se funciona pro meu caso" | Volte à pergunta de crença, isole a dúvida, mostre a tela que resolve. Sem preço ainda. |
| "Preciso falar com sócio" | "Marca 15min com ele esta semana? Apresento a parte que importa pra ele." Sem proposta sem decisor. |
| "Agora não" | Qualifique prioridade real. Baixa → follow-up datado + nutrição. Alta → ache o bloqueio real (crença ou decisor). |
| "Vocês fazem só tracking?" | "Tracking é a base. Com o dado na mão, a gente também resolve CRM, LP, tráfego e estratégia — mas só o que o **seu** dado mostrar que precisa." |

### 2.5 Pós-call (mesmo dia, obrigatório)
CRM atualizado (estágio, notas das 3 perguntas, nº de dor) · próximo passo com
**data** · proposta < 24h · follow-up agendado se não fechou.

---

## PARTE 3 — SCRIPTS DE OUTBOUND (cadência multicanal, 7+ toques)

Cadência de ~18 dias. Canal: e-mail corporativo (LGPD ok) → LinkedIn → WhatsApp
**só após resposta**. CTA sempre de **baixa fricção** (diagnóstico, não compra).
Todo e-mail tem assinatura identificada + linha de descadastro.

**Princípio:** você não oferece "uma reunião de vendas". Oferece um
**diagnóstico gratuito de perda de conversão** — vira valor antes de pedir tempo.

**Toque 1 — E-mail (dia 1)**
> Assunto: {{empresa}} está pagando Meta por ~40% de dado que não chega
>
> {{nome}}, tudo bem? Vi que vocês rodam tráfego para {{nicho/produto}}.
> Desde o iOS, campanhas só com pixel perdem em média ~40% dos dados de
> conversão — o algoritmo otimiza no escuro e o CPA sobe sem você ver.
>
> Montei um diagnóstico de 5 min que mostra **quanto** vocês provavelmente
> estão perdendo e onde. Sem custo, sem compromisso.
>
> Faz sentido eu te mandar? Respondo o teu "pode" e te envio.
>
> [assinatura + "Se não fizer sentido, responde 'sair' que não te escrevo mais."]

**Toque 2 — LinkedIn (dia 2):** conexão + nota curta:
> "{{nome}}, te mandei um e-mail sobre perda de dado de conversão pós-iOS em
> tráfego de {{nicho}}. Posso te mandar o diagnóstico de 5 min por aqui?"

**Toque 3 — E-mail (dia 4) — prova:**
> "{{nome}}, um caso rápido: cliente perdia 40% das conversões só no pixel;
> com server-side recuperou tracking de ~95% e o CPA caiu. Quer ver como
> ficaria no seu caso? Respondo aqui mesmo."

**Toque 4 — E-mail (dia 7) — ângulo agência/prova de ROAS:**
> "Pensando como agência: quando o cliente pergunta de onde veio a venda, o
> que você mostra hoje? A gente entrega um dashboard de atribuição por
> lead/venda. Te mostro em 15min — ou te mando o diagnóstico antes, você
> escolhe."

**Toque 5 — LinkedIn (dia 9):** comentar/reagir a um post dele + DM leve:
> "Curti o que você falou sobre {{tema}}. Aquele diagnóstico de perda de
> conversão ainda de pé se quiser."

**Toque 6 — E-mail (dia 13) — quebra de padrão:**
> "{{nome}}, vou parar de te escrever pra não virar chato. Última: se em algum
> momento o CPA subir sem explicação, provável que seja dado faltando — guarda
> meu contato. Se quiser o diagnóstico agora, é só responder 'quero'."

**Toque 7 — E-mail (dia 18) — break-up:**
> "Encerrando por aqui. Se um dia quiser saber quanto de verba o tracking
> quebrado está custando, a porta fica aberta. Sucesso com as campanhas."

> **WhatsApp** entra **só** depois que a pessoa responde por e-mail/LinkedIn e
> topa continuar por lá. Aí: confirmar diagnóstico/agendar 20min.

**Regras:** 1 CTA por mensagem · curto · personalize a 1ª linha (nicho/anúncio
real visto na Biblioteca de Anúncios) · pare na hora se pedir para sair.

---

## PARTE 4 — ROTEIRO DO VSL (3–5 MIN) + LANDING DE AGENDAMENTO

### 4.1 VSL — estrutura (sem jargão técnico)

| Bloco | Tempo | Conteúdo |
|---|---|---|
| **Gancho** | 0–15s | "Se você roda Meta Ads, provavelmente está pagando por ~40% de conversões que nem aparecem pra você. Te mostro em 3 min como recuperar." |
| **Problema** | 15–60s | iOS/bloqueio: pixel perde dado → algoritmo otimiza no escuro → CPA sobe, ROAS cai. "Não é a campanha ruim — é o dado faltando." |
| **Agitação** | 60–105s | Custo composto: verba desperdiçada todo mês + você não consegue provar de onde veio a venda (dor da agência com o cliente). |
| **Mecanismo** | 105–165s | Server-side/CAPI **explicado simples**: "manda a conversão direto do servidor pro Meta, sem depender do navegador. O Meta volta a enxergar." Sem GTM, instância sua. |
| **Prova** | 165–225s | Dashboard real na tela: recuperação, atribuição por venda, saúde. Caso (Grupo Vidal / +95%). |
| **Oferta** | 225–270s | "Diagnóstico gratuito de 20min: te mostro quanto você perde hoje e como recupera. Sem compromisso." |
| **CTA** | 270–300s | "Agenda no botão abaixo. Vagas limitadas porque eu mesmo faço cada diagnóstico." (escassez real do solo) |

Tom: direto, de gestor para gestor, prova > promessa. Nada de termo técnico
sem traduzir na hora.

### 4.2 Landing de agendamento (alinhar com `lp.usinadotempo.com.br`)

Ordem dos blocos:
1. **Above the fold:** headline = a dor em dinheiro ("Você está perdendo ~40%
   das conversões do seu Meta Ads — e pagando por isso") + sub (mecanismo em 1
   linha) + VSL + botão **Agendar diagnóstico**.
2. **Para quem é:** agência/gestor/infoprodutor com tráfego pago (auto-seleção).
3. **Prova:** dashboard (print/loom), caso, números.
4. **Como funciona:** 3 passos (Diagnóstico → Implantação → Dashboard).
5. **Objeções em FAQ:** "já uso Stape", "meu gestor já faz", "é difícil
   migrar?", "preciso de GTM?" (respostas da Parte 2.4).
6. **Booking embed** + **formulário de qualificação** — 3 selects de 1 toque,
   já implementados na LP: *quanto investe em anúncio/mês*, *como rastreia
   hoje*, *quem decide a contratação*. Soft-gate: nunca bloqueia o
   agendamento; classifica o lead (🟢 forte ≥R$20k · 🟡 médio R$5–20k ·
   🔴 fora <R$5k) e enriquece o alerta de Telegram + o evento do Google
   Calendar, então você entra na call de 20min já com verba/stack/decisor na
   mão (resolve o item "pré-call" da Parte 2.0).
7. CTA repetido. Sem menu, sem distração — página de 1 objetivo.

> As 3 perguntas conversacionais da reunião (prioridade / crença /
> viabilidade — Parte 2.1) **não** vão no form: são ganhas na call. O form
> captura só qualificação objetiva (BANT-light) que decide se a call vale o
> slot e prepara o ângulo.

---

## PARTE 5 — BRIEFING DE CRIATIVOS META (campanha de agendamento)

**Objetivo de campanha:** conversão otimizada para **agendamento concluído**
(evento server-side via a própria stack — dogfooding), **não** Lead Ad.

**Públicos (em ordem de eficiência):**
1. **Retargeting:** quem viu 50%+ da VSL / visitou a LP / engajou — converte
   melhor, comece por aqui.
2. **Lookalike** de leads e clientes (quando houver base ≥ ~100).
3. **Aberto/interesses fracos B2B** (marketing digital, Meta Business, Shopify,
   gestão de tráfego) — o **criativo auto-seleciona** o ICP, não a segmentação.

**Ângulos de criativo (testar 3–4):**
- **Dinheiro perdido:** "~40% das suas conversões somem no iOS. Quanto isso
  custa por mês na sua verba?"
- **Prova de ROAS (agência):** "Quando seu cliente pergunta de onde veio a
  venda, o que você mostra?"
- **Comparativo/custo (Stape):** "Server-side sem pagar por volume e sem montar
  GTM."
- **Autoridade/diagnóstico:** "Diagnóstico gratuito: descubra quanto seu
  tracking quebrado está custando."

**Formatos:** vídeo curto 15–30s (corte do gancho da VSL) · estático com **um
número grande** (40%) · carrossel comparativo (pixel vs server-side / Stape vs
Usina). Sempre legendado.

**Copy do anúncio (modelo):**
> Roda Meta Ads e o CPA sobe sem explicação? Provavelmente é dado faltando —
> não a campanha. Desde o iOS, só o pixel perde ~40% das conversões. Faço um
> diagnóstico gratuito mostrando quanto você perde e como recuperar com
> server-side (sem GTM). Agenda no link. 👇

**O que NÃO fazer nos criativos:** jargão técnico no topo de funil (CAPI, ITP,
sGTM) · otimizar a campanha por lead/clique · prometer serviço de
tráfego/estratégia no anúncio de topo (dilui o foco — isso é upsell pós-venda).

**Métrica que decide o criativo:** **custo por agendamento comparecido** (não
CPC, não CPL). Mate criativo por essa métrica em 5–7 dias.

---

## Apêndice — Ficha de Guerra (1 página)

**Vendo:** recuperar ~40% de conversão perdida → Meta otimiza melhor → mais
resultado/mesma verba + prova de ROAS. Tracking é a **porta**; CRM/LP/tráfego/
estratégia é **expansão** (só com prova do dashboard).
**ICP foco:** agência/gestor de tráfego com ≥ R$20–50k/mês de mídia.
**Não vendo feature. Vendo dinheiro perdido.**
**Preço:** setup + mensalidade. Setup filtra curioso. Ancore no custo de não fazer.
**3 perguntas (antes do preço):** Prioridade (0–10, ≥7) · Acredita que resolve? ·
Investimento viável + é o decisor? → **3 sins = proposta**.
**Preço → silêncio.** **Saída da call: sempre com data.**
**Desqualifique:** sem tráfego pago / prioridade <7 / sem decisor / sem orçamento.
**Solo:** automatize entrada, proteja agenda com o form de qualificação, nunca
terceirize a venda.

---

## Fontes consultadas
- The Digital Bloom — B2B PPC 2025 Report: https://thedigitalbloom.com/learn/b2b-ppc-2025-roi-lead-quality-report/
- Flyweel — CPL/CAC Benchmark 2025: https://www.flyweel.co/blog/lead-gen-cpl-cac-benchmark-index-2025
- Involve Digital — Meta Ads B2B Lead Gen 2026: https://www.involvedigital.com/insights/meta-ads-b2b-lead-generation-strategy
- Sopro — B2B CPL by channel: https://sopro.io/resources/blog/b2b-cost-per-lead-benchmarks/
- Gong — BANT Framework: https://www.gong.io/blog/bant-sales
- Prospeo — Sales Qualifying Questions 2026: https://prospeo.io/s/sales-qualifying-questions
- Closers.io (Cole Gordon) — 4 Steps to Close: https://closers.io/4-simple-steps-to-close-any-deal/
- The Sales Evangelist — Cole Gordon 8-step process: https://thesalesevangelist.com/episode1575/
- eesier — Cold Email e LGPD (Brasil): https://eesier.com.br/cold-email-lgpd
- LeadCNPJ — LGPD na prospecção B2B: https://leadcnpj.com.br/blog/lgpd-na-prospeccao-b2b/
- SocialHub — LGPD e WhatsApp Business 2026: https://www.socialhub.pro/blog/lgpd-whatsapp-business-guia-conformidade-2026/
- Apollo.io — Verified B2B emails: https://www.apollo.io/insights/how-do-i-find-verified-b2b-email-addresses-for-cold-outreach
- Stape — pricing/CAPI: https://stape.io/ · https://stape.io/blog/conversions-api-explained
- Tracklution — Stape alternatives: https://www.tracklution.com/learn/stape-alternatives/
- fogo.cx (concorrente BR): https://fogo.cx/
- Pitaia Digital — API de Conversões e GTM (BR): https://pitaiadigital.com.br/api-de-conversoes-e-gtm-tudo-o-que-voce-precisa-saber/
- pclub.io — Sales Demo best practices: https://www.pclub.io/blog/sales-demo-training
- Walnut.io — SaaS discovery calls: https://www.walnut.io/blog/sales-tips/the-full-guide-to-optimize-your-saas-sales-discovery-calls/
