import { Bindings } from "../types";

interface OAuthRow {
	access_token: string;
	refresh_token: string | null;
	expires_at: number;
}

export async function getValidTokenGoogle(env: Bindings, userId: string ): Promise<string> {
	const googleAuth = await env.DB.prepare(`
		SELECT access_token, refresh_token, expires_at 
		FROM oauth_connections 
		WHERE user_id = ? AND provider = 'google'
	`).bind(userId).first<OAuthRow>(); 
	if(!googleAuth){
		throw new Error("User has no connected Google auth account")
	}

	const nowSeconds = Math.floor(Date.now()/1000); 
	const buffer = 60;  // 60 second for api transit
	if(googleAuth.expires_at > (nowSeconds + buffer)){
		return googleAuth.access_token; 	
	}
	
	if(!googleAuth.refresh_token){
		throw new Error("No refresh token available. User must re-authenticate with Google"); 
	}
	const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
				client_id: env.GOOGLE_CLIENT_ID,
				client_secret: env.GOOGLE_CLIENT_SECRET,
				refresh_token: googleAuth.refresh_token,
				grant_type: 'refresh_token',
		}),
  });
	if(!tokenRes.ok){
		throw new Error("Refresh token revoked or invalid"); 
	}

	const tokens = await tokenRes.json() as {access_token: string, expires_in: number}
	const newExpiresAt = tokens.expires_in + nowSeconds; 
	await env.DB.prepare(`
		UPDATE oauth_connections 
		SET access_token = ?, expires_at = ?
		WHERE user_id = ? AND provider = 'google'
	`).bind(tokens.access_token, newExpiresAt, userId).run()

	return tokens.access_token
}
