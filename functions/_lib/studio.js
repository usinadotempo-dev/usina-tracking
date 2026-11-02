// Estúdio de Vídeo — E1 (Fase 2): base de conhecimento, perfil de voz,
// Roteirista, Embalagem (título + capa) e SEO/legenda com link rastreado.
//
// Método inspirado nos agentes yt-script / yt-package / yt-seo do projeto
// youtube-agent (licença MIT), reescrito em PT-BR, por cliente e com a regra
// central: nenhum número, resultado ou depoimento fora da base do cliente.

export const KNOWLEDGE_FIELDS = {
  product: 'Produto ou serviço',
  offer: 'Oferta e chamada principal',
  audience: 'Público',
  pains: 'Dores e desejos do público',
  proofs: 'Provas (cases, depoimentos, garantias)',
  numbers: 'Números e fatos que podem ser citados',
  forbidden: 'O que nunca dizer',
};

// Teto de gerações com IA por workspace em 24 h (controle de custo).
export function dailyLimit(env) {
  const n = parseInt(env.STUDIO_DAILY_LIMIT || '30', 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export async function usedToday(db, wsId) {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM studio_generations WHERE workspace_id = ? AND created_at > ?')
    .bind(wsId, Math.floor(Date.now() / 1000) - 86400).first();
  return r?.n || 0;
}

export function logGeneration(db, { wsId, videoId = null, kind, result, userId }) {
  return db.prepare(`INSERT INTO studio_generations (id, workspace_id, video_id, kind, model, input_tokens, output_tokens, created_by, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), wsId, videoId, kind, result.model, result.usage?.input_tokens || 0,
      result.usage?.output_tokens || 0, userId, Math.floor(Date.now() / 1000));
}

export function parseKnowledge(raw) {
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

const HOOK_FORMULAS = [
  'Contraintuitivo (o oposto do que o público acredita)',
  'Erro comum ("você provavelmente está fazendo X errado")',
  'Pergunta direta que o público já se faz',
  'Começo no meio da história (in medias res)',
  'Resultado + caminho ("como chegar em X sem Y") — só com dado da base',
  'Mito x verdade',
  'Aviso ou alerta',
  'Bastidores ("o que ninguém mostra sobre…")',
  'Identificação ("se você é…, este vídeo é para você")',
  'Dor explícita, dita do jeito do público',
  'Comparação (A x B)',
  'Lista com promessa clara (N passos/erros/sinais)',
  'Antes e depois — só com caso real da base',
  'Desafio ou teste ("testei X por…") — só se aconteceu',
  'Demonstração imediata (mostrar antes de explicar)',
  'Opinião forte / polêmica controlada',
  'Objeção do público respondida de cara',
  'Novidade ou mudança recente no assunto',
  'Custo de não agir',
  'Atalho ("o jeito mais simples de…")',
  'Curiosidade com lacuna (abre uma pergunta que só o vídeo fecha)',
];

function knowledgeBlock(k) {
  const lines = Object.entries(KNOWLEDGE_FIELDS)
    .map(([key, label]) => (k[key] ? `## ${label}\n${String(k[key]).trim()}` : null))
    .filter(Boolean);
  return lines.length ? lines.join('\n\n') : '(base de conhecimento vazia)';
}

// Prompt de sistema do cliente: estável por workspace (bom para cache).
export function systemPrompt(profile, workspaceName) {
  const k = parseKnowledge(profile?.knowledge);
  return `Você é a equipe de roteiro e embalagem do Estúdio da Usina do Tempo, trabalhando para o cliente "${workspaceName}". Escreva sempre em português do Brasil, falado e natural, para vídeos de YouTube e Instagram.

# Base de conhecimento do cliente (única fonte de fatos)
${knowledgeBlock(k)}

# Voz do cliente
${profile?.voice?.trim() || '(sem perfil de voz ainda: use um tom claro, próximo e direto)'}

# Regras inegociáveis
- Nunca invente números, porcentagens, prazos, resultados, nomes, depoimentos ou casos. Use só o que está na base acima.
- Quando um trecho precisaria de um dado que não está na base, escreva [CONFIRMAR: o que falta] no lugar e liste esse item em "pending_facts".
- Nada de promessa que o vídeo não cumpre. O gancho e o título precisam ser entregues pelo conteúdo.
- Respeite "O que nunca dizer".
- Um único pedido (chamada para ação) por vídeo, ligado à oferta do cliente.`;
}

const FORMAT_RULES = {
  long: 'Vídeo longo (YouTube, 6 a 12 minutos). Gancho nos primeiros 15 segundos; a virada (o motivo para assistir até o fim, ou a mudança de expectativa) entre 0:15 e 0:45; corpo em 5 a 9 batidas; o pedido no final.',
  short: 'Vídeo curto (Shorts/Reels, 20 a 55 segundos). Gancho no primeiro segundo e meio; a virada já na segunda frase; corpo em 3 a 5 batidas curtas; termine com uma frase que conecte de volta ao começo (loop) e o pedido em poucas palavras.',
};

const PLATFORM_LABEL = { youtube: 'YouTube', instagram: 'Instagram', both: 'YouTube e Instagram' };

function videoBrief(v) {
  return `Tema: ${v.topic}
Plataforma: ${PLATFORM_LABEL[v.platform] || v.platform}
Formato: ${FORMAT_RULES[v.format] || v.format}${v.notes ? `\nObservações da equipe: ${v.notes}` : ''}`;
}

// ---- Roteiro -----------------------------------------------------------------

export const SCRIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hooks', 'recommended_hooks', 'turn', 'beats', 'ask', 'total_seconds', 'pending_facts'],
  properties: {
    hooks: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['formula', 'text', 'score', 'why'],
        properties: {
          formula: { type: 'string' }, text: { type: 'string' },
          score: { type: 'integer' }, why: { type: 'string' },
        },
      },
    },
    recommended_hooks: { type: 'array', items: { type: 'integer' } },
    turn: {
      type: 'object', additionalProperties: false, required: ['at_seconds', 'text'],
      properties: { at_seconds: { type: 'integer' }, text: { type: 'string' } },
    },
    beats: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['title', 'speech', 'on_screen', 'seconds'],
        properties: {
          title: { type: 'string' }, speech: { type: 'string' },
          on_screen: { type: 'string' }, seconds: { type: 'integer' },
        },
      },
    },
    ask: { type: 'string' },
    total_seconds: { type: 'integer' },
    pending_facts: { type: 'array', items: { type: 'string' } },
  },
};

