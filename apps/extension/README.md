# Dashboard companion
Build from the repository root with `node scripts/build-extension.mjs`. In Chrome 116+, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist/extension`. Click the action icon to open the side panel. Paste your deployed HTTPS dashboard address. No default deployment address is invented.

This is an honest local companion, not a connected mailbox client. It stores only the dashboard URL in `chrome.storage.local`, opens that address with `noopener noreferrer`, and provides review/activity view shortcuts. The dashboard handles authentication and actions. The extension makes no HTTP API requests, has no host permissions, content scripts, credentials, model keys, Gmail DOM access or third-party code. API pairing, account state and connected notifications require a later explicit backend protocol and have not been implemented.

Uninstalling clears extension storage. Forget address removes the one saved setting. Test static safety with `node --test tests/extension.test.mjs`. A live Chrome installation and Chrome Web Store acceptance remain release gates.
