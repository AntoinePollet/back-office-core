// Ce que le faux service répond à la place de Cloudflare : API GraphQL Analytics (mesure d'audience)
// et Turnstile (anti-robots : script de la page et vérification Siteverify).

/** Identifiants de site qui changent la réponse des statistiques. Tout autre identifiant reçoit des données d'exemple. */
export const SITE_EMPTY = '00000000000000000000000000000000'
export const SITE_DOWN = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
/** Jeton d'API refusé par le faux Cloudflare. */
export const TOKEN_REFUSED = 'jeton-refuse'

/** Pages vues d'un jour d'exemple : des chiffres réguliers, faciles à vérifier dans les tests (10, 11, 12…). */
export const sampleDay = i => ({ pageViews: 10 + i, visits: 4 + (i % 3) })
export const SAMPLE_PAGES = [['/', 120], ['/services/conseil', 64], ['/contact', 31], ['/actualites/ouverture', 12]]
export const SAMPLE_REFERRERS = [['', 40], ['www.google.com', 25], ['www.linkedin.com', 6], ['cabinet-durand.fr', 0]]

const DAY = 86_400_000

/**
 * Réponse à la requête des statistiques. Les jours sont calculés d'après les bornes reçues : le i-ème jour
 * de la période vaut `sampleDay(i)`. Comme le vrai Cloudflare, une erreur d'authentification répond 200 avec `errors`.
 */
export function cloudflareGraphql(authorization, body) {
  if (authorization === `Bearer ${TOKEN_REFUSED}`) {
    return { status: 200, json: { data: null, errors: [{ message: 'Authentication error', path: ['viewer'], extensions: { code: 'authz' } }] } }
  }
  const v = body?.variables ?? {}
  if (v.siteTag === SITE_DOWN) return { status: 503, json: { errors: [{ message: 'service temporarily unavailable' }] } }
  if (v.siteTag === SITE_EMPTY) return { status: 200, json: { data: { viewer: { accounts: [{ total: [], days: [], pages: [], referrers: [] }] } }, errors: null } }
  const start = Date.parse(v.start), end = Date.parse(v.end)
  const days = []
  for (let t = start, i = 0; t < end; t += DAY, i++) {
    const d = sampleDay(i)
    days.push({ count: d.pageViews, sum: { visits: d.visits }, dimensions: { date: new Date(t).toISOString().slice(0, 10) } })
  }
  const total = days.reduce((a, d) => ({ count: a.count + d.count, sum: { visits: a.sum.visits + d.sum.visits } }), { count: 0, sum: { visits: 0 } })
  return {
    status: 200,
    json: {
      data: { viewer: { accounts: [{
        total: [total],
        days,
        pages: SAMPLE_PAGES.map(([requestPath, count]) => ({ count, dimensions: { requestPath } })),
        referrers: SAMPLE_REFERRERS.map(([refererHost, visits]) => ({ sum: { visits }, dimensions: { refererHost } })),
      }] } },
      errors: null,
    },
  }
}

/** Jeton produit par les clés de test officielles de Turnstile (et par le faux script ci-dessous). */
export const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'
export const SECRET_REFUSED = 'mauvaise-cle-secrete'

/**
 * Siteverify, avec le comportement documenté des clés secrètes de test :
 * 1x…AA réussit (jeton factice seulement), 2x…AA échoue toujours, 3x…AA répond « jeton déjà utilisé ».
 * Une clé secrète inconnue (SECRET_REFUSED) est refusée comme telle.
 */
export function siteverify(body) {
  const secret = body?.secret, token = body?.response
  const fail = code => ({ 'success': false, 'error-codes': [code] })
  if (!secret) return fail('missing-input-secret')
  if (secret === SECRET_REFUSED) return fail('invalid-input-secret')
  if (!token) return fail('missing-input-response')
  if (secret.startsWith('2x')) return fail('invalid-input-response')
  if (secret.startsWith('3x')) return fail('timeout-or-duplicate')
  if (token !== DUMMY_TOKEN) return fail('invalid-input-response')
  return { 'success': true, 'challenge_ts': new Date().toISOString(), 'hostname': 'example.com', 'error-codes': [] }
}

/**
 * Faux script Turnstile, servi à la place de https://challenges.cloudflare.com/turnstile/v0/api.js :
 * même API (render, reset, remove). Une clé du site qui commence par « 2x » échoue (comme la clé de test officielle),
 * toute autre donne le jeton factice. `turnstile.__expire()` simule l'expiration du jeton (cinq minutes en vrai).
 * Compteurs pour les tests : window.__turnstileRenders, window.__turnstileResets.
 */
export const TURNSTILE_SCRIPT = `(function () {
  var n = 0, widgets = {};
  function issue(w) {
    setTimeout(function () {
      if (!widgets[w.id]) return;
      if (String(w.o.sitekey).indexOf('2x') === 0) { w.box.textContent = 'Échec de la vérification (simulé)'; if (w.o['error-callback']) w.o['error-callback']('300030'); return; }
      w.box.textContent = 'Vous êtes un humain (vérification simulée)';
      if (w.o.callback) w.o.callback('${DUMMY_TOKEN}');
    }, 150);
  }
  window.turnstile = {
    render: function (el, o) {
      var id = 'faux-' + (++n);
      var box = document.createElement('div');
      box.className = 'faux-turnstile';
      box.style.cssText = 'border:1px solid #ccc;border-radius:6px;padding:14px 16px;font:14px sans-serif;background:#fafafa;max-width:300px';
      box.textContent = 'Vérification en cours…';
      el.appendChild(box);
      widgets[id] = { id: id, o: o, box: box };
      window.__turnstileRenders = (window.__turnstileRenders || 0) + 1;
      issue(widgets[id]);
      return id;
    },
    reset: function (id) { var w = widgets[id]; if (!w) return; window.__turnstileResets = (window.__turnstileResets || 0) + 1; w.box.textContent = 'Vérification en cours…'; issue(w); },
    remove: function (id) { var w = widgets[id]; if (w) { w.box.remove(); delete widgets[id]; } },
    __expire: function () { for (var k in widgets) { var w = widgets[k]; w.box.textContent = 'Expiré'; if (w.o['expired-callback']) w.o['expired-callback'](); issue(w); } }
  };
})();`
