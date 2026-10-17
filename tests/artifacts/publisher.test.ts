import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArtifactPublisher } from '../../src/artifacts/publisher';
import { artifactPath } from '../../src/artifacts/paths';
import { parseRegistry } from '../../src/artifacts/registry';
import { parseRecording } from '../../src/recording/format';
import { getStateAt } from '../../src/recording/engine';
import { recording, spliceStep } from '../recording/helpers';
import { MemoryArtifacts } from '../support/artifacts';
import { deferred, FakeClock, MemoryAdapter } from '../support/storage';
import { RecordingStore } from '../../src/storage/recording-store';
import { RecordingController } from '../../src/recording/controller';
import { EditorState } from '@codemirror/state';
import { transactionObservation } from '../../src/capture/transaction';

const initial = { id: 'id-1', recording: recording('A'), finalText: 'A' };
const revised = { id: 'id-1', recording: recording('A', [spliceStep('A', 1, 1, 'B')]), finalText: 'AB' };

void test('sibling paths replace only the Markdown suffix and preserve folders/dots/Unicode', () => {
	for (const [source, expected] of [['A.md', 'A.replay'], ['one/你好.draft.MD', 'one/你好.draft.replay']]) {
		assert.equal(artifactPath(source!), expected);
	}
	for (const invalid of ['../A.md', '/A.md', 'a/../A.md', 'A.json']) assert.throws(() => artifactPath(invalid));
});

void test('Start creates an initial portable file; Resume keeps its snapshot; Stop publishes full history', async () => {
	const adapter = new MemoryArtifacts();
	const publisher = new ArtifactPublisher(adapter);
	await publisher.publish('A.md', initial, true);
	assert.equal(publisher.owner('A.replay'), 'A.md');
	await publisher.publish('A.md', revised, true);
	assert.equal(parseRecording(await adapter.read('A.replay')).steps.length, 0);
	await publisher.publish('A.md', revised);
	const exported = parseRecording(await adapter.read('A.replay'));
	assert.equal(getStateAt(exported, 1), 'AB');
	assert.deepEqual(Object.keys(exported), ['format', 'formatVersion', 'initialText', 'steps']);
	assert.equal(await publisher.needsRecovery('A.md'), false);
	assert.deepEqual(adapter.calls, ['create', 'replace']);
});

void test('even an identical unowned artifact is never overwritten or adopted', async () => {
	const adapter = new MemoryArtifacts();
	adapter.files.set('A.replay', JSON.stringify(initial.recording));
	const before = adapter.files.get('A.replay');
	const publisher = new ArtifactPublisher(adapter);
	await assert.rejects(publisher.publish('A.md', initial), /already exists/);
	assert.equal(adapter.files.get('A.replay'), before);
	assert.equal(publisher.owner('A.replay'), null);
});

void test('external changes and a concurrent modification at the write boundary are preserved', async () => {
	const adapter = new MemoryArtifacts();
	const publisher = new ArtifactPublisher(adapter);
	await publisher.publish('A.md', initial);
	adapter.files.set('A.replay', 'external');
	await assert.rejects(publisher.publish('A.md', revised), /changed outside/);
	assert.equal(adapter.files.get('A.replay'), 'external');
	adapter.files.set('A.replay', JSON.stringify(initial.recording, null, 2) + '\n');
	adapter.before = async (operation, path) => { if (operation === 'replace') adapter.files.set(path, 'raced'); };
	await assert.rejects(publisher.publish('A.md', revised), /Changed while saving/);
	assert.equal(adapter.files.get('A.replay'), 'raced');
});

for (const operation of ['create', 'read', 'registry']) {
	void test(`publication failure during ${operation} preserves history and is retryable`, async () => {
		const adapter = new MemoryArtifacts();
		const publisher = new ArtifactPublisher(adapter);
		adapter.before = async (current) => { if (current === operation) throw new Error('Injected failure'); };
		await assert.rejects(publisher.publish('A.md', initial));
		adapter.before = undefined;
		await publisher.publish('A.md', initial);
		assert.equal(parseRecording(await adapter.read('A.replay')).initialText, 'A');
	});
}

