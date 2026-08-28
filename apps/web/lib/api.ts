export class ApiError extends Error {
  constructor(message: string, public status: number, public fields?: Record<string, string[]>, public code?: string) { super(message); }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (typeof options.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.message ?? "De aanvraag is mislukt.", response.status, data.fields, data.error);
  return data as T;
}

export function formatDate(value?: string | null) {
  if (!value) return "Nog niet";
  return new Intl.DateTimeFormat("nl-NL", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
