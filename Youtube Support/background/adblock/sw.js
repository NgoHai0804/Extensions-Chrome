/**
 * Chặn quảng cáo YouTube: DNR + inject MAIN (fetch/XHR/JSON prune).
 * Bật/tắt theo chrome.storage (adblockEnabled).
 */
import { STORAGE_KEY, mergeExtensionSettings } from "../../content/dubbing/core/extension-settings-esm.js";

const YT_URL_PATTERNS = ["*://*.youtube.com/*", "*://youtube.com/*"];
const YT_INITIATORS = ["youtube.com", "www.youtube.com", "m.youtube.com"];
const RULE_ID_START = 994500;
const RULE_ID_END = 994511;
const INJECT_COOLDOWN_MS = 1200;
const MAIN_PATCH_FILE = "content/adblock/main-world-patch.js";

const lastInjectByTab = new Map();

function isYouTubeUrl(url) {
  return typeof url === "string" && /:\/\/([a-z0-9-]+\.)?youtube\.com\//i.test(url);
}

function buildDynamicRules() {
  return [
    {
      id: 994500,
      priority: 2000,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "||youtube.com/pagead/",
        resourceTypes: ["xmlhttprequest", "sub_frame", "script", "image"]
      }
    },
    {
      id: 994501,
      priority: 2000,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "||youtube.com/youtubei/v1/player/ad_break",
        resourceTypes: ["xmlhttprequest"]
      }
    },
    {
      id: 994502,
      priority: 2000,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "||www.youtube.com/get_midroll_",
        resourceTypes: ["xmlhttprequest"]
      }
    },
    {
      id: 994503,
      priority: 2000,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "||m.youtube.com/get_midroll_",
        resourceTypes: ["xmlhttprequest"]
      }
    },
    {
      id: 994504,
      priority: 1900,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "adunit",
        requestDomains: ["youtube.com", "www.youtube.com", "m.youtube.com"],
        resourceTypes: ["xmlhttprequest"]
      }
    },
    {
      id: 994505,
      priority: 1800,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "||youtube.com/api/stats/ads?",
        resourceTypes: ["xmlhttprequest", "ping", "image"]
      }
    },
    {
      id: 994506,
      priority: 1800,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "||youtube.com/pcs/activeview?",
        resourceTypes: ["xmlhttprequest", "ping", "image"]
      }
    },
    {
      id: 994507,
      priority: 1800,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "||ad.doubleclick.net/",
        resourceTypes: ["xmlhttprequest", "ping", "image"]
      }
    },
    {
      id: 994508,
      priority: 1800,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "||googleads.g.doubleclick.net/pagead/",
        resourceTypes: ["xmlhttprequest", "script", "sub_frame", "image", "ping"]
      }
    },
    {
      id: 994509,
      priority: 1800,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "||doubleclick.com/",
        resourceTypes: ["xmlhttprequest", "image", "ping"]
      }
    },
    {
      id: 994510,
      priority: 1800,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "||google.com/pagead/",
        resourceTypes: ["xmlhttprequest", "image", "ping"]
      }
    },
    {
      id: 994511,
      priority: 1750,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        regexFilter: "^https?:\\/\\/[^/]*youtube\\.com\\/get_video_info\\?.*([?&])adformat=",
        resourceTypes: ["xmlhttprequest"]
      }
    }
  ];
}

async function updateOurRules(addRules) {
  const all = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = all.filter((r) => r.id >= RULE_ID_START && r.id <= RULE_ID_END).map((r) => r.id);
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

async function removeAdblockRules() {
  await updateOurRules([]);
}

async function applyAdblockRules() {
  await updateOurRules(buildDynamicRules());
}

async function adblockEnabledFromStorage() {
  try {
    const r = await chrome.storage.local.get(STORAGE_KEY);
    return mergeExtensionSettings(r[STORAGE_KEY]).adblockEnabled !== false;
  } catch {
    return true;
  }
}

async function injectMainPatch(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  const now = Date.now();
  const last = lastInjectByTab.get(tabId) || 0;
  if (now - last < INJECT_COOLDOWN_MS) return;
  lastInjectByTab.set(tabId, now);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      injectImmediately: true,
      files: [MAIN_PATCH_FILE]
    });
  } catch {
    /* tab có thể chưa sẵn sàng hoặc không inject được */
  }
}

async function injectAllYoutubeTabs() {
  const tabs = await chrome.tabs.query({ url: YT_URL_PATTERNS });
  await Promise.all(
    tabs
      .map((t) => t.id)
      .filter((id) => Number.isInteger(id))
      .map((id) => injectMainPatch(id))
  );
}

async function refreshYoutubeAdblock() {
  const on = await adblockEnabledFromStorage();
  try {
    if (on) {
      await applyAdblockRules();
      await injectAllYoutubeTabs();
    } else {
      await removeAdblockRules();
    }
  } catch (e) {
    console.warn("[YTHUB][adblock] refresh failed", e);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void refreshYoutubeAdblock();
});

chrome.runtime.onStartup.addListener(() => {
  void refreshYoutubeAdblock();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORAGE_KEY]) return;
  void refreshYoutubeAdblock();
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0 || !isYouTubeUrl(details.url)) return;
  void (async () => {
    if (await adblockEnabledFromStorage()) void injectMainPatch(details.tabId);
  })();
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0 || !isYouTubeUrl(details.url)) return;
  void (async () => {
    if (await adblockEnabledFromStorage()) void injectMainPatch(details.tabId);
  })();
});

void refreshYoutubeAdblock();
