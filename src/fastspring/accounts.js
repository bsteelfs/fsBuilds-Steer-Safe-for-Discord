const fsApi = require('./api');

/**
 * FastSpring Accounts API — the slice this bot uses.
 *
 * Once a Discord user is linked to a FastSpring account id (passively, on a
 * completed purchase), we can check whether that account has an active
 * subscription to decide VIP status in /store.
 *
 * Endpoint: GET /accounts?subscriptions=active
 */

/** Returns true if the account has an active subscription (VIP gating). */
async function hasActiveSubscription(accountId) {
  const { data } = await fsApi.get('/accounts', { params: { subscriptions: 'active' } });
  const ids = (data.accounts || []).map((a) => (typeof a === 'string' ? a : a.id));
  return ids.includes(accountId);
}

module.exports = { hasActiveSubscription };
