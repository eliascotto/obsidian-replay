import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RecordingStore } from '../../src/storage/recording-store';
import { parseRecording, serializeRecording } from '../../src/recording/format';
import { getStateAt } from '../../src/recording/engine';
import { MemoryAdapter, deferred } from '../support/storage';
import { spliceStep } from '../recording/helpers';

const root = '.custom/plugins/replay/recordings';
const log = root + '/one/steps.ndjson';

void test('create, append, reload, and portable round trip use only stored data', async () => {
	const adapter = new MemoryAdapter();
	const store = new RecordingStore(adapter, root);
	const first = await store.open('article.md', 'abc', 'one');
	assert.equal(first.recording.initialText, 'abc');
	await store.append(first.id, [spliceStep('abc', 1, 2, 'B')]);
	const reloaded = await new RecordingStore(adapter, root).load('article.md');
	assert.ok(reloaded);
	assert.equal(reloaded.finalText, 'aBc');
	assert.equal(getStateAt(parseRecording(serializeRecording(reloaded.recording)), 1), 'aBc');
	assert.equal((await store.open('article.md', 'ignored', 'two')).id, 'one');
});

void test('new recording with no edits is durable and IDs cannot escape the root', async () => {
	const adapter = new MemoryAdapter();
	const store = new RecordingStore(adapter, root);
	await store.open('article.md', 'Existing\r\narticle', 'one');
	assert.equal((await new RecordingStore(adapter, root).load('article.md'))?.finalText, 'Existing\r\narticle');
	await assert.rejects(store.open('other.md', '', '../outside'));
	await assert.rejects(store.open('other.md', '', 'one'));
});

for (const mode of ['none', 'partial-record', 'complete-prefix', 'all', 'metadata']) {
	void test(`retry after ${mode} failure never duplicates complete records`, async () => {
		const adapter = new MemoryAdapter();
		const store = new RecordingStore(adapter, root);
		await store.open('a.md', 'abc', 'one');
		const batch = [spliceStep('abc', 1, 2, 'B'), spliceStep('aBc', 3, 3, '!', 2)];
		let failed = false;
		adapter.before = async (operation, path, text) => {
			if (failed) return;
			if (mode === 'metadata' && path.endsWith('metadata.json')) {
				failed = true; throw new Error('Metadata failed');
			}
			if (operation !== 'append' || mode === 'metadata') return;
			failed = true;
			if (mode === 'partial-record') adapter.files.set(path, text.slice(0, 20));
			if (mode === 'complete-prefix') adapter.files.set(path, text.slice(0, text.indexOf('\n') + 1) + '{"sequence":');
			if (mode === 'all') adapter.files.set(path, text);
			throw new Error('Uncertain write');
		};
		await assert.rejects(store.append('one', batch));
		adapter.before = undefined;
		await store.append('one', batch);
		const reloaded = await new RecordingStore(adapter, root).load('a.md');
		assert.equal(reloaded?.recording.steps.length, 2);
		assert.equal(reloaded?.finalText, 'aBc!');
		assert.equal(adapter.files.get(log)?.split('\n').length, 3);
	});
}

void test('successful append followed by rejected acknowledgement is reconciled', async () => {
	const adapter = new MemoryAdapter();
	const store = new RecordingStore(adapter, root);
	await store.open('a.md', 'abc', 'one');
	adapter.after = async (operation) => { if (operation === 'append') throw new Error('Late failure'); };
	const batch = [spliceStep('abc', 1, 2, 'B')];
	await assert.rejects(store.append('one', batch));
	adapter.after = undefined;
	await store.append('one', batch);
	assert.equal((await new RecordingStore(adapter, root).load('a.md'))?.recording.steps.length, 1);
});

void test('incomplete tail is readable but repaired before continuation', async () => {
	const adapter = new MemoryAdapter();
	await new RecordingStore(adapter, root).open('a.md', 'abc', 'one');
	adapter.files.set(log, '{"sequence":');
	const store = new RecordingStore(adapter, root);
	assert.equal((await store.load('a.md'))?.finalText, 'abc');
	await store.append('one', [spliceStep('abc', 1, 2, 'B')]);
	assert.equal((await new RecordingStore(adapter, root).load('a.md'))?.finalText, 'aBc');
});

for (const corruption of ['complete-record', 'missing-initial', 'missing-log', 'missing-metadata', 'index', 'version']) {
	void test(`reject ${corruption} without replacing a valid recording`, async () => {
		const adapter = new MemoryAdapter();
		await new RecordingStore(adapter, root).open('a.md', 'abc', 'one');
		if (corruption === 'complete-record') adapter.files.set(log, '{bad}\n');
		if (corruption === 'missing-initial') adapter.files.delete(root + '/one/initial.json');
		if (corruption === 'missing-log') adapter.files.delete(log);
		if (corruption === 'missing-metadata') adapter.files.delete(root + '/one/metadata.json');
		if (corruption === 'index') adapter.files.set(root + '/index.json', '{bad');
		if (corruption === 'version') adapter.files.set(root + '/index.json', '{"storageVersion":2,"notes":{}}');
		const before = new Map(adapter.files);
		await assert.rejects(new RecordingStore(adapter, root).open('a.md', 'replacement', 'two'));
		assert.deepEqual(adapter.files, before);
	});
}

