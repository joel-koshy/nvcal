import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUTPUT_DIR = join(import.meta.dirname, '../src/generated');
const templates = [
	{
		input: join(import.meta.dirname, '../../web/dist/index.html'),
		output: join(OUTPUT_DIR, 'template.ts'),
		exportName: 'template',
	},
	{
		input: join(import.meta.dirname, '../../web/dist-cached/index.html'),
		output: join(OUTPUT_DIR, 'cached-template.ts'),
		exportName: 'cachedTemplate',
	},
];

try {
	mkdirSync(OUTPUT_DIR, { recursive: true });

	for (const { input, output, exportName } of templates) {
		const htmlContent = readFileSync(input, 'utf8');
		const escapedHtml = htmlContent.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\${/g, '\\${');
		writeFileSync(output, `export const ${exportName} = \`${escapedHtml}\`;\n`);
	}

	console.log('✅ Frontend production and cached-comparison templates compiled into backend.');
} catch (error) {
	console.error('❌ Failed to compile frontend templates. Did you run the frontend build first?', error.message);
	process.exit(1);
}
