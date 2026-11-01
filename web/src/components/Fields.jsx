import PasswordInput from './PasswordInput.jsx';

export function TextField({ label, help, value, onChange, placeholder, mono = false }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className={`input ${mono ? 'font-mono' : ''}`}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {help && <p className="mt-1 text-xs text-muted">{help}</p>}
    </div>
  );
}

// Segredo: o valor salvo nunca chega ao navegador — só {set, last4}.
// Em branco mantém o atual; "remover" apaga ao salvar.
export function SecretField({ label, help, saved, value, onChange, clear, onClear }) {
  const placeholder = saved?.set ? `••••••${saved.last4 || ''} — salvo; em branco mantém` : '';
  return (
    <div>
      <label className="label">{label}</label>
      <PasswordInput required={false} autoComplete="off" placeholder={placeholder}
        value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      {saved?.set && (
        <label className="mt-1 flex cursor-pointer items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={!!clear} onChange={(e) => onClear(e.target.checked)} />
          remover ao salvar
        </label>
      )}
      {help && <p className="mt-1 text-xs text-muted">{help}</p>}
    </div>
  );
}

export function Section({ title, description, children }) {
  return (
    <section className="card p-6">
      <h2 className="font-semibold text-navy">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function CopyField({ label, value, help }) {
  return (
    <div className="sm:col-span-2">
      <label className="label">{label}</label>
      <div className="flex gap-2">
        <input className="input font-mono text-xs" readOnly value={value} />
        <button type="button" className="btn-secondary shrink-0" onClick={() => navigator.clipboard.writeText(value)}>
          Copiar
        </button>
      </div>
      {help && <p className="mt-1 text-xs text-muted">{help}</p>}
    </div>
  );
}
