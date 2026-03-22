/**
 * Xóa cookies Studocu
 * @returns {Promise<number>} Số cookies đã xóa
 */
async function clearStudocuCookies() {
    const allCookies = await chrome.cookies.getAll({});
    let count = 0;
    for (const cookie of allCookies) {
        if (cookie.domain.includes('studocu')) {
            let cleanDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
            const protocol = cookie.secure ? "https:" : "http:";
            const url = `${protocol}//${cleanDomain}${cookie.path}`;
            await chrome.cookies.remove({ url: url, name: cookie.name, storeId: cookie.storeId });
            count++;
        }
    }
    return count;
}
