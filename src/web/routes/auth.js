const { Router } = require('express');
const tokens = require('../../tokens');
const oauth = require('../../discord-oauth');
const playerLinks = require('../../store/repository');

const router = Router();

/**
 * GET /auth/discord?state=<signed token containing discordUserId>
 *
 * Entry point for the one-time "Connect account" button in /store. The state
 * token is minted by commands/store.js; we verify it and hand the buyer to
 * Discord's consent screen.
 */
router.get('/discord', (req, res) => {
  const claims = tokens.verify(req.query.state);
  if (!claims?.discordUserId) {
    return res.status(400).send(page('Link expired', 'This connect link is invalid or has expired. Run <b>/store</b> in Discord again.'));
  }
  res.redirect(oauth.authorizeUrl(req.query.state));
});

/**
 * GET /auth/discord/callback?code=...&state=...
 *
 * Discord redirects here after consent. We verify state, exchange the code for
 * the buyer's VERIFIED email, and persist the Discord↔email link. From then on,
 * /store creates sessions for this player with no more prompts.
 */
router.get('/discord/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    return res.status(400).send(page('Cancelled', 'Authorization was cancelled. You can close this tab and try again from /store.'));
  }

  const claims = tokens.verify(state);
  if (!code || !claims?.discordUserId) {
    return res.status(400).send(page('Link expired', 'This connect link is invalid or has expired. Run <b>/store</b> in Discord again.'));
  }

  try {
    const user = await oauth.exchangeCodeForUser(code);

    // The person who consented must be the one who ran /store — otherwise
    // someone could link their email to another player's Discord id.
    if (String(user.id) !== String(claims.discordUserId)) {
      return res.status(403).send(page('Account mismatch', 'Please run <b>/store</b> yourself and authorize with your own Discord account.'));
    }
    if (!user.email) {
      return res.status(400).send(page('No email shared', "Discord didn't share an email for your account. Verify your Discord email, then try again from /store."));
    }

    playerLinks.upsert({ discordUserId: user.id, email: user.email, linkSource: 'oauth' });
    console.log(`[OAuth] Linked Discord ${user.id} ↔ ${maskEmail(user.email)} via OAuth`);

    return res.send(page("You're connected!", 'Head back to Discord and run <b>/store</b> — your purchases are ready to go. You can close this tab.'));
  } catch (err) {
    console.error('[OAuth] Callback failed:', err.response?.data || err.message);
    return res.status(502).send(page('Something went wrong', "We couldn't link your account just now. Please run /store and try again."));
  }
});

/** Masks an email so PII doesn't land in plaintext console logs. */
function maskEmail(email) {
  const [user, domain] = String(email).split('@');
  if (!domain) return '***';
  return `${user.slice(0, 2)}***@${domain}`;
}

/** Tiny self-contained confirmation page (no templating dependency). */
function page(heading, body) {
  return `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${heading}</title>
  <style>
    body{font-family:system-ui,-apple-system,sans-serif;background:#2b2d31;color:#f2f3f5;
      display:grid;place-items:center;min-height:100vh;margin:0}
    .card{background:#313338;padding:2rem 2.5rem;border-radius:12px;text-align:center;max-width:360px;
      box-shadow:0 8px 24px rgba(0,0,0,.35)}
    h1{font-size:1.25rem;margin:0 0 .75rem}
    p{color:#b5bac1;line-height:1.55;margin:0}
  </style></head>
  <body><div class="card"><h1>${heading}</h1><p>${body}</p></div></body></html>`;
}

module.exports = router;
