const path = require('path');
const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const { fetchProducts, fetchAllProductPaths } = require('../fastspring/catalog');
const { featureUrl, browseUrl } = require('../fastspring/session');
const { STORE_BRANDING, FALLBACK_BLURB } = require('../presentation');
const { hasRole } = require('../roles');

const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets');
const PRODUCT_SLOTS = ['product1', 'product2', 'product3', 'product4', 'product5'];

// Gated to community managers (the Community Manager role in DISCORD_CM_ROLE_ID,
// or the Manage Server permission if that isn't set).
const data = new SlashCommandBuilder()
  .setName('announce')
  .setDescription('Post a public web store announcement to the whole server (community managers).')
  .setDMPermission(false)
  // Hide the command by default from anyone without Manage Server. Combined with
  // a per-command override in Server Settings → Integrations, this lets you show
  // it to the Community Manager role and hide it from everyone else.
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((o) =>
    o.setName('message').setDescription('Announcement text (e.g. "Season 4 is live!")').setMaxLength(2000)
  )
  .addStringOption((o) => o.setName('title').setDescription('Headline').setMaxLength(200))
  .addAttachmentOption((o) =>
    o.setName('image').setDescription('Custom banner image for this announcement (optional)')
  )
  .addBooleanOption((o) => o.setName('ping').setDescription('Ping @everyone with the announcement'));

// Add five optional, autocompleted product slots. Autocomplete is fed live from
// FastSpring, so a CM picks products without editing any code or config.
for (const slot of PRODUCT_SLOTS) {
  data.addStringOption((o) =>
    o.setName(slot).setDescription('Feature a product (type to search the catalog)').setAutocomplete(true)
  );
}

/** Autocomplete handler — suggest catalog product paths matching what's typed. */
async function autocomplete(interaction) {
  const focused = (interaction.options.getFocused() || '').toLowerCase();
  let paths = [];
  try {
    paths = await fetchAllProductPaths();
  } catch (err) {
    console.warn('[/announce] Autocomplete catalog fetch failed:', err.message);
  }
  const choices = paths
    .filter((p) => p.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((p) => ({ name: p, value: p }));
  await interaction.respond(choices);
}

function isCommunityManager(interaction) {
  const cmRoleId = process.env.DISCORD_CM_ROLE_ID;
  return cmRoleId
    ? hasRole(interaction, cmRoleId)
    : interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

async function execute(interaction) {
  if (!isCommunityManager(interaction)) {
    return interaction.reply({
      content: '⛔ Only community managers can post announcements.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const title = interaction.options.getString('title') || `📢 ${STORE_BRANDING.name}`;
  const message =
    interaction.options.getString('message') ||
    'The web shop is open — grab the latest gear below!';
  const ping = interaction.options.getBoolean('ping') || false;

  // Collect chosen product paths (dedupe, preserve order), then fetch live detail.
  const wanted = [...new Set(PRODUCT_SLOTS.map((s) => interaction.options.getString(s)).filter(Boolean))];
  const products = wanted.length ? await fetchProducts(wanted).catch(() => []) : [];

  const browse = browseUrl();
  const logo = new AttachmentBuilder(path.join(ASSETS_DIR, STORE_BRANDING.logoFile), { name: 'logo.png' });
  const files = [logo]; // logo is the fallback thumbnail for products with no art

  // Banner: use the CM's uploaded image if provided, else the default hero.
  // We re-upload the custom image onto our own message (rather than linking the
  // uploaded attachment's URL, which is signed and expires) so it stays visible.
  let bannerUrl = 'attachment://hero.png';
  const custom = interaction.options.getAttachment('image');
  if (custom && (custom.contentType || '').startsWith('image/')) {
    try {
      const res = await fetch(custom.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      files.push(new AttachmentBuilder(Buffer.from(await res.arrayBuffer()), { name: 'banner.png' }));
      bannerUrl = 'attachment://banner.png';
    } catch (err) {
      console.warn('[/announce] Custom image failed, using default banner:', err.message);
    }
  }
  if (bannerUrl === 'attachment://hero.png') {
    files.push(new AttachmentBuilder(path.join(ASSETS_DIR, STORE_BRANDING.heroFile), { name: 'hero.png' }));
  }

  const container = new ContainerBuilder()
    .setAccentColor(STORE_BRANDING.color)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(bannerUrl).setDescription(STORE_BRANDING.name)
      )
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        // Components V2 can't use the message `content` field, so the @everyone
        // ping (when requested) goes inside the text — it still notifies as long
        // as allowedMentions permits it on the send call.
        `${ping ? '@everyone\n\n' : ''}# ${title}\n${message}`
      )
    )
    // Masked markdown links don't render inside Components V2 text, so the
    // "browse" action is a real link button.
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Browse the Full Web Shop')
          .setEmoji('🛒')
          .setURL(browse)
          .setStyle(ButtonStyle.Link)
      )
    );

  // One card + buy button per featured product (public link — no per-user tag).
  products.forEach((item) => {
    container.addSeparatorComponents(new SeparatorBuilder());
    const section = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `### ${item.displayName}\n${item.description || FALLBACK_BLURB}\n**${item.price}**`
        )
      )
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(item.imageUrl || 'attachment://logo.png'));
    container.addSectionComponents(section);
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel(`Get ${item.displayName} — ${item.price}`)
          .setEmoji('🛒')
          .setURL(featureUrl(item.path))
          .setStyle(ButtonStyle.Link)
      )
    );
  });

  try {
    // Public message (not ephemeral) — visible to everyone in the channel.
    // No `content` field: Components V2 forbids it. The @everyone mention (if any)
    // lives inside the container text; allowedMentions lets it actually ping.
    await interaction.channel.send({
      allowedMentions: { parse: ping ? ['everyone'] : [] },
      components: [container],
      files,
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (err) {
    console.error('[/announce] Failed to post:', err.message);
    return interaction.editReply({
      content:
        '⚠️ Could not post the announcement. Check that the bot can send messages here' +
        (ping ? ' and has permission to mention everyone.' : '.'),
    });
  }

  const count = products.length;
  await interaction.editReply({
    content: `✅ Announcement posted${count ? ` featuring ${count} product${count > 1 ? 's' : ''}` : ''}.`,
  });
}

module.exports = { data, execute, autocomplete };
