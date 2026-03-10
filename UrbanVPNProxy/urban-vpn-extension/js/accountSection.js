import { getAccountInfo, registerAccount } from "./api.js";

function formatTimestamp(ts) {
  if (!ts) return "N/A";
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    return d.toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh"
    });
  } catch {
    return String(ts);
  }
}

function renderAccountInfo(container, accountInfo) {
  if (!accountInfo) {
    container.textContent = 'Chưa có tài khoản. Bấm "Đăng ký" để tạo.';
    return;
  }

  const { anonToken, securityToken } = accountInfo;
  const ownerId =
    (anonToken && anonToken.owner && anonToken.owner.id) || "N/A";
  const ownerShort =
    ownerId !== "N/A" && ownerId.length > 20
      ? ownerId.slice(0, 10) + "..." + ownerId.slice(-6)
      : ownerId;

  const expireText = formatTimestamp(
    securityToken && securityToken.expirationTime
  );

  container.innerHTML = `
    <div class="account-line">Owner: ${ownerShort}</div>
    <div class="account-line">Hết hạn: ${expireText}</div>
  `;
}

export function initAccountSection() {
  const accountInfoEl = document.getElementById("accountInfo");
  const btnRegister = document.getElementById("btnRegister");
  const statusEl = document.getElementById("accountStatus");

  if (!accountInfoEl || !btnRegister) return;

  // load initial account info
  getAccountInfo()
    .then((resp) => {
      renderAccountInfo(accountInfoEl, resp.accountInfo);
    })
    .catch(() => {
      renderAccountInfo(accountInfoEl, null);
    });

  btnRegister.addEventListener("click", () => {
    if (statusEl) statusEl.textContent = "Đang đăng ký tài khoản mới...";

    registerAccount()
      .then((resp) => {
        if (statusEl) statusEl.textContent = "Đăng ký tài khoản thành công.";
        renderAccountInfo(accountInfoEl, resp.accountInfo);
      })
      .catch((err) => {
        if (statusEl) statusEl.textContent = "Lỗi đăng ký: " + err.message;
      });
  });
}

