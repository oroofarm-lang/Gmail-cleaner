import { createRelay } from './relay.js';
import { relayOrigin } from './relay-config.js';
const access = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const relay = createRelay(chrome.storage.local, relayOrigin);
chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  access.then(() => relay(message, sender)).then(respond, () => respond({ error: 'Companion request was rejected.' }));
  return true;
});
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('sidepanel.html') || message?.kind !== 'forget-companion' || Object.keys(message).length !== 1) return false;
  access.then(() => relay.forget()).then(() => respond({ forgotten: true }), () => respond({ error: 'Could not forget companion.' }));
  return true;
});
