const express = require('express');
const line = require('@line/bot-sdk');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const app = express();

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const lineClient = new line.messagingApi.MessagingApiClient({ 
  channelAccessToken: config.channelAccessToken 
});

// 1. 載入菜單
let menu = [];
try {
  const menuPath = path.join(__dirname, 'menu.json');
  const menuData = fs.readFileSync(menuPath, 'utf-8');
  menu = JSON.parse(menuData);
  console.log('🎉 菜單載入成功！');
} catch (error) {
  console.error('❌ 載入 menu.json 失敗：', error);
}

// 2. 初始化 Google Sheets 認證（終極自動讀卡機版）
// 2. 初始化 Google Sheets 認證（直接讀取 JS 金鑰晶片）
// 2. 初始化 Google Sheets 認證（回歸標準環境變數版）
let sheetsClient = null;
try {
  let authConfig = null;
  // 💡 直接讀取妳在 Zeabur 後台填好的那兩個格子
  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    authConfig = {
      clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
      privateKey: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') // 自動處理換行
    };
  } 

  if (authConfig && process.env.GOOGLE_SHEET_ID) {
    const googleAuthClient = new google.auth.GoogleAuth({
      credentials: {
        client_email: authConfig.clientEmail,
        private_key: authConfig.privateKey
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    sheetsClient = google.sheets({ version: 'v4', auth: googleAuthClient });
    console.log('🚀 Google Sheets 自動排單後台：雲端載入通電成功！'); // 💡 成功時會改噴這行
  } else {
    console.warn('⚠️ 未配置完整試算表變數，目前運作基礎版。');
  }
} catch (err) {
  console.error('❌ Google Sheets 認證模組發生錯誤：', err);
}
// 🧠 購物車記憶小本本
const userCarts = {};

// 3. 處理 LINE Webhook 路由
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// 4. 寫入試算表邏輯（整單累加寫入）
async function saveOrderToGoogleSheet(time, summary, total) {
  if (!sheetsClient || !process.env.GOOGLE_SHEET_ID) return;
  try {
    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:F', // 💡 預設強制寫入 Sheet1，請確保試算表左下角名字正確
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[time, summary, '', '', total, '未付款']]
      },
    });
    console.log(`📊 累加訂單 [${summary}] 成功同步到雲端試算表！`);
  } catch (err) {
    console.error('❌ 寫入 Google Sheets 失敗：', err);
  }
}

