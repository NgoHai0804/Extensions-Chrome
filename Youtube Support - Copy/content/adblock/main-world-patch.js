/* Chạy trong MAIN world (inject từ SW khi bật chặn quảng cáo). */
(function ythubMainWorldAdblock() {
  if (!location.hostname.includes("youtube.com")) return;
  if (window.__ythubMainAdblockInstalled) return;
  window.__ythubMainAdblockInstalled = true;

  const AD_KEYS = new Set([
    "adPlacements",
    "adSlots",
    "playerAds",
    "adBreakHeartbeatParams",
    "adSafetyReason",
    "ad3Module",
    "adLoggingData"
  ]);

  function pruneAdsDeep(value, seen) {
    const s = seen || new WeakSet();
    if (!value || typeof value !== "object") return value;
    if (s.has(value)) return value;
    s.add(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) pruneAdsDeep(value[i], s);
      return value;
    }
    for (const key of Object.keys(value)) {
      if (AD_KEYS.has(key)) {
        delete value[key];
      } else {
        pruneAdsDeep(value[key], s);
      }
    }
    return value;
  }

  function patchObject(payload) {
    if (!payload || typeof payload !== "object") return payload;
    try {
      pruneAdsDeep(payload);
      if (payload.playerResponse) pruneAdsDeep(payload.playerResponse);
    } catch {
      /* ignore */
    }
    return payload;
  }

  function sanitizeJsonText(text) {
    try {
      const obj = JSON.parse(text);
      pruneAdsDeep(obj);
      return JSON.stringify(obj);
    } catch {
      return text;
    }
  }

  function shouldPatchUrl(input) {
    if (typeof input !== "string") return false;
    return (
      input.includes("/youtubei/") &&
      (input.includes("/player") || input.includes("/next") || input.includes("/browse"))
    );
  }

  function nukeInitialFields() {
    try {
      if (window.ytInitialPlayerResponse) {
        delete window.ytInitialPlayerResponse.adPlacements;
        delete window.ytInitialPlayerResponse.adSlots;
        delete window.ytInitialPlayerResponse.playerAds;
      }
    } catch {
      /* ignore */
    }
  }

  nukeInitialFields();
  setInterval(nukeInitialFields, 1500);

  try {
    let current = window.ytInitialPlayerResponse;
    Object.defineProperty(window, "ytInitialPlayerResponse", {
      configurable: true,
      enumerable: true,
      get() {
        return current;
      },
      set(v) {
        current = patchObject(v);
      }
    });
    if (current) current = patchObject(current);
  } catch {
    /* ignore */
  }

  document.addEventListener(
    "yt-navigate-finish",
    () => {
      try {
        if (window.ytInitialPlayerResponse) patchObject(window.ytInitialPlayerResponse);
      } catch {
        /* ignore */
      }
    },
    { passive: true }
  );

  const nativeFetch = window.fetch;
  window.fetch = async function patchedFetch(...args) {
    const res = await nativeFetch.apply(this, args);
    try {
      const url = args[0] instanceof Request ? args[0].url : String(args[0] || "");
      if (!shouldPatchUrl(url)) return res;
      const text = await res.clone().text();
      const sanitized = sanitizeJsonText(text);
      if (sanitized === text) return res;
      return new Response(sanitized, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers
      });
    } catch {
      return res;
    }
  };

  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  const nativeXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
    try {
      const u = typeof url === "string" ? url : String(url || "");
      this.__ythubXhrUrl = u;
      this.__ythubXhrPatch = shouldPatchUrl(u);
    } catch {
      this.__ythubXhrPatch = false;
    }
    return nativeXhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function patchedSend(body) {
    try {
      if (!this.__ythubXhrPatch) {
        return nativeXhrSend.call(this, body);
      }
      const orig = this.onreadystatechange;
      this.onreadystatechange = function () {
        try {
          if (this.readyState === 4) {
            const txt = this.responseText;
            if (typeof txt === "string" && txt.length && txt[0] === "{") {
              const sanitized = sanitizeJsonText(txt);
              if (sanitized !== txt) {
                Object.defineProperty(this, "responseText", { value: sanitized });
                Object.defineProperty(this, "response", { value: sanitized });
              }
            }
          }
        } catch {
          /* ignore */
        }
        if (typeof orig === "function") return orig.apply(this, arguments);
      };
      let b = body;
      if (typeof b === "string" && b.includes("playerResponse")) {
        b = b.replace(/"(adSlots|playerAds|adPlacements)":/g, '"no_ads":');
      }
      return nativeXhrSend.call(this, b);
    } catch {
      return nativeXhrSend.call(this, body);
    }
  };

  const nativeJsonParse = JSON.parse;
  JSON.parse = function patchedJsonParse(...args) {
    const parsed = nativeJsonParse.apply(this, args);
    try {
      if (parsed && typeof parsed === "object") pruneAdsDeep(parsed);
    } catch {
      /* ignore */
    }
    return parsed;
  };
})();
