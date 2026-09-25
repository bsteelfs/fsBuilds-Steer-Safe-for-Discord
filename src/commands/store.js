const path = require('path');
const {
  SlashCommandBuilder,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const { fetchCatalog, fetchProducts } = require('../fastspring/catalog');
const { buildBuyLink, buildConnectLink, browseUrl } = require('../fastspring/session');
const {
  STORE_BRANDING,
  VIP_PRODUCTS,
  VIP_UPSELL_PRODUCT,
  FALLBACK_BLURB,
} = require('../presentation');
const { checkVip } = require('../vip');
const playerLinks = require('../store/repository');

// Components V2 lets us render one cohesive message where each product is a
// "section" (text + image accessory) with its own buy button directly beneath —
// so the button is unmistakably tied to its product, all in a single message.
//
// Components V2 caps a message at 40 total components, NESTED ones included
// (container, sections, text, thumbnails, rows, buttons, separators). A product
// card costs 5 (section + text + thumbnail + row + button), so we count what the
// header/connect/VIP blocks use and fit as many cards as the remainder allows.
const COMPONENT_LIMIT = 40;
const CARD_COST = 5;

const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets');

const data = new SlashCommandBuilder()
  .setName('store')
  .setDescription('Browse and purchase in-game items — powered by FastSpring.');

function linkButton(label, url, emoji = '🛒') {
  return new ButtonBuilder().setLabel(label).setEmoji(emoji).setURL(url).setStyle(ButtonStyle.Link);
}

/**
 * The right action button for a product given the buyer's connect state:
 *   - connected (we have their email/account) → a BUY link that creates a
 *     FastSpring session on click.
 *   - not connected → a "Connect to buy" link that starts the one-time OAuth flow.
 */
function buyButton(item, ctx) {
  return ctx.connected
    ? linkButton(`Buy ${item.displayName} — ${item.price}`, buildBuyLink(item.path, ctx.discordUserId, ctx.discordUsername))
    : linkButton(`Connect to buy ${item.displayName}`, buildConnectLink(ctx.discordUserId), '🔒');
}

/** Appends a product card (section + image) and its own buy/connect button. */
function appendProduct(container, item, ctx) {
  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${item.displayName}\n${item.description || FALLBACK_BLURB}\n**${item.price}**`
      )
    )
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(item.imageUrl || 'attachment://logo.png'));
  container.addSectionComponents(section);
  container.addActionRowComponents(new ActionRowBuilder().addComponents(buyButton(item, ctx)));
}

/**
 * /store — a single ephemeral Components V2 message: a branded container with a
 * hero banner, promo copy + a "browse the full web shop" button, then one
 * section per featured product (artwork + text) each followed by its own buy
 * button. Buy buttons hit our /checkout route, which creates a FastSpring
 * session and renders the embedded checkout (see src/fastspring/session.js).
 */
async function execute(interaction) {
  // Discord invalidates an interaction token ~3s after it's created. If the bot
  // was briefly asleep/lagged, or a resumed gateway session replays a stale
  // interaction, this first ack can fail with 10062. There's no reply channel
  // left, so log and bail; the user just re-runs /store.
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    if (err.code === 10062) {
      console.warn('[/store] Interaction expired before it could be acknowledged (10062).');
      return;
    }
    throw err;
  }

  let catalog;
  try {
    catalog = await fetchCatalog();
  } catch (err) {
    console.error('[/store] Failed to fetch catalog:', err.message);
    return interaction.editReply({ content: '⚠️ The store is temporarily unavailable. Please try again.' });
  }
  if (!catalog.length) {
    return interaction.editReply({ content: 'The store has no items listed right now.' });
  }

  const { id: discordUserId, username: discordUsername } = interaction.user;

  // "Connected" = we can identify this buyer to FastSpring — either an email
  // (captured once via Discord OAuth) or a FastSpring account id (linked after
  // their first purchase). The Sessions API needs one of these, so buy buttons
  // only go live once connected; until then they get a one-time connect step.
  const link = playerLinks.getByDiscordId(discordUserId);
  const connected = Boolean(link && (link.email || link.fsAccountId));
  const ctx = { connected, discordUserId, discordUsername };

  const browse = browseUrl();
  const hero = new AttachmentBuilder(path.join(ASSETS_DIR, STORE_BRANDING.heroFile), { name: 'hero.png' });
  const logo = new AttachmentBuilder(path.join(ASSETS_DIR, STORE_BRANDING.logoFile), { name: 'logo.png' });

  const headerText =
    `# ${STORE_BRANDING.name} — Web Shop\n` +
    `${STORE_BRANDING.tagline}\n\n` +
    `Coin packs, battle passes, and exclusive egg power-ups — plus member deals ` +
    `you won't find in the app.`;

  const container = new ContainerBuilder()
    .setAccentColor(STORE_BRANDING.color)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://hero.png').setDescription('Eggblast Arena')
      )
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(linkButton('Browse the Full Web Shop', browse))
    )
    .addSeparatorComponents(new SeparatorBuilder()); // divider under the header
  // container + gallery + text + row + button + separator
  let used = 6;

  // One-time connect prompt for players we can't yet identify to FastSpring.
  // After they authorize once, this disappears and buy buttons go live.
  if (!connected) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '### 🔗 One-time setup\nConnect your Discord account so we can process and confirm your purchases. ' +
          'Tap **Connect to buy** on any item below — you only do this once.'
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(linkButton('🔗 Connect Your Account', buildConnectLink(discordUserId), '🔗'))
    );
    container.addSeparatorComponents(new SeparatorBuilder());
    used += 4; // text + row + button + separator
  }

  // VIP section FIRST (just under the header), then the general featured items.
  // A user is VIP if their linked FastSpring account has an active subscription
  // OR they hold the configured VIP role (see src/vip.js).
  let vipStatus = { vip: false };
  try {
    vipStatus = await checkVip(interaction);
  } catch (err) {
    console.warn('[/store] VIP check failed:', err.message);
  }

  // Reserve room for the Featured header (separator + text) and at least one card.
  const FEATURED_HEADER = 2;
  if (vipStatus.vip) {
    let vipItems = await fetchProducts(VIP_PRODUCTS).catch(() => []);
    const vipRoom = Math.floor((COMPONENT_LIMIT - used - 1 - FEATURED_HEADER - CARD_COST) / CARD_COST);
    vipItems = vipItems.slice(0, Math.max(0, vipRoom));
    if (vipItems.length) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '## ⭐ VIP Exclusives\nMembers-only power-ups you won’t find anywhere else — thanks for being a VIP!'
        )
      );
      vipItems.forEach((item) => appendProduct(container, item, ctx));
      used += 1 + vipItems.length * CARD_COST;
    }
  } else {
    const upsell = (await fetchProducts([VIP_UPSELL_PRODUCT]).catch(() => []))[0];
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        upsell
          ? `## ⭐ Unlock VIP Exclusives\nSubscribe to **${upsell.displayName}** (${upsell.price}) to unlock members-only items.`
          : '## ⭐ Unlock VIP Exclusives\nSubscribe to unlock members-only items.'
      )
    );
    used += 1;
    if (upsell) {
      used += 2; // row + button
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          connected
            ? linkButton(`Unlock VIP — ${upsell.displayName} ${upsell.price}`, buildBuyLink(upsell.path, discordUserId, discordUsername))
            : linkButton(`Connect to unlock VIP — ${upsell.displayName}`, buildConnectLink(discordUserId), '🔒')
        )
      );
    }
  }

  // Featured items below the VIP section, as their own labelled group.
  const budget = Math.max(0, Math.floor((COMPONENT_LIMIT - used - FEATURED_HEADER) / CARD_COST));
  const featured = catalog.slice(0, budget);
  if (catalog.length > featured.length) {
    console.warn(`[/store] Showing ${featured.length}/${catalog.length} featured items to stay under the component cap.`);
  }
  if (featured.length) {
    container.addSeparatorComponents(new SeparatorBuilder()); // divider between sections
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('## 🛒 Featured Items\nPopular picks available to everyone.')
    );
    featured.forEach((item) => appendProduct(container, item, ctx));
  }

  await interaction.editReply({
    components: [container],
    files: [hero, logo],
    flags: MessageFlags.IsComponentsV2,
  });
}

module.exports = { data, execute };
