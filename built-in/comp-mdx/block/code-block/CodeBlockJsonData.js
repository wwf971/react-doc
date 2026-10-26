const modeList = ['pretty', 'plain'];

function jsonModeNormalize(value) {
	const mode = String(value ?? '').trim().toLowerCase();
	return modeList.includes(mode) ? mode : 'pretty';
}

function jsonModeNext(modeCurrent) {
	const indexCurrent = modeList.indexOf(jsonModeNormalize(modeCurrent));
	return modeList[(indexCurrent + 1) % modeList.length];
}

function jsonContentFormat(source, mode) {
	const contentSource = String(source ?? '');
	if (jsonModeNormalize(mode) === 'plain') {
		return { content: contentSource, error: '' };
	}

	try {
		return {
			content: JSON.stringify(JSON.parse(contentSource), null, 2),
			error: '',
		};
	} catch (error) {
		return {
			content: contentSource,
			error: `JSONを整形できません: ${String(error?.message ?? error)}`,
		};
	}
}

export { jsonContentFormat, jsonModeNext, jsonModeNormalize, modeList };