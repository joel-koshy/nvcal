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

// ─── Route → Type Map ───────────────────────────────────────────────────────

export interface AuthRoute {
  '/auth/signup POST': AuthSuccess;
  '/auth/login POST': AuthSuccess;
}
