import { Boxes, Table2, Trash2 } from '../../../../main/frontend/UICommon.js';
import { tableCardNormalize } from '../card-diagram/TableCardData.js';
import { OperatorAbandon } from './OperatorAbandon.jsx';
import { OperatorText } from './OperatorText.jsx';
import { OperatorMapping } from './OperatorMapping.jsx';

const bodyAnchorListGet = () => [{ id: 'body', sideList: ['left', 'right'] }];
const handleListCreate = (isAbandon = false) => [
	{ id: 'left', direction: 'in', anchor: { target: 'body', side: 'left' } },
	{ id: 'right', direction: isAbandon ? 'in' : 'out', anchor: { target: 'body', side: 'right' } },
];

function textNormalize(data = {}, nameDefault = 'Operation') {
	if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Operator data must be a mapping.');
	for (const field of ['name', 'description']) {
		if (data[field] !== undefined && typeof data[field] !== 'string') throw new Error(`Operator ${field} must be text.`);
	}
	return { ...data, name: data.name ?? nameDefault, description: data.description ?? '' };
}

export const operatorMappingSchema = {
	type: 'operator-mapping',
	kind: 'mapping',
	labelNode: 'Mapping',
	labelRow: 'Entry',
	labelRowPlural: 'Entries',
	labelField: 'Column',
	labelFieldPlural: 'Columns',
	reasonFieldListFixed: 'A mapping operator has exactly two fixed columns: Key and Value.',
	rowListKey: 'rows',
	anchorPrefix: 'row',
	fieldList: [{ id: 'key', label: 'Key', kind: 'text' }, { id: 'value', label: 'Value', kind: 'text' }],
	isFieldListEditable: false,
	headFieldList: [],
	nodePropertyList: [{ id: 'name', label: 'Header', kind: 'text' }],
	rowPropertyList: [],
	rowNew: () => ({ key: '', value: '' }),
	isHeaderHandleAllowed: () => false,
};

export function operatorMappingNormalize(data = {}) {
	if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Mapping operator data must be a mapping.');
	if (data.fields !== undefined) throw new Error(operatorMappingSchema.reasonFieldListFixed + ' Omit fields.');
	const normalized = tableCardNormalize({ ...data, fields: operatorMappingSchema.fieldList });
	delete normalized.fields;
	return normalized;
}

export const operatorNodeKindList = [
	{
		type: 'operator-abandon', label: 'Abandon',
		contract: { dataNormalize: data => textNormalize(data, 'Abandon'), anchorListGet: bodyAnchorListGet, sizeDefault: { width: 96, height: 32 } },
		schema: null, Card: OperatorAbandon,
		create: { description: 'Discard a source value; accepts input from either side.', icon: Trash2, keywordList: ['discard', 'ignore', 'mapping'],
			 nodeCreate: idNext => ({ id: idNext('abandon'), renderer: { type: 'operator-abandon' }, data: { name: 'Abandon' }, handles: handleListCreate(true) }) },
	},
	{
		type: 'operator-text', label: 'Text operation',
		contract: { dataNormalize: data => textNormalize(data), anchorListGet: bodyAnchorListGet, sizeDefault: { width: 200, height: 72 } },
		schema: null, Card: OperatorText,
		create: { description: 'A compact operation with an editable header and text.', icon: Boxes, keywordList: ['transform', 'mapping'],
			nodeCreate: idNext => ({ id: idNext('operation'), renderer: { type: 'operator-text' }, data: { name: 'Operation', description: 'Describe the operation' }, handles: handleListCreate() }) },
	},
	{
		type: 'operator-mapping', label: 'Key-value mapping',
		contract: { dataNormalize: operatorMappingNormalize, anchorListGet: data => [...bodyAnchorListGet(), ...data.rows.map(row => ({ id: `row/${row.id}`, sideList: ['left', 'right'] }))], sizeDefault: { width: 240, height: 120 } },
		schema: operatorMappingSchema, Card: OperatorMapping,
		create: { description: 'Editable entries with fixed Key and Value columns.', icon: Table2, keywordList: ['lookup', 'transform', 'mapping'],
			nodeCreate: idNext => ({ id: idNext('mapping'), renderer: { type: 'operator-mapping' }, data: { name: 'Value mapping', rows: [{ id: 'entry-1', key: 'Source', value: 'Target' }] }, handles: handleListCreate() }) },
	},
];