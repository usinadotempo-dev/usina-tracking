import { useRef, useState } from 'react';
import { upload, api } from '../lib/api.js';

const ACCEPT = 'image/png,image/jpeg,image/webp';
const MAX_BYTES = 2 * 1024 * 1024;

// Envio de imagem (logo ou foto). O servidor revalida tipo e tamanho.
export default function ImageUpload({ url, endpoint, round = false, label, onChanged }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) return setError('Imagem acima de 2 MB.');
    if (!ACCEPT.split(',').includes(file.type)) return setError('Use PNG, JPG ou WEBP.');
    setBusy(true);
    setError(null);
    try {
      await upload(endpoint, file);
      await onChanged?.();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  async function onRemove() {
    setBusy(true);
    setError(null);
    try {
      await api('DELETE', endpoint);
      await onChanged?.();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  const shape = round ? 'rounded-full' : 'rounded-xl';
  return (
    <div>
      {label && <p className="label">{label}</p>}
      <div className="flex items-center gap-4">
        <div className={`flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden border border-line bg-paper ${shape}`}>
          {url ? <img src={url} alt="" className="h-full w-full object-contain" /> : <span className="text-xs text-muted">sem imagem</span>}
        </div>
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <button type="button" className="btn-secondary px-3 py-1.5" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? 'Enviando…' : url ? 'Trocar' : 'Enviar imagem'}
            </button>
            {url && <button type="button" className="btn-secondary px-3 py-1.5" disabled={busy} onClick={onRemove}>Remover</button>}
          </div>
          <p className="text-xs text-muted">PNG, JPG ou WEBP · até 2 MB</p>
          {error && <p className="text-xs text-coral">{error}</p>}
        </div>
      </div>
      <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={onFile} />
    </div>
  );
}
