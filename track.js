/*
 * track.js — tracking client-side unificado da stack.
 *
 * Carregado por TODA landing page via <script src="/track.js" async>. É o
 * único arquivo de tracking client-side — ajustes valem para todas as LPs
 * de todos os clientes, sem editar página por página.
 *
 * O que faz:
 *   1. Resolve o workspace pelo Host (GET /api/booking/tracking-config) e
 *      inicializa Meta Pixel + GA4 + Google Ads com os IDs daquele workspace.
 *   2. Dispara um PageView (pixel + /tracker).
 *   3. Expõe window.USINATRK:
 *        USINATRK.track(eventName, userData) -> Promise   dispara conversão
 *        USINATRK.fireSchedule(userData)                  atalho p/ 'Schedule'
 *        USINATRK.pageView()                              dispara PageView
 *        USINATRK.gAdsConversion(eventKey, txnId)         conversão Google Ads
 *        USINATRK.eid()                                   último event_id
 *
 * Cada evento gera seu próprio event_id, usado no pixel, no POST /tracker e
 * como transaction_id da conversão Google Ads — Meta e Google Ads deduplicam
 * browser×servidor por esse id.
 *
 * A LP só declara QUAIS eventos dispara; destinos e IDs vêm do workspace.
 */
(function () {
  'use strict';
  var CFG = {};
  var lastEvid = null;

  function uuid() {
    return (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : (Date.now() + '.' + Math.random().toString(36).slice(2));
  }
  function ck(n) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]+)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function loadScript(src) {
    var s = document.createElement('script');
    s.async = true; s.src = src;
    document.head.appendChild(s);
  }

  function initMeta(id) {
    if (!id) return;
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', id);
  }

  function initGoogle(gid, awid) {
    if (!gid && !awid) return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    gtag('js', new Date());
    // gtag servido first-party pelo proxy /scripts/gtag.js (anti-adblock).
    loadScript('/scripts/gtag.js?id=' + encodeURIComponent(gid || awid));
    if (gid) gtag('config', gid);
    if (awid) gtag('config', awid);
  }

  // Conversão Google Ads no browser. transaction_id = event_id → o Google
  // Ads deduplica contra a conversão server-side (uploadClickConversions usa
  // o mesmo valor como orderId). O label vem do mapa evento->label do
  // workspace (derivado do event_catalog), keyed em minúsculas.
  function gAdsConversion(eventKey, txnId) {
    try {
      if (!window.gtag || !CFG.google_ads_aw_id) return;
      var key = String(eventKey || '').toLowerCase();
      var map = CFG.google_ads_conversions || {};
      var label = map[key] || (key === 'schedule' ? CFG.google_ads_conversion_label : null);
      if (!label) return;
      var params = { send_to: CFG.google_ads_aw_id + '/' + label };
      if (txnId) params.transaction_id = txnId;
      gtag('event', 'conversion', params);
    } catch (e) {}
  }

  // POST ao /tracker (Meta CAPI + GA4 + Google Ads server-side). O workspace
  // é resolvido pelo Host no servidor — não depende de CFG. Retorna a Promise
  // do fetch para quem quiser aguardar a confirmação.
  function postTracker(eventName, evid, userData) {
    return fetch('/tracker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: evid,
        event_source_url: location.href,
        consent_status: 'granted',
        user_data: {
          em: userData.em || userData.email || '',
          ph: userData.ph || userData.phone || '',
          fn: userData.fn || '',
          ln: userData.ln || '',
          fbp: ck('_fbp'),
          fbc: ck('_fbc'),
          ga_client_id: (ck('_ga') || '').split('.').slice(-2).join('.')
        }
      })
    });
  }

  // Dispara um evento de conversão em todos os canais com um event_id único.
  // Retorna a Promise do POST /tracker.
  function track(eventName, userData) {
    userData = userData || {};
    var evid = uuid();
    lastEvid = evid;
    try { if (window.fbq) fbq('track', eventName, {}, { eventID: evid }); } catch (e) {}
    gAdsConversion(eventName, evid);
    return postTracker(eventName, evid, userData);
  }

  // PageView: pixel + /tracker. O /tracker não grava PageView no event_log
  // (D1 enxuto); o GA4 recebe o page_view pelo gtag config.
  function pageView() {
    var evid = uuid();
    try { if (window.fbq) fbq('track', 'PageView', {}, { eventID: evid }); } catch (e) {}
    postTracker('PageView', evid, {}).catch(function () {});
  }

  function init() {
    fetch('/api/booking/tracking-config')
      .then(function (r) { return r.json(); })
      .then(function (c) {
        CFG = c || {};
        initMeta(CFG.meta_pixel_id);
        initGoogle(CFG.ga4_measurement_id, CFG.google_ads_aw_id);
        pageView();
      })
      .catch(function () {});
  }
  init();

  window.USINATRK = {
    track: track,
    fireSchedule: function (d) { return track('Schedule', d || {}).catch(function () {}); },
    gAdsConversion: gAdsConversion,
    pageView: pageView,
    eid: function () { return lastEvid; }
  };
})();
