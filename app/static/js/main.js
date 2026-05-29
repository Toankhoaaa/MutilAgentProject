/**
 * AI Email Orchestrator — Dashboard client logic.
 */

const API_V1 = "/api/v1";

/** @type {Map<string, { subject: string, body: string }>} */
const emailDraftCache = new Map();

const Toast = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 3500,
  timerProgressBar: true,
});

/** @returns {Record<string, string>} */
function getAuthHeaders() {
  return { "Content-Type": "application/json" };
}

/** @type {RequestInit} */
const fetchCredentials = { credentials: "include" };

/** @type {{ id?: string, email?: string, display_name?: string | null } | null} */
let currentUser = null;

/**
 * @param {string} message
 */
function showAuthError(message) {
  showErrorToast(message);
  Swal.fire({
    icon: "error",
    title: "Lỗi xác thực",
    text: message,
    confirmButtonColor: "#4f46e5",
  });
}

/**
 * Redirect to login when session is missing or invalid.
 * @param {string} [reason]
 */
function redirectToLogin(reason) {
  const params = new URLSearchParams();
  if (reason) {
    params.set("error", "unauthorized");
    params.set("message", reason);
  }
  const query = params.toString();
  window.location.href = query ? `/login?${query}` : "/login";
}

/**
 * @param {Response} response
 * @returns {boolean}
 */
/**
 * @param {Response} response
 * @param {unknown} [body]
 * @returns {boolean}
 */
