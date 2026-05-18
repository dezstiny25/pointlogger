require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
} = require("discord.js");

const { google } = require("googleapis");

const { joinVoiceChannel, getVoiceConnection } = require("@discordjs/voice");

// =========================
// CONFIG
// =========================

const EVENT_LOG_CHANNEL_ID = "1495741560464081066";
const APPROVER_ROLE_NAME = "Senior Officer Ranking Access";
const VC_CHANNEL_ID = "1200735025864388638";
const GUILD_ID = "1172162294470426695";

// =========================
// PENDING APPROVALS
// =========================

const pendingApprovals = new Map();

// =========================
// PROMOTION RANKS
// =========================

const promotionRanks = [
  { rank: "PFC", points: 60 },
  { rank: "LCP", points: 210 },
  { rank: "CPL", points: 450 },
  { rank: "CFC", points: 650 },
  { rank: "SGT", points: 1200 },
  { rank: "TSGT", points: 1500 },
  { rank: "SFC", points: 1800 },
  { rank: "MSG", points: 2250 },
  { rank: "CMS", points: 3300 },
  { rank: "2LT", points: 3600 },
  { rank: "LT", points: 3900 },
  { rank: "CPT", points: 4500 },
  { rank: "MAJ", points: 6500 },
  { rank: "LTC", points: 8000 },
  { rank: "COL", points: 10000 },
  { rank: "BGEN", points: 13000 },
  { rank: "MGEN", points: 16000 },
  { rank: "LTGEN", points: 19000 },
  { rank: "GEN", points: 22000 },
];

// =========================
// RANK LADDER
// =========================

const rankHierarchy = [
  {
    tag: "OR-1",
    roleId: "1172164122343919677",
    roleName: "[OR-1] | Private",
    nextTag: "OR-2",
    nextRoleId: "1172164461042356295",
    nextRoleName: "[OR-2] | Private First Class",
  },

  {
    tag: "OR-2",
    roleId: "1172164461042356295",
    roleName: "[OR-2] | Private First Class",
    nextTag: "OR-3",
    nextRoleId: "1441624526692548830",
    nextRoleName: "[OR-3] | Lance Corporal",
  },

  {
    tag: "OR-3",
    roleId: "1441624526692548830",
    roleName: "[OR-3] | Lance Corporal",
    nextTag: "OR-4",
    nextRoleId: "1172166076688248955",
    nextRoleName: "[OR-4] | Corporal",
  },
];

// =========================
// DISCORD CLIENT
// =========================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
  ],

  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// =========================
// GOOGLE SHEETS AUTH
// =========================

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

// =========================
// HELPER: MESSAGE LINK
// =========================

function getMessageLink(message) {
  return `https://discord.com/channels/${message.guild.id}/${message.channel.id}/${message.id}`;
}

// =========================
// LOG TO LOGS SHEET
// =========================

async function logApproval(message, approver, timestamp, status) {
  const sheets = google.sheets({
    version: "v4",
    auth: await auth.getClient(),
  });

  const messageLink = getMessageLink(message);

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SPREADSHEET_ID,

    range: "Logs!A:D",

    valueInputOption: "RAW",

    requestBody: {
      values: [[messageLink, approver, timestamp, status]],
    },
  });
}

// =========================
// UPDATE SHEET
// =========================

