/**
 * Key thiết bị 10 ký tự (hash) — dùng cho popup, content (cùng thuật toán với popup cũ).
 */
const DEVICE_KEY_LEN = 10;

async function sha256HexUtf8(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function webGlVendorRenderer() {
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    const gl =
      c.getContext("webgl", { failIfMajorPerformanceCaveat: false }) ||
      c.getContext("experimental-webgl");
    if (!gl) return "";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return "";
    const v = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
    const r = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    return `${v || ""}|${r || ""}`;
  } catch {
    return "";
  }
}

function uaClientHintsSync() {
  try {
    const uad = navigator.userAgentData;
    if (!uad) return "";
    return `${uad.platform || ""}|${uad.mobile ? "1" : "0"}`;
  } catch {
    return "";
  }
}

async function uaClientHintsHighEntropy() {
  try {
    const uad = navigator.userAgentData;
    if (!uad?.getHighEntropyValues) return "";
    const h = await uad.getHighEntropyValues(["architecture", "platformVersion", "model"]);
    return [h.architecture || "", h.platformVersion || "", h.model || ""].join("|");
  } catch {
    return "";
  }
}

async function collectDeviceKeyMaterial() {
  const scr = typeof screen !== "undefined" ? screen : null;
  const orient = scr && "orientation" in scr && scr.orientation && "type" in scr.orientation ? scr.orientation.type : "";
  const he = await uaClientHintsHighEntropy();
  return [
    chrome.runtime.id,
    String(navigator.hardwareConcurrency ?? ""),
    typeof navigator.deviceMemory === "number" ? String(navigator.deviceMemory) : "",
    String(navigator.maxTouchPoints ?? ""),
    typeof navigator.platform === "string" ? navigator.platform : "",
    uaClientHintsSync(),
    he,
    webGlVendorRenderer(),
    `${scr?.width ?? 0}x${scr?.height ?? 0}x${scr?.availWidth ?? 0}x${scr?.availHeight ?? 0}`,
    String(scr?.colorDepth ?? ""),
    String(scr?.pixelDepth ?? ""),
    String(typeof devicePixelRatio === "number" ? devicePixelRatio : ""),
    orient,
  ].join("\u001f");
}

/** 10 ký tự hex IN HOA — suy ra từ thiết bị. */
export async function deriveDeviceKey10() {
  const hex = await sha256HexUtf8(await collectDeviceKeyMaterial());
  return hex.slice(0, DEVICE_KEY_LEN).toUpperCase();
}
