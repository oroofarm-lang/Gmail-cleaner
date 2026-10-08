"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ShieldCheck,
  Inbox,
  Scissors,
  Mail,
  Command,
  Radio,
  History,
  Settings,
  Search,
  Check,
  Plus,
  ArrowLeft,
  Pause,
  Sun,
  Moon,
  Menu,
  X,
  RefreshCw,
  Trash2,
  ExternalLink,
  Sparkles,
  Download,
} from "lucide-react";
import type { MailGroup } from "@/lib/demo";
import type { Rule } from "@/packages/core";
type Activity = {
  id: string;
  kind: string;
  data: {
    message?: string;
    total?: number;
    gmailId?: string;
    groups?: { sender: string; count: number }[];
  };
  created: number;
  status: string;
};
type State = {
  stats?: {
    total: number;
    safe: number;
    bytes: number;
    protected: number;
    review: number;
    groupCount: number;
  };
  groups: MailGroup[];
  activity: Activity[];
  rules: {
    id: string;
    command: string;
    compiled: Rule;
    enabled: number;
    authorized: number;
  }[];
  settings: {
    source: string;
    privacy: string;
    autopilot: string;
    theme: string;
    notifications: boolean;
  };
  aiConsent?: {
    enabled: number;
    version: number;
    scope: string;
    model: string;
    updated: number;
  } | null;
  connection: { email: string; permission?: string } | null;
  job: { processed: number; status: string } | null;
  syncSchedule: {
    enabled: number;
    interval_minutes: number;
    next_due: number;
    status: string;
    last_success: number | null;
    last_error: string | null;
    failures: number;
  } | null;
  user: { email: string };
  capabilities: {
    gmailOAuth: boolean;
    ai: boolean;
    guardian: boolean;
    scheduledSync: boolean;
    extensionPairing: boolean;
  };
};
type Plan = {
  id: string;
  total: number;
  bytes: number;
  action: string;
  groups: { id: string; sender: string; count: number }[];
  excluded: number;
};
type AssistantResult = {
  type: string;
  title: string;
  text?: string;
  ids?: string[];
  rule?: Rule;
  command?: string;
};
function subscribeView(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("inbox-navigation", callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("inbox-navigation", callback);
  };
}
function viewSnapshot() {
  const v = new URLSearchParams(window.location.search).get("view");
  return v && titles[v] ? v : "report";
}
const nav = [
  ["report", "Inbox report", Inbox],
  ["deep-clean", "Deep clean", Scissors],
  ["subscriptions", "Subscriptions", Mail],
  ["protected", "Protected mail", ShieldCheck],
  ["assistant", "Your inbox agent", Command],
  ["rules", "Rules & autopilot", Radio],
  ["guardian", "Inbox guardian", Sparkles],
  ["activity", "Activity & undo", History],
] as const;
const titles: Record<string, string> = {
  report: "YOUR INBOX,\nA LITTLE LIGHTER.",
  "deep-clean": "MAKE ROOM\nFOR THE GOOD STUFF.",
  subscriptions: "LESS MAIL.\nMORE YOU.",
  protected: "THE IMPORTANT\nSTUFF STAYS.",
  assistant: "A LITTLE HELP\nWITH THE MESS.",
  rules: "YOUR INBOX.\nYOUR RULES.",
  guardian: "KEEP THE\nGOOD GOING.",
  activity: "A PAPER TRAIL.\nNO MYSTERIES.",
  settings: "MAKE IT\nYOUR OWN.",
};
const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const space = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`;
function trapDialogTab(event: React.KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const dialog = event.currentTarget;
  const controls = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.getClientRects().length > 0);
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
function Sticker({
  children,
  tone = "lime",
  className = "",
}: {
  children: React.ReactNode;
  tone?: string;
  className?: string;
}) {
  return <span className={`sticker ${tone} ${className}`}>{children}</span>;
}
function Mark() {
  return (
    <svg
      width="38"
      height="38"
      viewBox="0 0 42 42"
      fill="none"
      aria-hidden="true"
    >
      <path d="M5 8h32v25H5z" fill="currentColor" />
      <path d="m6 9 15 12L36 9" stroke="var(--paper)" strokeWidth="3" />
      <path d="m10 30 7-7m15 7-7-7" stroke="var(--paper)" strokeWidth="2" />
    </svg>
  );
}
async function api<T = Record<string, unknown>>(path: string, body?: unknown) {
  const r = await fetch(
    `/api/${path}`,
    body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const d = (await r.json()) as T & { error?: string };
  if (!r.ok)
    throw new Error(d.error ?? "Something went wrong. Please try again.");
  return d;
}
export default function App() {
  const [data, setData] = useState<State | null>(null),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [plan, setPlan] = useState<Plan | null>(null),
    [search, setSearch] = useState(""),
    [command, setCommand] = useState(""),
    [answer, setAnswer] = useState<AssistantResult | null>(null),
    [rulePreview, setRulePreview] = useState<Rule | null>(null),
    [menu, setMenu] = useState(false),
    [confirm, setConfirm] = useState(""),
    [confirmText, setConfirmText] = useState("");
  const [aiConsentScope, setAiConsentScope] = useState<"commands" | "metadata">(
    "commands",
  );
  const [syncInterval, setSyncInterval] = useState(60);
  const scanPaused = useRef(false);
  useEffect(
    () => () => {
      scanPaused.current = true;
    },
    [],
  );
  const [manualUnsubscribe, setManualUnsubscribe] = useState<{
    reason: string;
    sender: string;
    account: string | null;
    gmailUrl: string;
    search: string;
    candidates: { kind: string; url: string }[];
  } | null>(null);
  const view = useSyncExternalStore(
    subscribeView,
    viewSnapshot,
    () => "report",
  );
  const load = useCallback(async () => {
    try {
      setData(await api<State>("state"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    let mounted = true;
    api<State>("state")
      .then((d) => {
        if (mounted) setData(d);
      })
      .catch((e) => {
        if (mounted) setError((e as Error).message);
      });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    const theme = data?.settings.theme ?? "system";
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      (document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [data?.settings.theme]);
  const go = (v: string) => {
    setSelected([]);
    setSearch("");
    setMenu(false);
    window.history.pushState({}, "", `/?view=${v}`);
    window.dispatchEvent(new Event("inbox-navigation"));
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const act = async (
    label: string,
    path: string,
    body: unknown,
    message: string,
  ) => {
    setBusy(label);
    setError("");
    try {
      const result = await api<{
        preview?: Rule;
        revocationConfirmed?: boolean;
      }>(path, body);
      if (message) setNotice(message);
      await load();
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy("");
    }
  };
  const demo = async () => {
    await act("demo", "demo", {}, "Demo ready. Everything here is synthetic.");
    go("report");
  };
  const scan = async (restart = false) => {
    scanPaused.current = false;
    if (data?.settings.source === "gmail") {
      setBusy("scan");
      setError("");
      try {
        let complete = false;
        let first = true;
        while (!complete && !scanPaused.current) {
          const r = await api<{ processed: number; complete: boolean }>(
            "gmail/scan",
            first && restart ? { restart: true } : {},
          );
          first = false;
          setNotice(
            `${fmt(r.processed)} messages inventoried. Your scan can resume if interrupted.`,
          );
          complete = r.complete;
          await load();
        }
        setNotice(
          scanPaused.current
            ? "Scan paused after the current page. Choose Scan again to resume."
            : "Scan finished. Your report is ready.",
        );
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy("");
      }
    } else
      await act(
        "scan",
        "scan",
        {},
        "Synthetic inbox inventory completed. No real Gmail was read.",
      );
  };
  const preview = async (ids = selected, action = "trash") => {
    if (!ids.length) return;
    setBusy("preview");
    try {
      setPlan(await api<Plan>("preview", { ids, action }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const groups = data?.groups ?? [],
    active = groups.filter((g) =>
      ["active", "unsubscribed"].includes(g.status),
    ),
    total = data?.stats?.total ?? active.reduce((n, g) => n + g.count, 0),
    safe = active.filter(
      (g) =>
        !g.protected &&
        ["newsletter", "promotion", "notification"].includes(g.category),
    ),
    count = data?.stats?.safe ?? safe.reduce((n, g) => n + g.count, 0),
    bytes = data?.stats?.bytes ?? safe.reduce((n, g) => n + g.bytes, 0),
    protectedCount =
      data?.stats?.protected ??
      active.filter((g) => g.protected).reduce((n, g) => n + g.count, 0),
    review = active.filter((g) => !g.protected && g.category === "unknown"),
    news = active.filter((g) => g.list_id),
    demoMode = data?.settings.source === "demo";
  const rows = (
    view === "subscriptions"
      ? news
      : view === "protected"
        ? active.filter((g) => g.protected)
        : view === "deep-clean"
          ? active.filter((g) => !g.protected)
          : active
  ).filter((g) =>
    `${g.sender} ${g.address} ${g.category}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const selectedCount = safe
    .filter((g) => selected.includes(g.id))
    .reduce((n, g) => n + g.count, 0);
  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  const welcome = data && groups.length === 0 && !data.connection;
  return (
    <div className="app-shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside
        className={`sidebar ${menu ? "is-open" : ""}`}
        aria-label="Main navigation"
      >
        <button
          className="brand brand-button"
          onClick={() => go("report")}
          aria-label="Inbox Agent home"
        >
          <Mark />
          <span>
            inbox
            <br />
            agent<span className="brand-dot"></span>
          </span>
        </button>
        <div className="sidebar-caption">LESS NOISE, MORE LIFE.</div>
        <nav>
          {nav.map(([v, label, Icon]) => (
            <button
              key={v}
              onClick={() => go(v)}
              className={view === v ? "nav-link current" : "nav-link"}
              aria-current={view === v ? "page" : undefined}
            >
              <Icon size={18} />
              <span>{label}</span>
              {v === "deep-clean" && count > 0 && (
                <span className="nav-count">{count > 999 ? "1k+" : count}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="safety-note">
            <ShieldCheck size={22} />
            <p>
              Good mail is
              <br />
              <strong>always worth keeping.</strong>
            </p>
          </div>
          <button
            className={view === "settings" ? "nav-link current" : "nav-link"}
            onClick={() => go("settings")}
          >
            <Settings size={18} />
            Settings & privacy
          </button>
          <div className="profile">
            <span className="avatar">
              {data?.user.email.slice(0, 1).toUpperCase() ?? "Y"}
            </span>
            <div>
              <strong>Your workspace</strong>
              <small>{data?.user.email ?? "Sign in to get started"}</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            className="mobile-menu icon-btn"
            aria-expanded={menu}
            aria-label={menu ? "Close navigation" : "Open navigation"}
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
          <span className="breadcrumb">
            YOUR WORKSPACE <span>/</span>{" "}
            {nav.find((n) => n[0] === view)?.[1] ?? "Settings"}
          </span>
          <div className="top-actions">
            {data && (
              <span className="mode-label">
                <span className="status-dot" />
                {demoMode ? "DEMO MODE" : "GMAIL CONNECTED"}
              </span>
            )}
            <button
              className="icon-btn"
              aria-label="Toggle light and dark appearance"
              onClick={() =>
                void act(
                  "theme",
                  "settings",
                  {
                    theme:
                      document.documentElement.dataset.theme === "dark"
                        ? "light"
                        : "dark",
                  },
                  "Appearance updated.",
                )
              }
            >
              <Sun size={18} />
              <Moon size={18} />
            </button>
            <button
              className="agent-shortcut"
              aria-label="Ask your agent"
              onClick={() => go("assistant")}
            >
              <Command size={16} />
              <span>Ask your agent</span>
              <ArrowUpRight size={16} />
            </button>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {busy === "scan" && data?.settings.source === "gmail" && (
            <div className="alert" role="status">
              <span>
                Reading your inbox. You can pause after the current page.
              </span>
              <button
                className="button small"
                onClick={() => {
                  scanPaused.current = true;
                  setNotice("Pausing after the current page…");
                }}
              >
                Pause scan <Pause size={16} />
              </button>
            </div>
          )}
          {error && (
            <div className="alert error" role="alert">
              <span>{error}</span>
              {/Sign in/.test(error) && (
                <a href="/signin-with-chatgpt?return_to=%2F">Sign in</a>
              )}
              <button
                className="icon-btn"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <Check size={17} />
              <span>{notice}</span>
              <button
                className="icon-btn"
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!data ? (
            <div className="loading-state">
              <Mark />
              <h1>{error ? "Let’s get you in." : "Opening your workspace…"}</h1>
              <p>
                {error
                  ? "Sign in to start, or retry if the connection was interrupted."
                  : "Your mail deserves a little breathing room."}
              </p>
              {error && (
                <button className="button" onClick={() => void load()}>
                  Try again
                </button>
              )}
            </div>
          ) : welcome ? (
            <section className="welcome">
              <div className="eyebrow">MEET YOUR INBOX’S BETTER HALF</div>
              <h1>
                LESS INBOX.
                <br />
                <span>MORE LIFE.</span>
              </h1>
              <p>
                Find the clutter. Keep what matters.
                <br />
                Make room for a little headspace.
              </p>
              <div className="welcome-actions">
                <button
                  className="button"
                  disabled={!!busy}
                  onClick={() => void demo()}
                >
                  Explore a demo <ArrowRight size={20} />
                </button>
                {data.capabilities.gmailOAuth ? (
                  <button
                    className="button secondary"
                    onClick={() =>
                      window.location.assign(
                        new URL("/api/oauth/start", window.location.origin)
                          .href,
                      )
                    }
                  >
                    Connect Gmail <ArrowUpRight size={18} />
                  </button>
                ) : (
                  <button
                    className="button secondary"
                    onClick={() => go("settings")}
                  >
                    Gmail setup <ArrowUpRight size={18} />
                  </button>
                )}
              </div>
              <div className="promise-grid">
                <article>
                  <ShieldCheck />
                  <h2>The good stuff stays.</h2>
                  <p>
                    Receipts, conversations and important history are protected
                    first.
                  </p>
                </article>
                <article>
                  <Scissors />
                  <h2>You get the final say.</h2>
                  <p>
                    Review exactly what will move to Trash before approving
                    cleanup.
                  </p>
                </article>
                <article>
                  <History />
                  <h2>A way back.</h2>
                  <p>
                    Undo where Gmail allows recovery. Nothing is permanently
                    deleted by this app.
                  </p>
                </article>
              </div>
              <Sticker className="welcome-sticker" tone="yellow">
                INBOX ZERO-ish ↗
              </Sticker>
              <small className="demo-explainer">
                The demo uses a synthetic 24,000-message inbox. No Gmail access
                needed.
              </small>
            </section>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {view === "report"
                      ? "THE INBOX REPORT / VOL. 01"
                      : "A SMALL ACT OF DIGITAL SELF-CARE"}
                  </div>
                  <h1>
                    {(titles[view] ?? titles.report).split("\n").map((s, i) => (
                      <span key={s}>
                        {s}
                        {i === 0 && <br />}
                      </span>
                    ))}
                  </h1>
                </div>
                <Sticker
                  className="heading-sticker"
                  tone={view === "protected" ? "blue" : "lime"}
                >
                  {view === "protected"
                    ? "KEEP FOREVER"
                    : view === "activity"
                      ? "ALL ACCOUNTED FOR"
                      : view === "rules"
                        ? "HUMAN APPROVED"
                        : "WE CAN FIX THIS ↗"}
                </Sticker>
              </div>
              {demoMode && (
                <p className="demo-note">
                  You’re exploring a synthetic inbox. Cleanup, unsubscribe and
                  Undo affect demo data only.
                </p>
              )}
              {view === "report" && (
                <>
                  <section className="report-grid">
                    <div className="big-stat">
                      <div className="stat-label">EMAILS TAKING UP SPACE</div>
                      <div className="hero-number">
                        {fmt(total)}
                        <span className="asterisk">✳</span>
                      </div>
                      <p>
                        <strong>{fmt(count)} could probably go.</strong>
                        <br />
                        The rest? We’ll be careful with those.
                      </p>
                      <div className="hero-actions">
                        <button
                          className="button"
                          onClick={() => go("deep-clean")}
                        >
                          Let’s clean this mess <ArrowUpRight size={21} />
                        </button>
                        <button
                          className="text-button"
                          onClick={() => void scan()}
                          disabled={!!busy}
                        >
                          <RefreshCw
                            size={15}
                            className={busy === "scan" ? "spin" : ""}
                          />
                          {busy === "scan" ? "Scanning…" : "Scan again"}
                        </button>
                        {!demoMode && data.job?.status === "interrupted" && (
                          <button
                            className="text-button"
                            disabled={!!busy}
                            onClick={() => void scan(true)}
                          >
                            Restart inventory
                          </button>
                        )}
                      </div>
                      <div className="hero-foot">
                        {demoMode
                          ? "SYNTHETIC INVENTORY"
                          : "METADATA INVENTORY"}{" "}
                        <span>↳</span>{" "}
                        {data.job?.status === "running"
                          ? `${fmt(data.job.processed)} inventoried · resumable`
                          : "GOOD MAIL GETS FIRST PRIORITY"}
                      </div>
                    </div>
                    <div className="report-aside">
                      <div className="storage-note">
                        <div className="stat-label">
                          A LITTLE ROOM TO BREATHE
                        </div>
                        <span
                          className="eye-badge storage-eye"
                          aria-label="Cleanup candidate share"
                        >
                          {total ? Math.round((count / total) * 100) : 0}%
                        </span>
                        <strong>{space(bytes)}</strong>
                        <p>estimated space in cleanup candidates</p>
                        <Sticker tone="yellow">THAT’S A LOT OF EMAIL.</Sticker>
                        <svg
                          className="scribble"
                          viewBox="0 0 100 50"
                          aria-hidden="true"
                        >
                          <path
                            d="M3 28C26 4 61 44 89 11M78 10l12 0-1 13"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          />
                        </svg>
                      </div>
                      <div className="protected-note">
                        <ShieldCheck size={27} />
                        <div>
                          <strong>{fmt(protectedCount)}</strong>
                          <span>messages protected</span>
                          <small>The important stuff stays.</small>
                        </div>
                      </div>
                    </div>
                  </section>
                  <section
                    className="inbox-composition"
                    aria-label="Inbox composition"
                  >
                    <div className="composition-title">
                      <span>THE SHAPE OF YOUR INBOX</span>
                      <span>{fmt(total)} MESSAGES</span>
                    </div>
                    <div className="composition-bar">
                      <span
                        className="bar-clutter"
                        style={{
                          width: `${total ? (count / total) * 100 : 0}%`,
                        }}
                      />
                      <span
                        className="bar-protected"
                        style={{
                          width: `${total ? (protectedCount / total) * 100 : 0}%`,
                        }}
                      />
                      <span className="bar-review" style={{ flex: 1 }} />
                    </div>
                    <div className="composition-legend">
                      <span>
                        <i className="dot lime-bg" />
                        Cleanup candidates <strong>{fmt(count)}</strong>
                      </span>
                      <span>
                        <i className="dot ink-bg" />
                        Protected <strong>{fmt(protectedCount)}</strong>
                      </span>
                      <span>
                        <i className="dot yellow-bg" />
                        Human needed{" "}
                        <strong>
                          {fmt(
                            data?.stats?.review ??
                              review.reduce((n, g) => n + g.count, 0),
                          )}
                        </strong>
                      </span>
                    </div>
                  </section>
                  <section className="next-steps">
                    <div className="section-top">
                      <h2>THE USUAL SUSPECTS.</h2>
                      <span>START SMALL. FEEL BETTER.</span>
                    </div>
                    <div className="suspect-grid">
                      {[
                        [
                          "subscriptions",
                          "The newsletters",
                          "You’ve got a lot of reading to not do.",
                          news.reduce((n, g) => n + g.count, 0),
                          "01",
                        ],
                        [
                          "deep-clean",
                          "The old promotions",
                          "A sale from 2019 isn’t really a sale.",
                          safe
                            .filter((g) => g.category === "promotion")
                            .reduce((n, g) => n + g.count, 0),
                          "02",
                        ],
                        [
                          "deep-clean",
                          "The serial senders",
                          "A few senders. A whole lot of noise.",
                          safe
                            .filter((g) => g.count > 2000)
                            .reduce((n, g) => n + g.count, 0),
                          "03",
                        ],
                      ].map(([v, label, text, n, number]) => (
                        <button
                          className="suspect"
                          key={label}
                          onClick={() => go(String(v))}
                        >
                          <div className="suspect-top">
                            <span>No. {number}</span>
                            <ArrowUpRight size={22} />
                          </div>
                          <h3>{label}</h3>
                          <strong>{fmt(Number(n))}</strong>
                          <p>{text}</p>
                          <span className="text-link">
                            Take a look <ArrowRight size={15} />
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                  <section className="agent-strip">
                    <Command size={32} />
                    <div>
                      <h2>Overwhelmed? Just ask.</h2>
                      <p>“Find old newsletters” is a great place to start.</p>
                    </div>
                    <button
                      className="button secondary"
                      onClick={() => go("assistant")}
                    >
                      Talk to your agent <ArrowUpRight size={18} />
                    </button>
                  </section>
                </>
              )}
              {["deep-clean", "subscriptions", "protected"].includes(view) && (
                <>
                  <div className="section-top">
                    <div>
                      <h2>
                        {view === "protected"
                          ? "A SAFE PLACE FOR GOOD MAIL."
                          : view === "subscriptions"
                            ? "YOUR MAILING-LIST ROLL CALL."
                            : "YOU PROBABLY DON’T NEED THESE."}
                      </h2>
                      <p>
                        {view === "protected"
                          ? "Protection overrides every cleanup suggestion."
                          : view === "subscriptions"
                            ? "Unread status is an estimate, not proof you never engage."
                            : "Old bulk mail is a candidate. You review it before anything moves."}
                      </p>
                    </div>
                    {view !== "protected" && demoMode && (
                      <button
                        className="button secondary"
                        onClick={() =>
                          setSelected(
                            safe
                              .filter((g) => rows.some((r) => r.id === g.id))
                              .map((g) => g.id),
                          )
                        }
                      >
                        Select safe groups
                      </button>
                    )}
                  </div>
                  <label className="search-field">
                    <Search size={18} />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Find a sender or category"
                      aria-label="Search senders"
                    />
                    <span>{rows.length} GROUPS</span>
                  </label>
                  {(data.stats?.groupCount ?? 0) > 100 && (
                    <p className="muted">
                      Showing the 100 largest groups. Your report totals include
                      every inventoried group.
                    </p>
                  )}
                  <div className="mail-list">
                    {rows.length ? (
                      rows.map((g, i) => (
                        <article className="mail-row" key={g.id}>
                          {view !== "protected" && demoMode && (
                            <input
                              className="row-checkbox"
                              aria-label={`Select ${g.sender}`}
                              type="checkbox"
                              checked={selected.includes(g.id)}
                              disabled={
                                !!g.protected || g.category === "unknown"
                              }
                              onChange={() => toggle(g.id)}
                            />
                          )}
                          <span className={`sender-avatar color-${i % 4}`}>
                            {g.sender.slice(0, 1)}
                          </span>
                          <div className="sender-info">
                            <h3>{g.sender}</h3>
                            <span>{g.address}</span>
                            <small>
                              {g.category} ·{" "}
                              {g.list_id
                                ? "Mailing-list headers"
                                : "Metadata signals"}{" "}
                              · Oldest {new Date(g.oldest).getFullYear()}
                            </small>
                          </div>
                          <div className="row-stats">
                            <strong>{fmt(g.count)}</strong>
                            <span>messages · {space(g.bytes)}</span>
                          </div>
                          <div className="row-actions">
                            {g.protected ? (
                              <Sticker tone="blue">PROTECTED</Sticker>
                            ) : g.category === "unknown" ? (
                              <Sticker tone="yellow">HUMAN NEEDED</Sticker>
                            ) : (
                              <>
                                <span className="safe-label">
                                  <Check size={14} />
                                  Worth reviewing
                                </span>
                                <button
                                  className="text-button"
                                  disabled={!!busy}
                                  onClick={() =>
                                    void act(
                                      "protect",
                                      "protect",
                                      { id: g.id },
                                      `${g.sender} is protected.`,
                                    )
                                  }
                                >
                                  Keep forever
                                </button>
                                {view === "subscriptions" && (
                                  <button
                                    className="text-button"
                                    onClick={() => {
                                      setManualUnsubscribe(null);
                                      setConfirm(`unsubscribe:${g.id}`);
                                      setConfirmText("");
                                    }}
                                  >
                                    Unsubscribe <ArrowUpRight size={14} />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="empty-state">
                        <Mail size={32} />
                        <h3>
                          {search
                            ? "No senders match."
                            : "Nothing here needs your attention."}
                        </h3>
                        <p>
                          {search
                            ? "Try another sender or category."
                            : "Scan your inbox to update this view."}
                        </p>
                      </div>
                    )}
                  </div>
                  {selected.length > 0 && (
                    <div className="selection-bar">
                      <span>
                        <strong>{fmt(selectedCount)}</strong> messages ·{" "}
                        {selected.length} groups selected
                      </span>
                      <button
                        className="button"
                        disabled={!!busy}
                        onClick={() => void preview()}
                      >
                        Review cleanup <ArrowRight size={18} />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label="Clear selection"
                        onClick={() => setSelected([])}
                      >
                        <X />
                      </button>
                    </div>
                  )}
                  {!demoMode && (
                    <div className="info-panel">
                      <p>
                        Gmail cleanup uses individual messages and fresh safety
                        checks.
                      </p>
                      <button
                        className="button secondary"
                        onClick={() => go("assistant")}
                      >
                        Inspect message candidates
                      </button>
                    </div>
                  )}
                </>
              )}
              {view === "assistant" && (
                <section className="command-center">
                  <div className="command-intro">
                    <Command size={32} />
                    <h2>What’s on your mind?</h2>
                    <p>
                      {demoMode
                        ? "The demo assistant uses deterministic matching. It proposes actions for your review."
                        : "Metadata stays private unless you explicitly enable Smart Mode. Rules and cleanup always require policy checks."}
                    </p>
                  </div>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setBusy("assistant");
                      try {
                        setAnswer(
                          await api<AssistantResult>("assistant", { command }),
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy("");
                      }
                    }}
                  >
                    <label htmlFor="command" className="sr-only">
                      Ask your inbox agent
                    </label>
                    <div className="command-input">
                      <input
                        id="command"
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                        placeholder="Find old newsletters…"
                        maxLength={500}
                        required
                      />
                      <button
                        className="button"
                        disabled={!!busy}
                        type="submit"
                      >
                        <ArrowRight size={20} />
                        <span className="sr-only">Send command</span>
                      </button>
                    </div>
                  </form>
                  <div className="prompt-chips">
                    {[
                      "Find old newsletters",
                      "Why did you protect these?",
                      "Delete promotions older than 6 months",
                      "What did you clean today?",
                    ].map((p) => (
                      <button key={p} onClick={() => setCommand(p)}>
                        {p}
                        <Plus size={13} />
                      </button>
                    ))}
                  </div>
                  {answer && (
                    <div className="assistant-answer">
                      <Sticker>AGENT CHECKED</Sticker>
                      <h2>{answer.title}</h2>
                      <p>{answer.text}</p>
                      {answer.type === "groups" && (
                        <>
                          <div className="answer-groups">
                            {active
                              .filter((g) => answer.ids?.includes(g.id))
                              .slice(0, 8)
                              .map((g) => (
                                <div key={g.id}>
                                  <span>{g.sender}</span>
                                  <strong>{fmt(g.count)}</strong>
                                </div>
                              ))}
                          </div>
                          <button
                            className="button secondary"
                            onClick={() => {
                              go(
                                answer.ids?.some((id) =>
                                  safe.some((g) => g.id === id),
                                )
                                  ? "deep-clean"
                                  : "protected",
                              );
                              setSelected(answer.ids ?? []);
                            }}
                          >
                            Inspect these groups <ArrowRight size={18} />
                          </button>
                          {demoMode &&
                            answer.ids?.some((id) =>
                              safe.some((g) => g.id === id),
                            ) && (
                              <button
                                className="button"
                                onClick={() => void preview(answer.ids)}
                              >
                                Review cleanup
                              </button>
                            )}
                        </>
                      )}
                      {answer.type === "rule" && (
                        <>
                          <div className="compiled-rule">
                            <strong>{answer.rule?.action}</strong>
                            <span>
                              {answer.rule?.sender ?? answer.rule?.category}
                            </span>
                            <span>
                              {answer.rule?.olderThanDays
                                ? `Older than ${answer.rule.olderThanDays} days`
                                : ""}
                            </span>
                          </div>
                          <button
                            className="button"
                            onClick={async () => {
                              await act(
                                "rule",
                                "rules",
                                { command: answer.command, approved: true },
                                "Your rule was approved and saved.",
                              );
                              go("rules");
                            }}
                          >
                            Approve this rule <Check size={18} />
                          </button>
                        </>
                      )}
                      {answer.type === "activity" && (
                        <button
                          className="button"
                          onClick={() => go("activity")}
                        >
                          Open activity <ArrowRight size={18} />
                        </button>
                      )}
                    </div>
                  )}
                  {!demoMode && (
                    <LiveMessages
                      aiEnabled={
                        data.capabilities.ai &&
                        data.settings.privacy === "smart" &&
                        data.aiConsent?.enabled === 1 &&
                        data.aiConsent.scope === "metadata"
                      }
                      busy={busy}
                      setBusy={setBusy}
                      setError={setError}
                      onComplete={load}
                    />
                  )}
                </section>
              )}
              {view === "rules" && (
                <>
                  <div className="autopilot-panel">
                    <div>
                      <Sticker tone="yellow">
                        {data.settings.autopilot === "off"
                          ? "AUTOPILOT OFF"
                          : "ASSISTED MODE"}
                      </Sticker>
                      <h2>Good habits, on your terms.</h2>
                      <p>
                        Assisted mode prepares suggestions. Unattended execution
                        stays unavailable until its worker is configured and
                        verified.
                      </p>
                    </div>
                    <label>
                      Mode
                      <select
                        value={data.settings.autopilot}
                        disabled={!!busy}
                        onChange={(e) =>
                          void act(
                            "mode",
                            "settings",
                            { autopilot: e.target.value },
                            "Inbox maintenance mode updated.",
                          )
                        }
                      >
                        <option value="off">Off · suggestions only</option>
                        <option value="assisted">
                          Assisted · review required
                        </option>
                        <option value="autopilot" disabled>
                          Autopilot · scheduling unavailable
                        </option>
                      </select>
                    </label>
                    <button
                      className="button secondary"
                      onClick={() =>
                        void act(
                          "pause",
                          "settings",
                          { autopilot: "off" },
                          "Autopilot paused.",
                        )
                      }
                    >
                      <Pause size={17} />
                      Pause autopilot
                    </button>
                  </div>
                  <form
                    className="rule-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const result = await act(
                        "preview-rule",
                        "rules",
                        { command, approved: false },
                        "",
                      );
                      if (result) setRulePreview(result.preview ?? null);
                    }}
                  >
                    <label htmlFor="rule-command">
                      MAKE A RULE, IN YOUR OWN WORDS
                    </label>
                    <div className="command-input">
                      <input
                        id="rule-command"
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                        placeholder="Delete promotions older than 6 months"
                        required
                        maxLength={500}
                      />
                      <button className="button" disabled={!!busy}>
                        Preview <ArrowRight size={17} />
                      </button>
                    </div>
                    <p className="muted">
                      Use an exact sender email for protection. Cleanup rules
                      require at least 180 days.
                    </p>
                  </form>
                  {rulePreview && (
                    <div className="info-panel">
                      <h3>Review your rule</h3>
                      <p>
                        {rulePreview.action}{" "}
                        {rulePreview.sender ?? rulePreview.category}{" "}
                        {rulePreview.olderThanDays
                          ? `older than ${rulePreview.olderThanDays} days`
                          : ""}
                        . Protected mail is always excluded.
                      </p>
                      <button
                        className="button"
                        onClick={async () => {
                          await act(
                            "rule",
                            "rules",
                            { command: rulePreview.command, approved: true },
                            "Rule approved.",
                          );
                          setRulePreview(null);
                        }}
                      >
                        Approve & save
                      </button>
                    </div>
                  )}
                  <div className="rule-list">
                    {data.rules.length ? (
                      data.rules.map((r) => (
                        <article key={r.id}>
                          <Radio />
                          <div>
                            <h3>{r.command}</h3>
                            <span>
                              {r.compiled.action} · Human approved ·{" "}
                              {r.enabled ? "Enabled" : "Paused"}
                            </span>
                          </div>
                          <button
                            className="button secondary"
                            onClick={() =>
                              void act(
                                "toggle",
                                "rule-toggle",
                                { id: r.id, enabled: !r.enabled },
                                "Rule updated.",
                              )
                            }
                          >
                            {r.enabled ? "Pause" : "Enable"}
                          </button>
                        </article>
                      ))
                    ) : (
                      <div className="empty-state">
                        <Radio />
                        <h3>A blank slate is a good start.</h3>
                        <p>
                          Create your first rule above. Nothing runs without
                          your approval.
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}
              {view === "guardian" && (
                <section className="guardian-panel">
                  <div className="guardian-art">
                    <ShieldCheck size={100} strokeWidth={1} />
                    <Sticker>GOOD MAIL CLUB</Sticker>
                  </div>
                  <h2>
                    Peace of mind,
                    <br />
                    one message at a time.
                  </h2>
                  <p>
                    Scheduled scans keep your report up to date. They read
                    metadata and never run cleanup rules. Every mailbox change
                    still needs your approval.
                  </p>
                  <div className="guardian-status">
                    <span className="status-dot" />
                    {data.syncSchedule?.enabled
                      ? data.capabilities.scheduledSync
                        ? "Read-only scheduled scans enabled"
                        : "Scheduled scans enabled · worker heartbeat is overdue"
                      : "Scheduled scans are off"}
                  </div>
                  {!demoMode && (
                    <div className="info-panel">
                      <h3>Background scans</h3>
                      <p>
                        {data.capabilities.scheduledSync
                          ? "Choose how often to refresh your inventory. Large scans continue in small pages."
                          : "Background scans are unavailable until the operator configures and verifies the worker. You can scan manually."}
                      </p>
                      {data.syncSchedule?.status === "reauth_required" && (
                        <p role="status">
                          Reconnect Gmail, then enable scans again.
                        </p>
                      )}
                      {data.syncSchedule?.status ===
                        "paused_after_failures" && (
                        <p role="status">
                          Scans paused after repeated failures. Try a manual
                          scan before enabling them again.
                        </p>
                      )}
                      {data.syncSchedule?.status === "backoff" && (
                        <p role="status">
                          The last scan could not finish. A retry is scheduled.
                        </p>
                      )}
                      <label htmlFor="sync-interval">Scan frequency</label>
                      <select
                        id="sync-interval"
                        value={syncInterval}
                        disabled={!!busy || !data.capabilities.scheduledSync}
                        onChange={(event) =>
                          setSyncInterval(Number(event.target.value))
                        }
                      >
                        <option value={15}>Every 15 minutes</option>
                        <option value={60}>Every hour</option>
                        <option value={360}>Every 6 hours</option>
                        <option value={1440}>Daily</option>
                      </select>
                      <button
                        className="button secondary"
                        disabled={
                          !!busy ||
                          (!data.syncSchedule?.enabled &&
                            !data.capabilities.scheduledSync)
                        }
                        onClick={() =>
                          void act(
                            "schedule",
                            "gmail/schedule",
                            {
                              enabled: !data.syncSchedule?.enabled,
                              intervalMinutes: syncInterval,
                            },
                            data.syncSchedule?.enabled
                              ? "Scheduled scans paused. A current read may finish; no cleanup will run."
                              : "Read-only scheduled scans enabled. Cleanup still requires your approval.",
                          )
                        }
                      >
                        {data.syncSchedule?.enabled
                          ? "Pause scheduled scans"
                          : "Enable read-only scans"}
                      </button>
                      {data.syncSchedule?.last_success && (
                        <p className="muted">
                          Last completed scan:{" "}
                          {new Date(
                            data.syncSchedule.last_success,
                          ).toLocaleString()}
                        </p>
                      )}
                    </div>
                  )}
                  <button
                    className="button"
                    onClick={() => void scan()}
                    disabled={!!busy}
                  >
                    Scan now <RefreshCw size={18} />
                  </button>
                  <button className="text-button" onClick={() => go("rules")}>
                    Review your rules <ArrowRight size={17} />
                  </button>
                </section>
              )}
              {view === "activity" && (
                <>
                  <div className="section-top">
                    <h2>EVERY ACTION. OUT IN THE OPEN.</h2>
                    <span>UNDO SUBJECT TO GMAIL RECOVERY</span>
                  </div>
                  {!demoMode && (
                    <section
                      className="alert"
                      aria-label="Interrupted action recovery"
                    >
                      <p>
                        If a cleanup or Undo stopped unexpectedly, check
                        interrupted actions after two minutes. This releases
                        expired work without sending a Gmail change. Then review
                        Activity and choose Undo explicitly. Uncertain status
                        does not confirm that mail moved.
                      </p>
                      <button
                        className="button secondary"
                        disabled={!!busy}
                        onClick={() =>
                          void act(
                            "reconcile",
                            "gmail/reconcile",
                            {},
                            "Interrupted work checked. No Gmail change was sent; review uncertain actions before choosing Undo.",
                          )
                        }
                      >
                        Check interrupted actions
                      </button>
                    </section>
                  )}
                  <div className="activity-list">
                    {data.activity.length ? (
                      data.activity.map((a) => (
                        <article key={a.id}>
                          <span className="activity-icon">
                            {a.kind === "trash" ? (
                              <Trash2 size={20} />
                            ) : a.kind === "protect" ? (
                              <ShieldCheck size={20} />
                            ) : (
                              <Check size={20} />
                            )}
                          </span>
                          <div>
                            <time dateTime={new Date(a.created).toISOString()}>
                              {new Date(a.created).toLocaleString("en-US", {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            </time>
                            <h3>
                              {a.data.message ??
                                ([
                                  "uncertain",
                                  "restore_uncertain",
                                  "attempting",
                                  "restoring",
                                  "pending",
                                  "failed",
                                ].includes(a.status)
                                  ? `Message ${a.status.replaceAll("_", " ")}: review recovery status`
                                  : `${fmt(a.data.total ?? 1)} ${demoMode ? "demo messages" : "message"} ${a.kind === "trash" ? "moved to Trash" : a.kind === "archive" ? "archived" : a.kind}`)}
                            </h3>
                            <p>
                              {a.status === "undone"
                                ? "Restored."
                                : `You approved · ${a.status}`}{" "}
                              {a.data.groups
                                ?.map((g) => g.sender)
                                .slice(0, 3)
                                .join(", ")}
                            </p>
                          </div>
                          {["trash", "archive"].includes(a.kind) &&
                            [
                              "success",
                              "uncertain",
                              "restore_uncertain",
                            ].includes(a.status) && (
                              <button
                                className="button secondary"
                                disabled={!!busy}
                                onClick={() =>
                                  void act(
                                    "undo",
                                    demoMode ? "undo" : "gmail/undo",
                                    { actionId: a.id },
                                    "Messages restored where recovery was available.",
                                  )
                                }
                              >
                                <ArrowLeft size={16} />
                                Undo
                              </button>
                            )}
                        </article>
                      ))
                    ) : (
                      <div className="empty-state">
                        <History size={32} />
                        <h3>No disappearing acts here.</h3>
                        <p>
                          Your first cleanup will appear here, along with
                          available Undo.
                        </p>
                        <button
                          className="button secondary"
                          onClick={() => go("deep-clean")}
                        >
                          Find cleanup candidates
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
              {view === "settings" && (
                <div className="settings-grid">
                  <section>
                    <h2>Gmail connection</h2>
                    <p>
                      {data.connection
                        ? `Connected to ${data.connection.email}`
                        : "Your real inbox is not connected."}
                    </p>
                    {data.capabilities.gmailOAuth ? (
                      <button
                        onClick={() =>
                          window.location.assign(
                            new URL("/api/oauth/start", window.location.origin)
                              .href,
                          )
                        }
                        className="button secondary"
                      >
                        {data.connection
                          ? "Reconnect read-only"
                          : "Connect Gmail read-only"}
                        <ExternalLink size={16} />
                      </button>
                    ) : (
                      <p className="setup-note">
                        Gmail OAuth needs a Google Cloud client, redirect URI
                        and server encryption key. Demo Mode is available now.
                      </p>
                    )}
                    {data.connection && (
                      <p>
                        App access:{" "}
                        {data.connection.permission === "modify"
                          ? "mailbox changes allowed; every cleanup still requires a plan approval"
                          : "read-only scans and previews"}
                        .
                      </p>
                    )}
                    {data.connection &&
                      data.connection.permission !== "modify" &&
                      data.capabilities.gmailOAuth && (
                        <button
                          className="button secondary"
                          onClick={() => setConfirm("gmail-permission")}
                        >
                          Allow mailbox changes <ExternalLink size={16} />
                        </button>
                      )}
                    {data.connection && (
                      <button
                        className="text-button danger"
                        onClick={() => setConfirm("disconnect")}
                      >
                        Disconnect & revoke Google access
                      </button>
                    )}
                    <button className="text-button" onClick={() => void demo()}>
                      Open synthetic demo
                    </button>
                  </section>
                  <section>
                    <h2>AI & privacy</h2>
                    <fieldset>
                      <legend>How should we analyze your mail?</legend>
                      {[
                        [
                          "privacy",
                          "Privacy Mode",
                          "Deterministic metadata analysis. No mail sent to an AI provider.",
                        ],
                        [
                          "smart",
                          "Smart Mode",
                          "Share commands and, only if approved separately, selected mail metadata with OpenAI.",
                        ],
                      ].map(([v, label, description]) => (
                        <label className="radio-option" key={v}>
                          <input
                            type="radio"
                            name="privacy"
                            value={v}
                            checked={data.settings.privacy === v}
                            disabled={v === "smart" && !data.capabilities.ai}
                            onChange={() => {
                              if (v === "smart") {
                                setAiConsentScope("commands");
                                setConfirm("ai-consent");
                              } else
                                void act(
                                  "privacy",
                                  "settings",
                                  { privacy: v },
                                  "Privacy Mode enabled. Future AI requests are blocked.",
                                );
                            }}
                          />
                          <span>
                            <strong>{label}</strong>
                            <small>{description}</small>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                    <button
                      className="text-button"
                      disabled={!data.capabilities.ai}
                      onClick={() => {
                        setAiConsentScope("commands");
                        setConfirm("ai-consent");
                      }}
                    >
                      Review AI sharing choices
                    </button>
                    {data.aiConsent?.enabled === 1 && (
                      <button
                        className="text-button"
                        onClick={() =>
                          void act(
                            "ai-revoke",
                            "ai-consent",
                            {
                              enabled: false,
                              scope: "commands",
                              version: 1,
                              approved: true,
                            },
                            "AI sharing revoked. Already dispatched requests cannot be recalled.",
                          )
                        }
                      >
                        Revoke AI sharing
                      </button>
                    )}
                    <p className="muted">
                      {data.capabilities.ai
                        ? "AI provider configured."
                        : "OpenAI integration is not configured; deterministic suggestions remain available."}
                    </p>
                  </section>
                  <section>
                    <h2>Appearance & notifications</h2>
                    <label>
                      Appearance
                      <select
                        value={data.settings.theme}
                        onChange={(e) =>
                          void act(
                            "theme",
                            "settings",
                            { theme: e.target.value },
                            "Appearance saved.",
                          )
                        }
                      >
                        <option value="system">System</option>
                        <option value="light">Light · clean white</option>
                        <option value="dark">Dark · ink after hours</option>
                      </select>
                    </label>
                    <label className="check-option">
                      <input
                        type="checkbox"
                        checked={data.settings.notifications}
                        onChange={(e) =>
                          void act(
                            "notifications",
                            "settings",
                            { notifications: e.target.checked },
                            "Notification preference saved.",
                          )
                        }
                      />
                      In-app completion notifications
                    </label>
                  </section>
                  <section>
                    <h2>Data & privacy</h2>
                    <p>
                      Export your preferences, rules, stored analysis and action
                      history, or clear app data. This never deletes Gmail
                      messages.
                    </p>
                    <button
                      className="button secondary"
                      onClick={async () => {
                        try {
                          const result = await api("export", {});
                          const records: Record<string, unknown[]> = {};
                          for (const collection of result.collections as string[]) {
                            records[collection] = [];
                            let cursor: string | null = null;
                            do {
                              const page: {
                                rows: unknown[];
                                nextCursor: string | null;
                              } = await api("export", {
                                collection,
                                ...(cursor ? { cursor } : {}),
                              });
                              records[collection].push(...page.rows);
                              cursor = page.nextCursor;
                            } while (cursor);
                          }
                          const url = URL.createObjectURL(
                            new Blob(
                              [JSON.stringify({ ...result, records }, null, 2)],
                              {
                                type: "application/json",
                              },
                            ),
                          );
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = "inbox-agent-data.json";
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      <Download size={16} />
                      Export app data
                    </button>
                    <button
                      className="text-button danger"
                      onClick={() => {
                        setConfirm("delete-data");
                        setConfirmText("");
                      }}
                    >
                      Delete stored app data
                    </button>
                    <button
                      className="text-button danger"
                      onClick={() => {
                        setConfirm("delete-account");
                        setConfirmText("");
                      }}
                    >
                      Delete account
                    </button>
                  </section>
                  <section className="settings-wide">
                    <h2>Transparency, in plain language.</h2>
                    <p>
                      Customer mail is never used to train product models. Inbox
                      Agent moves mail to Trash and never permanently deletes
                      it. Gmail normally removes Trash after 30 days; recovery
                      is limited by Google.
                    </p>
                    <div className="legal-links">
                      {[
                        "privacy",
                        "terms",
                        "accessibility",
                        "security",
                        "ai-disclosure",
                      ].map((p) => (
                        <a key={p} href={`/legal/${p}`}>
                          {p.replace("-", " ")} <ArrowUpRight size={14} />
                        </a>
                      ))}
                    </div>
                    <p className="muted">
                      Private engineering preview. Public launch requires Google
                      verification and legal, accessibility and security review.
                    </p>
                  </section>
                </div>
              )}
              <footer>
                <span>
                  INBOX AGENT <span className="footer-divider">/</span> LESS
                  NOISE, MORE LIFE.
                </span>
                <span>
                  {demoMode
                    ? "SYNTHETIC DATA. REAL PEACE OF MIND."
                    : "YOUR MAIL, YOUR CALL."}{" "}
                  <span aria-hidden="true">✳</span>
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
      {plan && (
        <dialog
          className="review-dialog"
          ref={(el) => {
            if (el && !el.open) el.showModal();
          }}
          onKeyDown={trapDialogTab}
          onCancel={() => setPlan(null)}
          onClose={() => setPlan(null)}
          aria-labelledby="review-title"
        >
          <div className="dialog-top">
            <Sticker tone="lime">REVIEW FIRST</Sticker>
            <button
              className="icon-btn"
              aria-label="Close cleanup review"
              onClick={() => setPlan(null)}
            >
              <X />
            </button>
          </div>
          <h2 id="review-title">
            READY TO
            <br />
            MAKE ROOM?
          </h2>
          <div className="review-number">{fmt(plan.total)}</div>
          <p>
            demo messages will{" "}
            {plan.action === "archive" ? "be archived" : "move to Trash"}.{" "}
            {space(plan.bytes)} estimated.
            <br />
            No real Gmail messages will change.
          </p>
          <ul className="review-checks">
            <li>
              <Check size={17} />
              Old bulk mail or promotional category
            </li>
            <li>
              <Check size={17} />
              Protected and uncertain groups excluded
            </li>
            <li>
              <Check size={17} />
              Fresh protection check before execution
            </li>
            <li>
              <Check size={17} />
              Undo available in Activity
            </li>
          </ul>
          <div className="review-groups">
            {plan.groups.map((g) => (
              <div key={g.id}>
                <span>{g.sender}</span>
                <strong>{fmt(g.count)}</strong>
              </div>
            ))}
          </div>
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setPlan(null)}>
              Keep reviewing
            </button>
            <button
              className="button"
              disabled={!!busy}
              onClick={async () => {
                const result = await act(
                  "execute",
                  "execute",
                  { planId: plan.id, approved: true },
                  `${fmt(plan.total)} demo messages ${plan.action === "archive" ? "archived" : "moved to Trash"}. Undo is in Activity.`,
                );
                if (result) {
                  setPlan(null);
                  setSelected([]);
                }
              }}
            >
              {busy === "execute"
                ? "Moving…"
                : plan.action === "archive"
                  ? "Approve archive"
                  : "Approve & move to Trash"}
              <ArrowRight size={18} />
            </button>
          </div>
        </dialog>
      )}
      {confirm && (
        <dialog
          className="review-dialog compact"
          ref={(el) => {
            if (el && !el.open) el.showModal();
          }}
          onKeyDown={trapDialogTab}
          onCancel={() => setConfirm("")}
          aria-labelledby="confirm-title"
        >
          <div className="dialog-top">
            <Sticker tone="yellow">YOUR CALL</Sticker>
            <button
              className="icon-btn"
              aria-label="Close confirmation"
              onClick={() => setConfirm("")}
            >
              <X />
            </button>
          </div>
          <h2 id="confirm-title">
            {confirm.startsWith("unsubscribe:")
              ? "Leave this list?"
              : confirm === "ai-consent"
                ? "Share data with OpenAI?"
                : confirm === "gmail-permission"
                  ? "Allow Gmail mailbox changes?"
                  : confirm === "disconnect"
                    ? "Disconnect Gmail?"
                    : "Delete stored data?"}
          </h2>
          <p>
            {confirm.startsWith("unsubscribe:")
              ? demoMode
                ? "This simulates unsubscribe for this list. No real request is sent. Its old messages stay until you review a cleanup."
                : "A safe one-click transport is not configured. Use the sender’s unsubscribe option in Gmail."
              : confirm === "ai-consent"
                ? "Your assistant commands go to OpenAI. If you separately approve a message, only its sender domain, redacted subject and standard Gmail labels are shared. Bodies, snippets, attachments, custom labels and account identity are excluded. Subjects and commands may still contain personal information. AI only advises; it cannot approve cleanup or override protections. We request store:false; provider security retention may still apply. Revoke sharing in Settings; already sent requests cannot be recalled."
                : confirm === "gmail-permission"
                  ? "Continue to Google to allow reversible mailbox changes for the connected account. This does not approve cleanup. Every plan still needs your approval, and the app never permanently deletes messages. Google’s permission also includes broader capabilities; this app does not send mail."
                  : confirm === "disconnect"
                    ? "Google access will be revoked. Your Gmail messages stay. Stored analysis remains until you delete it."
                    : "This removes your app analysis, rules and activity. It never deletes Gmail messages. Disconnect Gmail first. Account deletion prevents reuse until an explicit new signup."}
          </p>
          {confirm === "ai-consent" && (
            <label className="radio-option">
              <input
                type="checkbox"
                checked={aiConsentScope === "metadata"}
                onChange={(e) =>
                  setAiConsentScope(e.target.checked ? "metadata" : "commands")
                }
              />
              <span>
                Also allow separately approved message metadata. Leave unchecked
                to share only assistant commands.
              </span>
            </label>
          )}
          {confirm.startsWith("unsubscribe:") &&
            !demoMode &&
            manualUnsubscribe && (
              <div>
                <p>{manualUnsubscribe.reason}</p>
                <p>
                  In Gmail, select{" "}
                  {manualUnsubscribe.account ?? "your connected account"},
                  search for <strong>{manualUnsubscribe.search}</strong>, open a
                  message and use Gmail’s unsubscribe control if available.
                  Verify the sender first.
                </p>
                <a
                  className="button secondary"
                  href={manualUnsubscribe.gmailUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open Gmail <ExternalLink size={16} />
                </a>
                {manualUnsubscribe.candidates.length > 0 && (
                  <p>
                    These destinations come from untrusted email headers.
                    Opening a link may share your IP and a tracking identifier.
                    Review the domain before proceeding; Inbox Agent has sent no
                    request.
                  </p>
                )}
                {manualUnsubscribe.candidates.map((candidate) => (
                  <p key={candidate.url}>
                    <a
                      href={candidate.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {candidate.url}
                    </a>
                  </p>
                ))}
              </div>
            )}
          {confirm.startsWith("delete") && (
            <label className="delete-confirm">
              Type DELETE to confirm
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
              />
            </label>
          )}
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setConfirm("")}>
              Cancel
            </button>
            <button
              className="button"
              disabled={
                !!busy ||
                (confirm.startsWith("delete") && confirmText !== "DELETE")
              }
              onClick={async () => {
                if (confirm === "ai-consent") {
                  const saved = await act(
                    "confirm",
                    "ai-consent",
                    {
                      enabled: true,
                      scope: aiConsentScope,
                      version: 1,
                      approved: true,
                    },
                    "AI sharing consent saved. Each message still needs separate approval.",
                  );
                  if (saved) setConfirm("");
                  return;
                }
                if (confirm === "gmail-permission") {
                  setBusy("confirm");
                  try {
                    const result = await api("oauth/upgrade", {
                      approved: true,
                    });
                    if (typeof result.authorizationUrl !== "string")
                      throw new Error("Google authorization is unavailable.");
                    const destination = new URL(result.authorizationUrl);
                    if (destination.origin !== "https://accounts.google.com")
                      throw new Error(
                        "Google authorization destination unavailable.",
                      );
                    window.location.assign(destination.href);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy("");
                  }
                  return;
                }
                if (confirm.startsWith("unsubscribe:") && !demoMode) {
                  setBusy("manual-unsubscribe");
                  try {
                    setManualUnsubscribe(
                      await api("gmail/unsubscribe-options", {
                        id: confirm.split(":").slice(1).join(":"),
                      }),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy("");
                  }
                  return;
                }
                const path = confirm.startsWith("unsubscribe:")
                  ? "unsubscribe"
                  : confirm === "disconnect"
                    ? "gmail/disconnect"
                    : confirm;
                const payload = confirm.startsWith("unsubscribe:")
                  ? {
                      id: confirm.split(":").slice(1).join(":"),
                      approved: true,
                    }
                  : { confirmation: "DELETE" };
                const result = await act(
                  "confirm",
                  path,
                  payload,
                  "Your request completed.",
                );
                if (result) {
                  if (result.revocationConfirmed === false)
                    setError(
                      "Local access removed, but Google revocation was not confirmed. Revoke Inbox Agent at https://myaccount.google.com/connections.",
                    );
                  setConfirm("");
                  if (confirm.startsWith("delete"))
                    setNotice(
                      "Stored application data deleted. Gmail messages were untouched.",
                    );
                }
              }}
            >
              {confirm.startsWith("unsubscribe:")
                ? demoMode
                  ? "Confirm unsubscribe"
                  : "Review manual options"
                : confirm === "ai-consent"
                  ? "Approve AI sharing"
                  : confirm === "gmail-permission"
                    ? "Continue to Google"
                    : confirm === "disconnect"
                      ? "Disconnect"
                      : "Delete app data"}
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
function LiveMessages({
  aiEnabled,
  busy,
  setBusy,
  setError,
  onComplete,
}: {
  aiEnabled: boolean;
  busy: string;
  setBusy: (s: string) => void;
  setError: (s: string) => void;
  onComplete: () => Promise<void>;
}) {
  const [analysis, setAnalysis] = useState("");
  const [aiMessage, setAiMessage] = useState<{
    id: string;
    metadata: { subject: string; sender: string };
  } | null>(null);
  const [resultText, setResultText] = useState("");
  const [messages, setMessages] = useState<
      {
        id: string;
        metadata: { subject: string; sender: string };
        classification: { action: string; explanation: string };
      }[]
    >([]),
    [selected, setSelected] = useState<string[]>([]),
    [plan, setPlan] = useState<{
      id: string;
      total: number;
      messages: { id: string; subject: string }[];
    } | null>(null);
  return (
    <section className="live-inspector">
      <h2>Inspect real messages</h2>
      {resultText && <p role="status">{resultText}</p>}
      <p>
        Up to 50 inventoried messages at a time. Protected mail cannot be
        selected.
      </p>
      <button
        className="button secondary"
        onClick={async () => {
          try {
            setMessages([
              ...messages,
              ...(
                await api<{
                  messages: {
                    id: string;
                    metadata: { subject: string; sender: string };
                    classification: { action: string; explanation: string };
                  }[];
                }>("gmail/messages", { offset: messages.length })
              ).messages,
            ]);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        {messages.length ? "Load next 50 messages" : "Load messages"}
      </button>
      {messages.map((m) => (
        <label className="live-message" key={m.id}>
          <input
            type="checkbox"
            checked={selected.includes(m.id)}
            disabled={m.classification.action !== "TRASH"}
            onChange={() =>
              setSelected((s) =>
                s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id],
              )
            }
          />
          <span>
            <strong>{m.metadata.subject}</strong>
            <small>
              {m.metadata.sender} · {m.classification.explanation}
            </small>
            <button
              type="button"
              className="text-button"
              disabled={!aiEnabled || !!busy}
              onClick={(e) => {
                e.preventDefault();
                setAiMessage(m);
              }}
            >
              Analyze metadata with AI (Smart Mode)
            </button>
          </span>
        </label>
      ))}
      {aiMessage && (
        <dialog
          className="review-dialog compact"
          ref={(el) => {
            if (el && !el.open) el.showModal();
          }}
          onCancel={() => setAiMessage(null)}
          onKeyDown={trapDialogTab}
          aria-labelledby="ai-message-title"
        >
          <h2 id="ai-message-title">Send selected metadata to OpenAI?</h2>
          <p>{aiMessage.metadata.subject}</p>
          <p>
            Only sender domain, redacted subject and standard labels are shared.
            No body, snippet or attachment is sent. This may still reveal
            personal information. Provider retention may apply. This request
            cannot change your mail.
          </p>
          <button
            className="button secondary"
            onClick={() => setAiMessage(null)}
          >
            Cancel
          </button>
          <button
            className="button"
            disabled={!!busy}
            onClick={async () => {
              setBusy("ai-analysis");
              try {
                setAnalysis(
                  JSON.stringify(
                    await api("analyze-message", {
                      id: aiMessage.id,
                      approved: true,
                    }),
                    null,
                    2,
                  ),
                );
                setAiMessage(null);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy("");
              }
            }}
          >
            Send metadata for advice
          </button>
        </dialog>
      )}
      {analysis && <pre className="analysis-result">{analysis}</pre>}
      {selected.length > 0 && (
        <button
          className="button"
          onClick={async () => {
            try {
              setPlan(
                await api<{
                  id: string;
                  total: number;
                  messages: { id: string; subject: string }[];
                }>("gmail/preview", { ids: selected, action: "trash" }),
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Preview {selected.length} messages
        </button>
      )}
      {plan && (
        <div className="info-panel">
          <h3>{plan.total} real Gmail messages ready for review</h3>
          <ul className="review-checks">
            {plan.messages.map((m) => (
              <li key={m.id}>{m.subject}</li>
            ))}
          </ul>
          <p>
            Approval moves these to Gmail Trash after fresh metadata, thread and
            protection checks. Gmail normally deletes Trash after 30 days. Undo
            is limited by Google.
          </p>
          <button
            className="button"
            disabled={!!busy}
            onClick={async () => {
              setBusy("live-cleanup");
              try {
                const result = await api<{
                  total: number;
                  skipped: number;
                  failed: number;
                }>("gmail/execute", { planId: plan.id, approved: true });
                setResultText(
                  `${result.total} confirmed moved to Gmail Trash; ${result.skipped} skipped; ${result.failed} uncertain.`,
                );
                setError(
                  result.failed
                    ? `${result.total} confirmed moved; ${result.skipped} skipped; ${result.failed} uncertain. Inspect Activity and Gmail before retrying.`
                    : "",
                );
                setPlan(null);
                setSelected([]);
                await onComplete();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy("");
              }
            }}
          >
            Approve Gmail Trash
          </button>
          <button className="button secondary" onClick={() => setPlan(null)}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
