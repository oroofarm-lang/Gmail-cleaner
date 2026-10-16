const events = [
  "api_failure",
  "scheduled_failure",
  "infrastructure_failure",
] as const;
type OperationalEvent = (typeof events)[number];
/** Deliberately accepts no error object, request, tenant identity or arbitrary fields. */
export function emitOperationalEvent(
  event: OperationalEvent,
  sink: (line: string) => void = (line) => console.error(line),
) {
  if (!events.includes(event)) throw Error("Invalid operational event.");
  const id = crypto.randomUUID();
  sink(JSON.stringify({ version: 1, event, id, at: Date.now() }));
  return id;
}