export function scriptPrompt(v, instructions) {
  return `Escreva o roteiro deste vídeo.

${videoBrief(v)}

Passos:
1. Crie 5 ganchos, cada um com uma fórmula DIFERENTE desta lista:
${HOOK_FORMULAS.map((f, i) => `   ${i + 1}. ${f}`).join('\n')}
2. Dê a cada gancho uma nota de 0 a 10, com rigor: clareza em uma frase, curiosidade real, relevância para o público da base, e se o vídeo consegue cumprir o que o gancho promete. Gancho que exige dado fora da base perde nota. Explique a nota em uma frase.
3. Em "recommended_hooks", os índices (a partir de 0) dos 2 melhores.
4. A virada: o momento (em segundos) e a fala que faz a pessoa decidir ficar até o fim.
5. O corpo em batidas: título curto, a fala exatamente como será dita, o que aparece na tela (texto ou imagem de apoio) e a duração estimada em segundos.
6. O pedido final (um só).
7. "total_seconds": duração total estimada. "pending_facts": dados a confirmar (vazio se não houver).${instructions ? `\n\nAjuste pedido pela equipe: ${instructions}` : ''}`;
}

// Texto corrido para gravar: gancho escolhido + virada + batidas + pedido.
export function composeScript(script, hookIndex = null) {
  if (!script) return '';
  const idx = hookIndex ?? script.recommended_hooks?.[0] ?? 0;
  const hook = script.hooks?.[idx]?.text || '';
  const parts = [`[GANCHO]\n${hook}`, `[VIRADA ~${script.turn?.at_seconds ?? ''}s]\n${script.turn?.text || ''}`];
  for (const b of script.beats || []) {
    parts.push(`[${b.title}]\n${b.speech}${b.on_screen ? `\n(Na tela: ${b.on_screen})` : ''}`);
  }
  parts.push(`[PEDIDO]\n${script.ask || ''}`);
  return parts.join('\n\n');
}

// ---- Embalagem (título + capa) --------------------------------------------

export const PACKAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pairs', 'recommended'],
  properties: {
    pairs: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'thumb_text', 'thumb_visual', 'score', 'why'],
        properties: {
          title: { type: 'string' }, thumb_text: { type: 'string' }, thumb_visual: { type: 'string' },
          score: { type: 'integer' }, why: { type: 'string' },
        },
      },
    },
    recommended: { type: 'integer' },
  },
};