// 5. 事件核心大腦
function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userId = event.source.userId;
  const userText = event.message.text.trim();
  
  if (!userCarts[userId]) {
    userCarts[userId] = {};
  }

  // A. 顯示菜單
  if (userText === '菜單') {
    const bubbles = menu.map(item => ({
      type: "bubble",
      size: "micro",
      hero: {
        type: "image",
        url: item.image || "https://images.unsplash.com/photo-1562967914-608f82629710?w=600",
        size: "full",
        aspectRatio: "20:13",
        aspectMode: "cover"
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: item.name, weight: "bold", size: "md" },
          { type: "text", text: `NT$ ${item.price} 元`, size: "sm", color: "#e53e3e", weight: "bold", margin: "xs" },
          { type: "text", text: item.description || "美味必點！", size: "xs", color: "#718096", margin: "xs", wrap: true }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#3182ce",
            height: "sm",
            action: {
              type: "message",
              label: `點這份餐點`,
              text: `我要點：${item.name}`
            }
          }
        ]
      }
    }));

    return lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: "flex",
        altText: "📋 請看我們的精選菜單",
        contents: { type: "carousel", contents: bubbles }
      }]
    });
  }

  // B. 彈出數量選單氣泡
  if (userText.startsWith('我要點：')) {
    const productName = userText.replace('我要點：', '').trim();
    const exists = menu.some(item => 
      item.name.toLowerCase().includes(productName.toLowerCase()) || 
      productName.toLowerCase().includes(item.name.toLowerCase())
    );
    if (!exists) {
      return lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `❌ 找不到「${productName}」這個品項喔！请輸入「菜單」重新選擇。` }]
      });
    }

    const quantities = [1, 2, 3, 4, 5, 6];
    const quickReplyItems = quantities.map(num => ({
      type: "action",
      action: {
        type: "message",
        label: `${num} 份`,
        text: `${productName}+${num}`
      }
    }));

    return lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: "text",
        text: `🔢 請問您需要幾份「${productName}」呢？\n請點選下方快捷數量：`,
        quickReply: { items: quickReplyItems }
      }]
    });
  }

  // C. 購物車累加儲存
  if (userText.includes('+')) {
    const parts = userText.split('+');
    const orderItemName = parts[0].trim().toLowerCase();
    const orderQuantity = parseInt(parts[1].trim(), 10);

    const matchedProduct = menu.find(item => {
      const menuName = item.name.toLowerCase().trim();
      return menuName.includes(orderItemName) || orderItemName.includes(menuName);
    });

    if (!matchedProduct || isNaN(orderQuantity) || orderQuantity <= 0) {
      return lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `❌ 抱歉，大腦認不出這個商品名稱。\n請務必點選菜單按鈕來點餐喔！` }]
      });
    }

    const standardName = matchedProduct.name;

    if (userCarts[userId][standardName]) {
      userCarts[userId][standardName] += orderQuantity;
    } else {
      userCarts[userId][standardName] = orderQuantity;
    }

    let currentCartText = `🛒 已幫您加入購物車！\n\n目前的清單如下：`;
    let currentTotal = 0;
    
    for (const [name, qty] of Object.entries(userCarts[userId])) {
      const p = menu.find(item => item.name === name);
      if (p) {
        const subTotal = p.price * qty;
        currentTotal += subTotal;
        currentCartText += `\n🔹 ${name} x ${qty} 份 (共 ${subTotal} 元)`;
      }
    }
    currentCartText += `\n\n💵 目前總計：${currentTotal} 元`;

    return lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: "text",
        text: currentCartText,
        quickReply: {
          items: [
            { type: "action", action: { type: "message", label: "📋 繼續看菜單", text: "菜單" } },
            { type: "action", action: { type: "message", label: "💰 確認結帳送出", text: "結帳" } }
          ]
        }
      }]
    });
  }

  // D. 最終結帳並送出
  if (userText === '結帳') {
    const cartItems = Object.entries(userCarts[userId]);
    if (cartItems.length === 0) {
      return lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `🛒 您的購物車目前是空的喔！快輸入「菜單」來挑選吧！` }]
      });
    }

    let summary = "";
    let finalTotal = 0;
    
    cartItems.forEach(([name, qty]) => {
      const p = menu.find(item => item.name === name);
      if (p) {
        const subTotal = p.price * qty;
        finalTotal += subTotal;
        summary += `${name}x${qty} `;
      }
    });

    if (!summary) {
      userCarts[userId] = {};
      return lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `❌ 購物車異常，已自動重置。` }]
      });
    }

    const taiwanTime = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
    
    saveOrderToGoogleSheet(taiwanTime, summary.trim(), finalTotal);
    userCarts[userId] = {}; // 清空購物車

    return lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{ 
        type: 'text', 
        text: `🎉 結帳成功！\n\n📋 訂單明細：${summary}\n💰 總金額：${finalTotal} 元\n\n✨ 雲端後台已自動排單處理，感謝您的訂購！` 
      }]
    });
  }

  // E. 基礎迎賓
  return lineClient.replyMessage({
    replyToken: event.replyToken,
    messages: [{ 
      type: 'text', 
      text: `🥰 您好！我是線上點餐助理。\n\n👉 請輸入「菜單」查看有照片的美味餐點！\n👉 購物車會自動幫您累加商品，挑選完後點選「確認結帳」即可喔！` 
    }]
  });
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`大腦正在連接埠 ${port} 上運行...`);
});