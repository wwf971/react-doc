import { yamlParse } from '../../frontend/src/lib/yaml.js';

function docIndexDataParse(data = {}) {
	const dataParsed = dataParse(data);
	if (!dataParsed || typeof dataParsed !== 'object' || Array.isArray(dataParsed)) {
		throw new Error('Index data must be a mapping.');
	}

	const type = textRequired(dataParsed.type, 'Index type');
	const dataNormalize = dataNormalizeByType[type];
	if (!dataNormalize) throw new Error(`Unsupported index type: ${type}`);
	return { ...dataNormalize(dataParsed), type };
}

const dataNormalizeByType = {
	'title-subtopics-items': titleSubtopicsItemsNormalize,
};

function titleSubtopicsItemsNormalize(dataParsed) {
	const title = textLocalizedNormalize(dataParsed.title, 'Index title');
	if (!Array.isArray(dataParsed.subtopics)) {
		throw new Error('Index data requires a subtopics list.');
	}

	return {
		...dataParsed,
		layout: textOptional(dataParsed.layout) || 'vertical-list',
		title,
		description: textLocalizedOptionalNormalize(dataParsed.description, 'Index description'),
		subtopics: dataParsed.subtopics.map((subtopic, index) => subtopicNormalize(subtopic, index)),
	};
}

function docIndexLanguageListGet(raw) {
	try {
		const dataIndex = docIndexDataParse(raw);
		const languageSet = new Set();
		for (const value of textLocalizedListGet(dataIndex)) {
			if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
			for (const language of Object.keys(value)) languageSet.add(language);
		}
		return [...languageSet];
	} catch {
		return [];
	}
}

function docIndexStructuredDataGet(raw) {
	try {
		const dataIndex = docIndexDataParse(raw);
		const contentList = textLocalizedListGet(dataIndex)
			.flatMap((value) => typeof value === 'string' ? [value] : Object.values(value ?? {}))
			.map((value) => String(value).trim())
			.filter(Boolean);
		return { contents: contentList.map((content) => ({ content })) };
	} catch {
		return undefined;
	}
}

function textLocalizedGet(value, languagePreferred = '') {
	if (typeof value === 'string') return { language: '', text: value };
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return { language: '', text: '' };
	}
	const language = textIs(value[languagePreferred])
		? languagePreferred
		: Object.keys(value).find((key) => textIs(value[key])) ?? '';
	return {
		language,
		text: language ? String(value[language]) : '',
	};
}

function dataParse(data) {
	if (typeof data === 'string') return data.trim() ? yamlParse(data) : {};
	if (data?.raw?.trim()) return yamlParse(data.raw);
	return data;
}

function subtopicNormalize(subtopic, index) {
	if (!subtopic || typeof subtopic !== 'object' || Array.isArray(subtopic)) {
		throw new Error(`Subtopic ${index + 1} must be a mapping.`);
	}
	const isItemsProvided = subtopic.items !== undefined;
	const isComponentProvided = subtopic.component !== undefined;
	if (isItemsProvided === isComponentProvided) {
		throw new Error(`Subtopic ${index + 1} requires exactly one of items or component.`);
	}
	if (isItemsProvided && !Array.isArray(subtopic.items)) {
		throw new Error(`Subtopic ${index + 1} items must be a list.`);
	}
	const id = textOptional(subtopic.id);
	if (isComponentProvided && !id) {
		throw new Error(`Subtopic ${index + 1} with a component requires an id.`);
	}
	return {
		...subtopic,
		id,
		title: textLocalizedNormalize(subtopic.title, `Subtopic ${index + 1} title`),
		description: textLocalizedOptionalNormalize(
			subtopic.description,
			`Subtopic ${index + 1} description`,
		),
		items: isItemsProvided
			? subtopic.items.map((item, itemIndex) => itemNormalize(item, index, itemIndex))
			: undefined,
		component: isComponentProvided
			? componentNormalize(subtopic.component, index)
			: undefined,
	};
}

function componentNormalize(component, subtopicIndex) {
	const label = `Subtopic ${subtopicIndex + 1} component`;
	if (!component || typeof component !== 'object' || Array.isArray(component)) {
		throw new Error(`${label} must be a mapping.`);
	}
	const data = component.data;
	const config = component.config;
	if (data !== undefined && (!data || typeof data !== 'object' || Array.isArray(data))) {
		throw new Error(`${label} data must be a mapping.`);
	}
	if (config !== undefined && (!config || typeof config !== 'object' || Array.isArray(config))) {
		throw new Error(`${label} config must be a mapping.`);
	}
	return {
		...component,
		name: textRequired(component.name, `${label} name`),
		data: data ?? {},
		config: config ?? {},
	};
}

function itemNormalize(item, subtopicIndex, itemIndex) {
	const label = `Subtopic ${subtopicIndex + 1} item ${itemIndex + 1}`;
	if (!item || typeof item !== 'object' || Array.isArray(item)) {
		throw new Error(`${label} must be a mapping.`);
	}
	const kind = textOptional(item.kind) || 'document';
	if (kind !== 'document' && kind !== 'inline-link') {
		throw new Error(`${label} kind must be document or inline-link.`);
	}
	return {
		...item,
		id: textOptional(item.id),
		kind,
		title: textLocalizedNormalize(item.title, `${label} title`),
		description: textLocalizedOptionalNormalize(item.description, `${label} description`),
		target: textRequired(item.target, `${label} target`),
	};
}

function textLocalizedListGet(dataIndex) {
	const textLocalizedListGet = textLocalizedListGetByType[dataIndex.type];
	return textLocalizedListGet?.(dataIndex) ?? [];
}

const textLocalizedListGetByType = {
	'title-subtopics-items': titleSubtopicsItemsTextLocalizedListGet,
};

function titleSubtopicsItemsTextLocalizedListGet(dataIndex) {
	return [
		dataIndex.title,
		dataIndex.description,
		...dataIndex.subtopics.flatMap((subtopic) => [
			subtopic.title,
			subtopic.description,
			...(subtopic.items ?? []).flatMap((item) => [item.title, item.description]),
		]),
	];
}

function textLocalizedNormalize(value, label) {
	if (typeof value === 'string') return textRequired(value, label);
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be text or a language mapping.`);
	}
	const valueNormalized = Object.fromEntries(
		Object.entries(value)
			.filter(([language, text]) => textIs(language) && textIs(text))
			.map(([language, text]) => [language.trim(), text.trim()]),
	);
	if (Object.keys(valueNormalized).length === 0) {
		throw new Error(`${label} requires at least one translation.`);
	}
	return valueNormalized;
}

function textLocalizedOptionalNormalize(value, label) {
	if (value === undefined || value === null || value === '') return undefined;
	return textLocalizedNormalize(value, label);
}

function textRequired(value, label) {
	if (!textIs(value)) throw new Error(`${label} must be non-empty text.`);
	return value.trim();
}

function textOptional(value) {
	return textIs(value) ? value.trim() : '';
}

function textIs(value) {
	return typeof value === 'string' && value.trim() !== '';
}

export {
	docIndexDataParse,
	docIndexLanguageListGet,
	docIndexStructuredDataGet,
	textLocalizedGet,
};
