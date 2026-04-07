import {
  mergeExtensionSettings,
  STORAGE_KEY,
  buildPersistedStoragePayload
} from "../content/dubbing/core/extension-settings-esm.js";
import { deriveDeviceKey10 } from "../shared/device-key.js";
import { fetchKeyCheckResult } from "../shared/key-check.js";

const $ = (id) => document.getElementById(id);

function buildLangListbox() {
  const sel = $("targetLang");
  const list = $("targetLangListbox");
  if (!sel || !list) return;
  while (list.firstChild) list.removeChild(list.firstChild);
  for (let i = 0; i < sel.options.length; i += 1) {
    const opt = sel.options[i];
    const li = document.createElement("li");
    li.className = "lang-select-option";
    li.setAttribute("role", "option");
    li.dataset.value = opt.value;
    li.textContent = opt.textContent;
    li.setAttribute("tabindex", "-1");
    li.addEventListener("click", (e) => {
      e.preventDefault();
      void chooseTargetLang(opt.value);
    });
    list.appendChild(li);
  }
  syncLangListSelection();
}

function syncLangListSelection() {
  const sel = $("targetLang");
  const list = $("targetLangListbox");
  if (!sel || !list) return;
  const v = sel.value;
  list.querySelectorAll(".lang-select-option").forEach((el) => {
    el.setAttribute("aria-selected", el.dataset.value === v ? "true" : "false");
  });
}

function syncLangTriggerLabel() {
  const sel = $("targetLang");
  const label = $("targetLangValue");
  if (!sel || !label) return;
  const opt = sel.options[sel.selectedIndex];
  label.textContent = opt ? opt.textContent : "";
}

function scrollLangListToSelected() {
  const list = $("targetLangListbox");
  const selected = list?.querySelector('.lang-select-option[aria-selected="true"]');
  if (!list || !selected) return;
  const pad = 6;
  const top = selected.offsetTop;
  const bottom = top + selected.offsetHeight;
  const viewTop = list.scrollTop;
  const viewBottom = viewTop + list.clientHeight;
  if (top < viewTop + pad) list.scrollTop = Math.max(0, top - pad);
  else if (bottom > viewBottom - pad) list.scrollTop = bottom - list.clientHeight + pad;
}

function setLangPanelOpen(open) {
  const root = $("langSelectRoot");
  const trig = $("targetLangTrigger");
  const list = $("targetLangListbox");
  if (!root || !trig || !list) return;
  root.classList.toggle("is-open", open);
  trig.setAttribute("aria-expanded", open ? "true" : "false");
  list.hidden = !open;
  if (open) {
    syncLangListSelection();
    requestAnimationFrame(() => scrollLangListToSelected());
  }
}

async function chooseTargetLang(value) {
  const sel = $("targetLang");
  if (!sel) return;
  sel.value = value;
  syncLangTriggerLabel();
  syncLangListSelection();
  setLangPanelOpen(false);
  await persistSettings({ targetLang: value });
}

function toggleLangPanel() {
  const list = $("targetLangListbox");
  if (!list) return;
  setLangPanelOpen(list.hidden);
}

function formatVolumePct(v) {
  const n = Math.round(Number(v) * 100);
  return `${Number.isFinite(n) ? n : 0}%`;
}

function syncVolLabel() {
  const el = $("volPct");
  if (el) el.textContent = formatVolumePct($("speechVolume").value);
}

function isSubtitleOverlayOn() {
  return $("toggleSubtitle").getAttribute("aria-checked") === "true";
}

function isAdblockOn() {
  return $("toggleAdblock").getAttribute("aria-checked") === "true";
}

function isYoutubeAriaFocusFixOn() {
  return $("toggleAriaFocusFix").getAttribute("aria-checked") === "true";
}

function syncSubtitleSwitch(on) {
  const btn = $("toggleSubtitle");
  if (!btn) return;
  btn.setAttribute("aria-checked", on ? "true" : "false");
}

function syncAdblockSwitch(on) {
  const btn = $("toggleAdblock");
  if (!btn) return;
  btn.setAttribute("aria-checked", on ? "true" : "false");
}

function syncAriaFocusFixSwitch(on) {
  const btn = $("toggleAriaFocusFix");
  if (!btn) return;
  btn.setAttribute("aria-checked", on ? "true" : "false");
}

