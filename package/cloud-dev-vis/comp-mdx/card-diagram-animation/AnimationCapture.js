import { toBlob, toSvg } from 'html-to-image';

// The viewport of an animation as a picture: the canvas as it is drawn now, at
// its state or anywhere in a transition, without the controls over it.
//
//   animationCapture(element, format)        -> Promise<Blob> ('png' | 'svg')
//   animationCaptureCopy(blobPromise, format)   the clipboard
//   animationCaptureDownload(blob, name)        hands the file to the browser
//
// an SVG is the html of the cards in a foreignObject and the lines as svg: it
// stays sharp at any size and its text stays text, in a browser and in tools
// reading foreignObject. the clipboard takes image/svg+xml where the browser
// allows it, the text of the file otherwise.
//
// the clipboard is written while the click is still being handled, with the
// picture as a promise: a browser may refuse a write made after the wait for it.
// it exists only on https and localhost; a page reached over plain http can copy
// text, not a picture, and says so.
const CAPTURE_TIME_LIMIT_MS = 30000;
const CAPTURE_SKIP_CLASS_LIST = ['react-flow__controls', 'react-flow__minimap', 'react-flow__attribution', 'react-flow__background', 'doc-anim-no-capture'];

function captureOptionGet(element) {
	const background = getComputedStyle(element).backgroundColor;
	return {
		pixelRatio: 2,
		backgroundColor: background && background !== 'rgba(0, 0, 0, 0)' ? background : '#ffffff',
		// what a state hides stays out of the picture, whatever the copy of its styles does
		filter: (node) => !CAPTURE_SKIP_CLASS_LIST.some((name) => node.classList?.contains(name))
			&& !(node instanceof Element && getComputedStyle(node).visibility === 'hidden'),
	};
}

async function captureMake(element, format) {
	const option = captureOptionGet(element);
	if (format === 'svg') {
		const url = await toSvg(element, option);
		const text = decodeURIComponent(url.slice(url.indexOf(',') + 1));
		return new Blob([text], { type: 'image/svg+xml' });
	}
	const blob = await toBlob(element, option);
	if (!blob) throw new Error('the picture could not be made');
	return blob;
}

// a picture that never comes (a font that does not answer) ends as a failure
export function animationCapture(element, format) {
	let timer;
	const limit = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`the picture was not ready after ${CAPTURE_TIME_LIMIT_MS / 1000} seconds`)), CAPTURE_TIME_LIMIT_MS);
	});
	return Promise.race([captureMake(element, format), limit]).finally(() => clearTimeout(timer));
}

// the text of an svg without the clipboard api: only while the click still counts
function textCopyByCommand(text) {
	const area = document.createElement('textarea');
	area.value = text;
	area.style.cssText = 'position: fixed; opacity: 0;';
	document.body.append(area);
	area.select();
	const isDone = document.execCommand('copy');
	area.remove();
	if (!isDone) throw new Error('the browser refused to copy');
}

export async function animationCaptureCopy(blobPromise, format) {
	const isClipboard = Boolean(navigator.clipboard?.write) && typeof ClipboardItem !== 'undefined';
	if (format === 'png') {
		if (!isClipboard) throw new Error('a picture can be copied only on https or localhost; this page is on plain http, so download it instead');
		await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
		return;
	}
	if (!isClipboard) {
		textCopyByCommand(await (await blobPromise).text());
		return;
	}
	const textPromise = blobPromise.then((blob) => blob.text());
	try {
		await navigator.clipboard.write([new ClipboardItem({
			'image/svg+xml': blobPromise,
			'text/plain': textPromise.then((text) => new Blob([text], { type: 'text/plain' })),
		})]);
	} catch {
		await navigator.clipboard.writeText(await textPromise);
	}
}

export function animationCaptureDownload(blob, name) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = name;
	link.style.display = 'none';
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 60000);
}
