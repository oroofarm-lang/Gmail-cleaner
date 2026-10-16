import { validProjection } from './relay.js';
import { relayOrigin } from './relay-config.js';
import { validateDashboardUrl } from './url.js';
const input = document.querySelector('#dashboard-url');
const notice = document.querySelector('#notice');
const links = [document.querySelector('#dashboard-link'), document.querySelector('#review-link'), document.querySelector('#activity-link')];
const forget = document.querySelector('#forget');
function render(value) {
  const url = validateDashboardUrl(value);
  input.value = url || '';
  links.forEach((link, index) => {
    link.hidden = !url;
    if (url) { const target = new URL(url); if (index) target.searchParams.set('view', ['', 'deep-clean', 'activity'][index]); link.href = target.href; }
    else link.removeAttribute('href');
  });
  forget.hidden = !url;
}
chrome.storage.local.get('dashboardUrl').then(({ dashboardUrl }) => render(dashboardUrl)).catch(() => {
  notice.textContent = 'Could not read this device’s settings. Try reopening the panel.';
});
document.querySelector('#configuration').addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = validateDashboardUrl(input.value);
  if (!url) { notice.textContent = 'Enter an HTTPS address without credentials, query parameters or a fragment.'; return; }
  try { await chrome.storage.local.set({ dashboardUrl: url }); render(url); notice.textContent = 'Address saved. Open the dashboard to sign in. Extension pairing is still unavailable.'; }
  catch { notice.textContent = 'Address could not be saved. Please try again.'; }
});
forget.addEventListener('click', async () => {
  try { await chrome.storage.local.remove('dashboardUrl'); render(null); notice.textContent = 'Dashboard address removed from this device.'; }
  catch { notice.textContent = 'Address could not be removed. Please try again.'; }
});

const summary = document.querySelector('#summary');
const refresh = document.querySelector('#companion-link');
function renderSummary(companion) {
  if (!relayOrigin) return;
  document.querySelector('#connection-heading').textContent = 'Read-only companion';
  document.querySelector('.status p').textContent = 'Approve sharing in the authenticated dashboard. The companion cannot modify mail.';
  document.querySelector('#forget-companion').hidden = !companion;
  refresh.hidden = false;
  refresh.href = relayOrigin + '/?view=settings';
  const p = companion?.projection;
  summary.textContent = validProjection(p) ? `${p.source === 'demo' ? 'Synthetic' : 'Gmail'} summary: ${p.total} messages, ${p.protected} protected, ${p.actions} actions. Gmail ${p.connected ? 'connected' : 'disconnected'}.` : 'No current summary. Open the dashboard to approve or refresh. Shared summaries expire after two minutes.';
}
chrome.storage.local.get('companion').then(({companion})=>renderSummary(companion)).catch(()=>{summary.textContent='Could not load summary.'});
chrome.storage.onChanged.addListener((changes, area)=>{if(area==='local' && changes.companion)renderSummary(changes.companion.newValue)});
setInterval(()=>chrome.storage.local.get('companion').then(({companion})=>renderSummary(companion)).catch(()=>{}),10000);

document.querySelector('#forget-companion').addEventListener('click', async () => {
  try {
    const response = await chrome.runtime.sendMessage({kind:'forget-companion'});
    if (!response?.forgotten) throw Error();
    notice.textContent = 'Local approval and summary removed. Revoke this device in the dashboard to remove server approval.';
  } catch { notice.textContent = 'Could not forget companion. Try again.'; }
});
