# Lồng tiếng YouTube — Clone **v3**

## Luồng lấy phụ đề (đã sắp lại)

Thứ tự thử; **mỗi lần thành công** sẽ có log trên **Console của tab YouTube**:

- Dòng **`SUB_OK | method=... | videoId=... | cues=... | timeline_s=... | sample="..."`**

1. **Thư viện JS** [`youtube-transcript`](https://www.npmjs.com/package/youtube-transcript) (file `vendor/youtube-transcript.esm.js`, gọi qua **service worker** — không cần `playerResponse`, chỉ cần `?v=`).
2. **`captionTracks` + `baseUrl`** từ `playerResponse` khi popup chọn rõ ngôn ngữ / loại ASR.
3. **Cache URL** `*/api/timedtext*` do `webRequest` bắt được → `fetch` cùng origin + parse.
4. **`HTMLVideoElement.textTracks`** (bật CC nếu cần).
5. Lặp caption / cache / textTracks / thư viện (fallback).

Sau đó: **dịch từng câu** (queue tuần tự) + **Web Speech** theo **Dịch & đọc sang** (`vi` → `vi-VN` cho TTS). **prefetch** ~8 câu. Nếu Windows chưa có giọng Việt, cài gói ngôn ngữ nói trong Cài đặt hệ thống.

## Cài

1. `chrome://extensions` → **Load unpacked** → thư mục **`clone`** (phải có `vendor/youtube-transcript.esm.js`).
2. Cấp quyền **`webRequest`**.
3. Cập nhật thư viện phụ đề: `npm install` trong `clone` rồi `npm run vendor`.
4. Bấm **Dịch** (trên thanh điều khiển video); popup → **Lưu**.

## Console

- Filter: **`[YTDUB-v3]`** hoặc **`SUB_OK`**.
- **`requests.js` + `googlevideo.com/videoplayback` 403** / **`doubleclick` CORS** / **`requestStorageAccessFor`**: thường là **YouTube / quảng cáo / extension khác**, không phải đoạn lấy phụ đề của clone. Tắt hết extension khác thử nếu cần so sánh.

## Lưu ý

- **v3** dùng `ytdub_settings_v3`.
- Reload extension → **F5** tab YouTube.
