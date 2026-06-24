const MEMO_LIMIT = 256;

const tauriApi = window.__TAURI__;
const invoke = tauriApi?.core?.invoke;
const currentWindow = tauriApi?.window?.getCurrentWindow?.();

const state = {
  session: null,
  manifests: [],
  activeManifestId: null,
  selectedRowIndex: 0,
  search: "",
  report: null,
  reportManifestName: null,
  pendingChallenge: null,
  toastTimer: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  renderAll();
  refreshSession();
});

function bindEvents() {
  $("#windowCloseButton")?.addEventListener("click", () => currentWindow?.close());
  $("#windowMinimizeButton")?.addEventListener("click", () => currentWindow?.minimize());
  $("#windowMaximizeButton")?.addEventListener("click", () => currentWindow?.toggleMaximize());

  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });

  $("#accountButton").addEventListener("click", openLogin);
  $("#refreshSessionButton").addEventListener("click", refreshSession);
  $("#logoutButton").addEventListener("click", logout);
  $("#importButton").addEventListener("click", () => $("#csvInput").click());
  $("#csvInput").addEventListener("change", importSelectedCsv);
  $("#exampleButton").addEventListener("click", downloadExampleCsv);

  $("#backToImportButton").addEventListener("click", () => showView("import"));
  $("#backToEditorButton").addEventListener("click", () => showView("editor"));
  $("#dryRunButton").addEventListener("click", startDryRun);
  $("#confirmButton").addEventListener("click", openConfirm);
  $("#runConfirmedButton").addEventListener("click", startDryRunFromConfirm);
  $("#closeConfirmButton").addEventListener("click", closeConfirm);
  $("#cancelConfirmButton").addEventListener("click", closeConfirm);

  $("#rowSearch").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderRows();
  });
  $("#memoEditor").addEventListener("input", updateSelectedMemo);
  $("#skipToggle").addEventListener("change", updateSelectedSkip);

  $("#exportJsonButton").addEventListener("click", exportReportJson);
  $("#exportFailedCsvButton").addEventListener("click", exportFailedCsv);

  $("#closeLoginButton").addEventListener("click", closeLogin);
  $("#cancelLoginButton").addEventListener("click", closeLogin);
  $("#loginModal").addEventListener("click", (event) => {
    if (event.target === $("#loginModal")) closeLogin();
  });
  $("#loginForm").addEventListener("submit", submitLogin);
  $("#twoFactorForm").addEventListener("submit", submitTwoFactor);
  $("#backToLoginButton").addEventListener("click", showLoginCredentials);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeLogin();
      closeConfirm();
    }
  });
}

async function call(command, args = undefined) {
  if (!invoke) {
    throw new Error("Tauri runtime unavailable. 请用桌面程序打开，不要直接用浏览器打开 HTML。");
  }
  return invoke(command, args);
}

async function refreshSession() {
  setRuntimeState(invoke ? "Tauri runtime 已连接" : "浏览器预览：后端不可用");
  if (!invoke) {
    state.session = {
      accountId: null,
      userId: null,
      displayName: null,
      sessionState: "unknown",
      lastValidatedAt: null,
    };
    renderSession();
    return;
  }

  try {
    state.session = await call("get_session_status");
  } catch (error) {
    state.session = {
      accountId: null,
      userId: null,
      displayName: null,
      sessionState: "invalid",
      lastValidatedAt: null,
    };
    toast(errorMessage(error));
  }
  renderSession();
}

async function logout() {
  try {
    await call("logout");
    await refreshSession();
    toast("已清除当前会话状态");
  } catch (error) {
    toast(errorMessage(error));
  }
}

async function importSelectedCsv(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = await call("parse_import_text", {
      text,
      sourceName: file.name,
    });
    const manifest = {
      id: createId(),
      name: parsed.sourceName || file.name || "import.csv",
      importedAt: new Date().toISOString(),
      parsed,
      rows: parsed.rows,
      summary: parsed.summary,
    };
    state.manifests.unshift(manifest);
    state.activeManifestId = manifest.id;
    state.selectedRowIndex = 0;
    state.search = "";
    $("#rowSearch").value = "";
    renderAll();
    showView("editor");
    toast(`已导入 ${parsed.totalRows} 条`);
  } catch (error) {
    toast(errorMessage(error));
  } finally {
    event.target.value = "";
  }
}

