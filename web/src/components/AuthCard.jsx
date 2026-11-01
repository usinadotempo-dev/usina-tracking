// Moldura das telas de entrada (login, esqueci a senha, troca de senha).
export default function AuthCard({ title, subtitle, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/assets/usina-brand/logo-color.png" alt="Usina do Tempo" className="mx-auto mb-5 h-10" />
          <h1 className="text-lg font-semibold text-navy">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        <div className="card p-7 shadow-sm">{children}</div>
        <p className="mt-6 text-center text-xs text-muted">Usina do Tempo © {new Date().getFullYear()}</p>
      </div>
    </div>
  );
}

export function Alert({ kind = 'error', children }) {
  const styles = kind === 'error'
    ? 'border-coral/30 bg-coral/5 text-coral'
    : 'border-teal/40 bg-teal/10 text-navy';
  return <p className={`rounded-lg border px-3.5 py-2.5 text-sm ${styles}`}>{children}</p>;
}
