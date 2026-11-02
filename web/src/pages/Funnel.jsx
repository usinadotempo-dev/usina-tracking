import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Alert } from '../components/AuthCard.jsx';

// Funis: visitas → eventos do catálogo do workspace, com a taxa entre
// degraus e a quebra por origem (UTM da sessão).

const PERIODS = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias']];
const GROUPS = [['utm_source', 'Origem'], ['utm_medium', 'Mídia'], ['utm_campaign', 'Campanha']];

const int = (v) => (v ?? 0).toLocaleString('pt-BR');
const pct = (a, b) => (b > 0 ? `${((a / b) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—');

export default function Funnel() {
  const { workspaces } = useAuth();
  const [params, setParams] = useSearchParams();
  const wsId = params.get('workspace') || workspaces[0]?.id || '';
  const [days, setDays] = useState(30);
  const [group, setGroup] = useState('utm_source');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!wsId) return;
    let alive = true;
    setData(null);
    setErr(null);
    api('GET', `/api/funnel?workspace=${encodeURIComponent(wsId)}&days=${days}&group=${group}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [wsId, days, group]);

  if (!workspaces.length) {
    return <div className="card p-10 text-center text-sm text-muted">Nenhum workspace liberado para o seu usuário.</div>;
  }

  const steps = data?.steps || [];
  const max = Math.max(1, ...steps.map((s) => s.count));
  const visits = steps[0]?.count || 0;
  const last = steps[steps.length - 1];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-navy">Funis</h1>
          <p className="mt-1 text-sm text-muted">Das visitas até cada evento que o seu site registra, e de onde vem quem converte.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {workspaces.length > 1 && (
            <select className="input w-auto" value={wsId} onChange={(e) => setParams({ workspace: e.target.value })}>
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
          <section className="card p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold text-navy">Funil de conversão</h2>
              {steps.length > 1 && (
                <p className="text-sm text-muted">
                  Conversão total ({last.label}): <span className="font-semibold text-navy">{pct(last.count, visits)}</span>
                </p>
              )}
            </div>
            {steps.length <= 1 ? (
              <p className="mt-4 text-sm text-muted">
                Este workspace ainda não tem eventos de conversão no catálogo. A Usina define os eventos (lead, checkout, compra…) no admin.
              </p>
            ) : (
              <div className="mt-5 space-y-4">
                {steps.map((s, i) => {
                  const prev = i > 0 ? steps[i - 1].count : null;
                  return (
                    <div key={s.key}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="text-navy">{s.label}</span>
                        <span className="font-mono text-navy">
                          {int(s.count)}
                          {prev !== null && <span className="ml-2 text-xs text-muted">{pct(s.count, prev)} do degrau anterior</span>}
                        </span>
                      </div>
                      <div className="h-3 overflow-hidden rounded-full bg-paper">
                        <div className="h-full rounded-full bg-navy/70" style={{ width: `${Math.max(1, (s.count / max) * 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {steps.length > 1 && data.breakdown && (
            <section className="card overflow-x-auto">
              <div className="flex flex-wrap items-center justify-between gap-3 p-5">
                <h2 className="font-semibold text-navy">Por origem do tráfego</h2>
                <div className="flex rounded-lg border border-line bg-white p-0.5 text-sm">
                  {GROUPS.map(([g, l]) => (
                    <button key={g} type="button" onClick={() => setGroup(g)}
                      className={`rounded-md px-3 py-1.5 ${group === g ? 'bg-navy text-white' : 'text-muted hover:text-navy'}`}>{l}</button>
                  ))}
                </div>
              </div>
              {data.breakdown.rows.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-muted">Sem visitas no período.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-y border-line bg-paper text-left text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-5 py-2">{GROUPS.find(([g]) => g === group)[1]}</th>
                      {steps.map((s) => <th key={s.key} className="px-3 py-2 text-right">{s.label}</th>)}
                      <th className="px-5 py-2 text-right">Conversão</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.breakdown.rows.map((r) => (
                      <tr key={r.value}>
                        <td className="max-w-[260px] truncate px-5 py-2.5 text-navy" title={r.value}>{r.value}</td>
                        {steps.map((s) => <td key={s.key} className="px-3 py-2.5 text-right font-mono">{int(r.counts[s.key])}</td>)}
                        <td className="px-5 py-2.5 text-right font-medium text-navy">{pct(r.counts[last.key], r.counts.__visit__)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="px-5 py-3 text-xs text-muted">
                Eventos sem sessão identificada (ex.: venda que chegou só pelo webhook) entram em "(sem UTM)".
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