async function downloadExampleCsv() {
  try {
    const csv = await call("example_csv");
    downloadText("vrc_block_list_example.csv", csv, "text/csv;charset=utf-8");
    toast("示例 CSV 已生成");
  } catch (error) {
    toast(errorMessage(error));
  }
}

async function validateActiveManifest() {
  const manifest = activeManifest();
  if (!manifest) return null;

  const result = await call("validate_rows", { rows: manifest.rows });
  const rows = Array.isArray(result) ? result[0] : result.rows;
  const summary = Array.isArray(result) ? result[1] : result.summary;
  manifest.rows = rows;
  manifest.summary = summary;
  renderEditor();
  return summary;
}

async function startDryRunFromConfirm() {
  closeConfirm();
  await startDryRun();
}

async function startDryRun() {
  const manifest = activeManifest();
  if (!manifest) {
    toast("没有可执行的导入批次");
    return;
  }

  try {
    await validateActiveManifest();
    const blockedByValidation = manifest.rows.filter((row) => !row.skip && rowIssueCount(row));
    if (blockedByValidation.length > 0) {
      toast(`还有 ${blockedByValidation.length} 条未通过校验`);
      return;
    }

    const runnable = manifest.rows.filter((row) => !row.skip);
    if (runnable.length === 0) {
      toast("没有需要执行的条目");
      return;
    }

    const report = await call("start_block_run", {
      request: {
        manifestName: manifest.name,
        account: state.session,
        rows: manifest.rows,
        dryRun: true,
      },
    });

    state.report = report;
    state.reportManifestName = manifest.name;
    renderReport();
    showView("run");
    toast("dry-run 报告已生成");
  } catch (error) {
    toast(errorMessage(error));
  }
}

function openConfirm() {
  const manifest = activeManifest();
  if (!manifest) return;
  const runnable = manifest.rows.filter((row) => !row.skip && !rowIssueCount(row)).length;
  const skipped = manifest.rows.filter((row) => row.skip).length;
  const invalid = manifest.rows.filter((row) => !row.skip && rowIssueCount(row)).length;

  $("#confirmCopy").textContent = "当前后端真实网络执行还未接线，确认后会生成 dry-run 报告。接线完成后这里会执行覆盖备注和屏蔽。";
  $("#confirmMetrics").innerHTML = [
    metric("可执行", runnable),
    metric("跳过", skipped),
    metric("需修正", invalid),
  ].join("");
  $("#confirmModal").hidden = false;
}

function closeConfirm() {
  $("#confirmModal").hidden = true;
}

async function submitLogin(event) {
  event.preventDefault();
  setFormError("#loginError", "");
  const userNameOrEmail = $("#loginUser").value.trim();
  const password = $("#loginPassword").value;
  const mode = $("#proxyMode").value;
  const url = $("#proxyUrl").value.trim() || null;

  try {
    const outcome = await call("login", {
      request: {
        userNameOrEmail,
        password,
        proxy: { mode, url },
      },
    });
    handleLoginOutcome(outcome);
  } catch (error) {
    setFormError("#loginError", errorMessage(error));
  }
}

async function submitTwoFactor(event) {
  event.preventDefault();
  setFormError("#twoFactorError", "");
  const code = $("#twoFactorCode").value.trim();
  if (!state.pendingChallenge?.challengeId) {
    setFormError("#twoFactorError", "缺少二步验证 challenge");
    return;
  }

  try {
    const outcome = await call("verify_two_factor", {
      request: {
        challengeId: state.pendingChallenge.challengeId,
        code,
      },
    });
    handleLoginOutcome(outcome);
  } catch (error) {
    setFormError("#twoFactorError", errorMessage(error));
  }
}

function handleLoginOutcome(outcome) {
  if (outcome.status === "completed") {
    state.session = outcome.account;
    state.pendingChallenge = null;
    closeLogin();
    renderSession();
    toast("登录完成");
    return;
  }

  if (outcome.status === "requires_totp" || outcome.status === "requires_email_otp") {
    state.pendingChallenge = {
      challengeId: outcome.challenge_id || outcome.challengeId,
      kind: outcome.status,
    };
    showTwoFactor(outcome.message || "需要二步验证码。");
    return;
  }

  setFormError("#loginError", outcome.error || "登录失败");
}

