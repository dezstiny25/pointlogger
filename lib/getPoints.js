const { google } = require("googleapis");

module.exports = async function getPoints(callsign) {
  const auth = new google.auth.GoogleAuth({
    keyFile: "credentials.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

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
      range: `${sheetName}!A2:F1000`,
    });

    const rows = res.data.values || [];

    for (let i = 0; i < rows.length; i++) {
      // Callsign in column B (index 1), points in column D (index 3)
      const sheetCallsign = rows[i][1];

      if (
        sheetCallsign &&
        sheetCallsign.toLowerCase() === callsign.toLowerCase()
      ) {
        const currentPoints = parseInt(rows[i][3]) || 0;
        const rank = rows[i][2] || ""; // column C
        const forPromotion = rows[i][4] || ""; // column E
        const rankDesignation = rows[i][5] || ""; // column F
        const regiment = rows[i][0] || ""; // column A
        return {
          success: true,
          points: currentPoints,
          sheet: sheetName,
          rank,
          regiment,
          forPromotion,
          rankDesignation,
        };
      }
    }
  }

  return { success: false, error: `Callsign "${callsign}" not found` };
};
