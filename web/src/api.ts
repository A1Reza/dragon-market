import { SnapshotSchema, type Mutation, type Reply } from "./contracts";
export const API_BASE = (import.meta.env.VITE_API_BASE || "/api").replace(
  /\/$/,
  "",
);
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload: unknown,
    public requestId: string | null,
  ) {
    super(message);
  }
}
export async function request<T = unknown>(
  path: string,
  options: RequestInit = {},
  base = API_BASE,
): Promise<Reply<T>> {
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
    : AbortSignal.timeout(15000);
  const response = await fetch(base + path, {
    ...options,
    signal,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const raw = await response.text();
  let data: unknown = raw || null;
  if (
    raw &&
    response.headers.get("content-type")?.includes("application/json")
  ) {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new APIError(
        "Backend returned malformed JSON",
        response.status,
        raw,
        response.headers.get("x-request-id"),
      );
    }
  }
  if (!response.ok)
    throw new APIError(
      typeof data === "string"
        ? data.trim()
        : `Request rejected (${response.status})`,
      response.status,
      data,
      response.headers.get("x-request-id"),
    );
  return {
    status: response.status,
    data: data as T,
    requestId: response.headers.get("x-request-id"),
    replayed: response.headers.get("idempotency-replayed") === "true",
  };
}
export async function snapshot(signal?: AbortSignal) {
  return SnapshotSchema.parse(
    (await request("/dev/snapshot", { signal })).data,
  );
}
export function mutate(m: Mutation) {
  return request(m.path, {
    method: m.method,
    body: m.body === undefined ? undefined : JSON.stringify(m.body),
    headers: m.key ? { "Idempotency-Key": m.key } : {},
  });
}
export const newKey = () => crypto.randomUUID();
// Gold.Amount uses hundredths. Inputs are explicitly smallest units; no floating point mutations.
export function gold(value: number) {
  return (value / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
export function integer(value: FormDataEntryValue | null, positive = true) {
  const v = Number(value);
  if (
    value === null ||
    String(value).trim() === "" ||
    !Number.isSafeInteger(v) ||
    v < (positive ? 1 : 0)
  )
    throw new Error(
      `Enter a ${positive ? "positive" : "nonnegative"} safe integer in smallest units`,
    );
  return v;
}
export function nextBid(current: number) {
  const result = current + Math.ceil(current / 20);
  return Number.isSafeInteger(result) ? result : null;
}
export function canList(
  item: { owner_id: string; status: string; type: string },
  actor: string,
) {
  return item.owner_id === actor && item.status === "free";
}
