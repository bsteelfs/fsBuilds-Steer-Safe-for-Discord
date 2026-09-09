const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    ActionRowBuilder,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');
const { featureUrl, browseUrl } = require('../fastspring/session');
const { fetchProducts } = require('../fastspring/catalog');
const { STORE_BRANDING, FALLBACK_BLURB } = require('../presentation');
const { hasRole } = require('../roles');
const { resolveColor, linkButton, describeProduct, appendProductCard } = require('../ui');

const PRODUCT_SLOTS = ['product1', 'product2', 'product3'];

const data = new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Post a public product announcement to the server (community managers only).')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('title').setDescription('Headline').setRequired(true).setMaxLength(200))
    .addStringOption((o) => o.setName('message').setDescription('Announcement text').setRequired(true).setMaxLength(2000))
    .addBooleanOption((o) => o.setName('ping').setDescription('Ping @everyone with the announcement'))
    // Hides the command by default from anyone without Manage Server. Combine
    // with a per-command override in Server Settings → Integrations → (your
    // bot) → Command Permissions → /announce to show it to just the CM role.
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

// Up to three optional product slots, so a CM can feature specific items.
for (const slot of PRODUCT_SLOTS) {
    data.addStringOption((o) =>
        o.setName(slot).setDescription('FastSpring product path to feature (optional)')
    );
}

function isCommunityManager(interaction) {
    const cmRoleId = process.env.DISCORD_CM_ROLE_ID;
    return cmRoleId
        ? hasRole(interaction, cmRoleId)
        : interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

/**
 * Builds the announcement as a Components V2 container. Exported for testing —
 * see the note in store.js on why the builder is separate from execute().
 */
function buildAnnouncementContainer({ title, message, products, ping }) {
    const container = new ContainerBuilder()
        .setAccentColor(resolveColor(STORE_BRANDING.color))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                // Components V2 forbids the message `content` field, so the
                // @everyone ping has to live inside the text. It still notifies,
                // as long as allowedMentions permits it on the send call.
                `${ping ? '@everyone\n\n' : ''}# ${title}\n${message}`
            )
        )
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(linkButton('Browse the Full Store', browseUrl()))
        );

    // One card per featured product. These links carry NO session token: an
    // announcement is public, so there's no single buyer to attribute it to.
    for (const item of products) {
        container.addSeparatorComponents(new SeparatorBuilder());
        appendProductCard(container, item, featureUrl(item.path));
    }

    return container;
}

async function execute(interaction) {
    if (!isCommunityManager(interaction)) {
        return interaction.reply({
            content: '⛔ Only community managers can post announcements.',
            flags: MessageFlags.Ephemeral,
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const title = interaction.options.getString('title');
    const message = interaction.options.getString('message');
    const ping = interaction.options.getBoolean('ping') || false;

    // Collect the chosen product paths, de-duped, in the order given.
    const wanted = [...new Set(PRODUCT_SLOTS.map((s) => interaction.options.getString(s)).filter(Boolean))];
    const raw = wanted.length ? await fetchProducts(wanted).catch(() => []) : [];
    const products = raw.map((p) => describeProduct(p, FALLBACK_BLURB));

    if (wanted.length && !products.length) {
        console.warn('[/announce] None of the requested product paths resolved:', wanted.join(', '));
    }

    const container = buildAnnouncementContainer({ title, message, products, ping });

    try {
        // Public message — visible to the whole channel, so it is sent to the
        // channel rather than as a reply to the (ephemeral) command.
        await interaction.channel.send({
            allowedMentions: { parse: ping ? ['everyone'] : [] },
            components: [container],
            flags: MessageFlags.IsComponentsV2,
        });

        const count = products.length;
        await interaction.editReply({
            content: `✅ Announcement posted${count ? ` featuring ${count} product${count > 1 ? 's' : ''}` : ''}.`,
        });
    } catch (err) {
        console.error('[/announce] Failed to post:', err.message);
        await interaction.editReply({
            content:
                '⚠️ Could not post the announcement. Check that the bot has permission to send messages here' +
                (ping ? ' and to mention everyone.' : '.'),
        });
    }
}

module.exports = { data, execute, buildAnnouncementContainer };
