const { google } = require("googleapis");

const DEFAULT_SHEETS = [
  "1st Infantry Division",
  "Scout Rangers",
  "Light Reaction Regiment",
];

async function authSheets() {
  const auth = new google.auth.GoogleAuth({
    keyFile: "credentials.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({
    version: "v4",
    auth: await auth.getClient(),
  });

  return sheets;
}

async function findRow(callsign, sheetsClient, sheetNames = DEFAULT_SHEETS) {
  for (let sheetName of sheetNames) {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${sheetName}!A2:F1000`,
    });

    const rows = res.data.values || [];

    for (let i = 0; i < rows.length; i++) {
      // Callsign is column B (index 1)
      let sheetCallsign = rows[i][1];

      if (
        sheetCallsign &&
        sheetCallsign.toLowerCase() === callsign.toLowerCase()
      ) {
        // Ensure row has 6 columns (A-F)
        const fullRow = [
          rows[i][0] || "",
          rows[i][1] || "",
          rows[i][2] || "",
          rows[i][3] || "",
          rows[i][4] || "",
          rows[i][5] || "",
        ];

        return { sheetName, rowIndex: i + 2, rowValues: fullRow };
      }
    }
  }

  return null;
}

async function updateSheet(callsign, points, promotionRanks) {
  const sheets = await authSheets();

  const found = await findRow(callsign, sheets);

  if (!found) {
    console.log(`❌ Callsign not found: ${callsign}`);
    return { success: false, error: `Callsign "${callsign}" not found` };
  }

  const { sheetName, rowIndex, rowValues } = found;

  // Points are in column D (index 3)
  const currentPoints = parseInt(rowValues[3]) || 0;
  const newPoints = currentPoints + points;

  // Update column D
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${sheetName}!D${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [[newPoints]] },
  });

  console.log(`${callsign} updated in ${sheetName}`);

  let promotionAlert = null;

  for (const promo of promotionRanks) {
    if (currentPoints < promo.points && newPoints >= promo.points) {
      promotionAlert = `${callsign} is now eligible for promotion to ${promo.rank}!`;
      break;
    }

    if (promo.points - newPoints <= 50 && promo.points - newPoints > 0) {
      promotionAlert = `${callsign} is close to promotion to ${promo.rank} (${promo.points - newPoints} points remaining)`;
      break;
    }
  }

  return { success: true, promotionAlert, sheet: sheetName };
}

async function addTrainee(
  callsign,
  points = 0,
  sheetName = "1st Infantry Division",
  regiment = "",
) {
  const sheets = await authSheets();

  // Read callsign column (B) to find first empty slot
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${sheetName}!B2:B1000`,
  });

  const rows = res.data.values || [];

  let targetRow = null;

  for (let i = 0; i < rows.length; i++) {
    const val = rows[i][0];
    if (!val || String(val).trim() === "") {
      targetRow = i + 2;
      break;
    }
  }

  const rowValues = [
    regiment || "1ID", // Column A: Regiment (default `1ID`)
    callsign, // Column B: Callsign
    "PVT", // Column C: Rank (default `PVT`)
    points, // Column D: Merit/Points
    "60", // Column E: For Promotion (default `60`)
    "OR-1", // Column F: Rank Designation (default `OR-1`)
  ];

  if (targetRow) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${sheetName}!A${targetRow}:F${targetRow}`,
      valueInputOption: "RAW",
      requestBody: { values: [rowValues] },
    });
  } else {
    // No empty slot found; append to sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${sheetName}!A2:F`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowValues] },
    });
  }

  console.log(
    `Trainee ${callsign} added to ${sheetName} at ${targetRow || "append"}`,
  );

  return { success: true, sheet: sheetName, row: targetRow };
}

