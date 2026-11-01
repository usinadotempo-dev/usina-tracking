import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Alert } from '../components/AuthCard.jsx';

const STATUS = {
  trial: 'Período de teste',
  active: 'Ativa',
  pending: 'Aguardando pagamento',
  past_due: 'Pagamento em atraso',
  canceled: 'Cancelada',
  none: 'Sem assinatura',
  contract: 'Contrato com a Usina',
  internal: 'Interno',
};
const INVOICE_STATUS = {
  PENDING: 'A vencer', RECEIVED: 'Paga', CONFIRMED: 'Paga', OVERDUE: 'Vencida',
  REFUNDED: 'Estornada', RECEIVED_IN_CASH: 'Paga',
};

const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const date = (unix) => (unix ? new Date(unix * 1000).toLocaleDateString('pt-BR') : '—');

// Assinatura do cliente (owner).
export default function Billing() {
  const { refresh } = useAuth();
  const [data, setData] = useState(null);
  const [doc, setDoc] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(null);

  async function load() {
    try { setData(await api('GET', '/portal/billing')); }
    catch (e) { setMsg({ kind: 'error', text: e.message }); }
  }
  useEffect(() => { load(); }, []);

  if (!data) return msg ? <Alert>{msg.text}</Alert> : <div className="card p-10 text-center text-sm text-muted">Carregando…</div>;

  const ent = data.entitlements || {};
  const isAsaas = data.billing_mode === 'asaas';
  const needsDoc = isAsaas && !data.has_subscription && !data.cpf_cnpj_masked;
  const docDigits = doc.replace(/\D/g, '');
  const docOk = docDigits.length === 11 || docDigits.length === 14;
  const blockedByDoc = needsDoc && !docOk;

  async function subscribe(slug) {
    setBusy(slug);
    setMsg(null);
    try {
      const res = await api('POST', '/portal/billing/subscribe', { plan_slug: slug, cpf_cnpj: docDigits });
      await Promise.all([load(), refresh()]);
      if (res.invoice_url) {
        setMsg({ kind: 'ok', text: 'Assinatura criada. Abrimos a fatura numa nova aba — o acesso é liberado assim que o pagamento for confirmado.' });
        window.open(res.invoice_url, '_blank', 'noopener');
      } else {
        setMsg({ kind: 'ok', text: res.changed ? 'Plano alterado.' : 'Assinatura criada.' });
      }
    } catch (e) {
      setMsg({ kind: 'error', text: e.message });
    }
    setBusy(null);
  }

  async function cancel() {
    if (!window.confirm('Cancelar a assinatura? O acesso continua até o fim do período já pago.')) return;
    setBusy('cancel');
    setMsg(null);
    try {
      const res = await api('POST', '/portal/billing/cancel');
      await Promise.all([load(), refresh()]);
      setMsg({ kind: 'ok', text: `Assinatura cancelada. Acesso até ${date(res.access_until)}.` });
    } catch (e) {
      setMsg({ kind: 'error', text: e.message });
    }
    setBusy(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-navy">Assinatura</h1>
        <p className="mt-1 text-sm text-muted">Plano, faturas e módulos liberados.</p>
      </div>

      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <section className="card grid gap-4 p-6 sm:grid-cols-3">
        <div>
          <p className="label">Plano</p>
          <p className="font-semibold text-navy">{data.plan.name}{data.plan.price_cents ? ` · ${brl(data.plan.price_cents)}/mês` : ''}</p>
        </div>
        <div>
          <p className="label">Situação</p>
          <p className="font-semibold text-navy">{STATUS[ent.status] || ent.status}</p>
          {ent.status === 'trial' && <p className="text-xs text-muted">até {date(ent.trial_ends_at)}</p>}
          {['active', 'canceled', 'past_due', 'pending'].includes(ent.status) && ent.current_period_end && (
            <p className="text-xs text-muted">período até {date(ent.current_period_end)}</p>
          )}
        </div>
        <div>
          <p className="label">Módulos liberados</p>
          <p className="text-sm text-navy">{(ent.modules || []).map((m) => data.module_labels[m] || m).join(' · ') || 'nenhum'}</p>
        </div>
      </section>

      {!isAsaas ? (
        <div className="card p-6 text-sm text-muted">
          A cobrança da sua empresa é feita por contrato com a Usina do Tempo. Para mudar de plano ou de módulos, fale com o seu contato na Usina.
        </div>
      ) : (
        <>
          {needsDoc && (
            <section className="card p-6">
              <label className="label" htmlFor="doc">CPF ou CNPJ para as faturas</label>
              <input id="doc" className="input max-w-xs font-mono" value={doc} onChange={(e) => setDoc(e.target.value)}
                placeholder="somente números" inputMode="numeric" maxLength={18} />
              <p className={`mt-1.5 text-xs ${doc && !docOk ? 'text-coral' : 'text-muted'}`}>
                {doc && !docOk
                  ? `CPF tem 11 dígitos e CNPJ tem 14 (você digitou ${docDigits.length}).`
                  : 'Obrigatório para emitir as faturas. Preencha para liberar os botões de assinatura.'}
              </p>
            </section>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {data.plans.map((p) => {
              const current = p.slug === data.plan.slug && data.has_subscription;
              return (
                <section key={p.slug} className={`card flex flex-col p-6 ${current ? 'border-coral' : ''}`}>
                  <h2 className="text-lg font-semibold text-navy">{p.name}</h2>
                  <p className="text-2xl font-semibold text-navy">{brl(p.price_cents)}<span className="text-sm font-normal text-muted">/mês</span></p>
                  <p className="mt-1 text-sm text-muted">{p.description}</p>
                  <ul className="mt-4 space-y-1 text-sm text-navy">
                    {p.modules.map((m) => <li key={m.key}>✓ {m.label}</li>)}
                    <li className="text-muted">Até {p.max_workspaces} workspace(s) e {p.max_users} usuários</li>
                  </ul>
                  <div className="mt-auto pt-5">
                    {current ? (
                      <p className="text-sm font-medium text-coral">Seu plano atual</p>
                    ) : (
                      <button type="button" className="btn-primary w-full" disabled={!!busy || blockedByDoc} title={blockedByDoc ? 'Preencha o CPF ou CNPJ acima' : undefined}
                        onClick={() => subscribe(p.slug)}>
                        {busy === p.slug ? 'Processando…' : data.has_subscription ? `Mudar para ${p.name}` : `Assinar ${p.name}`}
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
          <p className="text-xs text-muted">Pagamento por Pix, boleto ou cartão, escolhido na própria fatura. Plano Enterprise sob consulta com a Usina.</p>

          {data.invoices.length > 0 && (
            <section className="card divide-y divide-line">
              <h2 className="p-5 font-semibold text-navy">Faturas</h2>
              {data.invoices.map((inv) => (
                <div key={inv.payment_id} className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm">
                  <div>
                    <p className="font-medium text-navy">{brl(inv.value_cents || 0)}</p>
                    <p className="text-xs text-muted">vence em {inv.due_date ? inv.due_date.split('-').reverse().join('/') : '—'} · {INVOICE_STATUS[inv.status] || inv.status}</p>
                  </div>
                  {inv.invoice_url && <a href={inv.invoice_url} target="_blank" rel="noopener noreferrer" className="btn-secondary px-3 py-1.5">Ver fatura</a>}
                </div>
              ))}
            </section>
          )}

          {data.has_subscription && (
            <div className="flex justify-end">
              <button type="button" className="text-sm text-muted underline-offset-2 hover:underline" disabled={!!busy} onClick={cancel}>
                Cancelar assinatura
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
