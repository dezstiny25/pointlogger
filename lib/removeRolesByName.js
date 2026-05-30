module.exports = async function removeRolesByName(
  member,
  roleNames,
  guild,
  roleErrors,
  roleSummaryMap,
) {
  const botMember =
    guild.members.me || (await guild.members.fetch(guild.client.user.id));

  for (const roleName of roleNames) {
    let role = null;

    if (/^\d+$/.test(String(roleName).trim())) {
      role = guild.roles.cache.get(String(roleName).trim());
    } else {
      role = guild.roles.cache.find(
        (r) => r.name.trim() === String(roleName).trim(),
      );
    }

    if (!role) continue;

    try {
      if (role.position >= botMember.roles.highest.position) {
        roleErrors.push(
          `❌ Cannot remove "${role.name}" because it is above bot hierarchy.`,
        );

        continue;
      }

      if (member.roles.highest.position >= botMember.roles.highest.position) {
        roleErrors.push(
          `❌ Cannot modify ${member.user.tag}; member hierarchy higher than bot.`,
        );

        continue;
      }

      if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role);

        const id = member.id;
        const tag = member.user.tag;
        const existing = roleSummaryMap.get(id) || {
          tag,
          added: [],
          removed: [],
          already: [],
          nicknames: [],
        };

        existing.removed.push(role.name);
        roleSummaryMap.set(id, existing);
      }
    } catch (err) {
      roleErrors.push(
        `❌ Failed removing "${role.name}" from ${member.user.tag}\n` +
          `Reason: ${err.message}\n` +
          `Code: ${err.code || "Unknown"}`,
      );
    }
  }
};