function setTab(which) {
  const tabConfig = $("tabConfig");
  const tabInfo = $("tabInfo");
  const panelConfig = $("panelConfig");
  const panelInfo = $("panelInfo");
  const isInfo = which === "info";
  tabConfig.setAttribute("aria-selected", isInfo ? "false" : "true");
  tabInfo.setAttribute("aria-selected", isInfo ? "true" : "false");
  tabConfig.classList.toggle("is-active", !isInfo);
  tabInfo.classList.toggle("is-active", isInfo);
  panelConfig.hidden = isInfo;
  panelInfo.hidden = !isInfo;
}

const DEVICE_KEY_LEN = 10;

/** @param {HTMLElement | null} el */
function setDeviceKeyDisplay(el, key10) {
  if (!el) return;
  if (!key10 || key10 === "—") {
    delete el.dataset.deviceKey;
    el.removeAttribute("title");
    el.removeAttribute("aria-label");
    el.textContent = "—";
    return;
  }
  const s = String(key10).trim().toUpperCase();
  if (!s || s.length !== DEVICE_KEY_LEN) {
    delete el.dataset.deviceKey;
    el.removeAttribute("title");
    el.removeAttribute("aria-label");
    el.textContent = "—";
    return;
  }
  el.dataset.deviceKey = s;
  el.title = s;
  el.setAttribute("aria-label", `Key: ${s}`);
  el.textContent = s;
}

function fillExtensionVersion() {
  const el = $("extensionVersion");
  if (!el) return;
  try {
    el.textContent = chrome.runtime.getManifest().version;
  } catch {
    el.textContent = "—";
  }
}

/** @param {unknown} raw */
function parseKeyExpiresAtMs(raw) {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return null;
    const n = Number(t);
    if (Number.isFinite(n)) return n;
    const p = Date.parse(t);
    return Number.isFinite(p) ? p : null;
  }
  return null;
}

/** @param {unknown} raw */
function fillKeyExpiry(raw) {
  const dd = $("keyExpiresAt");
  if (!dd) return;
  dd.classList.remove("is-key-unknown", "is-key-expired");
  const ms = parseKeyExpiresAtMs(raw);
  if (ms == null) {
    dd.textContent = "Chưa ghi hạn";
    dd.classList.add("is-key-unknown");
    return;
  }
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) {
    dd.textContent = "—";
    dd.classList.add("is-key-unknown");
    return;
  }
  dd.textContent = d.toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" });
  if (ms < Date.now()) dd.classList.add("is-key-expired");
}

async function refreshKeyExpiryFromApi() {
  try {
    const r = await fetchKeyCheckResult();
    fillKeyExpiry(r.expiresAtMs);
  } catch {
    fillKeyExpiry(null);
  }
}

async function initInfoPanel() {
  const idEl = $("deviceIdValue");
  if (idEl) {
    try {
      setDeviceKeyDisplay(idEl, await deriveDeviceKey10());
    } catch {
      setDeviceKeyDisplay(idEl, "");
    }
  }
  fillExtensionVersion();
  await refreshKeyExpiryFromApi();
}

async function readMergedSettings() {
  const r = await chrome.storage.local.get(STORAGE_KEY);
  return mergeExtensionSettings(r[STORAGE_KEY]);
}

async function load() {
  const s = await readMergedSettings();
  $("targetLang").value = s.targetLang;
  buildLangListbox();
  syncLangTriggerLabel();
  $("speechVolume").value = String(s.speechVolume);
  syncVolLabel();
  syncSubtitleSwitch(s.showSubtitleOverlay !== false);
  syncAdblockSwitch(s.adblockEnabled !== false);
  syncAriaFocusFixSwitch(s.youtubeAriaFocusFix === true);
  /** Thu gọn storage nếu có field thừa (phiên bản cũ). */
  const cur = await chrome.storage.local.get(STORAGE_KEY);
  const raw = cur[STORAGE_KEY];
  if (raw == null || typeof raw !== "object") {
    await chrome.storage.local.set({ [STORAGE_KEY]: buildPersistedStoragePayload({}) });
  } else {
    const keep = new Set([
      "adblockEnabled",
      "showSubtitleOverlay",
      "targetLang",
      "speechVolume",
      "youtubeAriaFocusFix"
    ]);
    const hasExtra = Object.keys(raw).some((k) => !keep.has(k));
    if (hasExtra) {
      await chrome.storage.local.set({ [STORAGE_KEY]: buildPersistedStoragePayload(raw) });
    }
  }
}

