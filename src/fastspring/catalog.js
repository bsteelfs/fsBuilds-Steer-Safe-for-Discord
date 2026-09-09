const fsApi = require('./api');

/**
 * FastSpring Products API — the slice this bot uses.
 *
 * FastSpring is the source of truth for everything that describes a sellable
 * product: display name, price, artwork (`image`) and description. The bot
 * pulls it live per product, so editing a product in the FastSpring dashboard
 * is reflected in Discord with no code change.
 */

/**
 * Fetches one product's full detail.
 *
 * Endpoint: GET /products/{path}
 * Note: the response wraps the product in a `products` array even for a single
 * path — we unwrap the first element.
 *
 * @param {string} productPath  FastSpring product path, e.g. '500-coins'
 * @returns {Promise<Object>}   The raw FastSpring product object.
 */
async function fetchProduct(productPath) {
    const data = await fsApi.get(`/products/${encodeURIComponent(productPath)}`);

    if (data.products?.length) {
        return data.products[0];
    }

    throw new Error(`Product "${productPath}" not found in API response.`);
}

/**
 * Fetches full detail for a list of product paths, in parallel.
 *
 * Any path that fails to resolve (typo, unpublished) is logged and skipped
 * rather than failing the whole batch — so one bad entry in presentation.js
 * can't take /store down for everyone. Output order matches input order.
 *
 * @param {string[]} paths
 * @returns {Promise<Object[]>} Resolved products only.
 */
async function fetchProducts(paths) {
    const results = await Promise.all(
        paths.map((path) =>
            fetchProduct(path).catch((err) => {
                console.warn(`[catalog] Could not fetch product "${path}":`, err.message);
                return null;
            })
        )
    );

    return results.filter(Boolean);
}

module.exports = { fetchProduct, fetchProducts };
