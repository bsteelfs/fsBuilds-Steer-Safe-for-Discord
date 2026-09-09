const { createCheckoutSession } = require('../store/repository');

/**
 * Builds links into the FastSpring-backed web shop (WEBSHOP_URL).
 *
 * HOW THE BUYER'S DISCORD IDENTITY REACHES THE ORDER
 * The shop reads these query params:
 *   prod           → product path to pre-load into the cart
 *   coupon         → optional coupon code
 *   session_token  → attached to the order as a FastSpring ORDER TAG
 *
 * It does NOT read uid/uname, so we don't send them. Instead the bot mints an
 * unguessable session token per checkout (stored against the Discord user in
 * store/repository.js) and sends only that. When the order completes, the
 * webhook reads tags.session_token and trades it back for the Discord user.
 *
 * WHY A TOKEN RATHER THAN THE RAW DISCORD ID:
 * Query params are visible and editable by the buyer. A raw `uid` in the URL
 * could be swapped to credit somebody else's account; a random token carries no
 * meaning off this server, and expires. (For higher-value goods, look at
 * FastSpring "Secure Payloads" to sign the cart itself.)
 */
function requireWebshopUrl() {
    const baseUrl = process.env.WEBSHOP_URL;
    if (!baseUrl) {
        throw new Error('WEBSHOP_URL is not defined in the .env file.');
    }
    // new URL() needs a scheme — a bare "store.example.com" throws
    // ERR_INVALID_URL, so fail with a message that says what's actually wrong.
    try {
        return new URL(baseUrl);
    } catch {
        throw new Error(`WEBSHOP_URL is not a valid URL (include https://): ${baseUrl}`);
    }
}

/**
 * A per-buyer checkout link: pre-loads the product AND carries a token that
 * identifies the Discord user who clicked it.
 *
 * @param {string} productPath   FastSpring product path
 * @param {string} discordUserId Discord user id of the buyer
 * @param {string} discordUsername Discord username (for friendlier logs/DMs)
 */
function generateCheckoutUrl(productPath, discordUserId, discordUsername) {
    const url = requireWebshopUrl();
    const token = createCheckoutSession({ discordUserId, discordUsername });

    url.searchParams.set('prod', productPath);
    url.searchParams.set('session_token', token);

    return url.toString();
}

/**
 * A product link with NO buyer identity — for public announcements, where
 * there's no single player to attribute the click to. Pre-loads the product;
 * the buyer's identity is whatever they enter at checkout.
 */
function featureUrl(productPath) {
    const url = requireWebshopUrl();
    url.searchParams.set('prod', productPath);
    return url.toString();
}

/** The shop's base URL with no params — a plain "browse the store" link. */
function browseUrl() {
    return requireWebshopUrl().toString();
}

module.exports = { generateCheckoutUrl, featureUrl, browseUrl };
