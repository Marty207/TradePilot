const ANALYZE_API = `${TP_API_BASE}/analyze`;

const TIMEFRAME_ROLES = {
  "1m": "Entry timing — micro structure, candles, and precise trigger",
  "5m": "Setup structure — momentum, pullbacks, and intraday pattern",
  "15m": "Session trend — key zones, trend direction, and context",
  "30m": "Higher-timeframe bias — major structure and dominant trend",
};

const BASE_TIMEFRAMES = ["1m", "5m", "15m"];
const TIMEFRAME_ORDER = ["30m", "15m", "5m", "1m"];

const LOADING_MESSAGES = [
  "Reading your chart screenshots…",
  "Comparing 1m, 5m, and 15m structure…",
  "Mapping support and resistance…",
  "Building trade plan…",
];

const viewAuth = document.getElementById("tp-view-auth");
const viewSetup = document.getElementById("tp-view-setup");
const viewLoading = document.getElementById("tp-view-loading");
const viewResults = document.getElementById("tp-view-results");
const accountBar = document.getElementById("tp-account-bar");
const planPill = document.getElementById("tp-plan-pill");
const usageText = document.getElementById("tp-usage-text");
const subscribeBtn = document.getElementById("tp-subscribe-btn");
const authForm = document.getElementById("tp-auth-form");
const authMsg = document.getElementById("tp-auth-msg");
const websiteLink = document.getElementById("tp-website-link");
const loadingSub = document.getElementById("tp-loading-sub");
const setupHint = document.getElementById("tp-setup-hint");
const analyzeBtn = document.getElementById("tp-analyze-btn");
const newCaptureBtn = document.getElementById("tp-new-capture-btn");
const signalEl = document.getElementById("tp-signal");
const include30mCheckbox = document.getElementById("tp-include-30m");
const mtf30Row = document.getElementById("tp-mtf-30m-row");

const savedScreenshots = {};
let captureInProgress = false;
let analysisInProgress = false;
let loadingMessageTimer = null;
let authMode = "login";
let currentUser = null;

function formatApiDetail(detail) {
  if (!detail) return null;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item?.msg) return item.msg;
        return JSON.stringify(item);
      })
      .join(". ");
  }
  if (typeof detail === "object") {
    return detail.msg || detail.message || JSON.stringify(detail);
  }
  return String(detail);
}

function formatError(error, responseStatus, errorData) {
  if (errorData) {
    const detail = formatApiDetail(errorData.detail);
    if (detail) return detail;
  }
  if (error instanceof Error && error.message && error.message !== "[object Object]") {
    return error.message;
  }
  if (typeof error === "string") return error;
  if (responseStatus) return `Backend error (HTTP ${responseStatus}).`;
  return "Could not reach the backend. Check Railway and reload the extension.";
}

function showView(name) {
  const views = {
    auth: viewAuth,
    setup: viewSetup,
    loading: viewLoading,
    results: viewResults,
  };

  Object.entries(views).forEach(([key, el]) => {
    if (!el) return;
    const active = key === name;
    el.hidden = !active;
    el.classList.toggle("tp-view-active", active);
    el.classList.toggle("tp-view-enter", active);
  });

  if (name !== "loading") stopLoadingMessages();
}

function startLoadingMessages() {
  let i = 0;
  loadingSub.textContent = LOADING_MESSAGES[0];
  loadingMessageTimer = setInterval(() => {
    i = (i + 1) % LOADING_MESSAGES.length;
    loadingSub.style.opacity = "0";
    setTimeout(() => {
      loadingSub.textContent = LOADING_MESSAGES[i];
      loadingSub.style.opacity = "1";
    }, 280);
  }, 2400);
}

function stopLoadingMessages() {
  if (loadingMessageTimer) {
    clearInterval(loadingMessageTimer);
    loadingMessageTimer = null;
  }
}

