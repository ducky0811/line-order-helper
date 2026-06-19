const { google } = require('googleapis');

function createSheetsService() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!email || !rawKey || !spreadsheetId) {
    console.warn('⚠️ 未配置完整 Google Sheets 變數');
    return { saveOrder: async () => null };
  }

  const privateKey = rawKey.trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\{1,2}n/g, '\n')
    .replace(/\r\n/g, '\n');
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email.trim(), private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const client = google.sheets({ version: 'v4', auth });
  console.log('🚀 Google Sheets 服務已載入');

  return {
    async saveOrder(order) {
      await client.spreadsheets.values.append({
        spreadsheetId,
        range: `${process.env.GOOGLE_SHEET_NAME || 'Sheet1'}!A:F`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[order.time, order.summary, '', '', order.total, '未付款']]
        }
      });
    }
  };
}

module.exports = { createSheetsService };