async function transferToSheet(callsign, targetSheetName, promotionRanks = []) {
  const sheets = await authSheets();

  const found = await findRow(callsign, sheets);

  if (!found) {
    return { success: false, error: `Callsign "${callsign}" not found` };
  }

  const { sheetName, rowIndex, rowValues } = found;

  // Find the first blank row AFTER the last occupied callsign in target sheet column B.
  // This fills gaps at the end of the current SR/LRR block instead of inserting near the top.
  const targetRes = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${targetSheetName}!B2:B1000`,
  });

  const targetRows = targetRes.data.values || [];

  let targetRow = null;

  // find last occupied index
  let lastOccupied = -1;
  for (let i = 0; i < targetRows.length; i++) {
    const val = targetRows[i][0];
    if (val && String(val).trim() !== "") lastOccupied = i;
  }

  // search for first empty slot after lastOccupied
  for (let i = lastOccupied + 1; i < targetRows.length; i++) {
    const val = targetRows[i] && targetRows[i][0];
    if (!val || String(val).trim() === "") {
      targetRow = i + 2;
      break;
    }
  }

  // if nothing found after lastOccupied, append after the last row
  if (!targetRow) {
    targetRow = targetRows.length + 2;
  }

  // Prepare new row values for the target sheet.
  // Keep existing values where possible, but update Regiment (A), Rank (C), For Promotion (E), and Rank Designation (F) for SR/LRR.
  const currentPoints = parseInt(rowValues[3]) || 0;

  // determine current rank: prefer existing C, otherwise infer from promotionRanks
  let currentRank = (rowValues[2] || "").toString().trim();
  if (
    !currentRank &&
    Array.isArray(promotionRanks) &&
    promotionRanks.length > 0
  ) {
    // find highest promo with points <= currentPoints
    let last = null;
    for (const p of promotionRanks) {
      if (currentPoints >= (p.points || 0)) last = p.rank;
    }
    currentRank = last || "PVT";
  }

  // points to next promotion
  let pointsToNext = "";
  if (Array.isArray(promotionRanks) && promotionRanks.length > 0) {
    const next = promotionRanks.find((p) => currentPoints < (p.points || 0));
    if (next) pointsToNext = String((next.points || 0) - currentPoints);
  }

  // regiment tag for target sheet
  let targetRegiment = rowValues[0] || "";
  if (/scout rangers/i.test(targetSheetName)) targetRegiment = "SR";
  else if (/light reaction/i.test(targetSheetName)) targetRegiment = "LRR";

  const newRow = [
    targetRegiment,
    callsign,
    currentRank || "PVT",
    currentPoints,
    pointsToNext,
    rowValues[5] || "",
  ];

  if (targetRow) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${targetSheetName}!A${targetRow}:F${targetRow}`,
      valueInputOption: "RAW",
      requestBody: { values: [newRow] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${targetSheetName}!A2:F`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [newRow] },
    });
  }

  // Clear original full row A:F
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${sheetName}!A${rowIndex}:F${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [["", "", "", "", "", ""]] },
  });

  console.log(
    `Transferred ${callsign} from ${sheetName} to ${targetSheetName} (row ${targetRow || "append"})`,
  );

  return { success: true, from: sheetName, to: targetSheetName, targetRow };
}

async function setPromotion(
  callsign,
  rankLabel,
  rankDesignation,
  promotionRanks = [],
) {
  const sheets = await authSheets();

  const found = await findRow(callsign, sheets);

  if (!found) {
    return { success: false, error: `Callsign "${callsign}" not found` };
  }

  const { sheetName, rowIndex, rowValues } = found;

  // update rank label (C) and rank designation (F)
  const currentPoints = parseInt(rowValues[3]) || 0;

  // compute points to next promotion if promotionRanks provided
  let pointsToNext = rowValues[4] || "";
  if (Array.isArray(promotionRanks) && promotionRanks.length > 0) {
    const next = promotionRanks.find((p) => currentPoints < (p.points || 0));
    if (next) pointsToNext = String((next.points || 0) - currentPoints);
    else pointsToNext = "";
  }

  const newRow = [
    rowValues[0] || "",
    callsign,
    rankLabel || rowValues[2] || "",
    currentPoints,
    pointsToNext,
    rankDesignation || rowValues[5] || "",
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${sheetName}!A${rowIndex}:F${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [newRow] },
  });

  return { success: true, sheet: sheetName, row: rowIndex };
}

module.exports = { updateSheet, addTrainee, transferToSheet, setPromotion };