/**
 * @param {Partial<{ targetLang: string; showSubtitleOverlay: boolean; adblockEnabled: boolean; speechVolume: number; youtubeAriaFocusFix: boolean }>} [patch]
 */
async function persistSettings(patch = {}) {
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
  const base = stored && typeof stored === "object" ? { ...stored } : {};
  const prev = mergeExtensionSettings(stored);
  const vol =
    patch.speechVolume !== undefined && patch.speechVolume !== null
      ? Number(patch.speechVolume)
      : Number($("speechVolume").value);
  const ariaFix =
    Object.prototype.hasOwnProperty.call(patch, "youtubeAriaFocusFix") && patch.youtubeAriaFocusFix !== null
      ? Boolean(patch.youtubeAriaFocusFix)
      : isYoutubeAriaFocusFixOn();
  const payload = buildPersistedStoragePayload({
    ...base,
    ...patch,
    adblockEnabled: isAdblockOn(),
    showSubtitleOverlay: isSubtitleOverlayOn(),
    targetLang: patch.targetLang != null ? patch.targetLang : $("targetLang").value,
    speechVolume: Number.isFinite(vol) ? vol : prev.speechVolume,
    youtubeAriaFocusFix: ariaFix
  });
  await chrome.storage.local.set({ [STORAGE_KEY]: payload });
  if (prev.adblockEnabled !== payload.adblockEnabled) {
    try {
      await chrome.runtime.sendMessage({ type: "YTHUB_REFRESH_ADBLOCK" });
    } catch {
      /* SW có thể chưa sẵn sàng — onChanged vẫn xử lý khi đổi adblock */
    }
  }
}

$("tabConfig").addEventListener("click", () => setTab("config"));
$("tabInfo").addEventListener("click", () => setTab("info"));

$("copyDeviceId")?.addEventListener("click", async () => {
  const codeEl = $("deviceIdValue");
  const id = (codeEl?.dataset.deviceKey && String(codeEl.dataset.deviceKey).trim()) || "";
  const fb = $("copyDeviceIdFeedback");
  if (!id) return;
  try {
    await navigator.clipboard.writeText(id);
    if (fb) {
      fb.textContent = "Đã sao chép key.";
      fb.hidden = false;
    }
  } catch {
    if (fb) {
      fb.textContent = "Không sao chép được — chọn key và sao chép thủ công.";
      fb.hidden = false;
    }
  }
  window.setTimeout(() => {
    if (fb) {
      fb.hidden = true;
      fb.textContent = "";
    }
  }, 2600);
});

$("targetLangTrigger").addEventListener("click", () => {
  toggleLangPanel();
});

$("targetLangTrigger").addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    setLangPanelOpen(false);
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
    const list = $("targetLangListbox");
    if (list?.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setLangPanelOpen(true);
    }
  }
});

document.addEventListener("click", (e) => {
  const root = $("langSelectRoot");
  if (root?.contains(e.target)) return;
  setLangPanelOpen(false);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("targetLangListbox")?.hidden) {
    setLangPanelOpen(false);
    $("targetLangTrigger")?.focus();
  }
});

let speechVolSaveTimer = null;
$("speechVolume").addEventListener("input", () => {
  syncVolLabel();
  if (speechVolSaveTimer) clearTimeout(speechVolSaveTimer);
  speechVolSaveTimer = setTimeout(() => {
    speechVolSaveTimer = null;
    const v = Number($("speechVolume").value);
    void persistSettings({ speechVolume: v });
  }, 200);
});
$("speechVolume").addEventListener("change", () => {
  syncVolLabel();
  if (speechVolSaveTimer) {
    clearTimeout(speechVolSaveTimer);
    speechVolSaveTimer = null;
  }
  void persistSettings({ speechVolume: Number($("speechVolume").value) });
});

$("toggleSubtitle").addEventListener("click", () => {
  syncSubtitleSwitch(!isSubtitleOverlayOn());
  persistSettings();
});

$("toggleAdblock").addEventListener("click", () => {
  syncAdblockSwitch(!isAdblockOn());
  persistSettings();
});

$("toggleAriaFocusFix").addEventListener("click", () => {
  syncAriaFocusFixSwitch(!isYoutubeAriaFocusFixOn());
  persistSettings();
});

void load();
void initInfoPanel();
