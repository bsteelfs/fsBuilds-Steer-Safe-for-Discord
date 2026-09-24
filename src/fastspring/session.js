/**
 * Builds the links the /store message points at.
 *
 * This build no longer stuffs the product + buyer identity into the web-shop URL
 * as query params. Instead:
 *
 *   - BUY links point back at THIS server's /checkout/:token route, carrying only
 *     a short-lived SIGNED token (see ../tokens.js). On click, that route creates
 *     a FastSpring session server-side (product + orderTags + purchaser) and
 *     renders the embedded checkout. Nothing sensitive or editable is in the URL,
 *     and tags are guaranteed onto the order (see ../fastspring/sessions.js).
 *
 *   - CONNECT links start the one-time Discord OAuth flow so we can capture the
 *     player's email (the Sessions API needs a purchaser).
 *
 *   - browseUrl / featureUrl are plain public web-shop links, used by /announce,
 *     which is posted to the whole server (no single buyer to tag, and a session
 *     can't be created without a purchaser).
 */
const tokens = require('../tokens');

const DEFAULT_WEBSHOP_URL = 'https://eggblast.fastspringexamples.com/';

/** Public base URL of THIS bot's server (the tunnel URL in dev). */
function serverBase() {
  return (process.env.SERVER_URL || 'http://localhost:3000').replace(/\/$/, '');
}

/**
 * A per-player, tamper-proof BUY link. The product path and the player's Discord
 * identity are encoded into a signed, expiring token — never as raw URL params.
 * Clicking it hits /checkout/:token, which builds the FastSpring session.
 */
function buildBuyLink(productPath, discordUserId, discordUsername) {
  const token = tokens.sign({ productPath, discordUserId, discordUsername }, 900);
  return `${serverBase()}/checkout/${token}`;
}

/**
 * The one-time "Connect account" link that starts Discord OAuth. `state` carries
 * a signed discordUserId so the callback can trust who authorized.
 */
function buildConnectLink(discordUserId) {
  const state = tokens.sign({ discordUserId, purpose: 'oauth' }, 900);
  return `${serverBase()}/auth/discord?state=${encodeURIComponent(state)}`;
}

/** The public web shop base URL — for a "browse the whole store" button. */
function browseUrl() {
  return process.env.WEBSHOP_URL || DEFAULT_WEBSHOP_URL;
}

/**
 * A product deep link WITHOUT a buyer identity — for /announce (posted to the
 * whole server). Pre-selects the product; the buyer identifies at the web shop.
 */
function featureUrl(productPath) {
  const base = process.env.WEBSHOP_URL || DEFAULT_WEBSHOP_URL;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}prod=${encodeURIComponent(productPath)}`;
}

module.exports = { buildBuyLink, buildConnectLink, browseUrl, featureUrl };
