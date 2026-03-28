/** Ngưỡng thời gian / timedtext — chỉnh tại đây. */
(function ytdubCoreConfig() {
  const core = (window.__YTDUB_CORE = window.__YTDUB_CORE || {});

  core.DUBBING_CONFIG = {
    // Chờ CC + timedtext sẵn sàng (ms)
    subtitleReadyTimeoutMs: 10000,
    // Tổng thời gian tải phụ đề (ms)
    subtitleLoadTimeoutMs: 10000,
    // Bù start cue so với timedtext (giây)
    cueSyncLeadSec: 0.22,
    // Số cue dịch prefetch trước
    subtitlePrefetchAhead: 3,
    // Khoảng cách tối thiểu giữa hai lần fetch cùng URL timedtext (ms)
    timedtextSameUrlRetryGapMs: 6000,
    // Giãn cách request timedtext (tránh 429)
    timedtextMinRequestGapMs: 850,
    timedtext429BaseCooldownMs: 2800,
    timedtext429MaxCooldownMs: 22000
  };
})();
