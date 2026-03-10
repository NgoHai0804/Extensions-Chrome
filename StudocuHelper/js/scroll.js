/**
 * Cuộn qua từng trang để tải hết nội dung.
 * Hỗ trợ #page-container (study.soict.ai) và div[data-page-index] (Studocu)
 * @param {number} [delay=150] - Delay (ms) giữa mỗi trang
 * @returns {Promise<{success: boolean, pageCount: number, message?: string}>}
 */
function runScrollAllPages(delay = 10) {
    return new Promise((resolve) => {
        let pages;
        const container = document.querySelector('#page-container');
        if (container) {
            pages = Array.from(container.children);
        } else {
            pages = Array.from(document.querySelectorAll('div[data-page-index]'));
        }

        if (pages.length === 0) {
            resolve({ success: true, pageCount: 0, message: "Chưa có trang nào. Hãy đợi tài liệu tải." });
            return;
        }

        const totalPages = pages.length;

        window.scrollTo(0, 0);
        pages[0].scrollIntoView({ behavior: "auto", block: "start" });

        let index = 0;
        const goNext = () => {
            if (index >= totalPages) {
                resolve({ success: true, pageCount: totalPages });
                return;
            }

            const currentPage = index + 1;
            try {
                if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
                    chrome.runtime.sendMessage({
                        type: "scrollProgress",
                        current: currentPage,
                        total: totalPages
                    });
                }
            } catch (e) {
                // ignore sendMessage errors, vẫn tiếp tục cuộn
            }

            pages[index].scrollIntoView({ behavior: "auto", block: "center" });
            index++;
            setTimeout(goNext, delay);
        };
        setTimeout(goNext, delay);
    });
}
