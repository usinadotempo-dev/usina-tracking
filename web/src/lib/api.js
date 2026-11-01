// Cliente HTTP do app. Mesmo domínio das Functions — o cookie de sessão
// (_uta_sess, HttpOnly) vai automaticamente.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Envia um arquivo como corpo cru da requisição (o servidor valida o conteúdo).
export async function upload(path, file) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  let data = null;
  try { data = await res.json(); } catch { /* resposta sem corpo */ }
  if (!res.ok) throw new ApiError(data?.error || `Erro ${res.status}`, res.status);
  return data;
}

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* resposta sem corpo */ }
  if (!res.ok) {
    throw new ApiError(data?.error || `Erro ${res.status}`, res.status);
  }
  return data;
}
