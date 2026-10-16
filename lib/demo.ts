export type MailGroup = {
  id: string;
  sender: string;
  address: string;
  category: string;
  count: number;
  bytes: number;
  oldest: number;
  newest: number;
  protected: number;
  revision: number;
  list_id: string | null;
  status: string;
  source: string;
};
export const demoGroups = [
  [
    "The Daily Edit",
    "hello@dailyedit.example",
    "newsletter",
    4281,
    920000000,
    0,
  ],
  [
    "Studio Supply",
    "news@studiosupply.example",
    "promotion",
    3214,
    610000000,
    0,
  ],
  [
    "Good Things Club",
    "mail@goodthings.example",
    "newsletter",
    2087,
    430000000,
    0,
  ],
  [
    "Thread & Theory",
    "style@threadtheory.example",
    "promotion",
    1842,
    380000000,
    0,
  ],
  [
    "Social dispatch",
    "notify@social.example",
    "notification",
    1672,
    120000000,
    0,
  ],
  [
    "Weekend Reader",
    "notes@weekendreader.example",
    "newsletter",
    1324,
    280000000,
    0,
  ],
  ["Your people", "friends@people.example", "personal", 2841, 440000000, 1],
  ["Work & clients", "team@work.example", "work", 2336, 870000000, 1],
  [
    "Receipts & orders",
    "receipts@orders.example",
    "receipt",
    1924,
    730000000,
    1,
  ],
  ["Bank & tax", "accountant@finance.example", "financial", 1058, 320000000, 1],
  ["Travel plans", "bookings@travel.example", "travel", 543, 220000000, 1],
  [
    "Account security",
    "security@account.example",
    "security",
    621,
    60000000,
    1,
  ],
  ["A mixed bag", "updates@mixed.example", "unknown", 257, 80000000, 0],
] as const;
export const DEFAULT_SETTINGS = {
  source: "demo",
  privacy: "privacy",
  autopilot: "off",
  theme: "system",
  notifications: true,
  protectedSenders: [] as string[],
};
