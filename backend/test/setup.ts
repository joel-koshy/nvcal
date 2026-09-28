//@ts-nocheck: idek anymore
import { env } from "cloudflare:test";
import resetSql from "../db/reset.sql?raw";
import usersAndOauth from "../db/migrations/0001_users_and_oauth.sql?raw";
import calendars from "../db/migrations/0002_calendars.sql?raw";
import tasks from "../db/migrations/0003_tasks.sql?raw";
import events from "../db/migrations/0004_events.sql?raw";

export async function applySchema() {
	const migrationSql = [usersAndOauth, calendars, tasks, events].join('\n');
	const sql = `${resetSql}\n${migrationSql}`;

	// Strip all SQL comments (-- style) before splitting statements for D1.
	const noComments = sql.replace(/--.*/g, '');

	// 2. Split the giant string into individual statements by the semicolon
	const statements = noComments
		.split(';')
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

	// 3. Prepare each individual statement
	const prepared = statements.map((sql) => env.DB.prepare(sql));

	// 4. Execute them all in one atomic transaction
	await env.DB.batch(prepared);

	// 5. Seed a default user and calendar so tests can reference calendar_id 1
	await env.DB.prepare(
		`INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)`
	).bind('usr_test_123', 'test@example.com', new Date().toISOString()).run();

	await env.DB.prepare(
		`INSERT INTO calendars (id, user_id, name, timezone, is_external) VALUES (?, ?, ?, ?, 0)`
	).bind('1', 'usr_test_123', 'Test Calendar', 'UTC').run();
}
