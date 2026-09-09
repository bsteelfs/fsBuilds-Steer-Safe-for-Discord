/**
 * Checks whether the member who ran a command holds a given Discord role.
 *
 * `interaction.member.roles` comes in two shapes: a GuildMemberRoleManager
 * (has a `.cache` Collection) for a normal gateway interaction, or a plain array
 * of role-id strings for raw payloads — this handles both.
 *
 * A blank/undefined roleId returns false: an unset env var means "this feature
 * is off", never "everyone qualifies".
 */
function hasRole(interaction, roleId) {
    if (!roleId) return false;

    const roles = interaction.member?.roles;
    if (!roles) return false;

    if (typeof roles.cache?.has === 'function') return roles.cache.has(roleId);
    if (Array.isArray(roles)) return roles.includes(roleId);
    return false;
}

module.exports = { hasRole };
