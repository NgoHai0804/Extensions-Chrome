/**
 * Popup chính - Điều phối các nút và luồng xử lý
 */

// Lắng nghe tiến độ cuộn trang từ nội dung
chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'scrollProgress') {
        const { current, total } = message;
        if (typeof current === 'number' && typeof total === 'number' && total > 0) {
            updateStatus(`Cuộn trang: Đang cuộn trang ${current}/${total}...`, true);
        }
    }
});

// Nút Auto: chạy 3 bước trên trang hiện tại
document.getElementById('autoBtn').addEventListener('click', async () => {
    updateStatus("Bước 1/3 – Xóa cookies: Đang khởi tạo...", true);
    try {
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!currentTab?.id) {
            updateStatus("Lỗi: Không tìm thấy tab!", false);
            return;
        }
        const tabId = currentTab.id;

        updateStatus("Bước 1/3 – Xóa cookies: Đang xóa cookies Studocu...", true);
        const count = await clearStudocuCookies();
        updateStatus("Bước 1/3 – Xóa cookies: Đã xóa " + count + " cookies. Đang tải lại trang...", true);
        await chrome.tabs.reload(tabId);
        await waitForTabLoad(tabId);
        await new Promise(r => setTimeout(r, 1000));

        // Sau khi trang load lại, kiểm tra xem có CAPTCHA hay không.
        updateStatus("Bước 1/3 – Kiểm tra CAPTCHA trên trang...", true);
        const [{ result: captchaCheck }] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                try {
                    const selectors = [
                        'iframe[src*="recaptcha"]',
                        'iframe[src*="hcaptcha"]',
                        'div.g-recaptcha',
                        '[class*="captcha"]'
                    ];
                    const foundBySelector = selectors.some(sel => document.querySelector(sel));

                    const bodyText = (document.body && document.body.innerText || "").toLowerCase();
                    const textPatterns = [
                        "i'm not a robot",
                        "i am not a robot",
                        "tôi không phải người máy",
                        "captcha",
                        "verifying you are human",
                        "ray id —",
                        "ray id -",
                        "we appreciate your understanding as we work to protect our site"
                    ];
                    const foundByText = textPatterns.some(t => bodyText.includes(t.toLowerCase()));

                    const hasCaptcha = foundBySelector || foundByText;
                    if (hasCaptcha) {
                        alert("⚠️ Trang đang hiển thị CAPTCHA.\n\nVui lòng tự giải CAPTCHA trên Studocu, sau đó bấm lại nút Auto để tiếp tục.");
                    }
                    return { hasCaptcha };
                } catch (e) {
                    return { hasCaptcha: false, error: e && e.message };
                }
            }
        });

        if (captchaCheck && captchaCheck.hasCaptcha) {
            updateStatus("Bước 1/3 – Phát hiện CAPTCHA. Hãy giải CAPTCHA trên trang rồi bấm lại Auto.", false);
            return;
        }

        updateStatus("Bước 1/3 – Đã tải lại trang!", true);

        updateStatus("Bước 2/3 – Cuộn trang: Đang cuộn để tải hết nội dung...", true);
        const [{ result: scrollResult }] = await chrome.scripting.executeScript({
            target: { tabId },
            func: runScrollAllPages
        });

        const pageCount = scrollResult?.pageCount || 0;
        updateStatus("Bước 2/3 – Cuộn trang: Đã lướt " + pageCount + " trang. Đợi 3 giây...", true);
        await new Promise(r => setTimeout(r, 3000));

        const loadDelay = Math.min(Math.max(3000, pageCount * 50), 10000);
        updateStatus("Bước 3/3 – Tạo PDF: Đang chuẩn bị và đợi " + (loadDelay / 1000) + "s...", true);
        await chrome.scripting.insertCSS({ target: { tabId }, files: ["css/viewer_styles.css"] });
        await chrome.scripting.executeScript({
            target: { tabId },
            func: runCleanViewer,
            args: [true, loadDelay]
        });
    } catch (e) {
        updateStatus("Lỗi: " + e.message, false);
    }
});

