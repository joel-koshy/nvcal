import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

console.log('Starting Cloudflare tunnel...');

// 1. Start cloudflared targeting Wrangler's IPv4 address
const tunnel = spawn('cloudflared', ['tunnel', '--url', 'http://127.0.0.1:8787']);

let publicUrl = null;

// 2. Listen to the tunnel's terminal output to catch the URL
tunnel.stderr.on('data', (data) => {
	const output = data.toString();

	// Cloudflare quick tunnels always end in .trycloudflare.com
	const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);

	// If we find the URL and haven't processed it yet, trigger the rest of the script
	if (match && !publicUrl) {
		publicUrl = match[0];
		console.log(`\n> Tunnel established: ${publicUrl}`);
		setupEnvAndStart(publicUrl);
	}
});

tunnel.on('error', (err) => {
	console.error('\n❌ Failed to start cloudflared. Make sure it is installed on your system.');
	process.exit(1);
});

function setupEnvAndStart(url) {
	// 3. Update .dev.vars
	const varsPath = '.dev.vars';
	let varsContent = '';
	try {
		varsContent = readFileSync(varsPath, 'utf8');
	} catch (e) {
		// File doesn't exist yet, we will create it
	}

	// Swap out the existing URL or append a new one
	if (varsContent.includes('APP_URL=')) {
		varsContent = varsContent.replace(/APP_URL=.*/g, `APP_URL=${url}`);
	} else {
		varsContent += `\nAPP_URL=${url}\n`;
	}

	writeFileSync(varsPath, varsContent.trim() + '\n');
	console.log('> Injected URL into .dev.vars');

	// 4. Start the Wrangler dev server (forcing IPv4)
	console.log('> Booting Wrangler...\n');
	const wrangler = spawn('npx', ['wrangler', 'dev', '--ip', '127.0.0.1'], { stdio: 'inherit' });

	// 5. Ensure processes die cleanly when you hit Ctrl+C
	process.on('SIGINT', () => {
		console.log("\nCleaning up resources")
		tunnel.kill();
		wrangler.kill();
		process.exit();
	});
}