function openLogin() {
  showLoginCredentials();
  $("#loginModal").hidden = false;
  setTimeout(() => $("#loginUser").focus(), 0);
}

function closeLogin() {
  $("#loginModal").hidden = true;
  setFormError("#loginError", "");
  setFormError("#twoFactorError", "");
}

function showLoginCredentials() {
  $("#loginForm").hidden = false;
  $("#twoFactorForm").hidden = true;
  setFormError("#loginError", "");
  setFormError("#twoFactorError", "");
}

function showTwoFactor(message) {
  $("#loginForm").hidden = true;
  $("#twoFactorForm").hidden = false;
  $("#twoFactorMessage").textContent = message;
  setTimeout(() => $("#twoFactorCode").focus(), 0);
}

function updateSelectedMemo(event) {
  const row = selectedRow();
  if (!row) return;
  row.memo = event.target.value;
  row.normalizedMemo = normalizeMemo(row.memo);
  updateMemoMeter(row);
  renderRows();
}

function updateSelectedSkip(event) {
  const row = selectedRow();
  if (!row) return;
  row.skip = event.target.checked;
  renderEditor();
}

function selectRow(index) {
  state.selectedRowIndex = index;
  renderRows();
  renderDetail();
}

function showView(view) {
  const resolvedView = view === "history" ? "history" : view;
  $$(".view").forEach((element) => element.classList.remove("active"));
  const target = $(`#${resolvedView}View`);
  if (target) target.classList.add("active");
  $$(".nav-item").forEach((button) => {
    const activeNav = resolvedView === "editor" || resolvedView === "run" ? "import" : resolvedView;
    button.classList.toggle("active", button.dataset.view === activeNav);
  });
}

function renderAll() {
  renderSession();
  renderImport();
  renderEditor();
  renderReport();
}

function renderSession() {
  const session = state.session;
  const sessionState = session?.sessionState || "unknown";
  const dot = $("#sessionDot");
  dot.className = `session-dot ${sessionClass(sessionState)}`;
  $("#accountName").textContent = session?.displayName || "会话未验证";
  $("#accountMeta").textContent = session?.userId || sessionText(sessionState);
}

function renderImport() {
  const totalRows = state.manifests.reduce((sum, manifest) => sum + manifest.rows.length, 0);
  const validRows = state.manifests.reduce((sum, manifest) => sum + (manifest.summary?.valid || 0), 0);
  const invalidRows = state.manifests.reduce((sum, manifest) => sum + invalidCount(manifest), 0);

  $("#importStats").innerHTML = [
    stat("批次", state.manifests.length),
    stat("总条目", totalRows, "accent"),
    stat("通过校验", validRows, "success"),
    stat("需修正", invalidRows, invalidRows ? "danger" : ""),
  ].join("");

  $("#manifestCount").textContent = String(state.manifests.length);
  const list = $("#manifestList");
  if (state.manifests.length === 0) {
    list.innerHTML = `<div class="panel-empty">还没有导入 CSV。点击右上角“导入 CSV”开始。</div>`;
    return;
  }

  list.innerHTML = state.manifests
    .map((manifest) => {
      const invalid = invalidCount(manifest);
      const statusClass = invalid ? "bad" : "good";
      const statusText = invalid ? `${invalid} 条需修正` : "可执行";
      return `
        <button class="manifest-card" type="button" data-manifest="${escapeHtml(manifest.id)}">
          <span>
            <span class="card-title">${escapeHtml(manifest.name)}</span>
            <span class="card-meta">${manifest.rows.length} 条 · ${formatDate(manifest.importedAt)}</span>
          </span>
          <span class="status-pill ${statusClass}">${statusText}</span>
        </button>
      `;
    })
    .join("");

  $$("[data-manifest]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeManifestId = button.dataset.manifest;
      state.selectedRowIndex = 0;
      state.search = "";
      $("#rowSearch").value = "";
      renderEditor();
      showView("editor");
    });
  });
}

