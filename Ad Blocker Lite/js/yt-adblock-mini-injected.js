(function installYoutubeAdPatch() {
  // Chỉ chạy trên trang YouTube.
  if (!location.hostname.includes("youtube.com")) {
    return;
  }
  // Tránh cài đặt patch nhiều lần trong cùng một context trang.
  if (window.__ytAdblockMiniInstalled) {
    return;
  }
  window.__ytAdblockMiniInstalled = true;

  const AD_KEYS = new Set([
    "adPlacements",
    "adSlots",
    "playerAds",
    "adBreakHeartbeatParams",
    "adSafetyReason",
    "ad3Module",
    "adLoggingData"
  ]);

  // Đệ quy xóa các trường liên quan quảng cáo trong object/array.
  function pruneAdsDeep(value) {
    if (!value || typeof value !== "object") {
      return value;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        pruneAdsDeep(value[i]);
      }
      return value;
    }
    for (const key of Object.keys(value)) {
      if (AD_KEYS.has(key)) {
        delete value[key];
        continue;
      }
      pruneAdsDeep(value[key]);
    }
    return value;
  }

  // Parse -> prune -> stringify, nếu lỗi thì giữ nguyên text gốc.
  function sanitizePlayerResponse(text) {
    try {
      const obj = JSON.parse(text);
      pruneAdsDeep(obj);
      return JSON.stringify(obj);
    } catch (err) {
      return text;
    }
  }

  // Chỉ patch payload API nội bộ YouTube có khả năng chứa dữ liệu ad.
  function shouldPatchUrl(input) {
    if (typeof input !== "string") {
      return false;
    }
    return (
      input.includes("/youtubei/") &&
      (input.includes("/player") || input.includes("/next") || input.includes("/browse"))
    );
  }

  // Dọn dẹp player response ban đầu và lặp lại cho luồng SPA.
  function nukeInitialFields() {
    try {
      if (window.ytInitialPlayerResponse) {
        delete window.ytInitialPlayerResponse.adPlacements;
        delete window.ytInitialPlayerResponse.adSlots;
        delete window.ytInitialPlayerResponse.playerAds;
      }
    } catch (err) {
      void err;
    }
  }
  nukeInitialFields();
  setInterval(nukeInitialFields, 1500);

  // Hook fetch để sanitize JSON response khi URL phù hợp.
  const nativeFetch = window.fetch;
  window.fetch = async function patchedFetch(...args) {
    const res = await nativeFetch.apply(this, args);
    try {
      const url = args[0] instanceof Request ? args[0].url : String(args[0] || "");
      if (!shouldPatchUrl(url)) {
        return res;
      }

      const cloned = res.clone();
      const text = await cloned.text();
      const sanitized = sanitizePlayerResponse(text);
      if (sanitized === text) {
        return res;
      }
      return new Response(sanitized, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers
      });
    } catch (err) {
      return res;
    }
  };

  // Hook XHR cho các call API nội bộ YouTube vẫn dùng XMLHttpRequest.
  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  const nativeXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
    try {
      this.__ytMiniUrl = typeof url === "string" ? url : String(url || "");
      this.__ytMiniShouldPatch = shouldPatchUrl(this.__ytMiniUrl);
    } catch (err) {
      this.__ytMiniShouldPatch = false;
    }
    return nativeXhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function patchedSend(body) {
    try {
      if (!this.__ytMiniShouldPatch) {
        return nativeXhrSend.call(this, body);
      }

      const origOnReadyStateChange = this.onreadystatechange;
      this.onreadystatechange = function () {
        try {
          // Thay response bằng JSON đã sanitize khi request xong.
          if (this.readyState === 4) {
            const txt = this.responseText;
            if (typeof txt === "string" && txt.length && txt[0] === "{") {
              const sanitized = sanitizePlayerResponse(txt);
              if (sanitized !== txt) {
                Object.defineProperty(this, "responseText", { value: sanitized });
                Object.defineProperty(this, "response", { value: sanitized });
              }
            }
          }
        } catch (err) {
          void err;
        }
        if (typeof origOnReadyStateChange === "function") {
          return origOnReadyStateChange.apply(this, arguments);
        }
      };

      if (typeof body === "string" && body.includes("playerResponse")) {
        // Fallback: vô hiệu hóa các key ad phổ biến trong payload string gửi đi.
        body = body.replace(/"(adSlots|playerAds|adPlacements)":/g, '"no_ads":');
      }
    } catch (err) {
      void err;
    }
    return nativeXhrSend.call(this, body);
  };

  // Fallback toàn cục: prune key ad từ mọi output của JSON.parse.
  const nativeJsonParse = JSON.parse;
  JSON.parse = function patchedJsonParse(...args) {
    const parsed = nativeJsonParse.apply(this, args);
    try {
      if (parsed && typeof parsed === "object") {
        pruneAdsDeep(parsed);
      }
    } catch (err) {
      void err;
    }
    return parsed;
  };
})();
