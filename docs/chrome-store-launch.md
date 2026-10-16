# Chrome Web Store readiness

The local MV3 package is a dashboard companion. It has only `sidePanel` and `storage` permissions, a local service worker, local CSS/JS, no content scripts, no host permissions, no remote code and a restrictive CSP including `connect-src 'none'`. Its single purpose is opening the user's configured Inbox Agent dashboard. Pairing and Gmail state are visibly unavailable.

Build: `node scripts/build-extension.mjs`. Load `dist/extension` unpacked in Chrome 116+. Run `node --test tests/extension.test.mjs`; then manually open/close the action panel, save/forget an HTTPS URL, reopen Chrome, activate all links, check invalid URL errors and keyboard focus. Confirm no network request occurs until the user follows a dashboard link. Dashboard authentication remains on its own origin.

Icons are original; PNGs are generated locally for supported Chrome manifest sizes. Package local code only. Store listing, screenshots and privacy disclosures must accurately say dashboard companion, with no claims of connected mailbox actions. Supply an owned public privacy policy, developer identity/contact, permission purpose explanations and the data-practices declarations. Make no claim of Google affiliation. Storage permission saves only the address, not email records.

Current outcome: PASS static permission/CSP/URL tests; FAIL store launch. Live Chrome test, listing assets, owner privacy page, disclosures and Google Web Store review have not been completed. A build is not store acceptance. Backend pairing is intentionally unimplemented and cannot be advertised.

Official references checked 2026-10-05: [sidePanel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [manifest icons](https://developer.chrome.com/docs/extensions/reference/manifest/icons), [program policies](https://developer.chrome.com/docs/webstore/program-policies), [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use).
