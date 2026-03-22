/**
 * Clone v3 — entry (không dùng import).
 * Logic tách: ytdub-v3-*.js gắn lên window.__YTDUB_V3.
 *
 * Luồng: B1 phụ đề → B2 dịch → B3 TTS (Google translate_tts qua service worker).
 */
(function ytdubV3Entry() {
  const h = location.hostname.toLowerCase();
  if (!h.includes("youtube.com") && h !== "youtu.be" && !h.includes("youtube-nocookie.com")) {
    return;
  }
  const V = window.__YTDUB_V3;
  if (!V) {
    console.warn("[YTDUB-v3] Thiếu __YTDUB_V3 — kiểm tra thứ tự script trong manifest.");
    return;
  }
  V.injectBridge();
  V.buildUi();
  V.loadSettings();
  V.log("Sẵn sàng v3");
})();
