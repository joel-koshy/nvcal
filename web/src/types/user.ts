export type OAuthProvider = 'google' | 'apple';

export interface User {
  id: string; 
  email: string;
  created_at: string; // ISO-8601 UTC string
}

export interface OAuthConnection {
  id: string;
  user_id: string;
  provider: OAuthProvider;
  provider_account_id: string;
  // Security note: Tokens are often stripped before reaching the UI, 
  // but included here if your frontend needs to manage/refresh them directly.
  // !TODO DELTE ME 
  access_token?: string;
  refresh_token?: string;
  expires_at?: string; // ISO-8601 UTC string
}