void test('restart recovers a file created before acknowledgement/registry completion', async () => {
	const adapter = new MemoryArtifacts();
	adapter.after = async (operation) => { if (operation === 'create') throw new Error('Lost acknowledgement'); };
	await assert.rejects(new ArtifactPublisher(adapter).publish('A.md', initial));
	adapter.after = undefined;
	const restarted = new ArtifactPublisher(adapter);
	assert.equal(await restarted.needsRecovery('A.md'), true);
	await restarted.publish('A.md', revised);
	assert.equal(parseRecording(await adapter.read('A.replay')).steps.length, 1);
	assert.equal(await restarted.needsRecovery('A.md'), false);
});

void test('a saved file plus failed final registry commit is recoverable after restart', async () => {
	const adapter = new MemoryArtifacts();
	let writes = 0;
	adapter.before = async (operation) => { if (operation === 'registry' && ++writes === 2) throw new Error('Commit failed'); };
	await assert.rejects(new ArtifactPublisher(adapter).publish('A.md', revised));
	adapter.before = undefined;
	await new ArtifactPublisher(adapter).publish('A.md', revised);
	assert.equal(parseRecording(await adapter.read('A.replay')).steps.length, 1);
	assert.deepEqual(adapter.calls, ['create']);
});

void test('queued stale publication cannot roll back a newer recording', async () => {
	const adapter = new MemoryArtifacts();
	const publisher = new ArtifactPublisher(adapter);
	const gate = deferred();
	adapter.before = async (operation) => { if (operation === 'create') await gate.promise; };
	const first = publisher.publish('A.md', revised);
	const stale = publisher.publish('A.md', initial);
	const rejected = assert.rejects(stale, /newer recording/);
	gate.resolve();
	await first;
	await rejected;
	assert.equal(parseRecording(await adapter.read('A.replay')).steps.length, 1);
});

void test('source rename moves the owned file and subsequent Stop updates the new sibling', async () => {
	const adapter = new MemoryArtifacts();
	const publisher = new ArtifactPublisher(adapter);
	await publisher.publish('A.md', initial);
	await publisher.rename('A.md', 'folder/B.md');
	assert.equal(adapter.files.has('A.replay'), false);
	assert.equal(publisher.owner('folder/B.replay'), 'folder/B.md');
	await publisher.publish('folder/B.md', revised);
	assert.equal(parseRecording(await adapter.read('folder/B.replay')).steps.length, 1);
});

void test('folder move already relocating both files is reconciled without a second move', async () => {
	const adapter = new MemoryArtifacts();
	const publisher = new ArtifactPublisher(adapter);
	await publisher.publish('old/A.md', initial);
	await adapter.rename('old/A.replay', 'new/A.replay');
	await publisher.rename('old', 'new');
	assert.equal(publisher.owner('new/A.replay'), 'new/A.md');
});

void test('rename collisions retain the old artifact and are resolved by retrying publication', async () => {
	const adapter = new MemoryArtifacts();
	const publisher = new ArtifactPublisher(adapter);
	await publisher.publish('A.md', initial);
	adapter.files.set('B.replay', 'foreign');
	await assert.rejects(publisher.rename('A.md', 'B.md'));
	assert.ok(adapter.files.has('A.replay'));
	assert.equal(adapter.files.get('B.replay'), 'foreign');
	adapter.files.delete('B.replay');
	await publisher.publish('B.md', revised);
	assert.equal(publisher.owner('B.replay'), 'B.md');
});

void test('independent artifact rename detaches its snapshot; the next Stop recreates the sibling', async () => {
	const adapter = new MemoryArtifacts();
	const publisher = new ArtifactPublisher(adapter);
	await publisher.publish('A.md', initial);
	await adapter.rename('A.replay', 'Snapshot.replay');
	await publisher.artifactRenamed('A.replay', 'Snapshot.replay');
	await publisher.publish('A.md', revised);
	assert.equal(publisher.owner('Snapshot.replay'), null);
	assert.equal(parseRecording(await adapter.read('Snapshot.replay')).steps.length, 0);
	assert.equal(parseRecording(await adapter.read('A.replay')).steps.length, 1);
});

void test('deleting the source preserves the standalone artifact; deleting the artifact does not trigger migration', async () => {
	const adapter = new MemoryArtifacts();
	const publisher = new ArtifactPublisher(adapter);
	await publisher.publish('A.md', initial);
	adapter.files.delete('A.replay');
	assert.equal(await publisher.needsRecovery('A.md'), false);
	await publisher.publish('A.md', revised);
	await publisher.sourceDeleted('A.md');
	assert.equal(publisher.owner('A.replay'), null);
	assert.ok(adapter.files.has('A.replay'));
});

