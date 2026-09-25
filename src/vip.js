const playerLinks = require('./store/repository');
const accounts = require('./fastspring/accounts');
const { hasRole } = require('./roles');

/**
 * Decides whether a Discord user is a VIP. This build illustrates BOTH sources
 * of truth, and a user is VIP if EITHER is true:
 *
 *   1. FastSpring subscription — their linked FastSpring account has an active
 *      subscription (e.g. the Battle Pass). This is the "paid VIP"
 *      signal, verified live via the Accounts API. Requires an identity link.
 *
 *   2. Discord role — they hold the role configured in DISCORD_VIP_ROLE_ID.
 *      Managed by mods in Discord; instant, no purchase required. Skipped if the
 *      env var is unset.
 *
 * Returns { vip, viaSubscription, viaRole } so callers can tailor messaging.
 */
async function checkVip(interaction) {
  const viaRole = hasVipRole(interaction);

  // Subscription-based VIP. Two things to know here:
  //
  //  1) DEPENDS ON THE IDENTITY LINK. We can only check a subscription if this
  //     Discord user is linked to a FastSpring account (data/links.json). Links
  //     gain an fsAccountId passively from `order.completed` webhooks, which
  //     carry the `discordUserId` tag the Sessions API set on the order (see
  //     fastspring/sessions.js). So this path goes live after a player's first
  //     purchase; before that (OAuth email only, no account id) it's role-only.
  //
  //  2) MATCHES ANY ACTIVE SUBSCRIPTION, not specifically the Battle Pass.
  //     Fine today (it's the only subscription product); if more are added
  //     and you need to gate on a specific one, check the subscription's product
  //     path instead of "has any active subscription."
  let viaSubscription = false;
  const link = playerLinks.getByDiscordId(interaction.user.id);
  if (link?.fsAccountId) {
    try {
      viaSubscription = await accounts.hasActiveSubscription(link.fsAccountId);
    } catch (err) {
      console.warn('[vip] Subscription check failed:', err.message);
    }
  }

  return { vip: viaRole || viaSubscription, viaSubscription, viaRole };
}

function hasVipRole(interaction) {
  return hasRole(interaction, process.env.DISCORD_VIP_ROLE_ID);
}

module.exports = { checkVip };
