export function resourceNodeNormalize(data, fields) {
	const result = { ...data };
	for (const field of fields) {
		const value = data[field.id] ?? field.defaultValue ?? '';
		if (typeof value !== 'string') throw new Error(`${field.id} must be text.`);
		if (field.values && !field.values.includes(value)) throw new Error(`${field.id}: unsupported value "${value}".`);
		result[field.id] = value;
	}
	if (data.properties !== undefined && !Array.isArray(data.properties)) throw new Error('properties must be a list.');
	const ids = new Set();
	result.properties = (data.properties ?? []).map(property => {
		if (!property || typeof property !== 'object' || typeof property.id !== 'string' || !property.id.trim()) throw new Error('Property id must be non-empty text.');
		if (ids.has(property.id)) throw new Error(`Duplicate property id "${property.id}".`);
		ids.add(property.id);
		for (const field of ['name', 'value', 'description']) {
			if (property[field] !== undefined && typeof property[field] !== 'string') throw new Error(`Property ${property.id}.${field} must be text.`);
		}
		return { ...property, name: property.name ?? property.id, value: property.value ?? '', description: property.description ?? '' };
	});
	return result;
}

export function resourceNodeAnchorsGet(data) {
	return ['header', ...data.properties.map(property => `property/${property.id}`)].map(id => ({ id, sideList: ['left', 'right', 'top', 'bottom'] }));
}