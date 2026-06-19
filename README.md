# 接單小幫手 MVP

這是從穩定 LINE 點餐機器人獨立發展的商品化版本。正式營運中的舊專案不會被此分支修改。

## 第一版功能

- 手機版商家登入後台 `/admin`
- 客戶手機點餐與購物車 `/shop`
- 商品新增、修改、停售與刪除
- LINE 菜單即時讀取最新商品
- 訂單建立與狀態管理
- 取貨人、電話、取貨方式、時間與備註
- 伺服器端重新計價，避免客戶端竄改金額
- 狀態變更時主動通知 LINE 客戶
- Google Sheets 訂單同步
- 本機 JSON 測試模式與 Supabase 雲端模式

## 必要環境變數

複製 `.env.example` 中需要的變數到部署平台。正式環境至少需要：

- `CHANNEL_ACCESS_TOKEN`
- `CHANNEL_SECRET`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`

Google Sheets 與 Supabase 變數未設定時，程式仍可用本機資料模式啟動。

## Supabase

在 Supabase SQL Editor 執行 `supabase-schema.sql`，再設定：

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`（新版 Secret key）或 `SUPABASE_SERVICE_ROLE_KEY`（舊版）
- `MERCHANT_ID`

Supabase Secret/service role key 只能放在伺服器環境變數，不能放進網頁程式或 GitHub。

## 執行與測試

```powershell
npm start
npm run check
npm test
```

目前是單店 MVP。下一階段會加入商家帳號、多店隔離、LIFF 身分驗證與正式導入流程。
