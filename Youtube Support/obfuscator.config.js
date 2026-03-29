/**
 * Cấu hình "nặng" cho javascript-obfuscator.
 * Chạy: npx javascript-obfuscator <file.js> --output <out.js> --config obfuscator.config.js
 *
 * Lưu ý: selfDefending / debugProtection có thể gây treo DevTools hoặc hành vi lạ trong MV3;
 * bật từng mục và test extension sau mỗi bước.
 */
module.exports = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  stringArray: true,
  rotateStringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
  selfDefending: true,
  debugProtection: true,
  /** ms — bắt buộc là số khi bật debugProtection */
  debugProtectionInterval: 4000,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  numbersToExpressions: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 5,
  target: 'browser',
};
