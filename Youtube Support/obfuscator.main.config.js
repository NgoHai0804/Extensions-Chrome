/**
 * Obfuscate `release/main.js` — chạy trong SW (không có window) + MV3 CSP / Trusted Types.
 * Tắt mọi tùy chọn dùng eval/Function/new Function hoặc giả định `window`.
 */
const base = require("./obfuscator.config.js");

module.exports = {
  ...base,
  selfDefending: false,
  debugProtection: false,
  debugProtectionInterval: 0,
  /** `browser` dùng Function()/window → lỗi TrustedScript + SW */
  target: "service-worker",
  /** Giảm rủi ro tạo mã động */
  stringArrayCallsTransform: false,
  stringArrayCallsTransformThreshold: 0,
  stringArrayWrappersChainedCalls: false,
  stringArrayWrappersCount: 1,
  stringArrayWrappersParametersMaxCount: 2,
};
