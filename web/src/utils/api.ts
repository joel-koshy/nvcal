type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiError {
  status: number;
  message: string;
}

/**
 * Fired on a 401 from a protected route so the app can open the login modal.
 * Auth routes are excluded — a failed login already sits inside the modal.
 */
export const AUTH_REQUIRED_EVENT = 'auth:required';

/**
 * Thin fetch wrapper. Backend returns Zod-serialized JSON —
 * we just parse and return. Errors are surfaced as { status, message },
 * and an unauthorized response dispatches AUTH_REQUIRED_EVENT.
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
    if (res.status === 401 && !path.startsWith('/auth')) {
      window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
    }
    throw {
      status: res.status,
      message: (data as { error?: string })?.error ?? res.statusText,
    } satisfies ApiError;
  }

  console.log(`[api] ${method} ${path} → ${res.status}`, data);
  return data as T;
}
