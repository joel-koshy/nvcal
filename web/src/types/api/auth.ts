// ─── Request Bodies ─────────────────────────────────────────────────────────

/** POST /auth/signup & POST /auth/login */
export interface Credentials {
  email: string;
  password: string;
}

// ─── Response Bodies ────────────────────────────────────────────────────────

export interface AuthSuccess {
  success: true;
  user_id: string;
}

/** GET /auth/me — check current session */
export interface MeResponse {
  success: true;
  user_id: string;
  email: string;
}

/** POST /auth/logout */
export interface LogoutResponse {
  success: true;
}

// ─── Route → Type Map ───────────────────────────────────────────────────────

export interface AuthRoute {
  '/auth/signup POST': AuthSuccess;
  '/auth/login POST': AuthSuccess;
  '/auth/me GET': MeResponse;
  '/auth/logout POST': LogoutResponse;
}