function renderEditor() {
  const manifest = activeManifest();
  if (!manifest) {
    $("#editorSubtitle").textContent = "未选择批次";
    $("#editorStats").innerHTML = [
      stat("总条目", 0),
      stat("可执行", 0, "success"),
      stat("跳过", 0),
      stat("需修正", 0, "danger"),
    ].join("");
    $("#rowList").innerHTML = "";
    renderDetail();
    return;
  }

  const skipped = manifest.rows.filter((row) => row.skip).length;
  const invalid = invalidCount(manifest);
  const runnable = manifest.rows.filter((row) => !row.skip && !rowIssueCount(row)).length;
  $("#editorSubtitle").textContent = `${manifest.name} · ${manifest.rows.length} 条`;
  $("#editorStats").innerHTML = [
    stat("总条目", manifest.rows.length),
    stat("可执行", runnable, "success"),
    stat("跳过", skipped),
    stat("需修正", invalid, invalid ? "danger" : ""),
  ].join("");

  renderRows();
  renderDetail();
}

function renderRows() {
  const manifest = activeManifest();
  const list = $("#rowList");
  if (!manifest) {
    list.innerHTML = "";
    return;
  }

  const query = state.search.trim().toLowerCase();
  const rows = manifest.rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => {
      if (!query) return true;
      return `${row.uid} ${row.memo} ${row.normalizedMemo}`.toLowerCase().includes(query);
    });

  if (rows.length === 0) {
    list.innerHTML = `<div class="panel-empty">没有匹配条目</div>`;
    return;
  }

  list.innerHTML = rows
    .map(({ row, index }) => {
      const selected = index === state.selectedRowIndex ? " selected" : "";
      const skipped = row.skip ? " skipped" : "";
      const invalid = rowIssueCount(row) ? " invalid" : "";
      const badge = row.skip
        ? `<span class="status-pill">跳过</span>`
        : rowIssueCount(row)
          ? `<span class="status-pill bad">需修正</span>`
          : `<span class="status-pill good">待执行</span>`;
      return `
        <button class="import-row${selected}${skipped}${invalid}" type="button" data-row-index="${index}">
          <span class="row-title">${escapeHtml(shortUid(row.uid))}</span>
          <span class="row-meta">${escapeHtml(row.normalizedMemo || row.memo || "空备注")}</span>
          ${badge}
        </button>
      `;
    })
    .join("");

  $$("[data-row-index]").forEach((button) => {
    button.addEventListener("click", () => selectRow(Number(button.dataset.rowIndex)));
  });
}

function renderDetail() {
  const row = selectedRow();
  $("#detailEmpty").hidden = Boolean(row);
  $("#detailBody").hidden = !row;
  if (!row) return;

  $("#selectedUid").textContent = row.uid;
  if ($("#memoEditor").value !== row.memo) {
    $("#memoEditor").value = row.memo;
  }
  $("#skipToggle").checked = Boolean(row.skip);
  updateMemoMeter(row);
  renderIssues(row);
}

function updateMemoMeter(row) {
  const count = Array.from(row.memo || "").length;
  $("#memoCount").innerHTML = count > MEMO_LIMIT
    ? `<span class="danger">${count} / ${MEMO_LIMIT}</span>`
    : `${count} / ${MEMO_LIMIT}`;
  $("#normalizedHint").textContent = row.normalizedMemo === row.memo
    ? "空白未变化"
    : "已按 VRChat 写入前规则规整空白";
}

function renderIssues(row) {
  const localIssues = localMemoIssues(row);
  const issues = [...(row.validation || []), ...localIssues];
  $("#issueList").innerHTML = issues.length
    ? issues.map((issue) => `<div class="issue">${escapeHtml(issue.message || issue)}</div>`).join("")
    : `<div class="notice"><strong>校验</strong><span>当前条目可执行。</span></div>`;
}

function renderReport() {
  const report = state.report;
  if (!report) {
    $("#runSubtitle").textContent = "等待执行";
    $("#reportStats").innerHTML = [
      stat("总计", 0),
      stat("成功", 0, "success"),
      stat("失败", 0, "danger"),
      stat("跳过", 0),
    ].join("");
    $("#reportCount").textContent = "0";
    $("#reportList").innerHTML = `<div class="panel-empty">暂无报告</div>`;
    return;
  }

  $("#runSubtitle").textContent = `${state.reportManifestName || report.manifestName || "未命名批次"} · ${report.schemaVersion} · dry-run`;
  $("#reportStats").innerHTML = [
    stat("总计", report.summary.total),
    stat("成功", report.summary.success, "success"),
    stat("失败", report.summary.failed, report.summary.failed ? "danger" : ""),
    stat("跳过", report.summary.skipped),
  ].join("");
  $("#reportCount").textContent = String(report.items.length);
  $("#reportList").innerHTML = report.items
    .map((item) => {
      const status = reportStatus(item.status);
      const message = item.error || item.note?.message || item.block?.message || "ok";
      return `
        <div class="report-row">
          <span>
            <span class="row-title">${escapeHtml(shortUid(item.uid))}</span>
            <span class="row-meta">${escapeHtml(message)}</span>
          </span>
          <span class="status-pill ${status.className}">${status.label}</span>
        </div>
      `;
    })
    .join("");
}

