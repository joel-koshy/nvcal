import { z } from "zod";

/** Signup / login request body (shared validation). */
export const CredentialsSchema = z.object({
	email: z.email(),
	password: z.string().min(8, "Password must be at least 8 characters"),
});
export type Credentials = z.output<typeof CredentialsSchema>;