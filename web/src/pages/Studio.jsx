import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Alert } from '../components/AuthCard.jsx';

// Estúdio de Vídeo (E1): base do cliente + voz, e para cada vídeo:
// roteiro → embalagem (título + capa) → SEO/legenda com link rastreado.

const STATUS = { ideia: 'Ideia', roteiro: 'Roteiro', embalagem: 'Embalagem', pronto: 'Pronto', publicado: 'Publicado' };
const PLATFORM = { youtube: 'YouTube', instagram: 'Instagram', both: 'YouTube + Instagram' };
const FORMAT = { long: 'Longo', short: 'Curto (Shorts/Reels)' };
const when = (u) => (u ? new Date(u * 1000).toLocaleDateString('pt-BR') : '');

function Copy({ text, label = 'Copiar' }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="btn-secondary px-3 py-1.5 text-xs"
      onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}>
      {ok ? 'Copiado' : label}
    </button>
  );
}

export default function Studio() {
  const { workspaces } = useAuth();
  const [params, setParams] = useSearchParams();
  const wsId = params.get('workspace') || workspaces[0]?.id || '';
  const videoId = params.get('video');
  const [tab, setTab] = useState('videos');
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState(null);

  async function load() {
    if (!wsId) return;
    try { setData(await api('GET', `/portal/studio?workspace=${encodeURIComponent(wsId)}`)); }
    catch (e) { setMsg({ kind: 'error', text: e.message }); }
  }
  useEffect(() => { setData(null); setMsg(null); load(); }, [wsId]);

  if (!workspaces.length) {
    return <div className="card p-10 text-center text-sm text-muted">Nenhum workspace liberado para o seu usuário.</div>;
  }
  const openVideo = (id) => setParams(id ? { workspace: wsId, video: id } : { workspace: wsId });

  if (videoId && data) {
    return <VideoView id={videoId} canManage={data.can_manage} usage={data.usage} onBack={() => { openVideo(null); load(); }} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-navy">Estúdio de Vídeo</h1>
          <p className="mt-1 text-sm text-muted">Roteiro, título, capa e descrição na voz do cliente — com link que mostra quais vídeos trazem leads.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {workspaces.length > 1 && (
            <select className="input w-auto" value={wsId} onChange={(e) => setParams({ workspace: e.target.value })}>
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.tenant_name} — {w.name}</option>)}
            </select>
          )}
          <div className="flex rounded-lg border border-line bg-white p-0.5 text-sm">
            {[['videos', 'Vídeos'], ['base', 'Base e voz']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                className={`rounded-md px-3 py-1.5 ${tab === k ? 'bg-navy text-white' : 'text-muted hover:text-navy'}`}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {msg && <Alert kind={msg.kind === 'ok' ? 'ok' : 'error'}>{msg.text}</Alert>}
      {data && !data.ai_ready && <Alert>A IA ainda não foi ligada na plataforma. A Usina precisa cadastrar a chave do Claude.</Alert>}

      {!data ? (
        !msg && <div className="card p-10 text-center text-sm text-muted">Carregando…</div>
      ) : tab === 'base' ? (
        <BaseVoice wsId={wsId} data={data} onSaved={() => { setMsg({ kind: 'ok', text: 'Base e voz salvas.' }); load(); }} />
      ) : (
        <Videos wsId={wsId} data={data} onOpen={openVideo} onNeedBase={() => setTab('base')} />
      )}
    </div>
  );
}

