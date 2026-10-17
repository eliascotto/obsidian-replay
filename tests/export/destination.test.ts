import assert from 'node:assert/strict';
import { test } from 'node:test';
import { suggestedDestination, validateDestination, destinationParent } from '../../src/export/destination';

const paths = { configDir: '.settings', pluginDir: 'custom/plugin-replay' };
void test('filename suggestions preserve Unicode and sanitize invalid/reserved basenames visibly', () => {
	assert.equal(suggestedDestination('文章/My note.md'), '文章/My note.replay.json');
	assert.equal(suggestedDestination('CON.md'), '_CON.replay.json');
	assert.equal(suggestedDestination('invalid:note?.MD'), 'invalid-note-.replay.json');
	assert.equal(suggestedDestination('...md'), 'Recording.replay.json');
	assert.equal(destinationParent('a.replay.json'), '');
	assert.equal(destinationParent('nested/a.replay.json'), 'nested');
});

void test('destination paths reject traversal, absolute paths, reserved names and protected directories', () => {
	for (const path of [
		'', '/a.replay.json', '//server/a.replay.json', 'C:/a.replay.json', 'file://a.replay.json',
		'../a.replay.json', 'a/../b.replay.json', './a.replay.json', 'a//b.replay.json', 'a\\b.replay.json',
		'bad\u0000.replay.json', 'bad\n.replay.json', 'a?b.replay.json', 'CON.replay.json', 'lpt1/test.replay.json',
		'bad./file.replay.json', 'bad /file.replay.json', 'file.json', '.settings/a.replay.json', '.SETTINGS/a.replay.json',
		'custom/plugin-replay/a.replay.json', '.trash/a.replay.json', 'source.replay.json',
	]) assert.notEqual(validateDestination(path, 'source.replay.json', paths), '', path);
	for (const path of ['Article.replay.json', 'nested/文章 😀.replay.json', '.settings-other/a.replay.json', 'safe/a.replay.json']) {
		assert.equal(validateDestination(path, 'note.md', paths), '', path);
	}
});
