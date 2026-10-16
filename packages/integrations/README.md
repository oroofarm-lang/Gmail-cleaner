# Integration boundaries

The adapters use fixed Google/OpenAI origins, bounded timeouts, redirection errors and injected fetch implementations for tests. Gmail never exposes permanent deletion. Pagination retains provider page tokens; Gmail history IDs remain strings. A history 404 requires a complete resync. Callers must persist the final history cursor only after all history pages and database changes commit, verify Pub/Sub push authentication, and renew watches before their returned expiration (Google recommends daily renewal).

Metadata-only scanning cannot prove attachment absence. `getSafetyMessage` requests Gmail's full MIME structure with a partial-fields projection that excludes body data and snippets. `hasAttachmentOrUncertainty` protects attachments, non-text MIME parts, missing structure and multipart nesting beyond the projection depth. Use it for live pre-mutation revalidation; never infer attachment absence from a metadata-only response. Gmail's REST watch enum is lowercase `include`; the current push guide example uses a contradictory uppercase value, so the adapter follows the REST reference.

OAuth state and PKCE transactions must be stored in a session-bound server store and atomically consumed once before exchange. Never send the verifier, refresh tokens, client secret, or AES key to the browser. Encrypted token records use AES-256-GCM, fresh 96-bit nonces, and account ID authenticated data. Key rotation and refresh-token merge on refresh are storage responsibilities. `gmail.readonly` is the default; explicitly use `modify` for user-approved trash/archive operations. Restricted Gmail scopes require Google's verification and potentially an independent assessment before public production use.

OpenAI receives sender domain, capped partially redacted subject and allowlisted system labels; snippets are ignored. These fields are shared only when the caller has confirmed AI sharing consent. The model is supplied by deployment configuration; the adapter does not select an unverified model. Responses use `store:false`, strict JSON schema and a second Zod validation. Refusal/incomplete responses fail closed. No tools or action capabilities are provided. Model advice is untrusted and must be checked by deterministic protection and authorization rules in the action service. `store:false` is not a promise of zero provider retention.

Unsubscribe URLs are attacker-controlled. Lexical hostname checks cannot prevent DNS rebinding. Cloudflare fetch does not provide an enforceable resolved-address pin for arbitrary HTTPS destinations with the original hostname and certificate validation. Consequently **all unsubscribe candidates are manual-required and the adapter never fetches them or sends mail**. RFC 8058 automatic one-click also requires verifying DKIM coverage of unsubscribe headers; a textual Authentication-Results header is not sufficient proof. A future automatic implementation needs an audited egress proxy that rejects all non-public IPv4/IPv6 addresses, pins resolution for TLS, revalidates each redirect (or disables redirects), limits payload and time, and verifies authentication. No automatic success is reported.

Official references checked during implementation:

- [Gmail REST reference](https://developers.google.com/workspace/gmail/api/reference/rest)
- [Google server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)

Run isolated fake-provider tests: `node --experimental-strip-types --test tests/integrations/*.test.ts`. No test requires secrets or live accounts.