function handleUnauthorizedResponse(response, body) {
  if (response.status !== 401) {
    return false;
  }

  const message =
    body?.error?.message ||
    (typeof body?.detail === "string" ? body.detail : null) ||
    "";

  if (
    message.toLowerCase().includes("google") ||
    message.toLowerCase().includes("oauth") ||
    message.toLowerCase().includes("gmail")
  ) {
    return false;
  }

  redirectToLogin("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  return true;
}

/**
 * @param {string} name
 * @returns {string}
 */
function getInitials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * @param {{ email?: string, display_name?: string | null }} user
 */
function updateHeaderUser(user) {
  const greetingEl = document.getElementById("header-user-greeting");
  const emailEl = document.getElementById("header-user-email");
  const avatarEl = document.getElementById("header-user-avatar");

  const displayName = user.display_name?.trim() || user.email?.split("@")[0] || "Người dùng";
  const email = user.email || "";

  if (greetingEl) {
    greetingEl.textContent = `Xin chào, ${displayName}`;
  }
  if (emailEl) {
    emailEl.textContent = email;
  }
  if (avatarEl) {
    avatarEl.textContent = getInitials(displayName);
    avatarEl.title = email || displayName;
  }
}

/**
 * Auth guard: verify session before loading dashboard data.
 * @returns {Promise<object | null>}
 */
async function checkAuth() {
  try {
    const response = await fetch(`${API_V1}/auth/me`, fetchCredentials);

    if (response.status === 401) {
      redirectToLogin();
      return null;
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const message =
        data?.error?.message ||
        (typeof data?.detail === "string" ? data.detail : null) ||
        "Không thể xác thực phiên đăng nhập.";
      showAuthError(message);
      redirectToLogin(message);
      return null;
    }

    const user = await response.json();
    currentUser = user;
    updateHeaderUser(user);
    return user;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Lỗi kết nối khi kiểm tra đăng nhập.";
    showAuthError(message);
    redirectToLogin(message);
    return null;
  }
}

/** Sign out and return to the login page. */
function logout() {
  window.location.href = `${API_V1}/auth/logout`;
}

/**
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

/**
 * @param {Response} response
 * @returns {Promise<unknown>}
 */
async function parseJsonResponse(response) {
  const data = await response.json().catch(() => ({}));

  if (handleUnauthorizedResponse(response, data)) {
    throw new Error("Phiên đăng nhập đã hết hạn.");
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      (typeof data?.detail === "string"
        ? data.detail
        : Array.isArray(data?.detail)
          ? data.detail.map((d) => d.msg).join(", ")
          : null) ||
      `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

/**
 * @param {string} message
 */
function showSuccessToast(message) {
  Toast.fire({
    icon: "success",
    title: message,
  });
}

/**
 * @param {string} message
 */
function showErrorToast(message) {
  Toast.fire({
    icon: "error",
    title: message,
    customClass: {
      popup: "rounded-xl",
    },
    didOpen: (popup) => {
      popup.style.background = "#fef2f2";
      popup.style.color = "#991b1b";
      popup.style.border = "1px solid #fecaca";
    },
  });
}

/**
 * Tailwind classes for classification badges.
 * @param {string | null | undefined} category
 * @returns {string}
 */
function getCategoryBadge(category) {
  const key = (category || "unknown").toLowerCase();
  const map = {
    urgent: "bg-red-100 text-red-700",
    need_reply: "bg-blue-100 text-blue-700",
    spam: "bg-gray-100 text-gray-700",
    important: "bg-amber-100 text-amber-800",
    newsletter: "bg-indigo-100 text-indigo-700",
  };
  return map[key] || "bg-gray-100 text-gray-600";
}

/**
 * @param {string | null | undefined} category
 * @returns {string}
 */
function getCategoryLabel(category) {
  const key = (category || "unknown").toLowerCase();
  const labels = {
    urgent: "Urgent",
    need_reply: "Need Reply",
    spam: "Spam",
    important: "Important",
    newsletter: "Newsletter",
  };
  return labels[key] || category || "Unknown";
}

/**
 * @param {number} minutes
 * @returns {string}
 */
function formatTimeSaved(minutes) {
  if (minutes == null || Number.isNaN(minutes)) {
    return "—";
  }
  const m = Math.round(minutes);
  if (m < 60) {
    return `${m} phút`;
  }
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  return rest > 0 ? `${hours} giờ ${rest} phút` : `${hours} giờ`;
}

/**
 * @param {{ draft?: { is_sent?: boolean, draft_content?: string } }} email
 * @returns {string}
 */
function getDraftStatusLabel(email) {
  if (email.draft?.is_sent) {
    return '<span class="text-emerald-600 font-medium">Đã gửi</span>';
  }
  if (email.draft?.draft_content) {
    return '<span class="text-indigo-600 font-medium">Có nháp</span>';
  }
  return '<span class="text-gray-400">Chưa có</span>';
}

/**
 * @param {{
 *   id: string,
 *   sender?: string | null,
 *   subject?: string | null,
 *   classification?: { category?: string | null },
 *   draft?: { is_sent?: boolean, draft_content?: string },
 * }} email
 * @returns {string}
 */
function buildEmailRow(email) {
  const category = email.classification?.category;
  const badgeClass = getCategoryBadge(category);
  const badgeLabel = getCategoryLabel(category);
  const sender = escapeHtml(email.sender || "—");
  const subject = escapeHtml(email.subject || "(Không có tiêu đề)");
  const draftBody = email.draft?.draft_content || "";
  const hasDraft = Boolean(draftBody);
  const emailId = email.id;

  if (hasDraft) {
    emailDraftCache.set(emailId, {
      subject: email.subject || "",
      body: draftBody,
    });
  }

  const actionCell = hasDraft
    ? `<button
        type="button"
        class="btn-view-draft inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-all duration-300 hover:bg-indigo-100"
        data-email-id="${emailId}"
      >
        <i class="fa-solid fa-eye"></i> Xem nháp
      </button>`
    : `<span class="text-xs text-gray-400">—</span>`;

  return `
    <tr class="transition-all duration-300 hover:bg-gray-50/80">
      <td class="whitespace-nowrap px-6 py-4 font-medium text-gray-900">${sender}</td>
      <td class="max-w-xs truncate px-6 py-4 text-gray-700" title="${subject}">${subject}</td>
      <td class="whitespace-nowrap px-6 py-4">
        <span class="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeClass}">
          ${escapeHtml(badgeLabel)}
        </span>
      </td>
      <td class="whitespace-nowrap px-6 py-4 text-sm">${getDraftStatusLabel(email)}</td>
      <td class="whitespace-nowrap px-6 py-4 text-right">${actionCell}</td>
    </tr>
  `;
}

/**
 * Load overview stats and email table.
 */
async function fetchDashboardData() {
  try {
    const [statsRes, emailsRes] = await Promise.all([
      fetch(`${API_V1}/stats/overview`, fetchCredentials),
      fetch(`${API_V1}/emails/?limit=50`, fetchCredentials),
    ]);

    const stats = await parseJsonResponse(statsRes);
    const emailsPayload = await parseJsonResponse(emailsRes);

    const statTotal = document.getElementById("stat-total");
    const statUrgent = document.getElementById("stat-urgent");
    const statTime = document.getElementById("stat-time");
    const tbody = document.getElementById("email-table-body");

    if (statTotal) {
      statTotal.textContent = String(stats.total_processed ?? 0);
    }
    if (statUrgent) {
      statUrgent.textContent = String(stats.urgent_count ?? 0);
    }
    if (statTime) {
      statTime.textContent = formatTimeSaved(stats.time_saved_minutes);
    }

    if (!tbody) {
      return;
    }

    const items = emailsPayload.items || [];
    emailDraftCache.clear();

    if (items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="px-6 py-12 text-center text-gray-400">
            <i class="fa-solid fa-inbox mb-2 text-3xl text-gray-300"></i>
            <p class="text-sm">Chưa có email nào. Nhấn "Quét Email Mới" để bắt đầu.</p>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = items.map((email) => buildEmailRow(email)).join("");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Không thể tải dữ liệu.";
    showErrorToast(message);

    const tbody = document.getElementById("email-table-body");
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="px-6 py-12 text-center text-red-500">
            <p class="text-sm">${escapeHtml(message)}</p>
          </td>
        </tr>
      `;
    }
  }
}

