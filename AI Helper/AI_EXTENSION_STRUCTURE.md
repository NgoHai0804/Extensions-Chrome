## Đề xuất extension Chrome AI Helper

Extension Chrome này giúp bạn:
- **Hỏi đáp AI ngay trên mọi trang web**
- **Đọc và tóm tắt nội dung trang hiện tại**
- **Gửi/nhận tin nhắn qua giao diện riêng (popup + panel nổi trong trang)**
- **Quản lý nhiều cuộc hội thoại (lưu lịch sử ở phía extension, vì API của bạn không nhớ lịch sử)**

Extension dùng **Manifest V3**.

---

## 1. Use case & hành vi chính

- **Hỏi đáp nhanh trong popup**
  - Mở bằng icon extension trên thanh Chrome.
  - Form nhập prompt, nút gửi, hiển thị câu trả lời.
  - Dropdown để chọn: *Chế độ thường*, *Tóm tắt trang hiện tại*, *Giải thích đoạn được chọn*, v.v.

- **Panel nổi trong trang (in-page UI)**
  - Nút floating (ở góc phải dưới) để mở/thu gọn panel chat.
  - Có thể đọc/hiển thị nội dung liên quan tới trang hiện tại.

- **Đọc nội dung trang**
  - Đọc toàn bộ `document.body.innerText` (có giới hạn độ dài, cắt nhỏ nếu cần).
  - Đọc đoạn text được người dùng bôi đen (selection).
  - Gửi text đó kèm prompt đến API AI.

- **Quản lý lịch sử hội thoại (client-side)**
  - Vì API của bạn **không nhớ lịch sử**, extension sẽ:
    - Lưu lịch sử tin nhắn theo `conversationId` trong `chrome.storage.local`.
    - Khi gọi API, **tự gửi lại vài message gần nhất** như context (nếu bạn muốn).
  - Cho phép:
    - Tạo hội thoại mới.
    - Đổi tên, xoá hội thoại.

- **Tùy chọn cấu hình (Options page)**
  - Cài đặt:
    - API base URL, API key (nếu cần).
    - Ngôn ngữ mặc định (vi/en).
    - Mặc định có bật panel nổi hay không.
    - Giới hạn độ dài nội dung trang gửi lên AI.

---

## 2. Kiến trúc tổng quan extension

- **`manifest.json`**
  - `manifest_version: 3`
  - Khai báo:
    - `action` (popup)
    - `background.service_worker`
    - `content_scripts`
    - `options_page`
    - `permissions`: `scripting`, `activeTab`, `storage`
    - Host permissions: `"*://*/*"` (hoặc giới hạn hơn nếu cần)

- **Background (service worker)**
  - Nhận message từ popup & content scripts.
  - Gọi API AI qua `fetch`.
  - Quản lý một lớp logic chung:
    - Thêm context cho API (nếu cần).
    - Retry khi lỗi mạng.
    - Ánh xạ `conversationId` ↔ dữ liệu lưu trong `chrome.storage`.

- **Content script**
  - Inject CSS & HTML cho panel chat nổi trong trang.
  - Lắng nghe:
    - Selection text của người dùng.
    - Nút bấm trong panel (gửi prompt, tóm tắt trang…).
  - Gửi message về background để gọi API.

- **Popup UI**
  - Giao diện nhẹ, mở từ icon extension.
  - Cho phép:
    - Chọn/tạo hội thoại.
    - Nhập prompt, hiển thị kết quả.
    - Chọn chế độ: hỏi bình thường, tóm tắt tab hiện tại, giải thích đoạn bôi đen.
  - Giao tiếp với background (qua `chrome.runtime.sendMessage`).

- **Options page**
  - Form cấu hình, lưu vào `chrome.storage.sync` (nếu muốn đồng bộ giữa máy).

- **Layer tiện ích (utils)**
  - Hàm chuẩn hoá request tới API AI của bạn.
  - Hàm cắt nhỏ nội dung trang nếu quá dài.
  - Hàm format tin nhắn để gửi cho API (thêm lịch sử gần nhất…).

---

## 3. Đề xuất cấu trúc thư mục & file

```text
AIHelper/
  ├─ manifest.json
  ├─ src/
  │   ├─ background/
  │   │   └─ background.ts
  │   ├─ content/
  │   │   ├─ contentScript.ts
  │   │   ├─ panelUI.ts
  │   │   └─ content.css
  │   ├─ popup/
  │   │   ├─ popup.html
  │   │   ├─ popup.ts
  │   │   └─ popup.css
  │   ├─ options/
  │   │   ├─ options.html
  │   │   ├─ options.ts
  │   │   └─ options.css
  │   ├─ common/
  │   │   ├─ api.ts          # Gọi API AI của bạn
  │   │   ├─ storage.ts      # Đọc/ghi chrome.storage
  │   │   ├─ messages.ts     # Định nghĩa kiểu message, conversation
  │   │   └─ dom.ts          # Helper thao tác DOM (panel nổi)
  │   └─ types/
  │       └─ index.d.ts      # Kiểu dữ liệu chung (nếu dùng TS)
  ├─ assets/
  │   ├─ icon16.png
  │   ├─ icon48.png
  │   └─ icon128.png
  ├─ dist/                   # Thư mục build (nếu dùng bundler)
  ├─ package.json
  ├─ tsconfig.json
  ├─ webpack.config.js       # Hoặc Vite/ESBuild config
  └─ AI_EXTENSION_STRUCTURE.md
```

