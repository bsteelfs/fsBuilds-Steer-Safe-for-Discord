const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    ActionRowBuilder,
    MessageFlags,
} = require('discord.js');
const { generateCheckoutUrl, browseUrl } = require('../fastspring/session');
const { fetchProducts } = require('../fastspring/catalog');
const {
    STORE_BRANDING,
    FEATURED_PRODUCTS,
    VIP_PRODUCTS,
    VIP_UPSELL_PRODUCT,
    FALLBACK_BLURB,
} = require('../presentation');
const { checkVip } = require('../vip');
const { resolveColor, linkButton, describeProduct, appendProductCard, cardCost } = require('../ui');

// Components V2 caps a message at 40 components and each product card costs
// 3–5, so we budget rather than let Discord reject the whole message. The
// header, separators and section headings take the rest.
const COMPONENT_BUDGET = 30;

const data = new SlashCommandBuilder()
    .setName('store')
    .setDescription('Browse and purchase in-game items — powered by FastSpring.')
    .setDMPermission(false); // needs a guild member to evaluate VIP roles

/**
 * Builds the /store message as a single Components V2 container.
 *
 * Exported separately from execute() so it can be unit-tested without a live
 * Discord interaction — the payload either serializes to valid JSON or it
 * doesn't, and that's worth catching in CI rather than in your server.
 *
 * @param {object}   opts
 * @param {object[]} opts.featured  raw FastSpring products for everyone
 * @param {object[]} opts.vipItems  raw FastSpring products for VIPs (empty if not VIP)
 * @param {object|null} opts.upsell raw FastSpring product to nudge non-VIPs with
 * @param {boolean}  opts.isVip
 * @param {function} opts.checkoutUrlFor  (productPath) => url
 */
function buildStoreContainer({ featured, vipItems, upsell, isVip, checkoutUrlFor }) {
    const container = new ContainerBuilder().setAccentColor(resolveColor(STORE_BRANDING.color));

    // Header. Components V2 forbids `content`, so the title/tagline live in a
    // TextDisplay, and "browse" has to be a real button (masked markdown links
    // don't render inside V2 text).
    container
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# ${STORE_BRANDING.name} — ${STORE_BRANDING.title}\n${STORE_BRANDING.tagline}`
            )
        )
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(linkButton('Browse the Full Store', browseUrl()))
        )
        .addSeparatorComponents(new SeparatorBuilder());

    let spent = 0;

    // --- VIP section, directly under the header so it reads as the reward ---
    if (isVip && vipItems.length) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '## ⭐ VIP Exclusives\nMembers-only items you won\'t find anywhere else — thanks for being a VIP!'
            )
        );
        for (const item of vipItems) {
            if (spent + cardCost(item) > COMPONENT_BUDGET) break;
            appendProductCard(container, item, checkoutUrlFor(item.path));
            spent += cardCost(item);
        }
        container.addSeparatorComponents(new SeparatorBuilder());
    } else if (!isVip && upsell) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## ⭐ Unlock VIP Exclusives\nSubscribe to **${upsell.displayName}** (${upsell.price}) to unlock members-only items.`
            )
        );
        container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                linkButton(`Unlock VIP — ${upsell.displayName} ${upsell.price}`, checkoutUrlFor(upsell.path))
            )
        );
        container.addSeparatorComponents(new SeparatorBuilder());
        spent += 3;
    }

    // --- Featured items, available to everyone ---
    if (featured.length) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## 🛒 Featured Items\nPopular picks available to everyone.')
        );
        for (const item of featured) {
            if (spent + cardCost(item) > COMPONENT_BUDGET) {
                console.warn('[/store] Hit the Components V2 budget — trim FEATURED_PRODUCTS/VIP_PRODUCTS in presentation.js.');
                break;
            }
            appendProductCard(container, item, checkoutUrlFor(item.path));
            spent += cardCost(item);
        }
    }

    return container;
}

async function execute(interaction) {
    const { id: discordUserId, username } = interaction.user;

    // Defer first: FastSpring calls can exceed Discord's strict 3s window. If
    // the gateway replayed a stale interaction this fails with 10062 and there
    // is no reply channel left — log and bail; the user just re-runs /store.
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (err) {
        if (err.code === 10062) {
            console.warn('[/store] Interaction expired before it could be acknowledged (10062).');
            return;
        }
        throw err;
    }

    try {
        // The catalog fetch and the VIP check are independent — run them together.
        const [featuredRaw, vipStatus] = await Promise.all([
            fetchProducts(FEATURED_PRODUCTS),
            checkVip(interaction).catch((err) => {
                console.warn('[/store] VIP check failed:', err.message);
                return { vip: false };
            }),
        ]);

        let vipRaw = [];
        let upsellRaw = null;

        if (vipStatus.vip) {
            // Don't repeat a product that's already in the featured list.
            const featuredPaths = new Set(featuredRaw.map((p) => p.product));
            const vipPaths = VIP_PRODUCTS.filter((p) => !featuredPaths.has(p));
            vipRaw = vipPaths.length ? await fetchProducts(vipPaths) : [];
        } else if (VIP_UPSELL_PRODUCT) {
            [upsellRaw = null] = await fetchProducts([VIP_UPSELL_PRODUCT]);
        }

        const featured = featuredRaw.map((p) => describeProduct(p, FALLBACK_BLURB));
        const vipItems = vipRaw.map((p) => describeProduct(p, FALLBACK_BLURB));
        const upsell = upsellRaw ? describeProduct(upsellRaw, FALLBACK_BLURB) : null;

        if (!featured.length && !vipItems.length && !upsell) {
            return interaction.editReply({ content: 'The store has no items listed right now.' });
        }

        const container = buildStoreContainer({
            featured,
            vipItems,
            upsell,
            isVip: Boolean(vipStatus.vip),
            // A fresh session token per product link, so the webhook can tell
            // who bought what (see src/fastspring/session.js).
            checkoutUrlFor: (path) => generateCheckoutUrl(path, discordUserId, username),
        });

        await interaction.editReply({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
        });
    } catch (error) {
        console.error('Failed to build store:', error);
        await interaction.editReply({
            content: 'Sorry, the store is currently experiencing issues connecting to the catalog. Please try again later.',
        });
    }
}

module.exports = { data, execute, buildStoreContainer };
