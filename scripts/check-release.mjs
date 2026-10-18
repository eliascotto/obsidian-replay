import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
export async function checkRelease(root, tag) {
	const read = async (name) => JSON.parse(await readFile(path.join(root, name), 'utf8'));
	const [pkg, lock, manifest, versions] = await Promise.all(['package.json', 'package-lock.json', 'manifest.json', 'versions.json'].map(read));
	const require = (condition, message) => { if (!condition) throw new Error(message); };
	require(manifest.id === 'replay' && manifest.name === 'Replay', 'Plugin identity must remain replay / Replay.');
	require(pkg.name === 'obsidian-replay' && lock.name === pkg.name && lock.packages?.['']?.name === pkg.name, 'Package names must agree on obsidian-replay.');
	require(semver.test(manifest.version) && semver.test(manifest.minAppVersion), 'Manifest versions must use x.y.z.');
	require([pkg.version, lock.version, lock.packages?.['']?.version].every((version) => version === manifest.version), 'Package, lockfile, and manifest versions must agree.');
	require(versions[manifest.version] === manifest.minAppVersion, 'Version map must match the manifest minimum.');
	require(['description', 'author'].every((key) => typeof manifest[key] === 'string' && manifest[key].trim()), 'Manifest description and author are required.');
	require(manifest.description.length <= 250, 'Manifest description must be at most 250 characters.');
	require(typeof pkg.license === 'string' && pkg.license.trim() && pkg.license === lock.packages?.['']?.license, 'Package and lockfile must declare the same license.');
	require(typeof manifest.isDesktopOnly === 'boolean', 'Manifest must declare platform support.');
	if (tag !== undefined) require(tag === manifest.version && semver.test(tag), 'Release tag must exactly match the manifest version, without v.');
	for (const document of ['README.md', 'LICENSE']) {
		require((await readFile(path.join(root, document), 'utf8')).trim(), `Missing or empty submission document: ${document}`);
	}
	const assets = ['main.js', 'manifest.json', 'styles.css'];
	for (const asset of assets) {
		const info = await stat(path.join(root, asset));
		require(info.isFile() && info.size > 0, `Missing or empty release asset: ${asset}`);
	}
	const bundle = await readFile(path.join(root, 'main.js'), 'utf8');
	require(!bundle.includes('//# sourceMappingURL='), 'Release bundle must not contain a development source map.');
	return { version: manifest.version, minAppVersion: manifest.minAppVersion, assets };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
	const args = process.argv.slice(2);
	if (args.length && (args.length !== 2 || args[0] !== '--tag')) throw new Error('Usage: npm run check:release -- [--tag x.y.z]');
	const result = await checkRelease(process.cwd(), args[1]);
	process.stdout.write(`Release checks passed for ${result.version} (Obsidian ${result.minAppVersion}+): ${result.assets.join(', ')}\n`);
}
