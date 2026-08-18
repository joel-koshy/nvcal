import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const FRONTEND_DIST = join(import.meta.dirname, '../../web/dist/index.html');
const OUTPUT_DIR = join(import.meta.dirname, '../src/generated');
const OUTPUT_FILE = join(OUTPUT_DIR, 'template.ts');

try {
	// Read the production artifact built by Vite
	const htmlContent = readFileSync(FRONTEND_DIST, 'utf8');

	// Escape backticks and backslashes to make it a safe JS template literal
	const escapedHtml = htmlContent.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\${/g, '\\${');

	// Ensure the target directory exists
	mkdirSync(OUTPUT_DIR, { recursive: true });

	// Write out a clean JS module
	writeFileSync(OUTPUT_FILE, `export const template = \`${escapedHtml}\`;\n`);
	console.log('✅ Frontend production template compiled successfully into backend.');
} catch (error) {
	console.error('❌ Failed to compile frontend template. Did you run your frontend build first?', error.message);
	process.exit(1);
}
