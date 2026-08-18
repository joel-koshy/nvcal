import { z } from "zod";

/** POST /auth/signup · POST /auth/login */
export const AuthSuccessSchema = z.object({
	success: z.literal(true),
	user_id: z.string(),
});
export type AuthSuccess = z.output<typeof AuthSuccessSchema>;

/** POST /auth/logout */
export const LogoutResponseSchema = z.object({
	success: z.literal(true),
});
export type LogoutResponse = z.output<typeof LogoutResponseSchema>;