// Nút Xóa cookies
document.getElementById('clearBtn').addEventListener('click', async () => {
    updateStatus("Xóa cookies: Đang quét và xóa cookies Studocu...", true);

    try {
        const count = await clearStudocuCookies();
        updateStatus("Xóa cookies: Đã xóa " + count + " cookies. Đang tải lại trang...", true);

        setTimeout(() => {
            chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
                if (!tabs[0]) {
                    updateStatus("Xóa cookies: Lỗi – Không tìm thấy tab hiện tại!", false);
                    return;
                }

                const tabId = tabs[0].id;
                chrome.tabs.reload(tabId);
                await waitForTabLoad(tabId);
                await new Promise(r => setTimeout(r, 1000));

                // Sau khi trang load lại trong bước 1, kiểm tra xem có CAPTCHA / màn hình verify human không.
                updateStatus("Bước 1 – Kiểm tra CAPTCHA trên trang...", true);
                try {
                    const [{ result: captchaCheck }] = await chrome.scripting.executeScript({
                        target: { tabId },
                        func: () => {
                            try {
                                const selectors = [
                                    'iframe[src*="recaptcha"]',
                                    'iframe[src*="hcaptcha"]',
                                    'div.g-recaptcha',
                                    '[class*="captcha"]'
                                ];
                                const foundBySelector = selectors.some(sel => document.querySelector(sel));

                                const bodyText = (document.body && document.body.innerText || "").toLowerCase();
                                const textPatterns = [
                                    "i'm not a robot",
                                    "i am not a robot",
                                    "tôi không phải người máy",
                                    "captcha",
                                    "verifying you are human",
                                    "ray id —",
                                    "ray id -",
                                    "we appreciate your understanding as we work to protect our site"
                                ];
                                const foundByText = textPatterns.some(t => bodyText.includes(t.toLowerCase()));

                                const hasCaptcha = foundBySelector || foundByText;
                                if (hasCaptcha) {
                                    alert("⚠️ Trang đang hiển thị CAPTCHA / màn hình xác minh người dùng.\n\nVui lòng tự giải trên Studocu, sau đó bấm lại Bước 1 hoặc Auto để tiếp tục.");
                                }
                                return { hasCaptcha };
                            } catch (e) {
                                return { hasCaptcha: false, error: e && e.message };
                            }
                        }
                    });

                    if (captchaCheck && captchaCheck.hasCaptcha) {
                        updateStatus("Bước 1 – Phát hiện CAPTCHA. Hãy giải CAPTCHA trên trang rồi bấm lại Bước 1 hoặc Auto.", false);
                        return;
                    }
                } catch (e) {
                    // Nếu lỗi khi inject script, vẫn tiếp tục nhưng log trạng thái lỗi
                    updateStatus("Bước 1 – Lỗi khi kiểm tra CAPTCHA: " + e.message, false);
                    return;
                }

                updateStatus("Đã tải lại trang!", false);
            });
        }, 1000);
    } catch (e) {
        updateStatus("Lỗi: " + e.message, false);
    }
});

// Nút Cuộn trang
document.getElementById('scrollBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    updateStatus("Cuộn trang: Đang cuộn để tải hết nội dung...", true);

    try {
        const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: runScrollAllPages
        });

        if (result && result.success) {
            updateStatus("Cuộn trang: Đã render xong " + result.pageCount + " trang!", false);
        } else {
            updateStatus("Cuộn trang: " + (result?.message || "Hoàn tất hoặc không tìm thấy trang."), false);
        }
    } catch (e) {
        updateStatus("Lỗi: " + e.message, false);
    }
});

// Nút Tạo PDF
document.getElementById('checkBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["css/viewer_styles.css"]
    });

    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: runCleanViewer
    });
});
