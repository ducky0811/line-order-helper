const { createApp } = require('./src/app');

createApp().then(({ app }) => {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`🚀 商家管理後台與 LINE 機器人正在 ${port} 運行`));
}).catch(error => {
  console.error('❌ 服務啟動失敗：', error);
  process.exitCode = 1;
});
