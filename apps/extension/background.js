/* The browser action opens a local side panel; there are no mailbox capabilities. */
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Chrome versions below minimum_chrome_version cannot install this package.
  });
});
