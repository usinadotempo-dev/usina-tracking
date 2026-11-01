// GET /media/<key> — serve logos e avatares do R2 (binding MEDIA).
// Só prefixos conhecidos; as chaves têm sufixo aleatório, então o cache é
// imutável (trocar a imagem gera uma chave nova).

const ALLOWED_PREFIXES = ['tenants/', 'users/'];

export async function onRequestGet(context) {
  const { env, params } = context;
  const parts = Array.isArray(params.path) ? params.path : [params.path];
  const key = parts.filter(Boolean).join('/');

  if (!env.MEDIA || !key || key.includes('..') || !ALLOWED_PREFIXES.some((p) => key.startsWith(p))) {
    return new Response('Not Found', { status: 404 });
  }

  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response('Not Found', { status: 404 });

  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