async function updateSheet(callsign, points) {
  const sheets = google.sheets({
    version: "v4",
    auth: await auth.getClient(),
  });

  const sheetNames = [
    "1st Infantry Division",
    "Scout Rangers",
    "Light Reaction Regiment",
  ];

  for (let sheetName of sheetNames) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${sheetName}!B2:D100`,
    });

    const rows = res.data.values || [];

    for (let i = 0; i < rows.length; i++) {
      let sheetCallsign = rows[i][0];

      if (
        sheetCallsign &&
        sheetCallsign.toLowerCase() === callsign.toLowerCase()
      ) {
        let currentPoints = parseInt(rows[i][2]) || 0;

        let newPoints = currentPoints + points;

        await sheets.spreadsheets.values.update({
          spreadsheetId: process.env.SPREADSHEET_ID,

          range: `${sheetName}!D${i + 2}`,

          valueInputOption: "RAW",

          requestBody: {
            values: [[newPoints]],
          },
        });

        console.log(`${callsign} updated in ${sheetName}`);

        // =========================
        // PROMOTION ALERT CHECK
        // =========================

        let promotionAlert = null;

        for (const promo of promotionRanks) {
          // Exact / eligible
          if (currentPoints < promo.points && newPoints >= promo.points) {
            promotionAlert = `${callsign} is now eligible for promotion to ${promo.rank}!`;

            break;
          }

          // Close to promotion
          if (promo.points - newPoints <= 50 && promo.points - newPoints > 0) {
            promotionAlert = `${callsign} is close to promotion to ${promo.rank} (${promo.points - newPoints} points remaining)`;

            break;
          }
        }

        return {
          success: true,
          promotionAlert,
        };
      }
    }
  }

  console.log(`❌ Callsign not found: ${callsign}`);

  return {
    success: false,
    error: `Callsign "${callsign}" not found`,
  };
}

// =========================
// PARSE MERIT
// =========================

function parseMerit(message) {
  if (!message || !message.content) return [];

  const lines = message.content.split("\n");

  let results = [];

  let isAllMode = false;
  let allPoints = 0;

  // =========================
  // FIND ATTENDEES SECTION
  // =========================

  let attendeeLines = [];

  let insideAttendees = false;

  for (const line of lines) {
    const cleanLine = line.trim().toLowerCase();

    // Detect Attendees section
    if (cleanLine.includes("attendees")) {
      insideAttendees = true;
      continue;
    }

    // Stop when another section starts
    if (
      insideAttendees &&
      (cleanLine.includes("officer in charge") ||
        cleanLine.includes("supervising officer") ||
        cleanLine.includes("instructor") ||
        cleanLine.includes("hosts") ||
        cleanLine.includes("remarks"))
    ) {
      insideAttendees = false;
    }

    if (insideAttendees) {
      attendeeLines.push(line);
    }
  }

  // Use ONLY attendee lines
  const targetLines = attendeeLines.length > 0 ? attendeeLines : lines;

  // =========================
  // CHECK ALL MODE
  // =========================

  for (let line of targetLines) {
    let allMatch = line.match(/All\s*-\s*(\d+)/i);

    if (allMatch) {
      isAllMode = true;
      allPoints = parseInt(allMatch[1]);
      break;
    }
  }

  // =========================
  // ALL MODE
  // =========================

  if (isAllMode) {
    for (let line of targetLines) {
      let mentionMatch = line.match(/<@!?(\d+)>/);

      if (!mentionMatch) continue;

      let userId = mentionMatch[1];

      let member = message.guild.members.cache.get(userId);

      if (!member) continue;

      let nickname = member.nickname || member.user.username;

      let parts = nickname.split("|").map((p) => p.trim());

      if (parts.length < 2) continue;

      let callsign = parts[1];

      results.push({
        userId: userId,
        callsign,
        points: allPoints,
      });
    }

    return results;
  }

  // =========================
  // INDIVIDUAL MODE
  // =========================

  for (let line of targetLines) {
    if (!line.includes("-")) continue;

    let mentionMatch = line.match(/<@!?(\d+)>/);

    if (!mentionMatch) continue;

    let userId = mentionMatch[1];

    let member = message.guild.members.cache.get(userId);

    if (!member) continue;

    let nickname = member.nickname || member.user.username;

    let parts = nickname.split("|").map((p) => p.trim());

    if (parts.length < 2) continue;

    let callsign = parts[1];

    let pointsMatch = line.match(/-\s*(\d+)/);

    if (!pointsMatch) continue;

    let points = parseInt(pointsMatch[1]);

    results.push({
      userId: userId,
      callsign,
      points,
    });
  }

  return results;
}
// =========================
// EVENT LOG DETECTION
// =========================

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;

    if (message.channel.id !== EVENT_LOG_CHANNEL_ID) return;

    const entries = parseMerit(message);

    if (entries.length === 0) return;

    // =========================
    // ATTACHMENT / IMAGE
    // =========================

    let embedImage = null;

    // Find first uploaded image
    message.attachments.forEach((attachment) => {
      if (
        attachment.contentType &&
        attachment.contentType.startsWith("image/") &&
        !embedImage
      ) {
        embedImage = attachment.url;
      }
    });

    // =========================
    // EMBED
    // =========================

    const firstLine =
      (message.content || "").split("\n").find((l) => l.trim().length > 0) ||
      "Event";
    // strip any leading hash marks and whitespace (e.g. '# Casual Deployment')
    const rawTitle = firstLine.replace(/^#+\s*/, "").trim();
    const eventTitle =
      rawTitle.length > 100 ? rawTitle.slice(0, 97) + "..." : rawTitle;

    // replace a leading '# [Event Title]' line in the message content with
    // '# 📋Event Log for [Event Title]' (note: no space after the emoji)
    let modifiedContent = message.content || "";
    const contentLines = modifiedContent.split("\n");
    const firstNonEmptyIndex = contentLines.findIndex(
      (l) => l.trim().length > 0,
    );

    if (
      firstNonEmptyIndex !== -1 &&
      contentLines[firstNonEmptyIndex].trim().startsWith("#")
    ) {
      contentLines[firstNonEmptyIndex] = `# 📋|Mission Log for ${eventTitle}`;
      modifiedContent = contentLines.join("\n");
    }

    const approvalEmbed = new EmbedBuilder()
      .setTitle("✅ FOR APPROVAL")
      .setDescription(modifiedContent)
      .setColor("Yellow")
      .setTimestamp();

    // Put uploaded image inside embed
    if (embedImage) {
      approvalEmbed.setImage(embedImage);
    }

    // =========================
    // SEND APPROVAL MESSAGE
    // =========================

    const approvalMessage = await message.reply({
      embeds: [approvalEmbed],

      allowedMentions: {
        repliedUser: false,
      },
    });

    // Add reaction
    await approvalMessage.react("✅");
    await approvalMessage.react("❌");
    // Store pending
    pendingApprovals.set(approvalMessage.id, {
      originalMessageId: message.id,
      entries,
      embedImage,
    });

    // =========================
    // LOG PENDING
    // =========================

    const pendingTimestamp = new Date().toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
    });

    await logApproval(approvalMessage, "N/A", pendingTimestamp, "Pending");

    console.log(`Approval created: ${approvalMessage.id}`);
  } catch (err) {
    console.error(err);
  }
});

