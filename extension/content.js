/*
  TradePilot Select Area Version

  Simple product flow:
  1. Click Analyze
  2. Drag over the chart area
  3. AI analyzes only that selected area
*/

if (!document.getElementById("tradepilot-overlay")) {
  const overlay = document.createElement("div");
  overlay.id = "tradepilot-overlay";

  overlay.innerHTML = `
    <div class="tp-header">
      <div>
        <div class="tp-brand">TradePilot</div>
        <div class="tp-subtitle">AI chart analysis</div>
      </div>
      <button id="tp-close-btn">×</button>
    </div>

    <div class="tp-controls">
      <select id="tp-symbol">
        <option value="NQ=F">NQ</option>
        <option value="ES=F">ES</option>
      </select>

      <select id="tp-timeframe">
        <option value="1m">1m</option>
        <option value="3m">3m</option>
        <option value="5m">5m</option>
        <option value="15m">15m</option>
        <option value="30m">30m</option>
      </select>
    </div>

    <div class="tp-body">
      <div class="tp-signal wait" id="tp-signal">WAIT</div>

      <div class="tp-grid">
        <div>
          <span>Direction</span>
          <strong id="direction">NEUTRAL</strong>
        </div>
        <div>
          <span>Confidence</span>
          <strong id="confidence">0%</strong>
        </div>
      </div>

      <div class="tp-levels">
        <div>
          <span>Entry</span>
          <strong id="entry">--</strong>
        </div>
        <div>
          <span>Stop</span>
          <strong id="stopLoss">--</strong>
        </div>
        <div>
          <span>Targets</span>
          <strong id="target">--</strong>
        </div>
      </div>

      <button id="tp-analyze-btn">Analyze Area</button>

      <div class="tp-section">
        <div class="tp-label">Analysis</div>
        <div class="tp-text" id="reason">
          Click Analyze Area, then drag over the chart.
        </div>
      </div>

      <div class="tp-section">
        <div class="tp-label">Next Watch</div>
        <div class="tp-text" id="aiNotes">
          Waiting for chart selection.
        </div>
      </div>

      <div class="tp-footer">
        Decision-support only. Not financial advice.
      </div>

      <div id="tp-resize-handle"></div>
    </div>
  `;

  document.body.appendChild(overlay);

  const savedWidth = localStorage.getItem("tp-width");
  if (savedWidth) overlay.style.width = savedWidth;

  const savedHidden = localStorage.getItem("tp-hidden") === "1";
  if (savedHidden) overlay.style.display = "none";

  makeSidebarResizable(overlay);

  document.getElementById("tp-close-btn").addEventListener("click", () => {
    overlay.style.display = "none";
    localStorage.setItem("tp-hidden", "1");
  });

  document
    .getElementById("tp-analyze-btn")
    .addEventListener("click", startAreaSelection);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== "TOGGLE_SIDEBAR") return;

    const isHidden = overlay.style.display === "none";
    overlay.style.display = isHidden ? "" : "none";
    localStorage.setItem("tp-hidden", isHidden ? "0" : "1");
  });
}

function makeSidebarResizable(overlay) {
  const handle = document.getElementById("tp-resize-handle");

  let resizing = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();

    resizing = true;
    startX = e.clientX;
    startWidth = overlay.getBoundingClientRect().width;

    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (!resizing) return;

    const delta = startX - e.clientX;
    let newWidth = startWidth + delta;

    const maxWidth = Math.min(560, window.innerWidth - 48);
    newWidth = Math.max(320, Math.min(newWidth, maxWidth));

    overlay.style.width = `${newWidth}px`;
    localStorage.setItem("tp-width", `${newWidth}px`);
  });

  document.addEventListener("mouseup", () => {
    if (!resizing) return;

    resizing = false;
    document.body.style.userSelect = "";
  });
}

