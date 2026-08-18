type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface ApiError {
  status: number;
  message: string;
}

/**
 * Thin fetch wrapper. Backend returns Zod-serialized JSON —
 * we just parse and return. Errors are normalised into { status, message }.
 */
export async function api<T>(
  path: string,
  method: HttpMethod = 'GET',
  body?: unknown,
): Promise<T> {
  const url = path
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });

  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    console.error(`[api] ${method} ${path} → ${res.status}`, data);
    throw {
      status: res.status,
      message: (data as { error?: string })?.error ?? res.statusText,
    } satisfies ApiError;
  }

  console.log(`[api] ${method} ${path} → ${res.status}`, data);
  return data as T;
}
