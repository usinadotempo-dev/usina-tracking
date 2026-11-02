import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Alert } from '../components/AuthCard.jsx';

// Produtos Digitais: receita bruta e líquida, reembolsos, recompra, ranking
// de produtos, origem das vendas e melhores clientes.

const PERIODS = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias'], [365, '12 meses']];
const brl = (v) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const int = (v) => (v ?? 0).toLocaleString('pt-BR');
const pct = (a, b) => (b > 0 ? `${((a / b) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—');
const day = (u) => (u ? new Date(u * 1000).toLocaleDateString('pt-BR') : '—');

function Kpi({ label, value, hint }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-navy">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export default function Products() {
  const { workspaces } = useAuth();
  const [params, setParams] = useSearchParams();
  const wsId = params.get('workspace') || workspaces[0]?.id || '';
  const [days, setDays] = useState(30);
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!wsId) return;
    let alive = true;
    const t = setTimeout(() => {
      api('GET', `/portal/products?workspace=${encodeURIComponent(wsId)}&days=${days}&q=${encodeURIComponent(q)}`)
        .then((d) => { if (alive) { setData(d); setErr(null); } })
        .catch((e) => alive && setErr(e.message));
    }, q ? 300 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [wsId, days, q]);

  if (!workspaces.length) {
    return <div className="card p-10 text-center text-sm text-muted">Nenhum workspace liberado para o seu usuário.</div>;
  }
  const k = data?.kpis;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-navy">Produtos</h1>
          <p className="mt-1 text-sm text-muted">Vendas das plataformas (Hotmart, Kiwify, Eduzz), reembolsos e clientes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {workspaces.length > 1 && (
            <select className="input w-auto" value={wsId} onChange={(e) => { setData(null); setParams({ workspace: e.target.value }); }}>
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.tenant_name} — {w.name}</option>)}
            </select>
          )}
          <div className="flex rounded-lg border border-line bg-white p-0.5 text-sm">
            {PERIODS.map(([d, l]) => (
              <button key={d} type="button" onClick={() => setDays(d)}
                className={`rounded-md px-3 py-1.5 ${days === d ? 'bg-navy text-white' : 'text-muted hover:text-navy'}`}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {err && <Alert kind="error">{err}</Alert>}
      {!data ? (
        !err && <div className="card p-10 text-center text-sm text-muted">Carregando…</div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Receita líquida" value={brl(k.net_revenue)} hint={`bruta ${brl(k.revenue)}`} />
            <Kpi label="Vendas" value={int(k.sales)} hint={`ticket médio ${brl(k.aov)}`} />
            <Kpi label="Reembolsos" value={`${int(k.refunds)} · ${pct(k.refunds, k.sales)}`}
              hint={`${brl(k.refunded_value)}${k.chargebacks ? ` · ${int(k.chargebacks)} chargeback(s)` : ''}`} />
            <Kpi label="Clientes" value={int(k.customers)} hint={`${int(k.repeat_customers)} recompraram (${pct(k.repeat_customers, k.customers)})`} />
          </div>

          <section className="card overflow-x-auto">
            <h2 className="p-5 font-semibold text-navy">Produtos</h2>
            {data.products.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted">Nenhuma venda no período.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-y border-line bg-paper text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-5 py-2">Produto</th><th className="px-3 py-2 text-right">Vendas</th>
                    <th className="px-3 py-2 text-right">Receita</th><th className="px-3 py-2 text-right">Ticket</th>
                    <th className="px-3 py-2 text-right">Reembolsos</th><th className="px-5 py-2 text-right">Líquida</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.products.map((p) => (
                    <tr key={p.product_id}>
                      <td className="px-5 py-2.5 font-medium text-navy">{p.product_name}</td>
                      <td className="px-3 py-2.5 text-right">{int(p.sales)}</td>
                      <td className="px-3 py-2.5 text-right">{brl(p.revenue)}</td>
                      <td className="px-3 py-2.5 text-right">{brl(p.sales ? p.revenue / p.sales : 0)}</td>
                      <td className={`px-3 py-2.5 text-right ${p.refunds && p.refunds / p.sales > 0.1 ? 'font-semibold text-coral' : ''}`}>
                        {int(p.refunds)} <span className="text-xs text-muted">({pct(p.refunds, p.sales)})</span>
                      </td>
                      <td className="px-5 py-2.5 text-right font-medium text-navy">{brl(p.revenue - p.refunded_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            <section className="card lg:col-span-1">
              <h2 className="p-5 font-semibold text-navy">Origem das vendas</h2>
              {data.origins.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">—</p> : (
                <ul className="divide-y divide-line border-t border-line text-sm">
                  {data.origins.map((o) => (
                    <li key={o.source} className="flex items-center justify-between gap-3 px-5 py-2.5">
                      <span className="truncate text-navy" title={o.source}>{o.source}</span>
                      <span className="shrink-0 text-right"><span className="font-medium text-navy">{brl(o.revenue)}</span> <span className="text-xs text-muted">· {int(o.sales)}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card overflow-x-auto lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3 p-5">
                <h2 className="font-semibold text-navy">Melhores clientes <span className="text-xs font-normal text-muted">(todo o histórico)</span></h2>
                <input className="input max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nome ou e-mail" />
              </div>
              {data.customers.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">Nenhum cliente.</p> : (
                <table className="w-full text-sm">
                  <thead className="border-y border-line bg-paper text-left text-xs uppercase tracking-wide text-muted">
                    <tr><th className="px-5 py-2">Cliente</th><th className="px-3 py-2 text-right">Compras</th><th className="px-3 py-2 text-right">Total</th><th className="px-5 py-2 text-right">Última</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.customers.map((c) => (
                      <tr key={c.email}>
                        <td className="px-5 py-2.5">
                          <p className="font-medium text-navy">{c.name || '—'}</p>
                          <p className="text-xs text-muted">{c.email}{c.refunds ? ` · ${c.refunds} reembolso(s)` : ''}</p>
                        </td>
                        <td className="px-3 py-2.5 text-right">{int(c.purchases)}</td>
                        <td className="px-3 py-2.5 text-right font-medium text-navy">{brl(c.total)}</td>
                        <td className="px-5 py-2.5 text-right text-xs text-muted">{day(c.last_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
          <p className="text-xs text-muted">Reembolsos e chargebacks passam a ser registrados a partir desta versão; os anteriores não aparecem.</p>
        </>
      )}
    </div>
  );
}
