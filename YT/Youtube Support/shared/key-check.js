import { KEY_CHECK_API_BASE, EXTENSION_SLUG } from "./settings.js";
import { deriveDeviceKey10 } from "./device-key.js";

export function getManifestVersion() {
  try {
    return String(chrome?.runtime?.getManifest?.().version || "").trim();
  } catch {
    return "";
  }
}

/**
 * @param {unknown} data
 * @param {string} manifestVersion
 * @returns {{ ok: boolean; reason?: string; expiresAtMs: number | null }}
 */
export function evaluateKeyCheckResponse(data, manifestVersion) {
  if (!data || typeof data !== "object") {
    return { ok: false, reason: "bad_json", expiresAtMs: null };
  }
  const o = /** @type {Record<string, unknown>} */ (data);

  if (o.valid === true) {
    const need = String(o.extensionVersion ?? o.clientVersion ?? "").trim();
    const have = String(manifestVersion || "").trim();
    let ok = true;
    let reason;

    if (o.versionPolicyActive === true) {
      const dl = o.minimumVersionDeadlineAt ? Date.parse(String(o.minimumVersionDeadlineAt)) : NaN;
      if (Number.isFinite(dl) && Date.now() >= dl && need && have && need !== have) {
        ok = false;
        reason = "version_required";
      }
    }

    const expMs = o.expiresAt ? Date.parse(String(o.expiresAt)) : NaN;
    if (Number.isFinite(expMs) && expMs < Date.now()) {
      ok = false;
      reason = reason || "expired";
    }

    return {
      ok,
      reason: ok ? undefined : reason,
      expiresAtMs: Number.isFinite(expMs) ? expMs : null,
    };
  }

  if (o.valid === false) {
    const expMs = o.expiresAt ? Date.parse(String(o.expiresAt)) : NaN;
    return {
      ok: false,
      reason: String(o.reason || o.expiredBecause || "invalid"),
      expiresAtMs: Number.isFinite(expMs) ? expMs : null,
    };
  }

  return { ok: false, reason: "unknown_shape", expiresAtMs: null };
}

/**
 * Gọi API — không ghi `chrome.storage.local` (key / lịch sử check chỉ trong phiên).
 * @returns {Promise<{ ok: boolean; reason?: string; expiresAtMs: number | null }>}
 */
export async function fetchKeyCheckResult() {
  const manifestVersion = getManifestVersion();
  const key = await deriveDeviceKey10();
  const u = new URL(KEY_CHECK_API_BASE);
  u.searchParams.set("extension", EXTENSION_SLUG);
  u.searchParams.set("key", key);
  u.searchParams.set("clientVersion", manifestVersion);

  const res = await fetch(u.toString(), { credentials: "omit", cache: "no-store" });
  if (!res.ok) {
    throw new Error(`HTTP_${res.status}`);
  }
  const data = await res.json();
  return evaluateKeyCheckResponse(data, manifestVersion);
}

/**
 * @param {null | { licenseGateOk?: boolean; licenseCheckReason?: string }} V
 */
export async function runLicenseCheck(V) {
  const ev = await fetchKeyCheckResult();
  if (V) {
    V.licenseGateOk = ev.ok;
    V.licenseCheckReason = ev.ok ? undefined : ev.reason;
  }
  return ev;
}
