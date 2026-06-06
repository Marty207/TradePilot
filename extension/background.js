/*
  background.js

  Opens the Chrome side panel and captures screenshots for analysis.
*/

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_SENDER_TAB_ID") {
    sendResponse({ tabId: sender.tab?.id ?? null });
    return;
  }

  if (message.type !== "CAPTURE_VISIBLE_TAB") return;

  captureVisibleTab(sender, message.tabId)
    .then((screenshot) => sendResponse({ ok: true, screenshot }))
    .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));

  return true;
});

async function captureVisibleTab(sender, tabId) {
  let windowId = sender.tab?.windowId;

  if (windowId === undefined && tabId) {
    const tab = await chrome.tabs.get(tabId);
    windowId = tab.windowId;
  }

  if (windowId === undefined) {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    windowId = tab?.windowId;
  }

  if (windowId === undefined) {
    throw new Error("No browser window found for screenshot capture.");
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(dataUrl);
    });
  });
}
