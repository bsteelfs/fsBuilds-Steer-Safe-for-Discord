const fsApi = require('./api');
const { FEATURED_PRODUCTS } = require('../presentation');

/**
 * Fetches the curated set of featured products from FastSpring.
 *
 * This fork highlights a hand-picked list (see FEATURED_PRODUCTS in
 * presentation.js) rather than the whole catalog, so we skip `GET /products`
 * and fetch each featured product's detail directly:
 *   GET /products/{path}   → full product detail per item (parallel)
 *
 * Display order matches the FEATURED_PRODUCTS array order. Any path that
 * doesn't resolve (typo, unpublished) is logged and skipped, not fatal.
 * Returns a clean array ready to populate the Discord embeds + select menu.
 */
async function fetchCatalog() {
  return fetchProducts(FEATURED_PRODUCTS);
}

/**
 * Fetches full detail for a specific, ordered list of FastSpring product paths.
 * Used for both the featured catalog and the VIP-exclusive set.
 *
 * Display order matches the input array. Any path that doesn't resolve (typo,
 * unpublished) is logged and skipped, not fatal. Returns normalized products.
 */
async function fetchProducts(paths) {
  const list = (paths || []).slice(0, 25); // Discord component/embed practical cap

  if (list.length === 0) return [];

  // Fetch details in parallel; Promise.all preserves the input order.
  // Note: GET /products/{path} wraps the product in a "products" array,
  // so we unwrap the first element.
  const results = await Promise.all(
    list.map((path) =>
      fsApi
        .get(`/products/${path}`)
        .then((r) => r.data.products?.[0] || null)
        .catch((err) => {
          console.warn(`Could not fetch product "${path}":`, err.message);
          return null;
        })
    )
  );

  return results.filter(Boolean).map(normalizeProduct);
}

/**
 * Normalizes a raw FastSpring product response into the shape the bot needs.
 *
 * FastSpring is the source of truth for everything that affects display of a
 * sellable product, including its artwork and description (both configured in
 * the FastSpring dashboard):
 *   - display:     localized name object, e.g. { "en": "Battle Pass" }
 *   - pricing:     { price: { USD: 4.99 }, ... }
 *   - image:       a public CDN URL string (Discord can load it directly)
 *   - description: { summary: { en }, full: { en } } when set; often empty {}
 *
 * image/description may be absent if not configured for that product — callers
 * fall back gracefully.
 */
function normalizeProduct(p) {
  const displayName =
    (typeof p.display === 'object' ? p.display?.en : p.display) || p.product;

  const usdPrice = p.pricing?.price?.USD;
  const price = usdPrice !== undefined ? `$${Number(usdPrice).toFixed(2)}` : 'See store';

  const imageUrl = typeof p.image === 'string' ? p.image : null;

  const desc = p.description || {};
  const description = desc.summary?.en || desc.full?.en || null;

  return {
    path: p.product,
    displayName,
    price,
    imageUrl,
    description,
  };
}

/**
 * Returns every product path in the FastSpring catalog (GET /products).
 * Used to power /announce's live product autocomplete, so a community manager
 * can feature any product without touching code — new products in FastSpring
 * appear in the suggestions automatically.
 */
async function fetchAllProductPaths() {
  const { data } = await fsApi.get('/products');
  return data.products || [];
}

module.exports = { fetchCatalog, fetchProducts, fetchAllProductPaths };
