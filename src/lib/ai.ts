/** Client for /api/ai. Validates the model's JSON, retries once, then throws AiFailure so the UI can fall back. */

export type AiFailureKind = "rate_limited" | "not_configured" | "unavailable" | "invalid";

export class AiFailure extends Error {
  constructor(
    public kind: AiFailureKind,
    /** Seconds the server asked us to wait before retrying, when it said. */
    public retryAfter?: number,
  ) {
    super(kind);
  }
}

interface AiResponse {
  text: string;
  provider: string;
  model: string;
}

/** How long we are willing to wait, and how often, when the provider says "slow down". */
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_WAIT_SECONDS = 25;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function requestOnce(promptId: string, inputs: unknown): Promise<AiResponse> {
  let res: Response;
  try {
    res = await fetch("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ promptId, inputs }),
    });
  } catch {
    throw new AiFailure("unavailable");
  }
  if (res.status === 429) {
    const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
    throw new AiFailure("rate_limited", typeof body.retry_after === "number" ? body.retry_after : undefined);
  }
  if (res.status === 503) throw new AiFailure("not_configured");
  if (!res.ok) throw new AiFailure("unavailable");
  return (await res.json()) as AiResponse;
}

/** Like requestOnce, but waits and tries again when rate limited (the free tiers are tight). */
async function requestPatiently(promptId: string, inputs: unknown, wait: (ms: number) => Promise<void>): Promise<AiResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestOnce(promptId, inputs);
    } catch (e) {
      if (!(e instanceof AiFailure) || e.kind !== "rate_limited" || attempt >= MAX_RATE_LIMIT_RETRIES) throw e;
      const seconds = Math.min(MAX_WAIT_SECONDS, Math.max(2, e.retryAfter ?? 5 * (attempt + 1)));
      await wait(seconds * 1000);
    }
  }
}

/**
 * Calls a prompt and runs `validate` on the parsed JSON. `validate` should throw if the output is unusable.
 * An invalid answer is retried once. A rate limit is waited out a few times. Other failed requests are not
 * retried (the server already tries both providers).
 */
export async function callAI<T>(
  promptId: string,
  inputs: unknown,
  validate: (json: unknown) => T,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<{ value: T; provider: string; model: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await requestPatiently(promptId, inputs, wait);
    try {
      return { value: validate(JSON.parse(res.text)), provider: res.provider, model: res.model };
    } catch {
      // invalid JSON or failed validation: fall through and try once more
    }
  }
  throw new AiFailure("invalid");
}
