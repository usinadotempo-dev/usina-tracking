// Cliente do Claude para as Functions (Estúdio de Vídeo e, depois, Conteúdo).
//
// Secret no Pages: ANTHROPIC_API_KEY. Opcional: CLAUDE_MODEL (padrão
// claude-opus-5-5) — trocar por claude-sonnet-5-5 corta o custo pela metade.
// A chave nunca é logada nem devolvida ao navegador.
//
// Sempre saída estruturada (JSON Schema) para a tela não depender de texto
// livre. Recusa por segurança: a API tenta sozinha um modelo de reserva
// (fallbacks "default"); se ainda assim recusar, vira erro legível.

import Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_MODEL = 'claude-opus-5-5';
// Modelos que aceitam fallbacks: "default" (server-side fallback).
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

export class ClaudeError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export function claudeConfigured(env) {
  return !!env.ANTHROPIC_API_KEY;
}

// { system, prompt, schema, effort?, maxTokens? } → { data, usage, model }
export async function generateJson(env, { system, prompt, schema, effort = 'medium', maxTokens = 32000 }) {
  if (!env.ANTHROPIC_API_KEY) throw new ClaudeError('A IA ainda não foi configurada na plataforma (ANTHROPIC_API_KEY).', 503);
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const model = env.CLAUDE_MODEL || DEFAULT_MODEL;
  const withFallback = FALLBACK_MODELS.has(model);

  let msg;
  try {
    const stream = client.beta.messages.stream({
      model,
      max_tokens: maxTokens,
      ...(withFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
      output_config: { effort, format: { type: 'json_schema', schema } },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    });
    msg = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new ClaudeError('A IA está ocupada agora. Tente de novo em instantes.', 429);
    if (e instanceof Anthropic.AuthenticationError) throw new ClaudeError('Chave da IA inválida na plataforma.', 503);
    if (e instanceof Anthropic.BadRequestError) {
      console.error('claude 400:', e.message);
      throw new ClaudeError('A IA recusou o pedido (configuração). Avise a Usina.', 502);
    }
    if (e instanceof Anthropic.APIError) {
      console.error(`claude ${e.status}:`, e.message);
      throw new ClaudeError('A IA não respondeu. Tente de novo.', 502);
    }
    console.error('claude:', e?.message || e);
    throw new ClaudeError('Falha ao falar com a IA. Tente de novo.', 502);
  }

  if (msg.stop_reason === 'refusal') throw new ClaudeError('A IA não quis gerar este conteúdo. Ajuste o tema ou as instruções.', 422);
  if (msg.stop_reason === 'max_tokens') throw new ClaudeError('A resposta ficou grande demais. Peça algo mais curto.', 422);
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let data;
  try { data = JSON.parse(text); } catch {
    console.error('claude: JSON inválido', text.slice(0, 200));
    throw new ClaudeError('A IA devolveu um formato inesperado. Tente de novo.', 502);
  }
  return { data, usage: msg.usage, model: msg.model };
}