export function packagePrompt(v, finalScript, instructions) {
  return `Crie a embalagem deste vídeo: título e capa pensados como um PAR.

${videoBrief(v)}

Roteiro final:
"""
${finalScript.slice(0, 12000)}
"""

Gere 5 pares. Regras:
- Título com até 60 caracteres, claro, com a palavra que o público buscaria.
- Texto da capa com no máximo 4 palavras, que COMPLEMENTA o título (não repete as mesmas palavras).
- "thumb_visual": a imagem da capa em uma frase (expressão, objeto, contraste), que a equipe consiga produzir.
- O par precisa ser cumprido pelo roteiro; nada de promessa que o vídeo não entrega.
- Para Instagram, pense o par como capa do Reel + primeira linha da legenda.
- Nota de 0 a 10 para cada par com uma frase de justificativa; "recommended" é o índice (a partir de 0) do melhor.${instructions ? `\n\nAjuste pedido pela equipe: ${instructions}` : ''}`;
}

// Checagens objetivas do par (o que o modelo às vezes ignora).
export function packageWarnings(pair) {
  const w = [];
  if ((pair.title || '').length > 60) w.push(`título com ${pair.title.length} caracteres (o YouTube corta perto de 60)`);
  const thumbWords = (pair.thumb_text || '').trim().split(/\s+/).filter(Boolean);
  if (thumbWords.length > 4) w.push(`capa com ${thumbWords.length} palavras (ideal até 4)`);
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, '');
  const titleWords = new Set(norm(pair.title || '').split(/\s+/).filter((x) => x.length > 3));
  const repeated = thumbWords.map(norm).filter((x) => x.length > 3 && titleWords.has(x));
  if (repeated.length >= 2) w.push('capa repete palavras do título');
  if (/\[CONFIRMAR/.test(`${pair.title} ${pair.thumb_text}`)) w.push('tem dado a confirmar');
  return w;
}

// ---- SEO e legenda --------------------------------------------------------

export const SEO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['youtube', 'instagram'],
  properties: {
    youtube: {
      type: 'object', additionalProperties: false, required: ['description', 'tags', 'target_searches'],
      properties: {
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        target_searches: { type: 'array', items: { type: 'string' } },
      },
    },
    instagram: {
      type: 'object', additionalProperties: false, required: ['caption', 'hashtags'],
      properties: { caption: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } } },
    },
  },
};

export function seoPrompt(v, finalScript, title, instructions) {
  return `Escreva a descrição do YouTube e a legenda do Instagram deste vídeo.

${videoBrief(v)}
Título escolhido: ${title || '(ainda sem título)'}

Roteiro final:
"""
${finalScript.slice(0, 12000)}
"""

Regras:
- YouTube: as 2 primeiras linhas resumem o valor do vídeo e já trazem o link, escrito exatamente como {LINK} (uma única vez, ali no começo). Depois, um parágrafo curto do que a pessoa vai aprender e o pedido final de novo, em palavras. Sem lista de hashtags na descrição.
- "tags": 8 a 15 termos que alguém digitaria de verdade; nada de repetir variações óbvias.
- "target_searches": as 3 buscas principais que este vídeo deve disputar.
- Instagram: primeira linha que segura a rolagem, corpo curto em parágrafos, e o pedido com "link na bio". 3 a 8 hashtags específicas, sem o símbolo #.${instructions ? `\n\nAjuste pedido pela equipe: ${instructions}` : ''}`;
}

// ---- Perfil de voz ---------------------------------------------------------

export const VOICE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['voice'],
  properties: { voice: { type: 'string' } },
};

export function voicePrompt(samples) {
  return `Abaixo estão transcrições ou textos do próprio cliente. Descreva a VOZ dele para que outro roteirista escreva igual:
tom; ritmo e tamanho das frases; vocabulário e expressões típicas (cite as reais); como ele abre e fecha; como trata o público (você, a gente, vocês); nível de formalidade; o que ele nunca faria. Termine com 5 frases de exemplo no estilo dele (sem inventar fatos). Escreva em tópicos curtos, em português.

${samples.map((s, i) => `--- Exemplo ${i + 1} ---\n${s.slice(0, 15000)}`).join('\n\n')}`;
}

// ---- Link rastreado --------------------------------------------------------

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function newShortCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function trackedLink(env, code) {
  return `${env.APP_URL || 'https://app.usinadotempo.com.br'}/v/${code}`;
}

// Destino com UTMs por vídeo: o tracker da página grava a sessão com essa
// origem, e o lead/venda vira atribuível ao vídeo (CRM, Funis, Produtos).
export function destinationUrl(ctaUrl, video, source) {
  const u = new URL(ctaUrl);
  u.searchParams.set('utm_source', source);
  u.searchParams.set('utm_medium', 'video');
  u.searchParams.set('utm_campaign', 'estudio');
  u.searchParams.set('utm_content', video.short_code);
  return u.toString();
}
