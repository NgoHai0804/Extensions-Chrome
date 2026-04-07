/**
 * Preset obfuscation mức tối đa (threshold 1.0, RC4, …). Extension release dùng obfuscator.main.config.js.
 * Cảnh báo: kích thước và thời gian obfuscate tăng mạnh; có thể chậm hơn khi chạy.
 *
 * Dùng CLI: npx javascript-obfuscator <file.js> -o <out.js> --config obfuscator.config.js
 * Extension release: obfuscator.main.config.js (kế thừa + chỉnh cho service worker).
 */
module.exports = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 1,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 1,
  
  stringArray: true,
  rotateStringArray: true,
  stringArrayEncoding: ["rc4"],
  stringArrayThreshold: 1,
  stringArrayWrappersCount: 5,
  stringArrayWrappersType: "variable",
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 5,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 1,

  transformObjectKeys: true,
  /** true dễ gây xung đột / lỗi trên một số môi trường (extension + trang có CSP chặt). */
  unicodeEscapeSequence: false,

  /** mangled trên bundle rất lớn có thể gây SyntaxError (Identifier đã khai báo). */
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: true,
  numbersToExpressions: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 5,
  
  /** Nhóm chống debug / dò mã: beautify có thể làm hỏng mã (selfDefending); F12 → debugger (debugProtection). */
  selfDefending: false,
  debugProtection: false,
  debugProtectionInterval: 0,


  disableConsoleOutput: false,
  target: "browser",
};
