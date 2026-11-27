# KingMC-BOT

Bot treo AFK KingMC (KingSMP) kèm điều khiển từ xa qua Discord (`!order`, `!ah`, `!stats`, `!sb`, `!start`, `!stop`...), tối ưu chạy trên Render Free.

## Deploy trên Render
- **Build Command:** `npm install`
- **Start Command:**
  - Render #1 (`duykhang286`, `mahira01`, `mahira02`): `node bot-render.js`
  - Render #2 (`_Mahiruu_`, `_Mahiruuu_`): `node bot-render-oppo.js` *(hoặc `node bot-render.js` kèm `BOT_PROFILE=oppo`)*
- **Environment Variables:**
  - `DISCORD_TOKEN`: Token Discord Bot riêng cho từng Render
  - `DISCORD_CHANNEL_ID`: ID kênh Discord nhận thông báo & điều khiển *(khuyến nghị)*
  - `AUTO_START`: `123` / `12` / `all` *(tự bật bot khi khởi động; đặt `off` nếu muốn bật thủ công qua Discord)*
  - `STREAM_LOGS`: `true` hoặc `false`
- **Keep-Alive:** Ping định kỳ mỗi 5 phút vào `https://<service>.onrender.com/health`

