/*
  TradePilot content script (TradingView)

  Per-timeframe capture: user drags a region, then we screenshot that area.
  AI analysis runs from the side panel after all captures are saved.
*/

const TIMEFRAME_ROLES = {
  "1m": "Entry timing — micro structure, candles, and precise trigger",
  "5m": "Setup structure — momentum, pullbacks, and intraday pattern",
  "15m": "Session trend — key zones, trend direction, and context",
  "30m": "Higher-timeframe bias — major structure and dominant trend",
};

let activeSelection = null;

cleanupLegacyOverlay();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CAPTURE_TIMEFRAME") {
    startDragCapture(message.timeframe)
      .then((frame) => sendResponse({ ok: true, frame }))
      .catch((error) =>
        sendResponse({ ok: false, error: String(error.message || error) })
      );
    return true;
  }
});

function cleanupLegacyOverlay() {
  document.getElementById("tradepilot-overlay")?.remove();
  document.getElementById("tp-page-wrapper")?.remove();
  removeSelectorLayer();
  document.documentElement.classList.remove("tp-page-shift", "tp-resizing");
  document.documentElement.style.removeProperty("--tp-sidebar-width");
}

function removeSelectorLayer() {
  document.getElementById("tp-selector-layer")?.remove();
  activeSelection = null;
}

async function getThisTabId() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_SENDER_TAB_ID" }, (response) => {
      resolve(response?.tabId ?? null);
    });
  });
}

function cropScreenshot(screenshotDataUrl, rect) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      const scale = window.devicePixelRatio || 1;
      const canvas = document.createElement("canvas");
      canvas.width = rect.width * scale;
      canvas.height = rect.height * scale;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(
        image,
        rect.left * scale,
        rect.top * scale,
        rect.width * scale,
        rect.height * scale,
        0,
        0,
        rect.width * scale,
        rect.height * scale
      );

      resolve(canvas.toDataURL("image/png"));
    };

    image.onerror = () => reject(new Error("Could not load captured screenshot."));
    image.src = screenshotDataUrl;
  });
}

async function captureVisibleRegion(rect) {
  const captureResponse = await chrome.runtime.sendMessage({
    type: "CAPTURE_VISIBLE_TAB",
    tabId: await getThisTabId(),
  });

  if (!captureResponse?.ok) {
    throw new Error(captureResponse?.error || "Screenshot capture failed.");
  }

  return cropScreenshot(captureResponse.screenshot, rect);
}

function startDragCapture(timeframe) {
  if (activeSelection) {
    return Promise.reject(
      new Error("Finish or cancel the current selection first (Esc).")
    );
  }

  return new Promise((resolve, reject) => {
    const selector = document.createElement("div");
    selector.id = "tp-selector-layer";

    const hint = document.createElement("div");
    hint.id = "tp-selector-hint";
    hint.textContent = `Drag over the ${timeframe} chart area`;

    const box = document.createElement("div");
    box.id = "tp-selection-box";

    selector.appendChild(hint);
    selector.appendChild(box);
    document.body.appendChild(selector);

    let startX = 0;
    let startY = 0;
    let isSelecting = false;

    const cleanup = () => {
      removeSelectorLayer();
      document.removeEventListener("keydown", onEscape);
    };

    const finish = (fn) => {
      cleanup();
      fn();
    };

    const onEscape = (event) => {
      if (event.key !== "Escape") return;
      finish(() => reject(new Error("Capture cancelled.")));
    };

    document.addEventListener("keydown", onEscape);

    selector.addEventListener("mousedown", (event) => {
      isSelecting = true;
      startX = event.clientX;
      startY = event.clientY;
      box.style.left = `${startX}px`;
      box.style.top = `${startY}px`;
      box.style.width = "0px";
      box.style.height = "0px";
      box.style.display = "block";
    });

    selector.addEventListener("mousemove", (event) => {
      if (!isSelecting) return;

      const left = Math.min(startX, event.clientX);
      const top = Math.min(startY, event.clientY);
      const width = Math.abs(event.clientX - startX);
      const height = Math.abs(event.clientY - startY);

      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
    });

    selector.addEventListener("mouseup", async (event) => {
      if (!isSelecting) return;
      isSelecting = false;

      const rect = {
        left: Math.min(startX, event.clientX),
        top: Math.min(startY, event.clientY),
        width: Math.abs(event.clientX - startX),
        height: Math.abs(event.clientY - startY),
      };

      if (rect.width < 80 || rect.height < 80) {
        finish(() =>
          reject(new Error("Selected area is too small. Try a larger chart area."))
        );
        return;
      }

      hint.textContent = `Saving ${timeframe} screenshot…`;
      box.style.display = "none";

      try {
        const screenshot = await captureVisibleRegion(rect);
        finish(() =>
          resolve({
            timeframe,
            screenshot,
            role: TIMEFRAME_ROLES[timeframe] || `Chart context for ${timeframe}`,
          })
        );
      } catch (error) {
        finish(() => reject(error));
      }
    });

    activeSelection = { timeframe, cleanup };
  });
}
