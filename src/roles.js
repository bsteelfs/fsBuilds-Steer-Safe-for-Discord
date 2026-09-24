/**
 * Small helper for checking Discord roles on the member who ran a command.
 *
 * In a guild interaction, `interaction.member.roles` is either a
 * GuildMemberRoleManager (has a `.cache`) or, for raw gateway payloads, a plain
 * array of role id strings — this handles both.
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