function Videos({ wsId, data, onOpen, onNeedBase }) {
  const [f, setF] = useState({ topic: '', platform: 'youtube', format: 'long', notes: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const hasBase = Object.keys(data.profile.knowledge || {}).length > 0;
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api('POST', '/portal/studio/videos', { ...f, workspace_id: wsId });
      onOpen(r.id);
    } catch (ex) { setErr(ex.message); setBusy(false); }
  }

  return (
    <div className="space-y-6">
      {!hasBase && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-5 text-sm">
          <p className="text-navy">Antes do primeiro roteiro, preencha a <b>base de conhecimento</b> do cliente. A IA só usa fatos que estão lá.</p>
          <button type="button" className="btn-primary" onClick={onNeedBase}>Preencher base</button>
        </div>
      )}
      {data.can_manage && (
        <form onSubmit={create} className="card grid gap-3 p-5 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
          {err && <div className="sm:col-span-4"><Alert>{err}</Alert></div>}
          <div>
            <label className="label">Novo vídeo — tema</label>
            <input className="input" value={f.topic} onChange={set('topic')} placeholder="Ex.: 3 erros que travam a venda de imóveis na planta" />
          </div>
          <div>
            <label className="label">Plataforma</label>
            <select className="input" value={f.platform} onChange={set('platform')}>
              {Object.entries(PLATFORM).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Formato</label>
            <select className="input" value={f.format} onChange={set('format')}>
              {Object.entries(FORMAT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-primary" disabled={busy || !f.topic.trim()}>Criar</button>
          <div className="sm:col-span-4">
            <input className="input" value={f.notes} onChange={set('notes')} placeholder="Observações (opcional): ângulo, exemplo a usar, o que evitar…" />
          </div>
        </form>
      )}

      <section className="card">
        <div className="flex items-center justify-between p-5">
          <h2 className="font-semibold text-navy">Vídeos</h2>
          <p className="text-xs text-muted">IA hoje: {data.usage.used} de {data.usage.limit} gerações</p>
        </div>
        {data.videos.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted">Nenhum vídeo ainda.</p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {data.videos.map((v) => (
              <li key={v.id}>
                <button type="button" onClick={() => onOpen(v.id)} className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3 text-left text-sm hover:bg-paper">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-navy">{v.topic}</p>
                    <p className="text-xs text-muted">{PLATFORM[v.platform]} · {FORMAT[v.format]} · {when(v.updated_at)}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    {v.clicks > 0 && <span className="text-muted">{v.clicks} clique(s) no link</span>}
                    <span className="rounded bg-paper px-2 py-0.5 text-navy">{STATUS[v.status] || v.status}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function BaseVoice({ wsId, data, onSaved }) {
  const [k, setK] = useState({ ...data.profile.knowledge });
  const [voice, setVoice] = useState(data.profile.voice);
  const [cta, setCta] = useState(data.profile.cta_url);
  const [samples, setSamples] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const can = data.can_manage;

  async function save() {
    setBusy('save');
    setErr(null);
    try {
      await api('PUT', '/portal/studio/profile', { workspace_id: wsId, knowledge: k, voice, cta_url: cta });
      onSaved();
    } catch (e) { setErr(e.message); }
    setBusy(null);
  }
  async function buildVoice() {
    setBusy('voice');
    setErr(null);
    try {
      const parts = samples.split(/\n-{3,}\n/).map((s) => s.trim()).filter(Boolean);
      const r = await api('POST', '/portal/studio/voice', { workspace_id: wsId, samples: parts });
      setVoice(r.voice);
    } catch (e) { setErr(e.message); }
    setBusy(null);
  }

  return (
    <div className="space-y-6">
      {err && <Alert>{err}</Alert>}
      <section className="card space-y-4 p-6">
        <div>
          <h2 className="font-semibold text-navy">Base de conhecimento</h2>
          <p className="text-sm text-muted">A única fonte de fatos do roteirista. Número, resultado ou depoimento que não estiver aqui não entra no vídeo.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {Object.entries(data.fields).map(([key, label]) => (
            <div key={key}>
              <label className="label">{label}</label>
              <textarea className="input min-h-24" value={k[key] || ''} disabled={!can}
                onChange={(e) => setK((s) => ({ ...s, [key]: e.target.value }))}
                placeholder={key === 'numbers' ? 'Ex.: 1.200 alunos desde 2019; garantia de 7 dias' : ''} />
            </div>
          ))}
          <div className="sm:col-span-2">
            <label className="label">Página de destino dos vídeos</label>
            <input className="input" value={cta} onChange={(e) => setCta(e.target.value)} disabled={!can} placeholder="https://site-do-cliente.com.br/oferta" />
            <p className="mt-1 text-xs text-muted">O link de cada vídeo leva para cá com a origem marcada. Use uma página que tenha o tracking instalado.</p>
          </div>
        </div>
      </section>

      <section className="card space-y-4 p-6">
        <div>
          <h2 className="font-semibold text-navy">Voz do cliente</h2>
          <p className="text-sm text-muted">Como ele fala. Cole 1 a 3 transcrições ou textos dele e a IA monta o perfil; revise antes de salvar.</p>
        </div>
        {can && (
          <div className="space-y-2">
            <textarea className="input min-h-32" value={samples} onChange={(e) => setSamples(e.target.value)}
              placeholder={'Cole aqui a transcrição de um vídeo do cliente.\n\nPara mais de um, separe com uma linha contendo só ---'} />
            <div className="flex justify-end">
              <button type="button" className="btn-secondary" disabled={!!busy || samples.trim().length < 200} onClick={buildVoice}>
                {busy === 'voice' ? 'Analisando…' : 'Gerar perfil de voz'}
              </button>
            </div>
          </div>
        )}
        <textarea className="input min-h-48" value={voice} onChange={(e) => setVoice(e.target.value)} disabled={!can}
          placeholder="Tom, ritmo, expressões típicas, como abre e fecha, o que nunca faria…" />
      </section>

      {can && (
        <div className="flex justify-end">
          <button type="button" className="btn-primary" disabled={!!busy} onClick={save}>{busy === 'save' ? 'Salvando…' : 'Salvar base e voz'}</button>
        </div>
      )}
    </div>
  );
}

function VideoView({ id, canManage, usage, onBack }) {
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(null);
  const [instr, setInstr] = useState({ script: '', package: '', seo: '' });
  const [finalText, setFinalText] = useState('');

  async function load() {
    try {
      const r = await api('GET', `/portal/studio/videos/${id}`);
      setD(r);
      setFinalText(r.video.final_script || '');
    } catch (e) { setMsg({ kind: 'error', text: e.message }); }
  }
  useEffect(() => { load(); }, [id]);

  async function run(fn, okText) {
    setMsg(null);
    try { await fn(); if (okText) setMsg({ kind: 'ok', text: okText }); await load(); }
    catch (e) { setMsg({ kind: 'error', text: e.message }); }
    setBusy(null);
  }
  const generate = (step) => {
    setBusy(step);
    run(() => api('POST', `/portal/studio/videos/${id}/generate`, { step, instructions: instr[step] }),
      { script: 'Roteiro gerado.', package: 'Títulos e capas gerados.', seo: 'Descrição e legenda geradas.' }[step]);
  };
  const patch = (body, ok) => run(() => api('PATCH', `/portal/studio/videos/${id}`, body), ok);
  const remove = () => window.confirm('Apagar este vídeo?') && run(async () => { await api('DELETE', `/portal/studio/videos/${id}`); onBack(); });

  if (!d) return <div className="card p-10 text-center text-sm text-muted">{msg?.text || 'Carregando…'}</div>;
  const v = d.video;
  const s = v.script;
  const pkg = v.package;
  const seo = v.seo;
  const genBtn = (step, label) => canManage && (
    <div className="flex flex-wrap items-center gap-2">
      <input className="input min-w-[220px] flex-1" value={instr[step]} onChange={(e) => setInstr((x) => ({ ...x, [step]: e.target.value }))}
        placeholder="Ajuste para a IA (opcional): mais curto, outro ângulo…" />
      <button type="button" className="btn-primary" disabled={!!busy} onClick={() => generate(step)}>
        {busy === step ? 'Gerando… (até 1 min)' : label}
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <button type="button" className="text-sm text-muted hover:text-navy" onClick={onBack}>← Vídeos</button>
          <h1 className="mt-1 text-2xl font-semibold text-navy">{v.topic}</h1>
          <p className="text-sm text-muted">{PLATFORM[v.platform]} · {FORMAT[v.format]} · IA hoje {usage.used}/{usage.limit}</p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <select className="input w-auto" value={v.status} onChange={(e) => patch({ status: e.target.value })}>
              {Object.entries(STATUS).map(([k2, l]) => <option key={k2} value={k2}>{l}</option>)}
            </select>
            <button type="button" className="text-xs text-muted hover:text-coral" onClick={remove}>Apagar</button>
          </div>
        )}
      </div>

      {msg && <Alert kind={msg.kind === 'ok' ? 'ok' : 'error'}>{msg.text}</Alert>}

      {/* 1. Roteiro */}
      <section className="card space-y-4 p-6">
        <h2 className="font-semibold text-navy">1. Roteiro</h2>
        {s ? (
          <>
            <div>
              <p className="label">Ganchos (escolha um)</p>
              <ul className="space-y-2">
                {s.hooks.map((h, i) => (
                  <li key={i}>
                    <button type="button" disabled={!canManage} onClick={() => patch({ chosen_hook: i }, 'Gancho trocado; o texto final foi refeito.')}
                      className={`w-full rounded-xl border p-3 text-left text-sm ${s.chosen_hook === i ? 'border-coral bg-coral/5' : 'border-line hover:border-amber'}`}>
                      <p className="text-navy">{h.text}</p>
                      <p className="mt-1 text-xs text-muted">
                        <b>{h.score}/10</b> · {h.formula}{s.recommended_hooks?.includes(i) ? ' · recomendado' : ''} — {h.why}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {s.pending_facts?.length > 0 && (
              <Alert>Dados a confirmar antes de gravar: {s.pending_facts.join('; ')}</Alert>
            )}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="label mb-0">Texto final para gravar (~{Math.round((s.total_seconds || 0) / 60 * 10) / 10} min)</p>
                <Copy text={finalText} />
              </div>
              <textarea className="input min-h-72 font-mono text-xs" value={finalText} disabled={!canManage} onChange={(e) => setFinalText(e.target.value)} />
              {canManage && finalText !== (v.final_script || '') && (
                <div className="mt-2 flex justify-end">
                  <button type="button" className="btn-secondary" onClick={() => patch({ final_script: finalText }, 'Texto salvo.')}>Salvar texto</button>
                </div>
              )}
            </div>
          </>
        ) : <p className="text-sm text-muted">5 ganchos com nota, a virada, o corpo em batidas (fala + o que aparece na tela) e um único pedido.</p>}
        {genBtn('script', s ? 'Gerar de novo' : 'Gerar roteiro')}
      </section>

      {/* 2. Embalagem */}
      <section className="card space-y-4 p-6">
        <h2 className="font-semibold text-navy">2. Título e capa</h2>
        {pkg ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {pkg.pairs.map((p, i) => (
              <li key={i}>
                <button type="button" disabled={!canManage} onClick={() => patch({ chosen_pair: i })}
                  className={`h-full w-full rounded-xl border p-4 text-left text-sm ${pkg.chosen === i ? 'border-coral bg-coral/5' : 'border-line hover:border-amber'}`}>
                  <p className="font-semibold text-navy">{p.title}</p>
                  <p className="mt-2 inline-block rounded bg-navy px-2 py-1 text-xs font-bold uppercase text-white">{p.thumb_text}</p>
                  <p className="mt-2 text-xs text-muted">Capa: {p.thumb_visual}</p>
                  <p className="mt-1 text-xs text-muted"><b>{p.score}/10</b>{pkg.recommended === i ? ' · recomendado' : ''} — {p.why}</p>
                  {p.warnings?.length > 0 && <p className="mt-1 text-xs text-coral">⚠ {p.warnings.join(' · ')}</p>}
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">5 pares de título + texto da capa pensados juntos, com checagem de tamanho e repetição.</p>}
        {s ? genBtn('package', pkg ? 'Gerar de novo' : 'Gerar títulos e capas') : <p className="text-xs text-muted">Gere o roteiro primeiro.</p>}
      </section>

      {/* 3. SEO e legenda */}
      <section className="card space-y-4 p-6">
        <h2 className="font-semibold text-navy">3. Descrição, tags e legenda</h2>
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-paper p-3 text-xs">
          <span className="text-muted">Link rastreado:</span>
          <code className="text-navy">{d.links.youtube}</code><Copy text={d.links.youtube} />
          <code className="text-navy">{d.links.instagram}</code><Copy text={d.links.instagram} label="Copiar (Instagram)" />
          {v.clicks > 0 && <span className="text-muted">· {v.clicks} clique(s)</span>}
        </div>
        {seo ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between"><p className="label mb-0">YouTube — descrição</p><Copy text={seo.youtube.description} /></div>
              <textarea className="input min-h-48 text-xs" readOnly value={seo.youtube.description} />
              <div className="flex items-center justify-between"><p className="label mb-0">Tags</p><Copy text={seo.youtube.tags.join(', ')} /></div>
              <p className="text-xs text-navy">{seo.youtube.tags.join(', ')}</p>
              <p className="text-xs text-muted">Buscas-alvo: {seo.youtube.target_searches.join(' · ')}</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between"><p className="label mb-0">Instagram — legenda</p>
                <Copy text={`${seo.instagram.caption}\n\n${seo.instagram.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}`} /></div>
              <textarea className="input min-h-48 text-xs" readOnly
                value={`${seo.instagram.caption}\n\n${seo.instagram.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}`} />
              <p className="text-xs text-muted">No Instagram, coloque o link de Instagram acima na bio (ou no link da história).</p>
            </div>
          </div>
        ) : <p className="text-sm text-muted">Descrição com o link rastreado no topo, tags que valem, 3 buscas-alvo e a legenda do Instagram.</p>}
        {s ? genBtn('seo', seo ? 'Gerar de novo' : 'Gerar descrição e legenda') : <p className="text-xs text-muted">Gere o roteiro primeiro.</p>}
      </section>
    </div>
  );
}
