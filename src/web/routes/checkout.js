const { Router } = require('express');
const tokens = require('../../tokens');
const playerLinks = require('../../store/repository');
const { createCheckout } = require('../../fastspring/sessions');

const router = Router();

/**
 * GET /checkout/:token
 *
 * The destination of every /store BUY button. Creates the FastSpring session on
 * CLICK, then serves a page that renders the EMBEDDED checkout for that session.
 *
 * Why not just redirect to the session's webcheckoutUrl? That URL is FastSpring's
 * HOSTED checkout page — it takes the buyer off to onfastspring.com. To keep the
 * embedded (inline) checkout experience while still setting tags + purchaser
 * server-side, we create the session via the API, then load it into the Store
 * Builder Library with `fastspring.builder.checkout(sessionId)`. On an EMBEDDED
 * storefront that renders inline in #fsc-embedded-checkout-container.
 *
 * The token is a signed payload (see tokens.js) holding the productPath + the
 * buyer's Discord identity, minted in commands/store.js — so nothing sensitive
 * rides in the URL and it can't be tampered with.
 */
router.get('/:token', async (req, res) => {
  const claims = tokens.verify(req.params.token);
  if (!claims?.discordUserId || !claims?.productPath) {
    return res.status(400).send('This buy link is invalid or has expired. Run /store in Discord again.');
  }

  const link = playerLinks.getByDiscordId(claims.discordUserId);
  if (!link || (!link.email && !link.fsAccountId)) {
    // Buttons only point here once a player is connected; guard anyway.
    return res.status(409).send('Your account isn\'t connected yet. Run /store in Discord and choose "Connect account".');
  }

  try {
    const { id: sessionId } = await createCheckout({
      productPath: claims.productPath,
      // Prefer the linked FastSpring account (returning buyer); otherwise use
      // the email captured via OAuth (first purchase).
      accountId: link.fsAccountId || undefined,
      contact: link.email ? { email: link.email } : undefined,
      tags: {
        discordUserId: claims.discordUserId,
        discordUsername: claims.discordUsername || '',
      },
    });
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(embeddedCheckoutPage(sblStorefront(), sessionId));
  } catch (err) {
    console.error('[Checkout] Failed to create session:', err.response?.data || err.message);
    return res.status(502).send("We couldn't open checkout right now. Please try again from /store in a moment.");
  }
});

/**
 * The SBL `data-storefront` value: "<account>.onfastspring.com/<path>".
 * Prefer an explicit FS_SBL_STOREFRONT; otherwise derive it from
 * FS_STOREFRONT_PATH ("<account>/<path>") used for the Sessions API.
 */
function sblStorefront() {
  if (process.env.FS_SBL_STOREFRONT) return process.env.FS_SBL_STOREFRONT;
  const p = process.env.FS_STOREFRONT_PATH || '';
  const slash = p.indexOf('/');
  if (slash === -1) return p;
  return `${p.slice(0, slash)}.onfastspring.com/${p.slice(slash + 1)}`;
}

/**
 * The embedded-checkout page. Loads the Store Builder Library for the embedded
 * storefront and, once ready, calls checkout(sessionId) to render the session's
 * checkout inline. The session already carries the product, tags and purchaser
 * (set server-side), so nothing sensitive is in this page.
 */
function embeddedCheckoutPage(storefront, sessionId) {
  const sf = String(storefront).replace(/"/g, '&quot;');
  const sid = String(sessionId).replace(/[^A-Za-z0-9]/g, '');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Complete your purchase — Eggblast Arena</title>
  <script
    id="fsc-api"
    src="https://sbl.onfastspring.com/sbl/1.0.9/fastspring-builder.min.js"
    type="text/javascript"
    data-storefront="${sf}"
    data-error-callback="fscError">
  </script>
  <style>
    :root{--bg:#ffffff;--ink:#1c1c28;--muted:#6b6b7b;--accent:#8a2be2}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
    .wrap{max-width:640px;margin:0 auto;padding:28px 16px 60px;text-align:center}
    .logo{width:200px;max-width:60%;height:auto;margin:0 auto 24px;display:block}
    /* The embedded checkout renders left-aligned inside this centered wrapper. */
    #fsc-embedded-checkout-container{min-height:520px;text-align:left}
    #msg{color:var(--muted);font-size:.9rem;margin-top:12px}
  </style>
</head>
<body>
  <div class="wrap">
    <img class="logo" src="/assets/eggblast-logo.png" alt="Eggblast Arena" />
    <div id="fsc-embedded-checkout-container"></div>
    <p id="msg">Loading your checkout…</p>
  </div>
  <script>
    var SESSION_ID = ${JSON.stringify(sid)};
    window.fscError = function (err) {
      console.error('[SBL error]', err);
      document.getElementById('msg').textContent =
        'We couldn\\'t load the checkout. This storefront may not allow this domain yet — see the console.';
    };
    (function waitForSbl(tries) {
      if (window.fastspring && window.fastspring.builder) {
        try {
          window.fastspring.builder.checkout(SESSION_ID); // renders inline on an embedded storefront
          document.getElementById('msg').textContent = '';
        } catch (e) { window.fscError(e); }
        return;
      }
      if (tries <= 0) { window.fscError('SBL did not initialize'); return; }
      setTimeout(function () { waitForSbl(tries - 1); }, 300);
    })(20);
  </script>
</body>
</html>`;
}

module.exports = router;
module.exports.embeddedCheckoutPage = embeddedCheckoutPage;
module.exports.sblStorefront = sblStorefront;
