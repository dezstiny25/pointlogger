module.exports = function parseMerit(message) {
  if (!message || !message.content) return [];

  const lines = message.content.split("\n");

  let results = [];

  let isAllMode = false;
  let allPoints = 0;

  let attendeeLines = [];

  let insideAttendees = false;

  for (const line of lines) {
    const cleanLine = line.trim().toLowerCase();

    if (cleanLine.includes("attendees")) {
      insideAttendees = true;
      continue;
    }

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

  const targetLines = attendeeLines.length > 0 ? attendeeLines : lines;

  for (let line of targetLines) {
    let allMatch = line.match(/All\s*-\s*(\d+)/i);

    if (allMatch) {
      isAllMode = true;
      allPoints = parseInt(allMatch[1]);
      break;
    }
  }

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
};
