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
    <div class="tp-header" id="tp-drag-handle">
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
  const savedLeft = localStorage.getItem("tp-left");
  const savedTop = localStorage.getItem("tp-top");

  if (savedWidth) overlay.style.width = savedWidth;
  if (savedLeft) overlay.style.left = savedLeft;
  if (savedTop) overlay.style.top = savedTop;

  overlay.style.right = "auto";

  makeOverlayDraggable(overlay);
  makeOverlayResizable(overlay);

  document.getElementById("tp-close-btn").addEventListener("click", () => {
    overlay.style.display = "none";
  });

  document
    .getElementById("tp-analyze-btn")
    .addEventListener("click", startAreaSelection);
}

function makeOverlayResizable(overlay) {
  const handle = document.getElementById("tp-resize-handle");

  let resizing = false;
  let startX = 0;
  let startLeft = 0;
  let startWidth = 0;

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();

    resizing = true;

    const rect = overlay.getBoundingClientRect();

    startX = e.clientX;
    startLeft = rect.left;
    startWidth = rect.width;

    overlay.style.left = `${rect.left}px`;
    overlay.style.right = "auto";

    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (!resizing) return;

    const delta = e.clientX - startX;

    let newLeft = startLeft + delta;
    let newWidth = startWidth - delta;

    if (newWidth < 320) {
      newWidth = 320;
      newLeft = startLeft + startWidth - 320;
    }

    if (newLeft < 8) {
      newWidth = startWidth + startLeft - 8;
      newLeft = 8;
    }

    overlay.style.left = `${newLeft}px`;
    overlay.style.width = `${newWidth}px`;

    localStorage.setItem("tp-left", `${newLeft}px`);
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

    const captureResponse = await chrome.runtime.sendMessage({
      type: "CAPTURE_VISIBLE_TAB"
    });

    if (!captureResponse?.ok) {
      throw new Error(captureResponse?.error || "Screenshot capture failed.");
    }

    const croppedImage = await cropScreenshot(captureResponse.screenshot, rect);

    document.getElementById("reason").textContent =
      "Sending chart to AI...";

    const response = await fetch("http://localhost:8000/analyze", {
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

function makeOverlayDraggable(overlay) {
  const handle = document.getElementById("tp-drag-handle");

  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;

  handle.addEventListener("mousedown", (event) => {
    if (event.target.id === "tp-close-btn") return;

    isDragging = true;

    const rect = overlay.getBoundingClientRect();

    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;

    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.right = "auto";

    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (event) => {
    if (!isDragging) return;

    const newLeft = event.clientX - offsetX;
    const newTop = event.clientY - offsetY;

    overlay.style.left = `${newLeft}px`;
    overlay.style.top = `${newTop}px`;

    localStorage.setItem("tp-left", `${newLeft}px`);
    localStorage.setItem("tp-top", `${newTop}px`);

  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
    document.body.style.userSelect = "";
  });
}