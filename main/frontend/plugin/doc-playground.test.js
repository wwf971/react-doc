import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { playgroundApply, playgroundConfigOfDocPageListGet } from './doc-playground.ts';

function dirCreate(fileByPath) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-playground-'));
	for (const [file, text] of Object.entries(fileByPath)) {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), text);
	}
	return dir;
}

const inputOf = (dir, extra = {}) => ({
	alias: 'page',
	entryFile: path.join(dir, '.doc-page', 'entry.yaml'),
	playground: undefined,
	rootList: [{ alias: 'page', path: dir, pathRule: dir, kind: 'folder' }],
	...extra,
});

const itemYaml = 'playgroundList:\n  - { id: try, title: Try it, doc: ~page/doc/try.playground.md, template: ./playground/try.md }\n';

test('a playground is read from the file beside the entry; its document may not exist', () => {
	const dir = dirCreate({ '.doc-page/playground.yaml': itemYaml, '.doc-page/playground/try.md': '# Try' });
	const config = playgroundConfigOfDocPageListGet([inputOf(dir)], dir);
	assert.deepEqual(config.problemList, []);
	assert.deepEqual(config.list, [{ id: 'page/try', docPageAlias: 'page', title: 'Try it', description: '', doc: '~page:page/doc/try.playground.md', docLocal: '~page/doc/try.playground.md', isPresent: false }]);
	assert.ok(config.pathList.some((file) => file.endsWith('playground.yaml')), 'the file is watched, whether it exists or not');
	assert.equal(config.itemByIdGet().get('page/try').docAbs, path.join(dir, 'doc', 'try.playground.md'));
});

test('a doc page may have none, by the entry or by having no file', () => {
	const dir = dirCreate({ '.doc-page/playground.yaml': itemYaml, '.doc-page/playground/try.md': '# Try' });
	assert.deepEqual(playgroundConfigOfDocPageListGet([inputOf(dir, { playground: false })], dir).list, []);
	const empty = dirCreate({});
	const config = playgroundConfigOfDocPageListGet([inputOf(empty)], empty);
	assert.deepEqual(config.list, []);
	assert.deepEqual(config.problemList, []);
});

test('what is wrong is reported with its place, and skips the item', () => {
	const cases = [
		['- { id: a, doc: ~page/doc/a.md, template: ./t.md }', /ends with \.playground\.md/],
		['- { id: a, doc: ~other/a.playground.md, template: ./t.md }', /no folder root "other"/],
		['- { id: a, doc: ~page/a.playground.md, template: ./missing.md }', /template is not found/],
		['- { id: "a b", doc: ~page/a.playground.md, template: ./t.md }', /id must be a word/],
		['- { id: a, doc: page/a.playground.md, template: ./t.md }', /source path/],
		['- { id: a, doc: ~page/../a.playground.md, template: ./t.md }', /leaves its root/],
	];
	for (const [line, message] of cases) {
		const dir = dirCreate({ '.doc-page/playground.yaml': `playgroundList:\n  ${line}\n`, '.doc-page/t.md': 'x' });
		const config = playgroundConfigOfDocPageListGet([inputOf(dir)], dir);
		assert.deepEqual(config.list, [], line);
		assert.match(config.problemList[0].message, message);
	}
});

test('reset writes the template and keeps what was there; delete leaves only that backup', () => {
	const dir = dirCreate({ '.doc-page/playground.yaml': itemYaml, '.doc-page/playground/try.md': '# Template' });
	const item = playgroundConfigOfDocPageListGet([inputOf(dir)], dir).itemByIdGet().get('page/try');
	const backupList = () => fs.readdirSync(path.dirname(item.docAbs)).filter((name) => name.endsWith('.deleted'));
	assert.equal(playgroundApply(item, 'reset').code, 0);
	assert.equal(fs.readFileSync(item.docAbs, 'utf-8'), '# Template');
	assert.deepEqual(backupList(), [], 'nothing was there to keep');
	fs.writeFileSync(item.docAbs, '# Mine');
	assert.equal(playgroundApply(item, 'reset').code, 0);
	assert.equal(fs.readFileSync(item.docAbs, 'utf-8'), '# Template');
	assert.equal(fs.readFileSync(path.join(path.dirname(item.docAbs), backupList()[0]), 'utf-8'), '# Mine');
	assert.equal(playgroundApply(item, 'delete').code, 0);
	assert.equal(fs.existsSync(item.docAbs), false);
	assert.equal(backupList().length, 2);
	assert.equal(playgroundApply(item, 'delete').code, 0, 'nothing there is not a failure');
	assert.equal(playgroundApply(item, 'nothing').code, -1);
});

test('the rule of the repository ignores the document of a playground and keeps its template', () => {
	const dirRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
	const isIgnored = (file) => {
		try {
			execFileSync('git', ['check-ignore', '-q', file], { cwd: dirRoot });
			return true;
		} catch {
			return false;
		}
	};
	assert.equal(isIgnored('package/cloud-dev-vis/doc/card-diagram.playground.md'), true);
	assert.equal(isIgnored('example_doc/anything.playground.mdx'), true);
	assert.equal(isIgnored('package/cloud-dev-vis/.doc-page/playground/card-diagram.md'), false);
});
