(function () {
  'use strict';

  var measurementId = (document.querySelector('meta[name="ga4-measurement-id"]')?.content || '').trim();
  var productionHosts = ['vanly.me', 'www.vanly.me'];
  if (!/^G-[A-Z0-9]{6,20}$/.test(measurementId) || !productionHosts.includes(window.location.hostname)) return;

  var panel = document.getElementById('privacy-panel');
  var settings = document.getElementById('privacy-settings');
  var choice = document.getElementById('privacy-choice');
  var accept = document.getElementById('privacy-accept');
  var reject = document.getElementById('privacy-reject');
  if (!panel || !settings || !choice || !accept || !reject) return;

  var consentKey = 'vanly.analytics-consent.v1';
  var consentCookie = 'vanly_analytics_consent_v1';
  var disableKey = 'ga-disable-' + measurementId;
  var consent = null;
  var tagRequested = false;
  var consentRemembered = true;
  var consentWatch = null;

  // Keep the queue local until consent. Basic consent mode loads no Google tag while denied.
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window[disableKey] = true;
  window.gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied'
  });

  function sixMonthsLater(timestamp) {
    var expiry = new Date(timestamp);
    var day = expiry.getUTCDate();
    expiry.setUTCDate(1);
    expiry.setUTCMonth(expiry.getUTCMonth() + 6);
    var lastDay = new Date(Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth() + 1, 0)).getUTCDate();
    expiry.setUTCDate(Math.min(day, lastDay));
    return expiry.getTime();
  }

  function readConsent() {
    var raw;
    try {
      var cookie = document.cookie.split(';').find(function (item) {
        return item.trim().startsWith(consentCookie + '=');
      });
      if (!cookie) return null;
      raw = decodeURIComponent(cookie.trim().slice(consentCookie.length + 1));
    } catch (_) { return null; }
    var saved;
    try { saved = JSON.parse(raw); } catch (_) { saved = null; }
    var now = Date.now();
    if (!saved || saved.version !== 1 || !['granted', 'denied'].includes(saved.analytics) ||
        !Number.isFinite(saved.savedAt) || !Number.isFinite(saved.expiresAt) ||
        saved.savedAt <= 0 || saved.savedAt > now + 300000 ||
        saved.expiresAt <= now || saved.expiresAt <= saved.savedAt ||
        saved.expiresAt > sixMonthsLater(saved.savedAt)) return null;
    return saved.analytics;
  }

  function saveConsent(value) {
    consent = value;
    var now = Date.now();
    var expiry = sixMonthsLater(now);
    var payload = JSON.stringify({ version: 1, analytics: value, savedAt: now, expiresAt: expiry });
    try {
      document.cookie = consentCookie + '=' + encodeURIComponent(payload) +
        '; Max-Age=' + Math.floor((expiry - now) / 1000) + '; expires=' + new Date(expiry).toUTCString() +
        '; Domain=vanly.me; Path=/; Secure; SameSite=Lax';
    } catch (_) { /* A blocked cookie still permits this visit's explicit choice. */ }
    consentRemembered = readConsent() === value;
    // Only a same-origin change signal. The cookie is authoritative; localStorage never restores consent.
    try { window.localStorage.setItem(consentKey, payload); } catch (_) { /* Shared cookie remains usable. */ }
  }

  function cleanReferrer() {
    try {
      var referrer = new URL(document.referrer);
      return ['http:', 'https:'].includes(referrer.protocol) ? referrer.origin : '';
    } catch (_) { return ''; }
  }

  function enableAnalytics() {
    if (tagRequested) return;
    window[disableKey] = false;
    window.gtag('consent', 'update', {
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied'
    });
    window.gtag('set', 'ads_data_redaction', true);
    window.gtag('js', new Date());
    var page = {
      page_location: window.location.origin + window.location.pathname,
      page_referrer: cleanReferrer(),
      page_title: document.title
    };
    window.gtag('config', measurementId, Object.assign({}, page, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_domain: 'vanly.me',
      cookie_path: '/',
      cookie_expires: 180 * 86400
    }));
    window.gtag('event', 'page_view', page);

    var tag = document.createElement('script');
    tag.id = 'vanly-ga4';
    tag.async = true;
    tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(measurementId);
    tag.onerror = function () { /* A blocked analytics tag must never affect the page. */ };
    tagRequested = true;
    document.head.appendChild(tag);
    if (consentWatch === null) consentWatch = window.setInterval(reconcileConsent, 1000);
  }

  function eraseAnalyticsCookies() {
    try {
      var names = document.cookie.split(';').map(function (cookie) { return cookie.split('=')[0].trim(); });
      var ownNames = names.filter(function (name) {
        return name === '_ga' || name === '_ga_' + measurementId.slice(2) ||
          name === '_gat_gtag_' + measurementId.replaceAll('-', '_');
      });
      var domains = ['', window.location.hostname, '.' + window.location.hostname, 'vanly.me', '.vanly.me'];
      ownNames.forEach(function (name) {
        domains.forEach(function (domain) {
          document.cookie = name + '=; Max-Age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' +
            (domain ? '; domain=' + domain : '') + '; SameSite=Lax';
        });
      });
    } catch (_) { /* Storage restrictions do not prevent the disable flag or page reload. */ }
  }

  function closePanel() {
    panel.hidden = true;
    settings.setAttribute('aria-expanded', 'false');
    settings.focus({ preventScroll: true });
  }

  function rejectAnalytics(persist) {
    // The documented opt-out flag must be set before notifying an already loaded tag.
    window[disableKey] = true;
    if (consentWatch !== null) {
      window.clearInterval(consentWatch);
      consentWatch = null;
    }
    if (persist) saveConsent('denied');
    else consent = 'denied';
    eraseAnalyticsCookies();
    window.gtag('consent', 'update', {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied'
    });
    closePanel();
    // Reload removes the Google library and its handlers. The saved rejection prevents reloading it.
    if (tagRequested) {
      // If cookies became unwritable, reloading an old acceptance would reactivate the tag.
      if (readConsent() !== 'granted') window.location.reload();
    }
  }

  function reconcileConsent() {
    var stored = readConsent();
    if (stored !== 'granted' && tagRequested && !window[disableKey]) {
      if (stored === null && !consentRemembered && consent === 'granted') return;
      rejectAnalytics(false);
    } else if (stored === 'granted' && !window[disableKey]) {
      consent = stored;
    } else if (stored === 'granted' && !tagRequested) {
      consent = stored;
      consentRemembered = true;
      enableAnalytics();
      panel.hidden = true;
      settings.setAttribute('aria-expanded', 'false');
    } else if (!tagRequested) {
      consent = stored;
      eraseAnalyticsCookies();
      panel.hidden = stored !== null;
      settings.setAttribute('aria-expanded', stored === null ? 'true' : 'false');
    }
  }

  settings.hidden = false;
  settings.addEventListener('click', function () {
    choice.textContent = consent === 'granted' ? 'Pomiar odwiedzin jest włączony.' :
      consent === 'denied' ? 'Pomiar odwiedzin jest wyłączony.' : '';
    if (!consentRemembered) choice.textContent += ' Przeglądarka nie pozwala zapamiętać ustawień na kolejną wizytę.';
    panel.hidden = false;
    settings.setAttribute('aria-expanded', 'true');
    document.getElementById('privacy-title').focus({ preventScroll: true });
  });
  accept.addEventListener('click', function () {
    saveConsent('granted');
    enableAnalytics();
    closePanel();
  });
  reject.addEventListener('click', function () { rejectAnalytics(true); });

  window.addEventListener('storage', function (event) {
    if (event.key !== consentKey && event.key !== null) return;
    reconcileConsent();
  });
  window.addEventListener('focus', reconcileConsent);
  window.addEventListener('pageshow', reconcileConsent);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) reconcileConsent(); });

  consent = readConsent();
  if (consent === 'granted') enableAnalytics();
  else {
    eraseAnalyticsCookies();
    if (consent === null) {
      panel.hidden = false;
      settings.setAttribute('aria-expanded', 'true');
    }
  }
}());