/**
 * Trigger AI email processing pipeline.
 */
async function processEmails() {
  Swal.fire({
    title: "Đang xử lý",
    text: "Đang quét và xử lý email bằng AI... Vui lòng đợi",
    allowOutsideClick: false,
    allowEscapeKey: false,
    didOpen: () => {
      Swal.showLoading();
    },
  });

  try {
    const response = await fetch(`${API_V1}/emails/process`, {
      ...fetchCredentials,
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    await parseJsonResponse(response);

    Swal.close();
    showSuccessToast("Xử lý thành công!");
    await fetchDashboardData();
  } catch (err) {
    Swal.close();
    const message =
      err instanceof Error ? err.message : "Xử lý email thất bại.";
    showErrorToast(message);
  }
}

/**
 * @param {string} emailId
 * @param {string} subject
 * @param {string} body
 */
function openDraftModal(emailId, subject, body) {
  const modal = document.getElementById("draft-modal");
  const titleEl = document.getElementById("draft-modal-title");
  const subtitleEl = document.getElementById("draft-modal-subtitle");
  const contentEl = document.getElementById("draft-modal-content");
  const emailIdEl = document.getElementById("draft-modal-email-id");

  if (!modal || !contentEl || !emailIdEl) {
    return;
  }

  if (titleEl) {
    titleEl.textContent = subject
      ? `Bản nháp: ${subject}`
      : "Bản nháp trả lời";
  }
  if (subtitleEl) {
    subtitleEl.textContent = "Chỉnh sửa nội dung trước khi gửi lên Gmail.";
  }

  contentEl.value = body || "";
  emailIdEl.value = emailId;
  modal.classList.remove("hidden");
}

function closeDraftModal() {
  const modal = document.getElementById("draft-modal");
  if (modal) {
    modal.classList.add("hidden");
  }
}

/**
 * Persist draft edits (requires JWT).
 */
async function saveDraft() {
  const emailIdEl = document.getElementById("draft-modal-email-id");
  const contentEl = document.getElementById("draft-modal-content");

  const emailId = emailIdEl?.value;
  const draftContent = contentEl?.value?.trim();

  if (!emailId) {
    showErrorToast("Không xác định được email.");
    return;
  }
  if (!draftContent) {
    showErrorToast("Nội dung bản nháp không được để trống.");
    return;
  }

  try {
    const response = await fetch(`${API_V1}/emails/${emailId}/draft`, {
      ...fetchCredentials,
      method: "PUT",
      headers: getAuthHeaders(),
      body: JSON.stringify({ draft_content: draftContent }),
    });
    await parseJsonResponse(response);
    showSuccessToast("Đã lưu bản nháp.");
    await fetchDashboardData();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lưu bản nháp thất bại.";
    showErrorToast(message);
  }
}

/**
 * Send draft via Gmail (requires JWT + confirmation).
 * @param {string} emailId
 */
async function sendDraft(emailId) {
  const result = await Swal.fire({
    title: "Xác nhận gửi",
    text: "Bạn có chắc muốn gửi email này không?",
    icon: "question",
    showCancelButton: true,
    confirmButtonText: "Gửi",
    cancelButtonText: "Hủy",
    confirmButtonColor: "#059669",
    cancelButtonColor: "#6b7280",
  });

  if (!result.isConfirmed) {
    return;
  }

  try {
    const response = await fetch(`${API_V1}/emails/${emailId}/send`, {
      ...fetchCredentials,
      method: "POST",
      headers: getAuthHeaders(),
    });
    await parseJsonResponse(response);

    showSuccessToast("Đã gửi");
    closeDraftModal();
    await fetchDashboardData();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gửi email thất bại.";
    showErrorToast(message);
  }
}

function bindDraftModalActions() {
  const modal = document.getElementById("draft-modal");
  const overlay = document.getElementById("draft-modal-overlay");
  const btnClose = document.getElementById("btn-draft-close");
  const btnCloseX = document.getElementById("btn-draft-close-x");
  const btnSave = document.getElementById("btn-draft-save");
  const btnSend = document.getElementById("btn-draft-send-gmail");
  const emailIdEl = document.getElementById("draft-modal-email-id");

  [btnClose, btnCloseX, overlay].forEach((el) => {
    el?.addEventListener("click", closeDraftModal);
  });

  btnSave?.addEventListener("click", () => {
    saveDraft();
  });

  btnSend?.addEventListener("click", () => {
    const emailId = emailIdEl?.value;
    if (emailId) {
      sendDraft(emailId);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal && !modal.classList.contains("hidden")) {
      closeDraftModal();
    }
  });
}

function bindEmailTableDelegation() {
  const tbody = document.getElementById("email-table-body");
  tbody?.addEventListener("click", (event) => {
    const target = event.target.closest(".btn-view-draft");
    if (!target) {
      return;
    }

    const emailId = target.getAttribute("data-email-id");
    if (!emailId) {
      return;
    }

    const cached = emailDraftCache.get(emailId);
    if (cached) {
      openDraftModal(emailId, cached.subject, cached.body);
    } else {
      showErrorToast("Không tìm thấy nội dung bản nháp.");
    }
  });
}

function bindLogoutButton() {
  const logoutBtn = document.getElementById("btn-logout");
  logoutBtn?.addEventListener("click", logout);
}

async function initApp() {
  const isDashboard = document.getElementById("header-user-greeting") !== null;

  if (isDashboard) {
    const user = await checkAuth();
    if (!user) {
      return;
    }
  }

  bindLogoutButton();

  const scanBtn = document.getElementById("btn-scan-emails");
  if (scanBtn) {
    scanBtn.addEventListener("click", processEmails);
  }

  bindDraftModalActions();
  bindEmailTableDelegation();
  fetchDashboardData();
}

document.addEventListener("DOMContentLoaded", initApp);