void test('conflicting queued records are rejected rather than overwritten', async () => {
	const adapter = new MemoryAdapter();
	const store = new RecordingStore(adapter, root);
	await store.open('a.md', 'abc', 'one');
	await store.append('one', [spliceStep('abc', 1, 2, 'B')]);
	await assert.rejects(store.append('one', [spliceStep('abc', 1, 2, 'X')]));
	assert.equal((await new RecordingStore(adapter, root).load('a.md'))?.finalText, 'aBc');
});

void test('index and initialization failures can retry the same identity', async () => {
	for (const suffix of ['initial.json', 'steps.ndjson', 'metadata.json', 'index.json']) {
		const adapter = new MemoryAdapter();
		const store = new RecordingStore(adapter, root);
		adapter.after = async (_operation, path) => { if (path.endsWith(suffix)) throw new Error('Late creation failure'); };
		await assert.rejects(store.open('a.md', 'original', 'one'));
		adapter.after = undefined;
		assert.equal((await store.open('a.md', 'original', 'one')).id, 'one');
		assert.equal((await new RecordingStore(adapter, root).load('a.md'))?.finalText, 'original');
	}
});

void test('concurrent creates and folder moves retain independent path mappings', async () => {
	const adapter = new MemoryAdapter();
	const store = new RecordingStore(adapter, root);
	await Promise.all([store.open('folder/a.md', 'a', 'one'), store.open('folder/b.md', 'b', 'two'),
		store.open('folder-other/c.md', 'c', 'three')]);
	await store.rename('folder', 'moved');
	const restart = new RecordingStore(adapter, root);
	assert.equal((await restart.load('moved/a.md'))?.id, 'one');
	assert.equal((await restart.load('moved/b.md'))?.id, 'two');
	assert.equal((await restart.load('folder-other/c.md'))?.id, 'three');
	assert.equal(await restart.load('folder/a.md'), null);
	await assert.rejects(store.rename('moved/a.md', 'moved/b.md'));
});

void test('rename ordered behind an in-flight append cannot restore an old path', async () => {
	const adapter = new MemoryAdapter();
	const store = new RecordingStore(adapter, root);
	await store.open('old.md', 'abc', 'one');
	const gate = deferred();
	adapter.before = async (operation) => { if (operation === 'append') await gate.promise; };
	const append = store.append('one', [spliceStep('abc', 1, 2, 'B')]);
	const rename = store.rename('old.md', 'new.md');
	gate.resolve();
	await Promise.all([append, rename]);
	const restart = new RecordingStore(adapter, root);
	assert.equal(await restart.load('old.md'), null);
	assert.equal((await restart.load('new.md'))?.finalText, 'aBc');
	const metadata: unknown = JSON.parse(adapter.files.get(root + '/one/metadata.json') ?? '{}');
	assert.ok(typeof metadata === 'object' && metadata !== null && 'currentPath' in metadata);
	assert.equal(metadata.currentPath, 'new.md');
});

void test('metadata lag is derived from validated records and repaired by a subsequent write', async () => {
	const adapter = new MemoryAdapter();
	const store = new RecordingStore(adapter, root);
	await store.open('a.md', 'abc', 'one');
	const oldMetadata = adapter.files.get(root + '/one/metadata.json');
	assert.ok(oldMetadata);
	await store.append('one', [spliceStep('abc', 1, 2, 'B')]);
	adapter.files.set(root + '/one/metadata.json', oldMetadata);
	const restarted = new RecordingStore(adapter, root);
	assert.equal((await restarted.load('a.md'))?.recording.steps.length, 1);
	await restarted.append('one', [spliceStep('aBc', 3, 3, '!', 2)]);
	const metadata: unknown = JSON.parse(adapter.files.get(root + '/one/metadata.json') ?? '{}');
	assert.ok(typeof metadata === 'object' && metadata !== null && 'lastSequence' in metadata);
	assert.equal(metadata.lastSequence, 2);
});

void test('unsupported metadata and malformed index identities fail explicitly', async () => {
	for (const metadata of [true, { storageVersion: 2 }, { storageVersion: 1, id: 'wrong', currentPath: 'a.md', lastSequence: 0 }]) {
		const adapter = new MemoryAdapter();
		await new RecordingStore(adapter, root).open('a.md', 'abc', 'one');
		adapter.files.set(root + '/one/metadata.json', JSON.stringify(metadata));
		await assert.rejects(new RecordingStore(adapter, root).load('a.md'));
	}
	for (const notes of [{ 'a.md': '../escape' }, { 'a.md': 'one', 'b.md': 'one' }, { 'a.md': 2 }]) {
		const adapter = new MemoryAdapter();
		adapter.files.set(root + '/index.json', JSON.stringify({ storageVersion: 1, notes }));
		await assert.rejects(new RecordingStore(adapter, root).load('a.md'));
	}
});
