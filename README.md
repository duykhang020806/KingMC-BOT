# KingMC-BOT

Bot treo AFK KingMC (KingSMP) kèm điều khiển từ xa qua Discord (`!order`, `!ah`, `!stats`, `!sb`, `!start`, `!stop`...), tối ưu chạy trên Render Free (`bot-render.js`).

## Deploy trên Render
- **Build Command:** `npm install`
- **Start Command:** `node bot-render.js`
- **Environment Variables:**
  - `DISCORD_TOKEN`: Token Discord Bot
  - `DISCORD_CHANNEL_ID`: ID kênh Discord nhận thông báo & điều khiển *(khuyến nghị)*
  - `AUTO_START`: `123` *(tự bật 3 acc khi khởi động; đặt `off` nếu muốn bật thủ công qua Discord)*
  - `STREAM_LOGS`: `true` hoặc `false`
- **Keep-Alive:** Ping định kỳ mỗi 5 phút vào `https://<service>.onrender.com/health`
