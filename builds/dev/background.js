/**
 * Lead Pro — Background Service Worker
 * Opens Lead Pro as a pinned side panel automatically when the toolbar icon is clicked.
 * Agents can unpin using Chrome's built-in pin controls if needed.
 */

// Open the side panel when the toolbar icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch(function(err) {
    console.warn('[Lead Pro] setPanelBehavior failed:', err);
  });

chrome.action.onClicked.addListener(function(tab) {
  chrome.sidePanel.open({ tabId: tab.id })
    .catch(function(err) {
      console.warn('[Lead Pro] sidePanel.open failed:', err);
    });
});
