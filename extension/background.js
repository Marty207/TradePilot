/*
  background.js

  This captures the visible tab IN MEMORY.
  It does not save anything to downloads/files.
*/

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;

  chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_SIDEBAR" }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== "CAPTURE_VISIBLE_TAB") return;
  
    chrome.tabs.captureVisibleTab(
      sender.tab.windowId,
      { format: "png" },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            ok: false,
            error: chrome.runtime.lastError.message
          });
          return;
        }
  
        sendResponse({
          ok: true,
          screenshot: dataUrl
        });
      }
    );
  
    return true;
  });