import assert from 'node:assert/strict';
import test from 'node:test';
import { jsonContentFormat, jsonModeNext, jsonModeNormalize } from './CodeBlockJsonData.js';

test('JSON mode defaults to pretty and cycles through the supported modes', () => {
	assert.equal(jsonModeNormalize(), 'pretty');
	assert.equal(jsonModeNormalize('PLAIN'), 'plain');
	assert.equal(jsonModeNormalize('future-mode'), 'pretty');
	assert.equal(jsonModeNext('pretty'), 'plain');
	assert.equal(jsonModeNext('plain'), 'pretty');
});

test('pretty mode formats JSON while plain mode preserves authored text', () => {
	const source = '{"enabled":true,"items":[1,2]}';
	assert.deepEqual(jsonContentFormat(source, 'pretty'), {
		content: '{\n  "enabled": true,\n  "items": [\n    1,\n    2\n  ]\n}',
		error: '',
	});
	assert.deepEqual(jsonContentFormat(source, 'plain'), { content: source, error: '' });
});

test('invalid JSON remains visible when pretty formatting fails', () => {
	const result = jsonContentFormat('{invalid}', 'pretty');
	assert.equal(result.content, '{invalid}');
	assert.match(result.error, /^JSONを整形できません:/);
});