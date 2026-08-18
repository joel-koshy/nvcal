export type OAuthProvider = 'google' | 'apple';

export interface User {
	id: string;
	email: string;
	created_at: string; // ISO-8601 UTC
}

export interface OAuthConnection {
	id: string;
	user_id: string;
	provider: OAuthProvider;
	provider_account_id: string;
	access_token?: string;
	refresh_token?: string;
	expires_at?: string; // ISO-8601 UTC
}