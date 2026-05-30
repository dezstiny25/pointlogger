module.exports = function getMessageLink(message) {
  return `https://discord.com/channels/${message.guild.id}/${message.channel.id}/${message.id}`;
};