Nếu bạn không muốn dùng TypeScript/bundler, ta có thể đổi các file `.ts` thành `.js` và bỏ `dist/`, build đơn giản hơn.

---

## 4. Giao tiếp giữa các phần (message flow)

- **Popup → Background → API**
  1. Người dùng bấm gửi trong popup.
  2. Popup gửi message: `{ type: 'ASK_AI', payload: { prompt, mode, conversationId } }`.
  3. Background:
     - Lấy cấu hình (API URL, key, settings).
     - Lấy lịch sử hội thoại từ `chrome.storage`.
     - Gọi API AI.
     - Lưu lại message + answer mới vào `chrome.storage`.
     - Gửi kết quả lại cho popup.

- **Content script (panel) → Background → API**
  1. Người dùng bấm "Tóm tắt trang" trong panel.
  2. Content script lấy `document.body.innerText` (hoặc selection).
  3. Gửi message: `{ type: 'SUMMARIZE_PAGE', payload: { text, conversationId } }`.
  4. Background gọi API AI, trả kết quả lại cho content script.

- **Options page → Storage**
  - Options page ghi cấu hình vào `chrome.storage.sync` hoặc `local`.
  - Background & popup đều đọc cấu hình này khi cần.

---

## 5. Đề xuất chi tiết cho một số file chính

- **`manifest.json` (phác thảo)**

```json
{
  "manifest_version": 3,
  "name": "AI Helper",
  "version": "0.1.0",
  "description": "AI trợ lý cho mọi trang web: hỏi đáp, tóm tắt, giải thích nội dung.",
  "action": {
    "default_popup": "src/popup/popup.html",
    "default_icon": {
      "16": "assets/icon16.png",
      "48": "assets/icon48.png",
      "128": "assets/icon128.png"
    }
  },
  "background": {
    "service_worker": "dist/background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["dist/contentScript.js"],
      "css": ["src/content/content.css"]
    }
  ],
  "options_page": "src/options/options.html",
  "permissions": ["storage", "scripting", "activeTab"],
  "host_permissions": ["<all_urls>"]
}
```

- **`src/common/api.ts` – sinh `anonymous_user_id` ngẫu nhiên**

  - Mỗi máy/extension nên dùng **một `anonymous_user_id` ngẫu nhiên**, không hard-code.
  - Quy ước:
    - Lần đầu gọi API, nếu chưa có `anonymous_user_id` trong `chrome.storage.local`:
      - Sinh một UUID (hoặc chuỗi random), ví dụ `crypto.randomUUID()` nếu dùng được, hoặc fallback tự random.
      - Lưu vào `chrome.storage.local` với key `anonymous_user_id`.
    - Khi gọi API:
      - Đọc giá trị này và gắn vào header:  
        `cookie: "anonymous_user_id=<giá_trị_ngẫu_nhiên>"`

  - Pseudo-code (TypeScript/JavaScript):

```ts
// src/common/storage.ts (hoặc file riêng)
export async function getOrCreateAnonymousUserId(): Promise<string> {
  const existing = await chrome.storage.local.get('anonymous_user_id');
  if (existing.anonymous_user_id) {
    return existing.anonymous_user_id;
  }

  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await chrome.storage.local.set({ anonymous_user_id: id });
  return id;
}
```

```ts
// src/common/api.ts – bên trong callAI(...)
import { getOrCreateAnonymousUserId } from './storage';

export async function callAI(params: CallAIParams): Promise<CallAIResult> {
  const anonymousUserId = await getOrCreateAnonymousUserId();

  const headers: Record<string, string> = {
    'accept': '*/*',
    'content-type': 'application/json',
    'origin': 'https://notegpt.io',
    'referer': 'https://notegpt.io/chat-deepseek',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    'cookie': `anonymous_user_id=${anonymousUserId}`,
  };

  // ... phần body & fetch như đã mô tả ...
}
```

- **`src/common/api.ts`**
  - Chỉ cần 1 hàm trung tâm, ví dụ `callAI({ messages, mode, extraContext })`, bên trong dùng API của bạn (URL + payload sẽ cấu hình theo spec API thật).

- **`src/common/storage.ts`**
  - Hàm:
    - `getSettings() / saveSettings()`
    - `getConversations() / saveConversations()`
    - `appendMessage(conversationId, message)`

---

## 6. Những chức năng nâng cao có thể thêm sau

- **Tóm tắt theo đoạn (chunk) cho trang dài**
  - Tự chia nội dung trang thành nhiều phần, gọi AI nhiều lần, rồi ghép kết quả.

- **Chế độ “Explain like I’m 5” / “Dịch sang tiếng Việt”**
  - Các preset prompt để người dùng bấm 1 nút.

- **Highlight câu trả lời trên trang**
  - Khi AI giải thích một đoạn trên trang, content script có thể highlight đoạn đó.

- **Hotkey**
  - Ví dụ: `Alt + A` để mở panel chat nổi.

---

## 7. Bước tiếp theo

- Xác nhận:
  - Bạn muốn dùng **TypeScript + bundler** (Webpack/Vite) hay dùng **JavaScript thuần**?
  - Format API hiện tại của bạn (URL, method, body, response) để mình có thể thiết kế `api.ts` khớp 100%.
- Sau khi xác nhận, mình sẽ:
  - Tạo sẵn `manifest.json`, các file skeleton (`background.ts/js`, `contentScript.ts/js`, `popup.html/js`, `options.html/js`, v.v.).
  - Kết nối luồng message & mock call API để bạn có thể chạy thử extension trong Chrome.

