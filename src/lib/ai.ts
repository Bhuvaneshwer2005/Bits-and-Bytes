/** Client for /api/ai. Validates the model's JSON, retries once, then throws AiFailure so the UI can fall back. */

export type AiFailureKind = "rate_limited" | "not_configured" | "unavailable" | "invalid";

export class AiFailure extends Error {
  constructor(public kind: AiFailureKind) {
    super(kind);
  }
}

interface AiResponse {
  text: string;
  provider: string;
  model: string;
}

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
  if (res.status === 429) throw new AiFailure("rate_limited");
  if (res.status === 503) throw new AiFailure("not_configured");
  if (!res.ok) throw new AiFailure("unavailable");
  return (await res.json()) as AiResponse;
}

/**
 * Calls a prompt and runs `validate` on the parsed JSON. `validate` should throw if the output is unusable.
 * An invalid answer is retried once; a failed request is not (the server already tries both providers).
 */
export async function callAI<T>(
  promptId: string,
  inputs: unknown,
  validate: (json: unknown) => T,
): Promise<{ value: T; provider: string; model: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await requestOnce(promptId, inputs);
    try {
      return { value: validate(JSON.parse(res.text)), provider: res.provider, model: res.model };
    } catch {
      // invalid JSON or failed validation: fall through and try once more
    }
  }
  throw new AiFailure("invalid");
}
