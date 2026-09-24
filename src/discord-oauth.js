const axios = require('axios');

/**
 * Minimal Discord OAuth2 (Authorization Code flow) used to obtain a player's
 * VERIFIED email once, so we can create FastSpring sessions for them.
 *
 * A slash-command interaction never exposes a user's email — Discord only hands
 * us their id and username. The `email` scope, granted through this one-time
 * consent flow, is the only sanctioned way to learn it. After the player
 * authorizes once, we store the email and every future /store purchase is
 * friction-free.
 */
const DISCORD_API = 'https://discord.com/api';
const OAUTH_SCOPES = ['identify', 'email'];

/**
 * The redirect Discord sends the buyer back to after consent. This EXACT string
 * (scheme + host + path) must also be added in the Discord Developer Portal →
 * your app → OAuth2 → Redirects, or Discord rejects the request.
 */
function redirectUri() {
  const base = (process.env.SERVER_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/auth/discord/callback`;
}

/**
 * Builds the Discord consent URL. `state` is our signed token (see tokens.js) —
 * it carries the discordUserId so the callback knows who authorized and it can't
 * be forged or replayed for a different user.
 */
function authorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    response_type: 'code',
    scope: OAUTH_SCOPES.join(' '),
    redirect_uri: redirectUri(),
    state,
    prompt: 'consent',
  });
  return `${DISCORD_API}/oauth2/authorize?${params.toString()}`;
}

/**
 * Exchanges the one-time `code` for the buyer's profile ({ id, username, email,
 * verified, ... }). We only need it briefly to read the email — the access token
 * is not stored.
 */
async function exchangeCodeForUser(code) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET in .env');
  }

  const tokenRes = await axios.post(
    `${DISCORD_API}/oauth2/token`,
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const accessToken = tokenRes.data.access_token;
  const userRes = await axios.get(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return userRes.data;
}

module.exports = { authorizeUrl, exchangeCodeForUser, OAUTH_SCOPES };
