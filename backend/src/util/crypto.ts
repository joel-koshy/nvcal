const ENCODER = new TextEncoder();
const ITERATIONS = 100_000;
const KEY_LEN = 32;

// Hex Array Buffer to Hex String
const buf2Hex = (buffer: ArrayBuffer) => {
	return [...new Uint8Array(buffer)].map(x => x.toString(16).padStart(2, '0')).join('');
}
// Hex String to Hex Array Buffer
const hex2Buf = (hex: string) => {
	return new Uint8Array(hex.match(/[\da-f]{2}/gi)!.map(h => parseInt(h, 16)));
}

// Password and Salt to a hashed Hex Array
async function deriveKey(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		ENCODER.encode(password),
		{ name: "PBKDF2" },
		false,
		["deriveBits"]
	)

	return await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			salt: salt,
			iterations: ITERATIONS,
			hash: "SHA-256",
		},
		keyMaterial,
		KEY_LEN * 8
	);
}

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const hashBuf = await deriveKey(password, salt);
	return `${buf2Hex(salt.buffer)}:${buf2Hex(hashBuf)}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
	const [salt, hashed] = storedHash.split(':');
	if (!salt || !hashed) return false;

	const saltBuf = hex2Buf(salt);
	const attemptBuf = await deriveKey(password, saltBuf);
	const attemptString = buf2Hex(attemptBuf);
	return attemptString === hashed;
}