// =========================
// RANK / REGIMENT HELPERS
// =========================

const ENLISTED_RANKS = [
  "1348240606236770357",
  "1172164122343919677",
  "1172164461042356295",
  "[OR-3] | Lance Corporal",
  "[OR-4] | Corporal",
  "[OR-5] | Corporal First Class",
  "[OR-6] | Sergeant",
  "[OR-7] | Technical Sergeant",
  "[OR-8] | Senior First Sergeant",
  "[OR-9] | Master Sergeant",
];

async function removeRolesByName(
  member,
  roleNames,
  guild,
  roleErrors,
  roleSummaryMap,
) {
  const botMember =
    guild.members.me || (await guild.members.fetch(client.user.id));

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
      // hierarchy check
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
}

// =========================
// APPROVAL SYSTEM
// =========================

client.on("messageReactionAdd", async (reaction, user) => {
  try {
    if (user.bot) return;

    if (reaction.partial) await reaction.fetch();

    const emoji = reaction.emoji.name;

    const messageId = reaction.message.id;

    if (!pendingApprovals.has(messageId)) return;

    const member = await reaction.message.guild.members.fetch(user.id);

    // =========================
    // ROLE CHECK
    // =========================

    const hasRole = member.roles.cache.some(
      (role) => role.name === APPROVER_ROLE_NAME,
    );

    if (!hasRole) {
      console.log(
        `${user.username} tried approving/denying without permission`,
      );
      return;
    }

    const data = pendingApprovals.get(messageId);

    if (emoji === "✅") {
      const errors = [];
      const promotionAlerts = [];

      // =========================
      // UPDATE ALL ENTRIES
      // =========================

      for (const entry of data.entries) {
        const result = await updateSheet(entry.callsign, entry.points);

        if (!result.success) {
          errors.push(result.error);
        }

        if (result.promotionAlert) {
          promotionAlerts.push(result.promotionAlert);
        }
      }

      // =========================
      // TIMESTAMP
      // =========================

      const timestamp = new Date().toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
      });

      // =========================
      // LOG APPROVED
      // =========================

      await logApproval(reaction.message, user.username, timestamp, "Approved");

      // =========================
      // APPROVED EMBED
      // =========================

      const approvedEmbed = new EmbedBuilder()
        .setTitle("✅ POINTS LOGGED TO SHEETS")
        .setColor("Green")
        .addFields(
          {
            name: "Approved By",
            value: `<@${user.id}>`,
          },
          {
            name: "Timestamp",
            value: timestamp,
          },
        )
        .setDescription(reaction.message.embeds[0]?.description || "No content")
        .setTimestamp();
      if (data.embedImage) {
        approvedEmbed.setImage(data.embedImage);
      }

      // =========================
      // PROMOTION ALERTS
      // =========================

      if (promotionAlerts.length > 0) {
        approvedEmbed.addFields({
          name: "🎖️ Promotion Alerts",
          value: promotionAlerts.join("\n"),
        });
      }

      // =========================
      // ERRORS
      // =========================

      if (errors.length > 0) {
        approvedEmbed.addFields({
          name: "⚠️ Errors",
          value: errors.join("\n"),
        });
      }

      // =========================
      // EVENT ROLE ASSIGNMENT (BMT / SR / LRR)
      // =========================

      const roleSummaryMap = new Map();
      const roleErrors = [];

      const ensureSummary = (member) => {
        const id = member.id;
        const tag = member.user ? member.user.tag : String(member.id);
        if (!roleSummaryMap.has(id)) {
          roleSummaryMap.set(id, {
            tag,
            added: [],
            removed: [],
            already: [],
            nicknames: [],
          });
        }
        return roleSummaryMap.get(id);
      };

      try {
        const originalMsg = await reaction.message.channel.messages.fetch(
          data.originalMessageId,
        );

        const firstLine =
          (originalMsg.content || "")
            .split("\n")
            .find((l) => l.trim().length > 0) || "Event";
        const rawTitle = firstLine.replace(/^#+\s*/, "").trim();
        const eventTitle = rawTitle;
        const eventNormalized = eventTitle.toLowerCase();

        // helper to add roles by name with permission/position checks
        // helper to add roles by ROLE NAME
        const addRolesToMember = async (member, roleNames) => {
          const guild = reaction.message.guild;

          const botMember =
            guild.members.me || (await guild.members.fetch(client.user.id));

          if (!botMember) {
            roleErrors.push(`❌ Bot member could not be fetched`);
            return;
          }

          // =========================
          // BOT PERMISSION CHECKS
          // =========================

          if (!botMember.permissions.has("ManageRoles")) {
            roleErrors.push(`❌ Bot lacks "Manage Roles" permission in server`);
            return;
          }

          for (const roleName of roleNames) {
            let role = null;

            if (/^\d+$/.test(String(roleName).trim())) {
              role = guild.roles.cache.get(String(roleName).trim());
            } else {
              role = guild.roles.cache.find(
                (r) => r.name.trim() === String(roleName).trim(),
              );
            }

            // =========================
            // ROLE NOT FOUND
            // =========================

            if (!role) {
              roleErrors.push(`❌ Role not found: "${roleName}"`);
              continue;
            }

            // =========================
            // DEBUG INFO
            // =========================

            console.log(`\n========== ROLE DEBUG ==========`);
            console.log(`Target Member: ${member.user.tag}`);
            console.log(`Role: ${role.name}`);
            console.log(`Role Position: ${role.position}`);
            console.log(`Bot Highest Role: ${botMember.roles.highest.name}`);
            console.log(
              `Bot Highest Position: ${botMember.roles.highest.position}`,
            );
            console.log(`Target Highest Role: ${member.roles.highest.name}`);
            console.log(
              `Target Highest Position: ${member.roles.highest.position}`,
            );

            // =========================
            // ROLE HIERARCHY
            // =========================

            if (role.position >= botMember.roles.highest.position) {
              roleErrors.push(
                `❌ Cannot assign "${role.name}" because the role is ABOVE the bot role.\n` +
                  `Role Position: ${role.position}\n` +
                  `Bot Highest: ${botMember.roles.highest.position}`,
              );

              continue;
            }

            // =========================
            // MEMBER HIERARCHY
            // =========================

            if (
              member.roles.highest.position >= botMember.roles.highest.position
            ) {
              roleErrors.push(
                `❌ Cannot modify ${member.user.tag} because their highest role is equal/higher than the bot.\n` +
                  `Member Highest: ${member.roles.highest.name} (${member.roles.highest.position})\n` +
                  `Bot Highest: ${botMember.roles.highest.name} (${botMember.roles.highest.position})`,
              );

              continue;
            }

            // =========================
            // MANAGED ROLE CHECK
            // =========================

            if (role.managed) {
              roleErrors.push(
                `❌ Cannot assign "${role.name}" because it is a managed/integration role.`,
              );

              continue;
            }

            // =========================
            // OWNER CHECK
            // =========================

            if (member.id === guild.ownerId) {
              roleErrors.push(
                `❌ Cannot modify server owner (${member.user.tag})`,
              );

              continue;
            }

            // =========================
            // ADD ROLE
            // =========================

            try {
              if (!member.roles.cache.has(role.id)) {
                await member.roles.add(role);

                const s = ensureSummary(member);
                s.added.push(role.name);
              } else {
                const s = ensureSummary(member);
                s.already.push(role.name);
              }
            } catch (err) {
              roleErrors.push(
                `❌ Failed adding "${role.name}" to ${member.user.tag}\n` +
                  `Reason: ${err.message}\n` +
                  `Code: ${err.code || "Unknown"}\n` +
                  `HTTP Status: ${err.status || "Unknown"}`,
              );

              console.error(err);
            }
          }
        };

        // Role identifiers (IDs preferred)
        const ROLE_NAMES = {
          // Regiment
          REGIMENT_LABEL: "1353400430989672619",
          FIRST_INF_DIV: "1353051881223749724",
          SCOUT_RANGER: "1353051459561852929",
          LIGHT_REACTION: "1353051283551944754",

          // Weapon Qualifications
          WEAPON_QUAL_LABEL: "1480810210556776468",
          RIFLE_BASIC: "1462329070342635552",

          // Qualifications
          QUALIFICATIONS_LABEL: "1455599658331144334",
          BMT_QUALIFIED: "1439121940957761697",

          // Ranks
          OR_0_TRAINEE: "1348240606236770357",
          OR_1_PRIVATE: "1172164122343919677",
          OR_2_PFC: "1172164461042356295",
        };
        // Decide which events to act on
        const isBMT = /basic military training|\bbmt\b/i.test(eventNormalized);
        const isSR = /sr selection|scout rangers/i.test(eventNormalized);
        const isLRR = /lrr selection|light reaction/i.test(eventNormalized);

        for (const entry of data.entries) {
          if (!entry.userId) continue;

          let targetMember = null;

          try {
            targetMember = await reaction.message.guild.members.fetch(
              entry.userId,
            );
          } catch (err) {
            roleErrors.push(
              `Failed to fetch member for ID ${entry.userId}: ${err.message}`,
            );
            continue;
          }

          if (isBMT) {
            const rolesToAdd = [
              ROLE_NAMES.OR_1_PRIVATE,

              ROLE_NAMES.WEAPON_QUAL_LABEL,
              ROLE_NAMES.RIFLE_BASIC,

              ROLE_NAMES.QUALIFICATIONS_LABEL,
              ROLE_NAMES.BMT_QUALIFIED,

              ROLE_NAMES.REGIMENT_LABEL,
              ROLE_NAMES.FIRST_INF_DIV,
            ];

            await addRolesToMember(targetMember, rolesToAdd);

            // Remove OR-0 Trainee role if present
            try {
              const botMember =
                reaction.message.guild.members.me ||
                (await reaction.message.guild.members.fetch(client.user.id));

              if (!botMember) {
                roleErrors.push(`Bot member not found in guild`);
              } else if (!botMember.permissions.has("ManageRoles")) {
                roleErrors.push(
                  `Bot missing Manage Roles permission (required to remove OR-0)`,
                );
              } else {
                const or0Role = reaction.message.guild.roles.cache.get(
                  ROLE_NAMES.OR_0_TRAINEE,
                );
                if (or0Role && targetMember.roles.cache.has(or0Role.id)) {
                  if (or0Role.position >= botMember.roles.highest.position) {
                    roleErrors.push(
                      `Cannot remove OR-0 role because it is higher than the bot's highest role`,
                    );
                  } else {
                    await targetMember.roles.remove(or0Role);
                    const s = ensureSummary(targetMember);
                    s.removed.push(or0Role.name || or0Role.id);
                  }
                }
              }
            } catch (err) {
              roleErrors.push(
                `Failed to remove OR-0 from ${targetMember.user.tag}: ${err.message}`,
              );
            }

            // nickname update: replace [OR-0] with [OR-1]
            try {
              const botMember =
                reaction.message.guild.members.me ||
                (await reaction.message.guild.members.fetch(client.user.id));

              if (!botMember) {
                roleErrors.push(`Bot member not found in guild`);
              } else if (!botMember.permissions.has("ManageNicknames")) {
                roleErrors.push(`Bot missing Manage Nicknames permission`);
              } else if (
                botMember.roles.highest.position <=
                targetMember.roles.highest.position
              ) {
                roleErrors.push(
                  `Cannot change nickname for ${targetMember.user.tag} because their highest role is equal or higher than the bot`,
                );
              } else {
                const currentNick =
                  targetMember.nickname || targetMember.user.username;

                if (/\[OR-0\]/i.test(currentNick)) {
                  const newNick = currentNick.replace(/\[OR-0\]/i, "[OR-1]");
                  if (newNick !== currentNick) {
                    await targetMember.setNickname(newNick);
                    const s = ensureSummary(targetMember);
                    s.nicknames.push(newNick);
                  }
                } else {
                  // no OR-0 found; still report roles added
                  const s = ensureSummary(targetMember);
                  // mark as updated without specifics
                  s.added.push("(roles added)");
                }
              }
            } catch (err) {
              roleErrors.push(
                `Failed to update nickname for ${targetMember.user.tag}: ${err.message}`,
              );
            }
          } else if (isSR) {
            // Remove old ranks
            await removeRolesByName(
              targetMember,
              ENLISTED_RANKS,
              reaction.message.guild,
              roleErrors,
              roleSummaryMap,
            );

            // Remove Infantry Division
            await removeRolesByName(
              targetMember,
              [ROLE_NAMES.FIRST_INF_DIV],
              reaction.message.guild,
              roleErrors,
              roleSummaryMap,
            );

            // Add SR roles
            const rolesToAdd = [
              ROLE_NAMES.OR_2_PFC,
              ROLE_NAMES.REGIMENT_LABEL,
              ROLE_NAMES.SCOUT_RANGER,
            ];

            await addRolesToMember(targetMember, rolesToAdd);

            // Nickname update
            try {
              const currentNick =
                targetMember.nickname || targetMember.user.username;

              const parts = currentNick.split("|").map((p) => p.trim());

              if (parts.length >= 3) {
                const callsign = parts[1];
                const ign = parts[2];

                const newNick = `[OR-2] | ${callsign} | ${ign}`;

                await targetMember.setNickname(newNick);

                const s = ensureSummary(targetMember);
                s.nicknames.push(newNick);
              }
            } catch (err) {
              roleErrors.push(
                `Failed nickname update for ${targetMember.user.tag}: ${err.message}`,
              );
            }
          } else if (isLRR) {
            // Remove old ranks
            await removeRolesByName(
              targetMember,
              ENLISTED_RANKS,
              reaction.message.guild,
              roleErrors,
              roleSummaryMap,
            );

            // Remove Infantry Division
            await removeRolesByName(
              targetMember,
              [ROLE_NAMES.FIRST_INF_DIV],
              reaction.message.guild,
              roleErrors,
              roleSummaryMap,
            );

            // Add LRR roles
            const rolesToAdd = [
              ROLE_NAMES.OR_2_PFC,
              ROLE_NAMES.REGIMENT_LABEL,
              ROLE_NAMES.LIGHT_REACTION,
            ];

            await addRolesToMember(targetMember, rolesToAdd);

            // Nickname update
            try {
              const currentNick =
                targetMember.nickname || targetMember.user.username;

              const parts = currentNick.split("|").map((p) => p.trim());

              if (parts.length >= 3) {
                const callsign = parts[1];
                const ign = parts[2];

                const newNick = `[OR-2] | ${callsign} | ${ign}`;

                await targetMember.setNickname(newNick);

                const s = ensureSummary(targetMember);
                s.nicknames.push(newNick);
              }
            } catch (err) {
              roleErrors.push(
                `Failed nickname update for ${targetMember.user.tag}: ${err.message}`,
              );
            }
          }
        }
      } catch (err) {
        roleErrors.push(`Event role assignment failed: ${err.message}`);
      }

      if (roleSummaryMap.size > 0) {
        const summaries = [];

        for (const [id, entry] of roleSummaryMap) {
          const tag = entry.tag || id;

          if (entry.added.length > 0 && entry.already.length === 0) {
            summaries.push(`${tag} - updated all roles`);
          } else if (entry.added.length > 0 && entry.already.length > 0) {
            summaries.push(
              `${tag} - updated roles except for: ${entry.already.join(", ")}`,
            );
          } else if (entry.added.length === 0 && entry.already.length > 0) {
            summaries.push(
              `${tag} - no new roles; already had: ${entry.already.join(", ")}`,
            );
          } else if (entry.removed.length > 0 && entry.added.length === 0) {
            summaries.push(
              `${tag} - removed roles: ${entry.removed.join(", ")}`,
            );
          } else if (entry.nicknames.length > 0 && entry.added.length === 0) {
            summaries.push(
              `${tag} - nickname updated to ${entry.nicknames.join(", ")}`,
            );
          } else {
            // Generic fallback
            const parts = [];
            if (entry.added.length)
              parts.push(`added: ${entry.added.join(", ")}`);
            if (entry.already.length)
              parts.push(`already: ${entry.already.join(", ")}`);
            if (entry.removed.length)
              parts.push(`removed: ${entry.removed.join(", ")}`);
            if (entry.nicknames.length)
              parts.push(`nickname: ${entry.nicknames.join(", ")}`);

            summaries.push(`${tag} - ${parts.join("; ")}`);
          }
        }

        approvedEmbed.addFields({
          name: "✅ Roles Assigned",
          value: summaries.join("\n"),
        });
      }

      if (roleErrors.length > 0) {
        approvedEmbed.addFields({
          name: "⚠️ Role Errors",
          value: roleErrors.join("\n"),
        });
      }

      // =========================
      // EDIT MESSAGE
      // =========================

      await reaction.message.edit({
        embeds: [approvedEmbed],
      });

      // Remove pending
      pendingApprovals.delete(messageId);

      console.log(`Approved by ${user.username}`);
    } else if (emoji === "❌") {
      // Deny flow
      const timestamp = new Date().toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
      });

      await logApproval(reaction.message, user.username, timestamp, "Denied");

      const deniedEmbed = new EmbedBuilder()
        .setTitle("❌ POINTS DENIED")
        .setColor("Red")
        .addFields(
          {
            name: "Denied By",
            value: `<@${user.id}>`,
          },
          {
            name: "Timestamp",
            value: timestamp,
          },
        )
        .setDescription(reaction.message.embeds[0]?.description || "No content")
        .setTimestamp();
      // Re-add original image
      if (data.embedImage) {
        deniedEmbed.setImage(data.embedImage);
      }

      await reaction.message.edit({ embeds: [deniedEmbed] });

      // Remove pending
      pendingApprovals.delete(messageId);

      console.log(`Denied by ${user.username}`);
    }
  } catch (err) {
    console.error(err);
  }
});

