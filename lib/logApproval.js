const { google } = require("googleapis");
const getMessageLink = require("./getMessageLink");

module.exports = async function logApproval(
  message,
  approver,
  timestamp,
  status,
) {
  const auth = new google.auth.GoogleAuth({
    keyFile: "credentials.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({
    version: "v4",
    auth: await auth.getClient(),
  });

  const messageLink = getMessageLink(message);

  // check if this exact (messageLink + status) already exists in the Logs sheet to avoid duplicate identical entries
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `Logs!A2:D1000`,
    });

    const rows = res.data.values || [];
    const found = rows.some((r) => {
      const link = r[0] || "";
      const rowStatus = r[3] || "";
      return (
        link === messageLink &&
        String(rowStatus).trim().toLowerCase() ===
          String(status).trim().toLowerCase()
      );
    });

    if (found) {
      return { alreadyLogged: true };
    }
  } catch (err) {
    // if the check fails for some reason, continue to append to avoid losing logs
    console.error("logApproval: error checking existing logs:", err);
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: "Logs!A:D",
    valueInputOption: "RAW",
    requestBody: {
      values: [[messageLink, approver, timestamp, status]],
    },
  });

  return { alreadyLogged: false };
};
