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