// =========================
// READY EVENT - JOIN VC
// =========================

client.on("ready", async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);

  try {
    console.log(`\n========== BOT GUILD ACCESS ==========`);

    client.guilds.cache.forEach((g) => {
      console.log(`- ${g.name} (${g.id})`);
    });

    console.log(`=====================================\n`);

    // IMPORTANT:
    const guild = client.guilds.cache.get(GUILD_ID);

    if (!guild) {
      console.error(`❌ Guild not found: ${GUILD_ID}`);
      return;
    }

    console.log(`🔗 Connected to guild: ${guild.name}`);

    const voiceChannel = guild.channels.cache.get(VC_CHANNEL_ID);

    if (!voiceChannel) {
      console.error(`❌ Voice channel not found: ${VC_CHANNEL_ID}`);
      return;
    }

    console.log(`🎙️ Attempting to join VC: ${voiceChannel.name}`);

    joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    console.log(`✅ Successfully joined VC`);
  } catch (err) {
    console.error("❌ VC JOIN ERROR:", err);
  }
});

// =========================
// SHUTDOWN - LEAVE VC
// =========================

async function leaveVoiceChannel() {
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
}

process.on("SIGTERM", async () => {
  console.log("📍 SIGTERM received, shutting down gracefully...");
  await leaveVoiceChannel();
  client.destroy();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("📍 SIGINT received, shutting down gracefully...");
  await leaveVoiceChannel();
  client.destroy();
  process.exit(0);
});