async function checkBackendConnection() {
  try {
    const res = await fetch(`${TP_API_BASE}/`);
    if (!res.ok) throw new Error();
    await res.json();
  } catch {
    if (setupHint) {
      setupHint.textContent = "Cannot reach backend — check Railway is running.";
    }
  }
}

function setAuthMessage(text, ok = false) {
  if (!authMsg) return;
  authMsg.textContent = text;
  authMsg.classList.toggle("ok", ok);
}

function updateAccountBar(user) {
  currentUser = user;
  if (!user) {
    accountBar.hidden = true;
    return;
  }

  accountBar.hidden = false;
  const active = user.subscription_status === "active";
  planPill.textContent = active ? "Active" : "Inactive";
  planPill.classList.toggle("pro", active);
  usageText.textContent = active
    ? `${user.analyses_remaining} analyses left`
    : "$20/mo for full access";
  subscribeBtn.hidden = active;
}

function websiteHostname() {
  try {
    return new URL(TP_WEBSITE_URL).hostname;
  } catch {
    return "trade-pilot-rust.vercel.app";
  }
}

async function initSession() {
  websiteLink.href = TP_WEBSITE_URL;
  websiteLink.textContent = `Subscribe at ${websiteHostname()} →`;
  const user = await refreshAccount();
  updateAccountBar(user);
  showView(user ? "setup" : "auth");
}

document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    authMode = tab.dataset.authTab;
    document.querySelectorAll("[data-auth-tab]").forEach((t) => {
      t.classList.toggle("active", t === tab);
    });
    setAuthMessage("");
    document.getElementById("tp-auth-password").autocomplete =
      authMode === "register" ? "new-password" : "current-password";
  });
});

authForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthMessage("");

  const email = document.getElementById("tp-auth-email").value.trim();
  const password = document.getElementById("tp-auth-password").value;

  try {
    const user =
      authMode === "register"
        ? await registerAccount(email, password)
        : await loginAccount(email, password);
    updateAccountBar(user);
    setAuthMessage(`Signed in. ${user.analyses_remaining} analyses left.`, true);
    setTimeout(() => showView("setup"), 400);
  } catch (error) {
    setAuthMessage(error.message);
  }
});

subscribeBtn?.addEventListener("click", async () => {
  try {
    await startCheckout();
  } catch (error) {
    setupHint.textContent = error.message;
  }
});

include30mCheckbox.addEventListener("change", () => {
  mtf30Row.classList.toggle("tp-mtf-disabled", !include30mCheckbox.checked);
  if (!include30mCheckbox.checked) {
    delete savedScreenshots["30m"];
    updateMtfItem("30m", "idle");
  }
  updateAnalyzeButton();
});

analyzeBtn.addEventListener("click", runAiAnalysis);
newCaptureBtn.addEventListener("click", () => showView("setup"));

document.querySelectorAll(".tp-mtf-capture-btn").forEach((btn) => {
  btn.addEventListener("click", () => captureTimeframe(btn.dataset.tf));
});

function getSelectedTimeframes() {
  const frames = [...BASE_TIMEFRAMES];
  if (include30mCheckbox.checked) frames.push("30m");
  return frames;
}

function getCapturedTimeframes() {
  return getSelectedTimeframes()
    .filter((tf) => savedScreenshots[tf])
    .sort((a, b) => TIMEFRAME_ORDER.indexOf(b) - TIMEFRAME_ORDER.indexOf(a));
}

function updateAnalyzeButton() {
  const count = getCapturedTimeframes().length;
  const busy = captureInProgress || analysisInProgress;
  analyzeBtn.disabled = count === 0 || busy;
  analyzeBtn.textContent =
    count === 0 ? "Analyze" : `Analyze (${count} screenshot${count > 1 ? "s" : ""})`;
}

async function getTradingViewTab() {
  const win = await chrome.windows.getCurrent();
  const tabs = await chrome.tabs.query({
    windowId: win.id,
    url: ["*://*.tradingview.com/*"],
  });
  if (!tabs.length) return null;
  return tabs.find((tab) => tab.active) || tabs[tabs.length - 1];
}

