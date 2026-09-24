const fsApi = require('./api');

/**
 * Creates a FastSpring checkout SESSION server-side (Sessions API v2) and returns
 * the session id + hosted checkout URL.
 *
 *   POST /v2/checkouts/{FS_STOREFRONT_PATH}/sessions   (Basic auth — the same
 *   axios client / FS_API_USERNAME:FS_API_PASSWORD creds as every other call,
 *   see api.js)
 *
 * WHY sessions instead of URL params:
 *   - Product, quantity, coupon, buyer identity and tags are all set HERE, on the
 *     server, so none of it rides in a tamperable query string.
 *   - `orderTags` set on the session are GUARANTEED to land on the resulting
 *     `order.completed` webhook (the webhook reads data.tags), so fulfillment
 *     (the confirmation DM + item grant) is reliable.
 *
 * PURCHASER REQUIREMENT (important):
 *   The Sessions API needs a purchaser — either a known FastSpring `accountId`
 *   (a returning buyer we've already linked) OR an inline contact with an email
 *   (a first-time buyer, whose email we capture once via Discord OAuth). A
 *   session with NEITHER is rejected: 400 "Purchaser account or contact required".
 *   That's why /store connects the player's account before it builds a buy link.
 *
 * @returns {Promise<{ id: string, url: string, status: any }>}
 */
async function createCheckout({ productPath, quantity = 1, tags = {}, accountId, contact, couponCode }) {
  const checkoutPath = process.env.FS_STOREFRONT_PATH;
  if (!checkoutPath) throw new Error('FS_STOREFRONT_PATH is not set (see .env.example).');
  if (!productPath) throw new Error('createCheckout requires a productPath.');

  // Purchaser: prefer the linked account; fall back to an inline contact email.
  const customer = {};
  if (accountId) {
    customer.accountId = accountId;
  } else if (contact?.email) {
    customer.billToContact = {
      email: contact.email,
      firstName: contact.firstName || 'Player',
      lastName: contact.lastName || 'One',
    };
  } else {
    throw new Error(
      'createCheckout needs an accountId or contact.email — FastSpring requires a purchaser.'
    );
  }

  const cart = { lineItems: [{ productPath, quantity }] };
  if (couponCode) cart.couponCode = couponCode;

  const body = { customer, cart, orderTags: tags };

  const { data } = await fsApi.post(`/v2/checkouts/${checkoutPath}/sessions`, body);

  const url = data?.checkoutUrls?.webcheckoutUrl;
  if (!url) {
    throw new Error(
      `Session ${data?.id || '(no id)'} has no webcheckoutUrl (status: ${JSON.stringify(data?.checkoutStatus)}).`
    );
  }
  return { id: data.id, url, status: data.checkoutStatus };
}

module.exports = { createCheckout };
