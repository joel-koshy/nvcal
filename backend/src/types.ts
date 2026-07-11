/** Cloudflare Worker Bindings */
export type Bindings = {
	DB: D1Database;
	SYNC_QUEUE: Queue;
	JWT_SECRET: string;
	GOOGLE_CLIENT_ID: string;
	GOOGLE_CLIENT_SECRET: string;
	GOOGLE_REDIRECT_URI: string;

	APP_URL: string,
};

/** Hono context Variables */
export type Variables = {
	userId: string;
	jwtPayload: {
		sub?: string;
		exp?: number;
	};
};

export type JwtPayload = {
	sub: string;
}