function exportReportJson() {
  if (!state.report) {
    toast("暂无报告可导出");
    return;
  }
  downloadText(
    `${safeFileStem(state.reportManifestName || "vrc-blocker-report")}.json`,
    `${JSON.stringify(state.report, null, 2)}\n`,
    "application/json;charset=utf-8",
  );
}

function exportFailedCsv() {
  if (!state.report) {
    toast("暂无报告可导出");
    return;
  }
  const failed = state.report.items.filter((item) => !["success", "already_blocked", "skipped"].includes(item.status));
  if (failed.length === 0) {
    toast("没有失败条目");
    return;
  }
  const csv = ["uid,memo,error"]
    .concat(failed.map((item) => [item.uid, item.memo, item.error || ""].map(csvCell).join(",")))
    .join("\n");
  downloadText(`${safeFileStem(state.reportManifestName || "failed")}_failed.csv`, `${csv}\n`, "text/csv;charset=utf-8");
}

function activeManifest() {
  return state.manifests.find((manifest) => manifest.id === state.activeManifestId) || state.manifests[0] || null;
}

function selectedRow() {
  const manifest = activeManifest();
  return manifest?.rows[state.selectedRowIndex] || null;
}

function invalidCount(manifest) {
  return manifest.rows.filter((row) => !row.skip && rowIssueCount(row)).length;
}

function rowIssueCount(row) {
  return (row.validation?.length || 0) + localMemoIssues(row).length;
}

function localMemoIssues(row) {
  const issues = [];
  const normalized = normalizeMemo(row.memo);
  if (!normalized) issues.push({ message: "memo 不能为空" });
  if (Array.from(normalized).length > MEMO_LIMIT) issues.push({ message: `memo 超过 ${MEMO_LIMIT} 字符` });
  return issues;
}

function normalizeMemo(value) {
  return String(value || "").split(/\s+/).filter(Boolean).join(" ");
}

function stat(label, value, className = "") {
  return `
    <div class="stat-card">
      <div class="stat-value ${className}">${escapeHtml(String(value))}</div>
      <div class="stat-label">${escapeHtml(label)}</div>
    </div>
  `;
}

function metric(label, value) {
  return `<div class="metric"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`;
}

function reportStatus(status) {
  const map = {
    success: { label: "成功", className: "good" },
    failed: { label: "失败", className: "bad" },
    skipped: { label: "跳过", className: "" },
    already_blocked: { label: "已屏蔽", className: "warn" },
    failed_block_after_note: { label: "备注后屏蔽失败", className: "bad" },
    failed_note_after_block: { label: "屏蔽后备注失败", className: "bad" },
  };
  return map[status] || { label: status, className: "" };
}

function sessionClass(sessionState) {
  if (sessionState === "valid") return "valid";
  if (sessionState === "invalid") return "invalid";
  if (sessionState === "requiresTwoFactor") return "pending";
  return "";
}

function sessionText(sessionState) {
  const map = {
    unknown: "等待登录",
    valid: "会话可用",
    requiresTwoFactor: "等待二步验证",
    invalid: "会话无效",
  };
  return map[sessionState] || "等待登录";
}

function showViewById(id) {
  showView(id);
}

function setRuntimeState(text) {
  $("#runtimeState").textContent = text;
}

function setFormError(selector, message) {
  const element = $(selector);
  element.hidden = !message;
  element.textContent = message;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    element.hidden = true;
  }, 2400);
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shortUid(uid) {
  if (!uid || uid.length <= 22) return uid || "";
  return `${uid.slice(0, 12)}…${uid.slice(-6)}`;
}

function safeFileStem(value) {
  return String(value)
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "vrc-blocker-report";
}

function formatDate(value) {
  try {
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return value;
  }
}

function createId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function errorMessage(error) {
  if (typeof error === "string") return error;
  return error?.message || JSON.stringify(error);
}

window.showViewById = showViewById;
