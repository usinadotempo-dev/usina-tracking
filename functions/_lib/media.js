// Arquivos de mídia no R2 (binding env.MEDIA) — Fase 1, sprint 1.3.
// Imagens validadas pelo conteúdo (assinatura do arquivo), não pelo nome
// nem pelo Content-Type enviado. SVG não é aceito (pode carregar script).

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function detectImage(bytes) {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
      && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return { ext: 'png', type: 'image/png' };
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { ext: 'jpg', type: 'image/jpeg' };
  }
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return { ext: 'webp', type: 'image/webp' };
  }
  return null;
}

export function mediaUrl(key) {
  return key ? `/media/${key}` : null;
}

// Lê o corpo da requisição como imagem validada.
// Retorna { bytes, image } ou { error, status }.
export async function readImageUpload(request) {
  const len = parseInt(request.headers.get('content-length') || '0', 10);
  if (len > MAX_IMAGE_BYTES) return { error: 'Imagem acima de 2 MB.', status: 413 };
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return { error: 'Arquivo vazio.', status: 400 };
  if (bytes.length > MAX_IMAGE_BYTES) return { error: 'Imagem acima de 2 MB.', status: 413 };
  const image = detectImage(bytes);
  if (!image) return { error: 'Use PNG, JPG ou WEBP.', status: 415 };
  return { bytes, image };
}

// Grava a imagem sob `prefix/` com nome único (permite cache imutável) e
// apaga a anterior. Retorna a chave nova.
export async function replaceImage(env, prefix, name, bytes, image, oldKey) {
  if (!env.MEDIA) throw new Error('Binding MEDIA (R2) não configurado');
  const key = `${prefix}/${name}-${crypto.randomUUID().slice(0, 8)}.${image.ext}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: image.type } });
  if (oldKey && oldKey !== key) {
    try { await env.MEDIA.delete(oldKey); } catch (e) { console.error('media delete:', e.message); }
  }
  return key;
}

export async function deleteImage(env, key) {
  if (!key || !env.MEDIA) return;
  try { await env.MEDIA.delete(key); } catch (e) { console.error('media delete:', e.message); }
}
