const repository = require('./store/repository');
const accounts = require('./fastspring/accounts');
const { hasRole } = require('./roles');

/**
 * Decides whether a Discord user is a VIP. Two independent sources of truth —
 * the user is VIP if EITHER is true:
 *
 *   1. Discord role — they hold the role in DISCORD_VIP_ROLE_ID. Managed by
 *      moderators in Discord; instant, no purchase required. Off when the env
 *      var is blank.
 *
 *   2. FastSpring subscription — their linked FastSpring account has an active
 *      subscription (e.g. the Battle Pass). This is the "paid VIP" signal,
 *      verified live via the Accounts API. It depends on an identity link,
 *      which is created when a purchase made through /store completes (see
 *      src/web/routes/webhook.js) — so it's dormant for a user until their
 *      first purchase. It also matches ANY active subscription, not one product
 *      in particular; gate on the subscription's product path if you need that.
 *
 * Returns { vip, viaRole, viaSubscription } so callers can tailor messaging.
 */
async function checkVip(interaction) {
    const viaRole = hasRole(interaction, process.env.DISCORD_VIP_ROLE_ID);

    let viaSubscription = false;
    const link = repository.getByDiscordId(interaction.user.id);
    if (link?.fsAccountId) {
        try {
            viaSubscription = await accounts.hasActiveSubscription(link.fsAccountId);
        } catch (err) {
            // A FastSpring hiccup shouldn't break /store — fall back to role-only.
            console.warn('[vip] Subscription check failed:', err.message);
        }
    }

    return { vip: viaRole || viaSubscription, viaRole, viaSubscription };
}

module.exports = { checkVip };