function startAreaSelection() {
  document.getElementById("reason").textContent =
    "Drag over the exact chart area you want analyzed.";

  const selector = document.createElement("div");
  selector.id = "tp-selector-layer";

  const box = document.createElement("div");
  box.id = "tp-selection-box";

  selector.appendChild(box);
  document.body.appendChild(selector);

  let startX = 0;
  let startY = 0;
  let isSelecting = false;

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
      height: Math.abs(event.clientY - startY)
    };

    selector.remove();

    if (rect.width < 80 || rect.height < 80) {
      document.getElementById("reason").textContent =
        "Selected area is too small. Try a larger chart area.";
      return;
    }

    await analyzeSelectedArea(rect);
  });
}

async function analyzeSelectedArea(rect) {
  const button = document.getElementById("tp-analyze-btn");
  const symbol = document.getElementById("tp-symbol").value;
  const timeframe = document.getElementById("tp-timeframe").value;

  try {
    button.textContent = "Analyzing...";
    button.disabled = true;

    document.getElementById("reason").textContent =
      "Capturing selected area...";

    const overlay = document.getElementById("tradepilot-overlay");
    overlay.style.visibility = "hidden";

    const captureResponse = await chrome.runtime.sendMessage({
      type: "CAPTURE_VISIBLE_TAB"
    });

    overlay.style.visibility = "";

    if (!captureResponse?.ok) {
      throw new Error(captureResponse?.error || "Screenshot capture failed.");
    }

    const croppedImage = await cropScreenshot(captureResponse.screenshot, rect);

    document.getElementById("reason").textContent =
      "Sending chart to AI...";

    const response = await fetch("https://tradepilot-production-407b.up.railway.app/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        symbol,
        timeframe,
        screenshot: croppedImage
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.detail || "Backend analysis failed.");
    }
    
    const data = await response.json();
    updateOverlay(data);

  } catch (error) {
    document.getElementById("reason").textContent =
      "Could not analyze the selected area.";

    document.getElementById("aiNotes").textContent = String(error);

    console.error("TradePilot error:", error);
  } finally {
    const overlay = document.getElementById("tradepilot-overlay");
    if (overlay) overlay.style.visibility = "";

    button.textContent = "Analyze Area";
    button.disabled = false;
  }
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

    image.onerror = () => {
      reject(new Error("Could not load captured screenshot."));
    };

    image.src = screenshotDataUrl;
  });
}

function formatPrice(value) {
  const num = Number(value);

  if (Number.isNaN(num)) {
    return value ?? "--";
  }

  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function updateOverlay(data) {
  const signal = document.getElementById("tp-signal");

  const actionMap = {
    ENTER_NOW: "ENTER NOW",
    PLACE_LIMIT: "LIMIT ORDER",
    NO_TRADE: "DO NOT ENTER",
    WAIT: "WAIT",
  };
  
  signal.textContent = actionMap[data.action] || data.action || "WAIT";

  signal.classList.remove("enter", "limit", "wait", "no-trade");

  if (data.action === "ENTER_NOW") {
    signal.classList.add("enter");
  } else if (data.action === "PLACE_LIMIT") {
    signal.classList.add("limit");
  } else if (data.action === "NO_TRADE") {
    signal.classList.add("no-trade");
  } else {
    signal.classList.add("wait");
  }

  document.getElementById("direction").textContent =
    data.direction || "NEUTRAL";

  document.getElementById("confidence").textContent =
    `${data.confidence ?? 0}%`;

  document.getElementById("entry").textContent =
    formatPrice(data.entry);
  
  document.getElementById("stopLoss").textContent =
    formatPrice(data.stopLoss);

  document.getElementById("target").textContent = 
    data.targets && data.targets.length
      ? data.targets.map(formatPrice).join(" / ")
      : "--";

  document.getElementById("reason").innerHTML =
    data.reason && data.reason.length
      ? data.reason.join("<br>")
      : "No analysis returned.";

  document.getElementById("aiNotes").innerHTML =
    data.aiNotes && data.aiNotes.length
      ? data.aiNotes.join("<br>")
      : "No watch notes returned.";
}
