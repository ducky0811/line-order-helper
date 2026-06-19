function createLineIdentityService() {
  return {
    async verify(accessToken) {
      if (!accessToken) return null;
      const response = await fetch('https://api.line.me/v2/profile', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!response.ok) {
        const error = new Error('LINE 登入資料已失效，請重新開啟點餐頁');
        error.status = 401;
        throw error;
      }
      const profile = await response.json();
      if (!profile.userId) {
        const error = new Error('無法辨識 LINE 客戶');
        error.status = 401;
        throw error;
      }
      return profile.userId;
    }
  };
}

module.exports = { createLineIdentityService };