void test('invalid registry data never grants ownership or silently resets a registry', () => {
	for (const text of ['{}', '{"version":2,"entries":{}}', '{"version":1,"entries":{"id":{"source":"../A.md","path":"A.replay","sequence":0,"fingerprint":""}}}']) {
		assert.throws(() => parseRegistry(text));
	}
});

void test('recording retains edits made during initial artifact creation and retries publication-only failures', async () => {
	const adapter = new MemoryArtifacts();
	const publisher = new ArtifactPublisher(adapter);
	const store = new RecordingStore(new MemoryAdapter(), 'recordings');
	const errors: unknown[] = [];
	const controller = new RecordingController(store, (_path, error) => errors.push(error), new FakeClock(), () => 'id-1', undefined, publisher);
	const gate = deferred();
	const creating = deferred();
	adapter.before = async (operation) => { if (operation === 'create') { creating.resolve(); await gate.promise; } };
	const starting = controller.start('A.md', 'A');
	await creating.promise;
	const observation = transactionObservation(EditorState.create({ doc: 'A' }).update({ changes: { from: 1, insert: 'B' } }));
	assert.ok(observation);
	controller.capture('A.md', observation);
	gate.resolve();
	await starting;
	adapter.before = async (operation) => { if (operation === 'replace') throw new Error('Publication failed'); };
	await assert.rejects(controller.stop('A.md'));
	assert.equal(controller.status('A.md'), 'error');
	assert.equal((await store.load('A.md'))?.recording.steps.length, 1);
	adapter.before = undefined;
	await controller.stop('A.md');
	assert.equal(controller.status('A.md'), 'stopped');
	assert.equal(parseRecording(await adapter.read('A.replay')).steps.length, 1);
	assert.equal(errors.length, 1);
});

void test('a lost rename acknowledgement is recovered from persisted relocation intent', async () => {
	const adapter = new MemoryArtifacts();
	const publisher = new ArtifactPublisher(adapter);
	await publisher.publish('A.md', initial);
	const rename = adapter.rename.bind(adapter);
	adapter.rename = async (from, to) => { await rename(from, to); throw new Error('Lost rename acknowledgement'); };
	await assert.rejects(publisher.rename('A.md', 'B.md'));
	adapter.rename = rename;
	await new ArtifactPublisher(adapter).publish('B.md', revised);
	assert.equal(parseRecording(await adapter.read('B.replay')).steps.length, 1);
});

void test('a missing companion cannot claim an identical unrelated rename destination', async () => {
	const adapter = new MemoryArtifacts();
	const publisher = new ArtifactPublisher(adapter);
	await publisher.publish('A.md', initial);
	await adapter.rename('A.replay', 'B.replay');
	await assert.rejects(publisher.rename('A.md', 'B.md'), /already exists/);
});

void test('case-insensitive destination collisions are preserved before creation', async () => {
	const adapter = new MemoryArtifacts();
	adapter.files.set('a.replay', 'foreign');
	adapter.exists = async (path) => [...adapter.files.keys()].some((key) => key.toLowerCase() === path.toLowerCase());
	await assert.rejects(new ArtifactPublisher(adapter).publish('A.md', initial), /already exists/);
	assert.equal(adapter.files.get('a.replay'), 'foreign');
	assert.equal(adapter.calls.length, 0);
});

void test('changing a source to a non-Markdown extension preserves the snapshot without corrupting ownership', async () => {
	const adapter = new MemoryArtifacts();
	const publisher = new ArtifactPublisher(adapter);
	await publisher.publish('A.md', initial);
	await publisher.rename('A.md', 'A.txt');
	assert.equal(publisher.owner('A.replay'), null);
	assert.ok(adapter.files.has('A.replay'));
	assert.deepEqual(Object.keys(parseRegistry(adapter.registry).entries), []);
});

void test('loading known ownership does not wait for an unrelated file publication', async () => {
	const adapter = new MemoryArtifacts();
	const publisher = new ArtifactPublisher(adapter);
	const entered = deferred(); const gate = deferred();
	adapter.before = async (operation) => { if (operation === 'create') { entered.resolve(); await gate.promise; } };
	const publishing = publisher.publish('A.md', initial);
	await entered.promise;
	let loaded = false;
	const loading = publisher.load().then(() => { loaded = true; });
	await Promise.resolve();
	try { assert.equal(loaded, true); }
	finally { gate.resolve(); await publishing; await loading; }
});
