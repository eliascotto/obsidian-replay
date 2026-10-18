import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Command, Plugin } from 'obsidian';
import { registerRecordingCommands } from '../../src/commands/recording-commands';
import type { RecordingControls } from '../../src/ui/recording-controls';

function commands(start: boolean, stop: boolean) {
	const registered = new Map<string, Command>();
	const calls: string[] = [];
	const controls = {
		canStart: () => start, canStop: () => stop,
		start: () => { calls.push('start'); }, stop: () => { calls.push('stop'); },
		toggle: () => { calls.push('toggle'); },
	};
	const plugin = { addCommand: (command: Command) => { registered.set(command.id, command); } };
	registerRecordingCommands(plugin as unknown as Plugin, controls as unknown as RecordingControls);
	return { registered, calls };
}

void test('one editable default belongs to the toggle; legacy command IDs keep their original actions', () => {
	const { registered, calls } = commands(true, true);
	assert.deepEqual(registered.get('toggle-recording')?.hotkeys, [{ modifiers: ['Mod', 'Shift'], key: 'R' }]);
	assert.equal(registered.get('start-recording')?.hotkeys, undefined);
	assert.equal(registered.get('stop-recording')?.hotkeys, undefined);
	registered.get('start-recording')!.checkCallback!(false);
	registered.get('stop-recording')!.checkCallback!(false);
	assert.deepEqual(calls, ['start', 'stop']);
});

void test('checking command availability never starts, stops, or toggles recording', () => {
	for (const [start, stop] of [[true, false], [false, true], [false, false]]) {
		const { registered, calls } = commands(start!, stop!);
		assert.equal(registered.get('toggle-recording')!.checkCallback!(true), start || stop);
		assert.equal(registered.get('start-recording')!.checkCallback!(true), start);
		assert.equal(registered.get('stop-recording')!.checkCallback!(true), stop);
		assert.deepEqual(calls, []);
	}
});

void test('the same toggle command handles start and stop contexts and ignores unavailable contexts', () => {
	for (const [start, stop] of [[true, false], [false, true], [false, false]]) {
		const { registered, calls } = commands(start!, stop!);
		assert.equal(registered.get('toggle-recording')!.checkCallback!(false), start || stop);
		assert.deepEqual(calls, start || stop ? ['toggle'] : []);
	}
});
