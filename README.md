# 接單小幫手 MVP

這是從穩定 LINE 點餐機器人獨立發展的商品化版本。正式營運中的舊專案不會被此分支修改。

## 第一版功能

- 手機版商家登入後台 `/admin`
- 客戶手機點餐與購物車 `/shop`
- 手機相簿商品照片上傳與自動縮圖
- 店名、標語、封面、電話、地址與營業時間設定
- 一鍵暫停／恢復接單
- 店家 LINE 綁定與新訂單 Flex 通知
- 在 LINE 內確認、製作、可取貨與完成訂單
- LIFF 客戶身分驗證與訂單狀態通知
- 訂單後台每 10 秒自動同步
- 最新／歷史訂單分類、筆數提示與訂單搜尋
- IG／Facebook 外部商店下單後以安全碼連結 LINE 通知
- 免登入訂單進度查詢頁
- 現金取貨、銀行轉帳、末五碼與付款狀態通知
- 商家可開關／改名訂購欄位，並新增、修改或停用取貨方式
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
- `PUBLIC_BASE_URL`：商店公開網址，例如 `https://line-order-saas-test.zeabur.app`，用於 LINE 訂單進度連結
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
