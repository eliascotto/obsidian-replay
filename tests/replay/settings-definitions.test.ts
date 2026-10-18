import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Setting } from 'obsidian';
import { DEFAULT_DOOMED_COLOR, ReplayPreferences } from '../../src/settings';
import { replaySettingDefinitions } from '../../src/ui/settings-definitions';

function control() {
	return {
		value: '', placeholder: '', attributes: new Map<string, string>(),
		change: (_value: string) => {},
		get inputEl() { return { setAttribute: (key: string, value: string) => this.attributes.set(key, value) }; },
		setValue(value: string) { this.value = value; return this; },
		setPlaceholder(value: string) { this.placeholder = value; return this; },
		onChange(callback: (value: string) => void) { this.change = callback; return this; },
	};
}

function row() {
	const picker = control();
	const hex = control();
	const reset = {
		click: () => {},
		setIcon(_icon: string) { return this; },
		setTooltip(_tooltip: string) { return this; },
		onClick(callback: () => void) { this.click = callback; return this; },
	};
	const setting = {
		addColorPicker(callback: (component: typeof picker) => void) { callback(picker); return this; },
		addText(callback: (component: typeof hex) => void) { callback(hex); return this; },
		addExtraButton(callback: (button: typeof reset) => void) { callback(reset); return this; },
	};
	return { picker, hex, reset, setting: setting as unknown as Setting };
}

void test('search indexing exposes setting names and descriptions without rendering or saving', async () => {
	const writes: unknown[] = [];
	const preferences = new ReplayPreferences({}, async (data) => { writes.push(data); }, () => assert.fail('Save failed'));
	const definitions = replaySettingDefinitions(preferences);
	assert.deepEqual(definitions.map(({ name }) => name), ['Recording keyboard shortcut', 'Doomed highlight color']);
	assert.ok(definitions.every(({ desc }) => desc.length > 0));
	assert.match(definitions[0]!.desc, /No shortcut is assigned by default/);
	await preferences.flush();
	assert.equal(writes.length, 0);
});

void test('shared settings controls validate, synchronize, save, and reset the highlight color', async () => {
	const writes: Record<string, unknown>[] = [];
	const preferences = new ReplayPreferences({ doomedHighlightColor: '#123456', playbackRate: 2 },
		async (data) => { writes.push(data); }, () => assert.fail('Save failed'));
	let notifications = 0;
	preferences.subscribe(() => { notifications++; });
	const { setting, picker, hex, reset } = row();
	replaySettingDefinitions(preferences)[1]!.render!(setting);
	assert.equal(picker.value, '#123456');
	assert.equal(hex.value, '#123456');
	assert.equal(hex.attributes.get('aria-label'), 'Doomed highlight color');
	hex.change('invalid');
	assert.equal(hex.attributes.get('aria-invalid'), 'true');
	assert.equal(preferences.doomedHighlightColor, '#123456');
	await preferences.flush();
	assert.equal(writes.length, 0);
	hex.change(' #ABCDEF ');
	assert.equal(hex.attributes.get('aria-invalid'), 'false');
	assert.equal(picker.value, '#abcdef');
	assert.equal(hex.value, '#abcdef');
	picker.change('#654321');
	assert.equal(hex.value, '#654321');
	reset.click();
	assert.equal(picker.value, DEFAULT_DOOMED_COLOR);
	assert.equal(hex.value, DEFAULT_DOOMED_COLOR);
	assert.equal(preferences.doomedHighlightColor, DEFAULT_DOOMED_COLOR);
	await preferences.flush();
	assert.deepEqual(writes.map((data) => data.doomedHighlightColor), ['#abcdef', '#654321', DEFAULT_DOOMED_COLOR]);
	assert.ok(writes.every((data) => data.playbackRate === 2));
	assert.equal(notifications, 3);
});
