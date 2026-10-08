"use client";
import { useEffect, useState } from "react";
type Device = { id: string; status: string; created: number; expires: number };
type Hello = { id: string; nonce: string; paired: boolean };
type Configuration = {
  enabled: boolean;
  extensionId: string | null;
  devices: Device[];
};
async function api<T = unknown>(path: string, body?: unknown) {
  const response = await fetch(
    `/api/extension${path}`,
    body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok)
    throw Error(
      (data as { error?: string }).error || "Companion request failed.",
    );
  return data as T;
}
function message(
  id: string,
  payload: unknown,
): Promise<Hello & { received?: boolean; error?: string }> {
  const chrome = (
    window as unknown as {
      chrome?: {
        runtime?: {
          sendMessage(
            id: string,
            payload: unknown,
            callback: (
              result: Hello & { received?: boolean; error?: string },
            ) => void,
          ): void;
          lastError?: { message?: string };
        };
      };
    }
  ).chrome;
  if (!chrome?.runtime?.sendMessage)
    return Promise.reject(
      Error(
        "Open this dashboard in Chrome with the configured companion installed.",
      ),
    );
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () =>
        reject(
          Error("Companion did not respond. Reopen the panel and try again."),
        ),
      10000,
    );
    chrome.runtime!.sendMessage(id, payload, (result) => {
      window.clearTimeout(timeout);
      if (chrome.runtime!.lastError || !result || result.error)
        reject(Error("Companion unavailable or request rejected."));
      else resolve(result);
    });
  });
}
export function ExtensionSettings() {
  const [config, setConfig] = useState<Configuration | null>(null);
  const [pending, setPending] = useState<Hello | null>(null);
  const [recovery, setRecovery] = useState<Hello | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => setConfig(await api<Configuration>(""));
  useEffect(() => {
    let active = true;
    api<Configuration>("")
      .then((d) => {
        if (active) setConfig(d);
      })
      .catch(() => {
        if (active) setNotice("Could not load companion settings.");
      });
    return () => {
      active = false;
    };
  }, []);
  const send = async (hello: Hello) => {
    const projection = await api("/summary", {
      id: hello.id,
      nonce: hello.nonce,
    });
    await message(config!.extensionId!, {
      kind: "summary",
      id: hello.id,
      nonce: hello.nonce,
      projection,
    });
    setNotice(
      "Summary sent. It expires on this device after two minutes. Refresh requires an open authenticated dashboard.",
    );
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setNotice("");
    try {
      await work();
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-wide">
      <h2>Chrome companion</h2>
      <p>
        Share only total and protected message counts, action count, connection
        status and whether the data is synthetic. No subjects, addresses, Gmail
        tokens or cleanup authority are shared.
      </p>
      {!config?.enabled && (
        <p>
          Companion relay is unavailable until the operator configures a trusted
          dashboard and extension.
        </p>
      )}
      <button
        className="button secondary"
        disabled={busy || !config?.enabled || !!pending}
        onClick={() =>
          run(async () => {
            const hello = await message(config!.extensionId!, {
              kind: "hello",
            });
            if (
              !/^[a-f0-9]{64}$/.test(hello.nonce) ||
              !/^[a-f0-9-]{36}$/.test(hello.id) ||
              typeof hello.paired !== "boolean"
            )
              throw Error("Invalid companion response.");
            if (hello.paired) {
              try {
                await send(hello);
                setRecovery(null);
              } catch (e) {
                setRecovery(hello);
                throw e;
              }
            } else {
              const started = await api<{ alreadyApproved?: boolean }>(
                "/start",
                { id: hello.id, nonce: hello.nonce },
              );
              if (started.alreadyApproved) await send(hello);
              else setPending(hello);
            }
          })
        }
      >
        Connect or refresh companion
      </button>
      {recovery && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await message(config!.extensionId!, {
                kind: "reset",
                id: recovery.id,
                nonce: recovery.nonce,
              });
              await api("/revoke", { id: recovery.id });
              const hello = await message(config!.extensionId!, {
                kind: "hello",
              });
              await api("/start", { id: hello.id, nonce: hello.nonce });
              setPending(hello);
              setRecovery(null);
            })
          }
        >
          Start new companion approval
        </button>
      )}
      {pending && (
        <div role="group" aria-label="Confirm companion sharing">
          <p>
            <strong>Approve this Chrome device?</strong> Read-only counts will
            be available for up to 30 days. Gmail reconnection or account
            deletion invalidates approval. This request expires after two
            minutes.
          </p>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api("/approve", {
                  id: pending.id,
                  nonce: pending.nonce,
                  approved: true,
                });
                setPending(null);
                await send(pending);
              })
            }
          >
            Approve read-only sharing
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api("/revoke", { id: pending.id });
                setPending(null);
              })
            }
          >
            Cancel pairing
          </button>
        </div>
      )}
      <p aria-live="polite">{notice}</p>
      {config?.devices.map((d) => (
        <div key={d.id}>
          <span>
            Device {d.id.slice(0, 8)} — {d.status}
          </span>
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api("/revoke", { id: d.id });
                if (pending?.id === d.id) setPending(null);
                setNotice(
                  "Approval revoked. A previously shared summary expires within two minutes.",
                );
              })
            }
          >
            Revoke device {d.id.slice(0, 8)}
          </button>
        </div>
      ))}
    </section>
  );
}
