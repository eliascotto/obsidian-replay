import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const releaseVersion = (JSON.parse(readFileSync('manifest.json', 'utf8')) as { version: string }).version;

function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'replay-release-check-'));
	for (const file of ['package.json', 'package-lock.json', 'manifest.json', 'versions.json', 'README.md', 'LICENSE']) {
		writeFileSync(join(root, file), readFileSync(file));
	}
	writeFileSync(join(root, 'main.js'), '/* production bundle fixture */');
	writeFileSync(join(root, 'styles.css'), '.replay {}');
	const change = (file: string, update: (value: Record<string, unknown>) => void) => {
		const value = JSON.parse(readFileSync(join(root, file), 'utf8')) as Record<string, unknown>;
		update(value); writeFileSync(join(root, file), JSON.stringify(value));
	};
	const run = (...args: string[]) => spawnSync(process.execPath, [resolve('scripts/check-release.mjs'), ...args], { cwd: root, encoding: 'utf8' });
	return { root, change, run, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

void test('release checks accept aligned metadata and require an exact tag', () => {
	const f = fixture();
	try {
		assert.equal(f.run().status, 0);
		assert.equal(f.run('--tag', releaseVersion).status, 0);
		for (const tag of [`v${releaseVersion}`, `${releaseVersion}-beta`, `${releaseVersion}\n`, '']) assert.notEqual(f.run('--tag', tag).status, 0);
		const differentVersion = releaseVersion === '9.0.0' ? '8.0.0' : '9.0.0';
		assert.notEqual(f.run('--tag', differentVersion).status, 0);
		assert.notEqual(f.run('--unknown').status, 0);
	} finally { f.cleanup(); }
});

for (const [file, key, value] of [
	['package.json', 'version', '9.0.0'], ['package-lock.json', 'version', '9.0.0'],
	['package.json', 'name', 'obsidian-sample-plugin'], ['manifest.json', 'id', 'renamed-plugin'],
	['manifest.json', 'minAppVersion', '1.8.0'], ['versions.json', releaseVersion, '1.0.0'],
	['package.json', 'license', ''], ['package.json', 'license', 'different-license'],
	['manifest.json', 'description', 'x'.repeat(251)],
] as const) {
	void test(`release checks reject inconsistent ${file} ${key}`, () => {
		const f = fixture();
		try { f.change(file, (metadata) => { metadata[key] = value; }); assert.notEqual(f.run().status, 0); }
		finally { f.cleanup(); }
	});
}

void test('release checks reject absent assets and development source maps', () => {
	const f = fixture();
	try {
		writeFileSync(join(f.root, 'main.js'), '//# sourceMappingURL=data:example');
		assert.notEqual(f.run().status, 0);
		writeFileSync(join(f.root, 'main.js'), 'production');
		rmSync(join(f.root, 'styles.css'));
		assert.notEqual(f.run().status, 0);
	} finally { f.cleanup(); }
});

for (const file of ['README.md', 'LICENSE']) {
	void test(`release checks require a nonempty ${file}`, () => {
		const f = fixture();
		try {
			writeFileSync(join(f.root, file), '');
			assert.notEqual(f.run().status, 0);
		} finally { f.cleanup(); }
	});
}

void test('version helper updates an existing minimum-version map entry without Git operations', () => {
	const f = fixture();
	try {
		f.change('manifest.json', (value) => { value.minAppVersion = '1.8.0'; });
		const result = spawnSync(process.execPath, [resolve('version-bump.mjs')], {
			cwd: f.root, encoding: 'utf8', env: { ...process.env, npm_package_version: releaseVersion },
		});
		assert.equal(result.status, 0, result.stderr);
		assert.equal((JSON.parse(readFileSync(join(f.root, 'versions.json'), 'utf8')) as Record<string, string>)[releaseVersion], '1.8.0');
		const before = readFileSync(join(f.root, 'manifest.json'), 'utf8');
		const invalid = spawnSync(process.execPath, [resolve('version-bump.mjs')], {
			cwd: f.root, encoding: 'utf8', env: { ...process.env, npm_package_version: 'invalid' },
		});
		assert.notEqual(invalid.status, 0); assert.equal(readFileSync(join(f.root, 'manifest.json'), 'utf8'), before);
	} finally { f.cleanup(); }
});
