import { z } from "zod";
export const IntentSchema = z
  .object({
    intent: z.enum([
      "newsletters",
      "promotions",
      "protected",
      "activity",
      "rule",
      "review",
    ]),
    ruleCommand: z.string().max(500).nullable(),
  })
  .strict();
export async function interpretCommand(
  command: string,
  options: {
    apiKey: string;
    model: string;
    fetch?: typeof fetch;
    authorize?: () => Promise<void>;
  },
) {
  await options.authorize?.();
  const response = await (options.fetch ?? fetch)(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model: options.model,
        store: false,
        max_output_tokens: 400,
        instructions:
          'Interpret only this authenticated user command for a Gmail review UI. No tools are available. Never claim to execute anything. Translate exact protection commands into "Protect sender@domain.com" or cleanup commands into "Delete promotions older than N days" / "Delete newsletters older than N days" / "Archive promotions older than N days". Require an exact sender address; never invent it. Vague, mailbox-wide, unsupported or unsafe commands become review. Rules may never remove protections; age must be >=180 days. Return intent and nullable ruleCommand only.',
        input: command.slice(0, 500),
        text: {
          format: {
            type: "json_schema",
            name: "inbox_intent",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                intent: {
                  type: "string",
                  enum: [
                    "newsletters",
                    "promotions",
                    "protected",
                    "activity",
                    "rule",
                    "review",
                  ],
                },
                ruleCommand: { type: ["string", "null"] },
              },
              required: ["intent", "ruleCommand"],
            },
          },
        },
      }),
    },
  );
  if (!response.ok) throw new Error("AI interpretation unavailable");
  const data = (await response.json()) as {
    status: string;
    output?: { type: string; content?: { type: string; text?: string }[] }[];
  };
  if (data.status !== "completed")
    throw new Error("AI interpretation incomplete");
  const text = data.output
    ?.filter((x) => x.type === "message")
    .flatMap((x) => x.content ?? [])
    .filter((x) => x.type === "output_text")
    .map((x) => x.text ?? "")
    .join("");
  if (!text || text.length > 2000) throw new Error("Invalid AI interpretation");
  return IntentSchema.parse(JSON.parse(text));
}