async function ensureContentScript(tabId) {
  try {
    const ping = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (ping?.ok) return;
  } catch {
    // Content script missing — inject below.
  }

  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["content.css"],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });

  const ping = await chrome.tabs.sendMessage(tabId, { type: "PING" });
  if (!ping?.ok) {
    throw new Error("Could not connect to TradingView. Refresh the chart tab and try again.");
  }
}

function updateMtfItem(timeframe, state) {
  const item = document.querySelector(`.tp-mtf-item[data-tf="${timeframe}"]`);
  if (!item || item.classList.contains("tp-mtf-disabled")) return;

  const icon = item.querySelector(".tp-mtf-icon");
  const status = item.querySelector(".tp-mtf-status");
  const btn = item.querySelector(".tp-mtf-capture-btn");

  item.classList.remove("tp-mtf-capturing", "tp-mtf-done", "tp-mtf-error");

  if (state === "capturing") {
    item.classList.add("tp-mtf-capturing");
    icon.textContent = "◐";
    status.textContent = "Capturing…";
    btn.disabled = true;
  } else if (state === "done") {
    item.classList.add("tp-mtf-done");
    icon.textContent = "✓";
    status.textContent = "Saved";
    btn.disabled = false;
    btn.textContent = "Recapture";
  } else if (state === "error") {
    item.classList.add("tp-mtf-error");
    icon.textContent = "✕";
    status.textContent = "Failed";
    btn.disabled = false;
    btn.textContent = "Retry";
  } else {
    icon.textContent = "○";
    status.textContent = "Not captured";
    btn.disabled = false;
    btn.textContent = "Capture";
  }
}

function buildScreenshotsPayload() {
  const ordered = getCapturedTimeframes();
  const total = ordered.length;

  return ordered.map((tf, index) => ({
    timeframe: tf,
    screenshot: savedScreenshots[tf].screenshot,
    image_index: index + 1,
    total_images: total,
    role: TIMEFRAME_ROLES[tf] || `Chart context for ${tf}`,
  }));
}

function buildAnalyzePayload(symbol, screenshots) {
  const primary =
    screenshots.find((s) => s.timeframe === "15m") || screenshots[0];

  return {
    symbol,
    screenshots,
    timeframe: primary.timeframe,
    screenshot: primary.screenshot,
  };
}

async function captureTimeframe(timeframe) {
  if (captureInProgress || analysisInProgress) return;
  if (timeframe === "30m" && !include30mCheckbox.checked) return;

  const tab = await getTradingViewTab();
  if (!tab) {
    setupHint.textContent = "Open a TradingView chart tab, then try again.";
    return;
  }

  captureInProgress = true;
  updateMtfItem(timeframe, "capturing");
  updateAnalyzeButton();

  try {
    await chrome.tabs.update(tab.id, { active: true });
    await ensureContentScript(tab.id);

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "CAPTURE_TIMEFRAME",
      timeframe,
    });

    if (!response?.ok) {
      throw new Error(formatApiDetail(response?.error) || "Capture failed.");
    }

    savedScreenshots[timeframe] = response.frame;
    updateMtfItem(timeframe, "done");

    const count = getCapturedTimeframes().length;
    setupHint.textContent = `${timeframe} saved — ${count} ready. Click Analyze when done.`;
  } catch (error) {
    updateMtfItem(timeframe, "error");
    setupHint.textContent = `Could not capture ${timeframe}: ${formatError(error)}`;
  } finally {
    captureInProgress = false;
    updateAnalyzeButton();
  }
}

function showResultsError(message) {
  signalEl.className = "tp-signal wait tp-reveal";
  signalEl.textContent = "ERROR";
  document.getElementById("direction").textContent = "—";
  document.getElementById("confidence").textContent = "0%";
  document.getElementById("tp-confidence-fill").style.width = "0%";
  document.getElementById("entry").textContent = "--";
  document.getElementById("stopLoss").textContent = "--";
  document.getElementById("target").textContent = "--";
  document.getElementById("reason").textContent = "Could not complete analysis.";
  document.getElementById("aiNotes").textContent = message;
  showView("results");
  replayRevealAnimations();
}

