import type { AuthSuccess, LogoutResponse } from "@nvcal/domain";

/** Auth API route → response type map. */
export interface AuthRoute {
	'/auth/signup POST': AuthSuccess;
	'/auth/login POST': AuthSuccess;
	'/auth/logout POST': LogoutResponse;
}