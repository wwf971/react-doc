#!/usr/bin/env node
// Fetch the official AWS icons the AWS series draws with (doc/aws.md#the-official-icons) into
// comp-mdx/aws/icon-official/, a folder git ignores: one file a kind, named by its type, and
// source.yaml, which package they came from and when. What is fetched is the list of
// comp-mdx/aws/AwsIcon.js; a kind whose icon is not there keeps its own.
//
// AWS lets its icons be used to draw architecture diagrams ("We allow customers and partners to
// use these toolkits and assets to create architecture diagrams", on the page of the icons), and
// does not say they may be passed on: they are fetched on each machine that draws with them, and
// never committed.
//
//   node script-icon/aws-icon-fetch.mjs              the current package, found on the page of the icons
//   node script-icon/aws-icon-fetch.mjs --url URL    a package of a given address
//   node script-icon/aws-icon-fetch.mjs --zip FILE   a package already downloaded
//   node script-icon/aws-icon-fetch.mjs --list       what the folder holds
//
// The package is read with `unzip` where there is one, else with `tar` (bsdtar, which reads a zip:
// macOS, Windows 10 and later).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AWS_ICON_FOLDER, AWS_ICON_LIST } from '../comp-mdx/aws/AwsIcon.js';

const PAGE_URL = 'https://aws.amazon.com/architecture/icons/';
const PACKAGE_PATTERN = /https:\/\/[a-z0-9.-]+\.awsstatic\.com\/[^"'\s<>]*Icon-package_[^"'\s<>]*\.zip/;
const DIR_OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'comp-mdx', 'aws', AWS_ICON_FOLDER);
const HEADERS = { 'user-agent': 'react-doc-icon-fetch' };

function argsParse(argv) {
	const args = {};
	for (let index = 0; index < argv.length; index += 1) {
		const item = argv[index];
		if (item === '--list') args.isList = true;
		else if (item === '--url' || item === '--zip') args[item.slice(2)] = argv[(index += 1)];
		else throw new Error(`unknown argument ${item}`);
	}
	return args;
}

// a time with its zone, as the documents write one: 2026-11-15 16:40:00 +09
function timeTextOf(date) {
	const pad = (value) => String(value).padStart(2, '0');
	const offset = -date.getTimezoneOffset();
	const zone = `${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}${Math.abs(offset) % 60 ? pad(Math.abs(offset) % 60) : ''}`;
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${zone}`;
}

// the release of a package, from its name: Icon-package_07312026... is 2026-07-31
function releaseOf(name) {
	const match = /Icon-package_(\d{2})(\d{2})(\d{4})/.exec(name);
	return match ? `${match[3]}-${match[1]}-${match[2]}` : '';
}

async function packageUrlFind() {
	const response = await fetch(PAGE_URL, { headers: HEADERS });
	if (!response.ok) throw new Error(`${PAGE_URL}: ${response.status}`);
	const match = PACKAGE_PATTERN.exec(await response.text());
	if (!match) throw new Error(`${PAGE_URL}: no link to an icon package found; download it by hand and pass --zip FILE`);
	return match[0];
}

async function packageDownload(url, dir) {
	const response = await fetch(url, { headers: HEADERS });
	if (!response.ok) throw new Error(`${url}: ${response.status}`);
	const path = join(dir, basename(new URL(url).pathname));
	writeFileSync(path, Buffer.from(await response.arrayBuffer()));
	return path;
}

const hasCommand = (command) => {
	try {
		execFileSync(command, command === 'unzip' ? ['-v'] : ['--version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
};

// the reader of the package: its member list, and one member as bytes
function zipReaderOf(path) {
	const big = { maxBuffer: 64 * 1024 * 1024 };
	if (hasCommand('unzip')) return {
		list: () => execFileSync('unzip', ['-Z1', path], { ...big, encoding: 'utf8' }).split('\n'),
		read: (member) => execFileSync('unzip', ['-p', path, member], big),
	};
	if (hasCommand('tar')) return {
		list: () => execFileSync('tar', ['-tf', path], { ...big, encoding: 'utf8' }).split('\n'),
		read: (member) => execFileSync('tar', ['-xOf', path, member], big),
	};
	throw new Error('neither unzip nor tar is found to read the package');
}

function listPrint() {
	const fileList = existsSync(DIR_OUT) ? readdirSync(DIR_OUT) : [];
	for (const item of AWS_ICON_LIST) console.log(`${fileList.includes(`${item.type}.svg`) ? 'fetched ' : 'missing '} ${item.type.padEnd(24)} ${item.file}`);
	if (fileList.includes('source.yaml')) console.log(`\n${readFileSync(join(DIR_OUT, 'source.yaml'), 'utf8')}`);
}

async function main() {
	const args = argsParse(process.argv.slice(2));
	if (args.isList) return listPrint();
	const dirTemp = mkdtempSync(join(tmpdir(), 'aws-icon-'));
	try {
		const url = args.zip ? '' : (args.url ?? (await packageUrlFind()));
		const path = args.zip ?? (console.log(`downloading ${url}`), await packageDownload(url, dirTemp));
		const reader = zipReaderOf(path);
		const memberList = reader.list().filter((member) => member && !member.startsWith('__MACOSX/'));
		mkdirSync(DIR_OUT, { recursive: true });
		const missingList = [];
		for (const item of AWS_ICON_LIST) {
			const member = memberList.find((entry) => basename(entry) === item.file);
			if (!member) { missingList.push(item); continue; }
			const content = reader.read(member);
			if (!/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/.test(content.subarray(0, 2048).toString('utf8'))) throw new Error(`${member}: not an svg`);
			writeFileSync(join(DIR_OUT, `${item.type}.svg`), content);
			console.log(`${item.type.padEnd(24)} ${member}`);
		}
		const name = basename(url ? new URL(url).pathname : path);
		writeFileSync(join(DIR_OUT, 'source.yaml'), [
			'# the official AWS icons, fetched by script-icon/aws-icon-fetch.mjs; not to be committed',
			`package: ${name}`,
			...(url ? [`url: ${url}`] : []),
			...(releaseOf(name) ? [`release: ${releaseOf(name)}`] : []),
			`fetched: ${timeTextOf(new Date())}`,
			`terms: ${PAGE_URL}`,
			'',
		].join('\n'));
		for (const item of missingList) console.warn(`not in the package: ${item.file} (${item.type} keeps its own icon)`);
		console.log(`${AWS_ICON_LIST.length - missingList.length} of ${AWS_ICON_LIST.length} icons in ${DIR_OUT}`);
		if (missingList.length > 0) process.exitCode = 1;
	} finally {
		rmSync(dirTemp, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(String(error?.message ?? error));
	process.exit(1);
});