function replayRevealAnimations() {
  viewResults.querySelectorAll(".tp-reveal").forEach((el) => {
    el.classList.remove("tp-reveal-play");
    void el.offsetWidth;
    el.classList.add("tp-reveal-play");
  });
}

async function runAiAnalysis() {
  if (!currentUser) {
    showView("auth");
    return;
  }

  const symbol = document.getElementById("tp-symbol").value;
  const screenshots = buildScreenshotsPayload();

  if (!screenshots.length) {
    setupHint.textContent = "Capture at least one timeframe first.";
    return;
  }

  analysisInProgress = true;
  updateAnalyzeButton();
  showView("loading");
  startLoadingMessages();

  try {
    const authHeaders = await getAuthHeaders();
    const response = await fetch(ANALYZE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(buildAnalyzePayload(symbol, screenshots)),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      if (response.status === 401) {
        await clearStoredAuth();
        currentUser = null;
        updateAccountBar(null);
        showView("auth");
        setAuthMessage(formatError(null, response.status, errorData));
        return;
      }
      if (response.status === 402) {
        showView("setup");
        setupHint.textContent = formatError(null, response.status, errorData);
        subscribeBtn.hidden = false;
        return;
      }
      throw new Error(formatError(null, response.status, errorData));
    }

    const data = await response.json();
    if (data.usage) updateAccountBar(data.usage);
    else await initSession();
    updatePanel(data);
    showView("results");
    replayRevealAnimations();
  } catch (error) {
    console.error("TradePilot analyze error:", error);
    showResultsError(formatError(error));
  } finally {
    analysisInProgress = false;
    updateAnalyzeButton();
  }
}

function formatPrice(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return value ?? "--";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function updatePanel(data) {
  const actionMap = {
    ENTER_NOW: "ENTER NOW",
    PLACE_LIMIT: "LIMIT ORDER",
    NO_TRADE: "DO NOT ENTER",
    WAIT: "WAIT",
  };

  signalEl.classList.remove("enter", "limit", "wait", "no-trade", "analyzing");
  signalEl.textContent = actionMap[data.action] || data.action || "WAIT";

  if (data.action === "ENTER_NOW") signalEl.classList.add("enter");
  else if (data.action === "PLACE_LIMIT") signalEl.classList.add("limit");
  else if (data.action === "NO_TRADE") signalEl.classList.add("no-trade");
  else signalEl.classList.add("wait");

  document.getElementById("direction").textContent =
    data.direction || "NEUTRAL";

  const confidence = data.confidence ?? 0;
  document.getElementById("confidence").textContent = `${confidence}%`;
  document.getElementById("tp-confidence-fill").style.width = `${Math.min(
    100,
    Math.max(0, confidence)
  )}%`;

  document.getElementById("entry").textContent = formatPrice(data.entry);
  document.getElementById("stopLoss").textContent = formatPrice(data.stopLoss);
  document.getElementById("target").textContent =
    data.targets?.length ? data.targets.map(formatPrice).join(" / ") : "--";

  document.getElementById("reason").innerHTML =
    data.reason?.length ? data.reason.join("<br>") : "No analysis returned.";

  let notes =
    data.aiNotes?.length ? data.aiNotes.join("<br>") : "No watch notes returned.";

  if (data.timeframeBreakdown?.length) {
    const breakdown = data.timeframeBreakdown
      .map((row) => `<strong>${row.timeframe}</strong>: ${row.summary}`)
      .join("<br>");
    notes += `<br><br>${breakdown}`;
  }

  document.getElementById("aiNotes").innerHTML = notes;
}

include30mCheckbox.dispatchEvent(new Event("change"));
updateAnalyzeButton();
checkBackendConnection();
initSession();
