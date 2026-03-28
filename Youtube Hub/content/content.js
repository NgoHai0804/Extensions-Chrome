/** Entry extension (không import). Manifest: dubbing → adblock → file này. */
(function youtubeHubEntry() {
  const h = location.hostname.toLowerCase();
  if (!h.includes("youtube.com") && h !== "youtu.be" && !h.includes("youtube-nocookie.com")) {
    return;
  }

  const V = window.__YTDUB_V3;
  if (V) {
    V.injectBridge();
    V.buildUi();
    V.loadSettings();
    V.log("Sẵn sàng v3");
  } else {
    console.warn("[Trợ lý YouTube] Thiếu __YTDUB_V3 — kiểm tra thứ tự script trong manifest.");
  }

  if (window.__YTHUB_ADBLOCK?.init) {
    window.__YTHUB_ADBLOCK.init();
  }
})();
