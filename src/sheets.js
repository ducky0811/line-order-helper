const { google } = require('googleapis');

function createSheetsService() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!email || !rawKey) {
    console.warn('⚠️ 未配置 Google Sheets 服務帳號 Email 或 Private Key');
    return { available: false, serviceAccountEmail: email || '', saveOrder: async () => null, verify: async () => { throw new Error('系統尚未設定 Google Sheets 服務帳號'); } };
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
    available: true,
    serviceAccountEmail: email.trim(),
    async verify(config = {}) {
      const targetId = config.spreadsheet_id || spreadsheetId;
      if (!targetId) throw new Error('請貼上 Google 試算表網址');
      const result = await client.spreadsheets.get({ spreadsheetId: targetId, fields: 'spreadsheetId,sheets.properties.title' });
      const targetSheet = config.sheet_name || process.env.GOOGLE_SHEET_NAME || 'Sheet1';
      if (!result.data.sheets?.some(item => item.properties?.title === targetSheet)) throw new Error(`找不到名為「${targetSheet}」的工作表`);
      const range = `'${String(targetSheet).replace(/'/g, "''")}'!A1:J1`;
      const existing = await client.spreadsheets.values.get({ spreadsheetId: targetId, range });
      if (!existing.data.values?.length) await client.spreadsheets.values.update({ spreadsheetId: targetId, range, valueInputOption: 'RAW', requestBody: { values: [['訂單時間', '訂單編號', '客戶姓名', '電話', '商品內容', '取貨方式', '取貨時間', '總金額', '付款方式', '付款狀態']] } });
      return true;
    },
    async saveOrder(order, config = {}) {
      const targetId = config.spreadsheet_id || spreadsheetId;
      if (!targetId) return null;
      const targetSheet = config.sheet_name || process.env.GOOGLE_SHEET_NAME || 'Sheet1';
      await client.spreadsheets.values.append({
        spreadsheetId: targetId,
        range: `'${String(targetSheet).replace(/'/g, "''")}'!A:J`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[order.time, order.id ? `#${String(order.id).slice(0, 8)}` : '', order.customer_name || '', order.phone || '', order.summary, order.fulfillment || '', order.pickup_time || '', order.total, order.payment_method === 'bank_transfer' ? '銀行轉帳' : '現金取貨', '未付款']]
        }
      });
    }
  };
}

module.exports = { createSheetsService };
