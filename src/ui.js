// src/ui.js
//
// Shared Components V2 helpers.
//
// Components V2 (discord.js v14.19+) replaces the old "embed + button rows"
// message with a single ContainerBuilder holding typed child components. The
// win for a store: each product becomes a SECTION — its text and its own buy
// button/artwork grouped together — so a button is unmistakably tied to its
// product, instead of a loose row of buttons under one embed.
//
// Rules that bite if you forget them:
//   1. A message using Components V2 CANNOT set `content` or `embeds`.
//      Anything you want the reader to see (including an @everyone ping) has to
//      live inside a TextDisplay component.
//   2. The message is capped at 40 TOTAL components — every container, section,
//      text display, thumbnail, row and button counts. Product cards cost ~5
//      each, so callers cap how many they render.
//   3. Send with flags: MessageFlags.IsComponentsV2.
const {
    SectionBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');

// Discord's hard cap. We stay under it rather than let the API reject the send.
const MAX_COMPONENTS = 40;

/** Accepts '#0099ff' or 0x0099ff and returns the integer Discord expects. */
function resolveColor(color) {
    if (typeof color === 'number') return color;
    if (typeof color === 'string') return parseInt(color.replace('#', ''), 16);
    return 0x5865f2; // Discord blurple, if branding is missing entirely
}

/** A link-style buy button. Labels are capped at 80 chars by Discord. */
function linkButton(label, url) {
    return new ButtonBuilder()
        .setLabel(label.slice(0, 80))
        .setEmoji('🛒')
        .setURL(url)
        .setStyle(ButtonStyle.Link);
}

/**
 * Formats one FastSpring product for display. FastSpring owns all of this —
 * name, price, artwork and description come from the dashboard, so updating a
 * product there changes Discord with no code change.
 */
function describeProduct(fsProduct, fallbackBlurb) {
    const displayName =
        (typeof fsProduct.display === 'object' ? fsProduct.display?.en : fsProduct.display) || fsProduct.product;

    const usdPrice = fsProduct.pricing?.price?.USD;
    const price = usdPrice !== undefined ? `$${Number(usdPrice).toFixed(2)}` : 'See store';

    const desc = fsProduct.description || {};
    const blurb = desc.summary?.en || desc.full?.en || fallbackBlurb;

    return {
        path: fsProduct.product,
        displayName,
        price,
        blurb,
        imageUrl: typeof fsProduct.image === 'string' ? fsProduct.image : null,
    };
}

/**
 * Adds one product card to a container: a section holding the product's text,
 * plus its buy button.
 *
 * With artwork we use a thumbnail accessory and hang the button underneath (5
 * components). Without artwork the button becomes the section's own accessory,
 * sitting inline to the right (3 components) — which also avoids an empty-looking
 * card for products that have no image set in FastSpring.
 */
function appendProductCard(container, item, checkoutUrl) {
    const text = new TextDisplayBuilder().setContent(
        `### ${item.displayName}\n${item.blurb}\n**${item.price}**`
    );
    const button = linkButton(`Buy ${item.displayName} — ${item.price}`, checkoutUrl);
    const section = new SectionBuilder().addTextDisplayComponents(text);

    if (item.imageUrl) {
        section.setThumbnailAccessory(new ThumbnailBuilder().setURL(item.imageUrl));
        container.addSectionComponents(section);
        container.addActionRowComponents(new ActionRowBuilder().addComponents(button));
    } else {
        section.setButtonAccessory(button);
        container.addSectionComponents(section);
    }
}

/** Rough component cost of a card, used to budget against MAX_COMPONENTS. */
function cardCost(item) {
    return item.imageUrl ? 5 : 3;
}

module.exports = {
    MAX_COMPONENTS,
    resolveColor,
    linkButton,
    describeProduct,
    appendProductCard,
    cardCost,
};
