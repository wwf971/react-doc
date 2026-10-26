import assert from 'node:assert/strict';
import test from 'node:test';
import { imageDataParse } from './ImageData.js';

test('parses every Image property from YAML block data', () => {
	const result = imageDataParse({
		raw: [
			'src: /doc-aux/image/example.png',
			'alt: Example screen',
			'caption: "Figure: Example screen"',
			'displayMode: contain-auto',
			'width: 520',
			'height: 300',
		].join('\n'),
		lang: 'yaml',
	});

	assert.deepEqual(result, {
		src: '/doc-aux/image/example.png',
		alt: 'Example screen',
		caption: 'Figure: Example screen',
		displayMode: 'contain-auto',
		width: 520,
		height: 300,
	});
});

test('preserves direct component data', () => {
	const data = { src: '/image.png', alt: 'Direct image', width: 400 };
	assert.equal(imageDataParse(data), data);
});

test('rejects YAML that is not a mapping', () => {
	assert.throws(
		() => imageDataParse({ raw: '- /image.png', lang: 'yaml' }),
		/Image YAML must contain a mapping/,
	);
});
