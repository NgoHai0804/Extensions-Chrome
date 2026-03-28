# Phương pháp chặn quảng cáo YouTube trong extension này

Tài liệu này giải thích nhanh extension đang chặn quảng cáo YouTube theo mô hình đa lớp, kết hợp từ logic hiện tại và bộ `yt-adblock-mini`.

## Mục tiêu

- Giảm/tối ưu khả năng xuất hiện pre-roll, mid-roll, overlay ads trên YouTube.
- Giữ khả năng phát video ổn định (nếu một lớp fail thì lớp khác vẫn hỗ trợ).
- Dễ debug: có thể bật/tắt từng lớp để khoanh vùng lỗi.

## Tổng quan 3 lớp chặn

### 1) Chặn mạng (DNR - Declarative Net Request)

Extension dùng rule để chặn các request liên quan quảng cáo và tracking, ví dụ:

- `youtube.com/pagead/`
- `youtube.com/youtubei/v1/player/ad_break`
- `doubleclick.net`
- `googlesyndication.com`
- `googleads.g.doubleclick.net`

File liên quan:

- `rulesets/main/yt-adblock-mini.json`
- Dynamic rules trong `js/background.js`

Tác dụng:

- Cắt request ads sớm ở tầng network.
- Giảm payload quảng cáo trước khi đến player.

---

### 2) Patch dữ liệu player trong MAIN world

Extension inject script vào `world: "MAIN"` để can thiệp đúng context của trang YouTube (không phải isolated world).

File chính:

- `js/yt-adblock-mini-injected.js`

Cơ chế:

- Hook `fetch` để patch response các endpoint `youtubei` (`/player`, `/next`, `/browse`).
- Hook `XMLHttpRequest` (`open/send`) để sanitize payload/response cho luồng XHR.
- Hook `JSON.parse` như fallback để prune các key ads trong object.
- Xóa key ads trong `window.ytInitialPlayerResponse` theo chu kỳ.

Các key bị xóa/prune thường gặp:

- `adPlacements`
- `adSlots`
- `playerAds`
- `adBreakHeartbeatParams`
- `adSafetyReason`
- `ad3Module`
- `adLoggingData`

Tác dụng:

- Kể cả khi request không bị chặn 100%, dữ liệu player vẫn bị "tỉa" để giảm khả năng render ads.

---

### 3) Cosmetic filtering (CSS hide)

Extension inject CSS để ẩn các khối ad UI còn sót.

File:

- `css/yt-adblock-mini-hide-ads.css`

Selector tiêu biểu:

- `ytd-ad-slot-renderer`
- `#masthead-ad`
- `#player-ads`
- `.video-ads`
- `.ytp-ad-module`

Tác dụng:

- Loại bỏ ad blocks trên giao diện khi ad đã render ở DOM.

## Khi nào extension inject?

Trong `js/background.js`, logic inject chạy tại các điểm:

- `chrome.runtime.onInstalled`
- `chrome.runtime.onStartup`
- `chrome.webNavigation.onCommitted`
- `chrome.tabs.onUpdated`
- `chrome.webRequest.onResponseStarted`

Và có cooldown theo tab để tránh inject lặp quá nhanh.

## Vì sao dùng đa lớp?

YouTube thay đổi liên tục, một lớp đơn lẻ thường không đủ bền:

- Chỉ chặn network: có thể vẫn còn ad do data flow khác.
- Chỉ patch JSON: có thể inject trễ hoặc miss case.
- Chỉ CSS: chỉ ẩn UI, không giải quyết ad logic bên trong player.

Đa lớp giúp:

- Tăng tỷ lệ chặn ad.
- Giảm xác suất vỡ video playback.
- Dễ khoanh vùng lỗi khi YouTube thay đổi schema/hành vi.

## Cách debug nhanh

1. Reload extension trong `chrome://extensions`.
2. Mở YouTube và bật DevTools Network.
3. Lọc theo: `pagead`, `doubleclick`, `ad_break`.
4. Nếu video lỗi:
   - Tạm tắt patch `JSON.parse` trong `js/yt-adblock-mini-injected.js`.
   - Thử tắt từng lớp để xác định nguyên nhân.

## Ghi chú quan trọng

- Đây là mô hình học tập/maintain, không có cam kết chặn 100% vì YouTube thay đổi thường xuyên.
- Ưu tiên patch có điều kiện (chỉ patch URL cần thiết) để giảm risk gây side-effect.
