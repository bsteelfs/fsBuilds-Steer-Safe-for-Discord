const fsApi = require('./api');

/**
 * FastSpring Accounts API — the slice this bot uses.
 *
 * Once a Discord user is linked to a FastSpring account id (passively, on a
 * completed purchase — see src/web/routes/webhook.js), we can check whether
 * that account has an active subscription to decide VIP status in /store.
 */

// Safety valve so a malformed paging response can't spin forever.
const MAX_PAGES = 20;

/**
 * Returns true if the given FastSpring account has an active subscription.
 *
 * Endpoint: GET /accounts?subscriptions=active
 *
 * PAGINATION: this endpoint returns a PAGE of accounts, not all of them. With a
 * single unpaginated request, any account past the first page would silently
 * read as "not VIP" once you have more than a page of subscribers. We walk the
 * pages using the response's own `totalPages`, stopping as soon as we match.
 *
 * At large subscriber volumes, replace this scan with a direct lookup of the
 * one account rather than listing every subscriber.
 */
async function hasActiveSubscription(fsAccountId) {
    if (!fsAccountId) return false;

    for (let page = 0; page < MAX_PAGES; page += 1) {
        const data = await fsApi.get(`/accounts?subscriptions=active&page=${page}`);

        // Entries are either bare id strings or {id} objects depending on the
        // request — normalize both to plain id strings.
        const ids = (data.accounts || []).map((a) => (typeof a === 'string' ? a : a.id));
        if (ids.includes(fsAccountId)) return true;

        // Stop when there are no more pages (or no paging metadata at all).
        const totalPages = Number(data.totalPages);
        if (!Number.isFinite(totalPages) || page >= totalPages - 1 || ids.length === 0) {
            return false;
        }
    }

    console.warn(`[accounts] Stopped after ${MAX_PAGES} pages looking for account ${fsAccountId}.`);
    return false;
}

module.exports = { hasActiveSubscription };