// =========================
// REGISTER SLASH COMMANDS
// =========================

client.once("ready", async () => {
  try {
    const commands = [
      new SlashCommandBuilder()
        .setName("promote")
        .setDescription("Promote mentioned personnel")
        .addUserOption((option) =>
          option
            .setName("user1")
            .setDescription("First user")
            .setRequired(true),
        )

        .addUserOption((option) =>
          option
            .setName("user2")
            .setDescription("Second user")
            .setRequired(false),
        )

        .addUserOption((option) =>
          option
            .setName("user3")
            .setDescription("Third user")
            .setRequired(false),
        ),
    ].map((command) => command.toJSON());

    const rest = new REST({ version: "10" }).setToken(
      process.env.DISCORD_TOKEN,
    );

    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
      body: commands,
    });

    console.log("✅ Slash commands registered");
  } catch (err) {
    console.error(err);
  }
});

// =========================
// PROMOTE COMMAND
// =========================

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "promote") return;

  const member = interaction.member;

  const hasRole = member.roles.cache.some(
    (role) => role.name === APPROVER_ROLE_NAME,
  );

  if (!hasRole) {
    return interaction.reply({
      content: "❌ You do not have permission to use this command.",
      ephemeral: true,
    });
  }

  const users = [
    interaction.options.getUser("user1"),
    interaction.options.getUser("user2"),
    interaction.options.getUser("user3"),
  ].filter(Boolean);

  const results = [];

  const botMember = await interaction.guild.members.fetchMe();

  for (const user of users) {
    try {
      const targetMember = await interaction.guild.members.fetch(user.id);

      const nickname = targetMember.nickname || targetMember.user.username;

      const rankMatch = nickname.match(/\[(OR-\d+)\]/i);

      if (!rankMatch) {
        results.push(`${user} - ❌ Rank tag not found`);
        continue;
      }

      const currentTag = rankMatch[1];
      const currentRank = rankHierarchy.find((r) => r.tag === currentTag);

      if (!currentRank) {
        results.push(`${user} - ❌ Rank not configured`);
        continue;
      }

      const oldRole = interaction.guild.roles.cache.get(currentRank.roleId);
      const newRole = interaction.guild.roles.cache.get(currentRank.nextRoleId);

      if (!newRole) {
        results.push(`${user} - ❌ Next rank role not found`);
        continue;
      }

      console.log("========== PROMOTION DEBUG ==========");
      console.log("Target:", targetMember.user.tag);
      console.log("Bot:", botMember.user.tag);
      console.log("Bot Position:", botMember.roles.highest.position);
      console.log("Target Position:", targetMember.roles.highest.position);
      console.log("Old Role:", oldRole?.name, oldRole?.position);
      console.log("New Role:", newRole.name, newRole.position);
      console.log("====================================");

      // =========================
      // REMOVE OLD ROLE (SAFE)
      // =========================
      try {
        if (oldRole && targetMember.roles.cache.has(oldRole.id)) {
          if (oldRole.position >= botMember.roles.highest.position) {
            results.push(`${user} - ⚠️ Cannot remove old role (hierarchy)`);
          } else {
            await targetMember.roles.remove(oldRole);
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      } catch (err) {
        console.log("REMOVE ERROR:", err);
        results.push(`${user} - ⚠️ Failed to remove old role`);
        continue;
      }

      // REFRESH MEMBER AFTER ROLE CHANGE
      const refreshedMember = await interaction.guild.members.fetch(user.id);

      // =========================
      // ADD NEW ROLE (SAFE)
      // =========================
      try {
        if (newRole.position >= botMember.roles.highest.position) {
          results.push(`${user} - ❌ Cannot assign new role (hierarchy)`);
          continue;
        }

        await refreshedMember.roles.add(newRole);
      } catch (err) {
        console.log("ADD ERROR:", err);
        results.push(`${user} - ❌ Failed to add new role`);
        continue;
      }

      // =========================
      // UPDATE NICKNAME
      // =========================
      try {
        const newNickname = nickname.replace(
          `[${currentRank.tag}]`,
          `[${currentRank.nextTag}]`,
        );

        await refreshedMember.setNickname(newNickname);
      } catch (err) {
        console.log("NICKNAME ERROR:", err);
      }

      results.push(`${user} - Promoted to ${currentRank.nextRoleName}`);
    } catch (err) {
      console.error(err);
      results.push(`${user} - ❌ Promotion failed`);
    }
  }

  await interaction.reply({
    content:
      `# <:PUAF:1504174549451800677> Personnel Promotions <:PUAF:1504174549451800677>\n\n` +
      results.join("\n\n") +
      `\n\n### Congratulations 🎉`,
  });
});

// =========================
// LOGIN
// =========================

client.login(process.env.DISCORD_TOKEN);
