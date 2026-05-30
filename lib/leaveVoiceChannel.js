const { getVoiceConnection } = require("@discordjs/voice");

module.exports = async function leaveVoiceChannel(client) {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    const connection = getVoiceConnection(guild.id);
    if (connection) {
      connection.destroy();
      console.log("✅ Bot left voice channel");
    }
  } catch (err) {
    console.error("❌ Error leaving voice channel:", err);
  }
};
