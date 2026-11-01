import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { TextField, SecretField, Section, CopyField } from '../components/Fields.jsx';
import { Alert } from '../components/AuthCard.jsx';

// Integrações que o próprio cliente configura (owner/manager). IDs de conta
// de anúncio, Google Ads e presets do dashboard ficam com a Usina.
export default function Integrations() {
  const { workspaces } = useAuth();
  const [wsId, setWsId] = useState(workspaces[0]?.id || '');
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [clear, setClear] = useState({});
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load(id) {
    if (!id) return;
    setData(null);
    setMsg(null);
    try {
      const d = await api('GET', `/portal/workspaces/${encodeURIComponent(id)}/integrations`);
      setData(d);
      setForm({ ...d.config });
      setClear({});
    } catch (e) {
      setMsg({ kind: 'error', text: e.message });
    }
  }

  useEffect(() => { load(wsId); }, [wsId]);

  if (!workspaces.length) {
    return <div className="card p-10 text-center text-sm text-muted">Nenhum workspace liberado para o seu usuário.</div>;
  }

  const secrets = data?.secrets || {};
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k, label, extra = {}) => (
    <TextField key={k} label={label} value={form[k]} onChange={set(k)} {...extra} />
  );
  const secret = (k, label, extra = {}) => (
    <SecretField key={k} label={label} saved={secrets[k]} value={form[k]}
      onChange={set(k)} clear={clear[k]} onClear={(c) => setClear((s) => ({ ...s, [k]: c }))} {...extra} />
  );

  async function onSave(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const config = {};
    for (const [k, v] of Object.entries(form)) {
      if (k.endsWith('_webhook_slug')) continue;
      const isSecret = k in secrets;
      if (isSecret && !String(v ?? '').trim()) continue; // em branco mantém
      config[k] = v === '' ? null : v;
    }
    const clear_secrets = Object.keys(clear).filter((k) => clear[k]);
    try {
      await api('PATCH', `/portal/workspaces/${encodeURIComponent(wsId)}/integrations`, { config, clear_secrets });
      setMsg({ kind: 'ok', text: 'Integrações salvas.' });
      await load(wsId);
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    }
    setBusy(false);
  }

  const origin = window.location.origin;
  const hook = (platform, slug) => (slug ? `${origin}/webhook/${platform}/${slug}` : null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-navy">Integrações</h1>
          <p className="mt-1 text-sm text-muted">Credenciais ficam cifradas e nunca voltam para a tela depois de salvas.</p>
        </div>
        {workspaces.length > 1 && (
          <select className="input w-auto" value={wsId} onChange={(e) => setWsId(e.target.value)}>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}
      </div>

      {msg && <Alert kind={msg.kind === 'ok' ? 'ok' : 'error'}>{msg.text}</Alert>}
      {!data ? (
        <div className="card p-10 text-center text-sm text-muted">Carregando…</div>
      ) : (
        <form onSubmit={onSave} className="space-y-6">
          <Section title="Meta — Pixel e API de Conversões" description="Eventos do site enviados direto do servidor para o seu pixel.">
            {text('meta_pixel_id', 'Pixel ID', { mono: true })}
            {secret('meta_access_token', 'Token da API de Conversões', { help: 'Gerenciador de Eventos → Pixel → Configurações → API de Conversões.' })}
            {text('meta_test_event_code', 'Código de teste (opcional)', { mono: true })}
          </Section>

          <Section title="Google Analytics 4" description="Os dois campos são necessários para enviar conversões ao GA4.">
            {text('ga4_measurement_id', 'Measurement ID', { mono: true, placeholder: 'G-XXXXXXXXXX' })}
            {secret('ga4_api_secret', 'API Secret')}
          </Section>

          <Section title="Kommo CRM" description="Cada lead das suas páginas vira contato + negócio no Kommo. O mapeamento do funil é ajustado pela Usina.">
            {text('kommo_subdomain', 'Subdomínio', { mono: true, help: 'A parte antes de .kommo.com' })}
            {secret('kommo_long_lived_token', 'Token de longa duração')}
            {secret('kommo_integration_id', 'ID da integração')}
            {secret('kommo_secret_key', 'Chave secreta')}
            {hook('kommo', form.kommo_webhook_slug) && (
              <CopyField label="Webhook para cadastrar no Kommo" value={hook('kommo', form.kommo_webhook_slug)}
                help="Kommo → Configurações → Integrações → Webhooks. Evento: lead mudou de etapa." />
            )}
          </Section>

          <Section title="Plataformas de venda" description="Cadastre a URL na plataforma e preencha o segredo para recusarmos avisos falsos.">
            {hook('hotmart', form.hotmart_webhook_slug)
              ? <CopyField label="URL — Hotmart" value={hook('hotmart', form.hotmart_webhook_slug)} />
              : <p className="text-sm text-muted sm:col-span-2">Salve uma vez para gerar as URLs de webhook.</p>}
            {hook('kiwify', form.kiwify_webhook_slug) && <CopyField label="URL — Kiwify" value={hook('kiwify', form.kiwify_webhook_slug)} />}
            {hook('eduzz', form.eduzz_webhook_slug) && <CopyField label="URL — Eduzz" value={hook('eduzz', form.eduzz_webhook_slug)} />}
            {secret('hotmart_hottok', 'Hotmart — Hottok')}
            {secret('kiwify_webhook_token', 'Kiwify — token do webhook')}
            {secret('eduzz_webhook_secret', 'Eduzz — segredo do webhook')}
          </Section>

          <Section title="Automação" description="Opcional: envio de compradores para ferramentas de e-mail e WhatsApp.">
            {secret('encharge_api_key', 'Encharge — API key')}
            {secret('manychat_key', 'ManyChat — chave')}
          </Section>

          <Section title="Regional">
            {text('default_country_code', 'DDI padrão', { mono: true, placeholder: '55' })}
            {text('timezone_offset', 'Fuso horário', { mono: true, placeholder: '-03:00' })}
          </Section>

          <div className="flex justify-end">
            <button type="submit" disabled={busy} className="btn-primary">{busy ? 'Salvando…' : 'Salvar integrações'}</button>
          </div>
        </form>
      )}
    </div>
  );
}
