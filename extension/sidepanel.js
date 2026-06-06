const ANALYZE_API = `${TP_API_BASE}/analyze`;

const TIMEFRAME_ROLES = {
  "1m": "Entry timing — micro structure, candles, and precise trigger",
  "5m": "Setup structure — momentum, pullbacks, and intraday pattern",
  "15m": "Session trend — key zones, trend direction, and context",
  "30m": "Higher-timeframe bias — major structure and dominant trend",
};

const BASE_TIMEFRAMES = ["1m", "5m", "15m"];
const TIMEFRAME_ORDER = ["30m", "15m", "5m", "1m"];

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
    if (detail) {
      if (
        detail.includes("timeframe") &&
        detail.toLowerCase().includes("required")
      ) {
        return "Backend is outdated (AI_ONLY). Push the latest backend/ code to GitHub and redeploy on Railway.";
      }
      return detail;
    }
  }

  if (error instanceof Error && error.message && error.message !== "[object Object]") {
    return error.message;
  }
  if (typeof error === "string") return error;
  if (responseStatus === 404) {
    return "Backend not found. In Railway: Settings → Networking → Generate public domain (*.up.railway.app).";
  }
  if (responseStatus) return `Backend error (HTTP ${responseStatus}).`;
  return "Could not reach the backend. Check Railway is running and reload the extension.";
}

async function checkBackendConnection() {
  const reasonEl = document.getElementById("reason");

  try {
    const res = await fetch(`${TP_API_BASE}/`);
    if (!res.ok) {
      reasonEl.textContent = formatError(null, res.status, null);
      return;
    }

    const data = await res.json();
    if (data.mode !== "MTF") {
      reasonEl.textContent =
        "Backend is online but outdated (AI_ONLY). Redeploy the latest backend/ folder on Railway.";
      document.getElementById("aiNotes").textContent =
        "In Railway: set Root Directory to backend, add OPENAI_API_KEY, then redeploy from GitHub.";
      return;
    }

    reasonEl.textContent =
      "Backend connected. Capture your timeframes, then click Analyze.";
  } catch {
    reasonEl.textContent = `Cannot reach ${TP_API_BASE} — check Railway public domain and that the service is running.`;
  }
}

const analyzeBtn = document.getElementById("tp-analyze-btn");
const signalEl = document.getElementById("tp-signal");
const include30mCheckbox = document.getElementById("tp-include-30m");
const mtf30Row = document.getElementById("tp-mtf-30m-row");

const savedScreenshots = {};
let captureInProgress = false;

include30mCheckbox.addEventListener("change", () => {
  mtf30Row.classList.toggle("tp-mtf-disabled", !include30mCheckbox.checked);
  if (!include30mCheckbox.checked) {
    delete savedScreenshots["30m"];
    updateMtfItem("30m", "idle");
  }
  updateAnalyzeButton();
});

analyzeBtn.addEventListener("click", runAiAnalysis);

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
  analyzeBtn.disabled = count === 0 || captureInProgress;
  analyzeBtn.textContent =
    count === 0 ? "Analyze" : `Analyze (${count} screenshot${count > 1 ? "s" : ""})`;
}

async function getTradingViewTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.includes("tradingview.com")) return null;
  return tab;
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

async function captureTimeframe(timeframe) {
  if (captureInProgress) return;
  if (timeframe === "30m" && !include30mCheckbox.checked) return;

  const tab = await getTradingViewTab();
  if (!tab) {
    document.getElementById("reason").textContent =
      "Open a TradingView chart tab, then try again.";
    return;
  }

  captureInProgress = true;
  updateMtfItem(timeframe, "capturing");
  updateAnalyzeButton();

  document.getElementById("reason").textContent = `Drag over the ${timeframe} chart on TradingView…`;

  try {
    await chrome.tabs.update(tab.id, { active: true });

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
    document.getElementById("reason").textContent =
      `${timeframe} saved. ${count} screenshot${count > 1 ? "s" : ""} ready — click Analyze when done.`;
    document.getElementById("aiNotes").textContent =
      "Screenshots stored. Run AI analysis when you are ready.";
  } catch (error) {
    updateMtfItem(timeframe, "error");
    document.getElementById("reason").textContent = `Could not capture ${timeframe}.`;
    document.getElementById("aiNotes").textContent = formatError(error);
  } finally {
    captureInProgress = false;
    updateAnalyzeButton();
  }
}

async function runAiAnalysis() {
  const symbol = document.getElementById("tp-symbol").value;
  const screenshots = buildScreenshotsPayload();

  if (!screenshots.length) {
    document.getElementById("reason").textContent =
      "Capture at least one timeframe first.";
    return;
  }

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "Analyzing…";
  signalEl.classList.add("analyzing");
  signalEl.textContent = "ANALYZING";

  document.getElementById("reason").textContent =
    "Sending screenshots to AI…";
  document.getElementById("aiNotes").textContent =
    "This may take a few seconds.";

  try {
    const response = await fetch(ANALYZE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, screenshots }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const message = formatError(null, response.status, errorData);
      throw new Error(message);
    }

    const data = await response.json();
    updatePanel(data);
    document.getElementById("reason").textContent = "Analysis complete.";
  } catch (error) {
    console.error("TradePilot analyze error:", error);
    document.getElementById("reason").textContent =
      "Could not complete analysis.";
    document.getElementById("aiNotes").textContent = formatError(error);
    signalEl.classList.remove("analyzing");
    signalEl.textContent = "WAIT";
    signalEl.className = "tp-signal wait";
  } finally {
    analyzeBtn.disabled = false;
    updateAnalyzeButton();
    signalEl.classList.remove("analyzing");
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
