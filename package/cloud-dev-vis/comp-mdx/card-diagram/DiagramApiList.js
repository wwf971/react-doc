import { apiDefine } from '../../../../main/frontend/src/lib/doc-api.js';
import { compDefinitionNormalize, compIdResolve } from '../../../../main/comp-doc/registry/comp-registry.js';
import { blockDataGet, blockLocate, docModelEnsure } from '../../../../main/comp-doc/api/api-doc.js';
import { DiagramEditStore } from './DiagramEditStore.js';
import { diagramCanvasFind, diagramCanvasListGet } from './DiagramCanvasRegistry.js';
import { lineTypeList } from './DiagramERData.js';
import { ROUTE_DIRECTION_LIST, routeOverlapListGet, routeResolve, routeTypeHasAnchors, routeTypeIsBezier } from './DiagramRoute.js';

// The apis a diagram component exposes (doc_page_impl_api.md#the-apis-of-a-component,
// card-diagram-connection-line.md#the-apis): what the edit card does to a connection line,
// for an agent or a script. Every write goes through a command of DiagramEditStore, so its
// validation is the one the editor has.
//
// While an edit session is open on the block, the command works on its draft: it is
// undoable there, and written when the author saves (the answer says isDraft). Otherwise
// the data of the block is read, changed by the same command, and written as a save would
// (doc/blockDataSet). A place on the canvas (x, y) needs the diagram drawn on the page, as
// where the ends of the line are is known only there; along with offsetX, offsetY needs nothing.

const blockParam = { name: 'block', type: 'any', description: 'the diagram: the index of its block, or the id of its component (id=...); the first such diagram of the document when absent' };
const docParam = { name: 'doc', type: 'string', description: 'the document, as a link target; the current one when absent' };
const connectionParam = { name: 'connectionId', type: 'string', isRequired: true, description: 'the id of the connection' };
const anchorParam = { name: 'anchorId', type: 'string', isRequired: true, description: 'the id of the anchor (connectionRouteGet lists them)' };
const placeParamList = [
	{ name: 'x', type: 'number', description: 'the place, in diagram coordinates (the diagram must be drawn on the page)' },
	{ name: 'y', type: 'number', description: 'the place, in diagram coordinates' },
	{ name: 'along', type: 'number', description: 'which end it follows: 0 the source, 1 the target, between a share of each' },
	{ name: 'offsetX', type: 'number', description: 'its offset from the point at "along" on the line between the ends' },
	{ name: 'offsetY', type: 'number', description: 'its offset from the point at "along" on the line between the ends' },
];
const handleValueParam = { name: 'value', type: 'any', description: `right-angled: ${ROUTE_DIRECTION_LIST.join(', ')} or null for auto; curve: { x, y } or null for none` };

// the diagram block an api works on, and how to read and change it
async function diagramLocate(context, { block, doc }, registry) {
	const ensured = await docModelEnsure(context, doc);
	if (ensured.message) return { message: ensured.message };
	const { configDoc } = context.stores.sourceStore;
	const { compId } = context.comp;
	const isDiagram = (item) => Boolean(item.component) && compIdResolve(configDoc, item.component.compName) === compId;
	let located;
	if (block === undefined || block === null || block === '') {
		const index = ensured.model.blockList.findIndex(isDiagram);
		if (index === -1) return { message: `${ensured.path} has no ${compId} diagram` };
		located = { block: ensured.model.blockList[index], index };
	} else {
		located = blockLocate(ensured.model, block);
		if (located.message) return { message: located.message };
		if (!isDiagram(located.block)) return { message: `block ${located.index} is not a ${compId} diagram` };
	}
	const data = await blockDataGet(context, located.block);
	if (data.message) return { message: data.message };
	const canvas = diagramCanvasFind(ensured.path, data.raw);
	const editor = canvas?.editorGet();
	const resolve = (name, placement) => {
		const definition = compDefinitionNormalize(context.stores.docStore.compById[compIdResolve(configDoc, name)]);
		return definition?.placementList?.includes(placement) ? definition.expose?.[placement] : undefined;
	};
	let store;
	try {
		store = editor?.store ?? new DiagramEditStore(data.raw ?? '', 'diagram', resolve, registry);
	} catch (error) {
		return { message: `the diagram does not read: ${error.message}` };
	}
	return { path: ensured.path, index: located.index, canvas, editor, store };
}

// one command on the diagram: the draft of the open session, or the data of the block
async function diagramChange(context, params, registry, command) {
	const diagram = await diagramLocate(context, params, registry);
	if (diagram.message) return { code: -1, message: diagram.message };
	const { store, editor } = diagram;
	// a canvas whose data was just written has not been drawn anew yet: until then it is
	// the only canvas of the document drawing a line of this id
	const endsGet = (connectionId) => {
		const connection = store.connectionGet(connectionId);
		const canvasList = diagram.canvas ? [diagram.canvas] : diagramCanvasListGet().filter((canvas) => canvas.sourcePath === diagram.path && canvas.endsGet(connectionId, connection));
		return canvasList.length === 1 ? canvasList[0].endsGet(connectionId, connection) : null;
	};
	let result;
	const run = () => { result = command(store, endsGet, diagram); };
	if (editor) editor.change(run);
	else run();
	if (result === false || result === null) return { code: -1, message: store.message || 'the change was not applied' };
	if (editor) return { code: 0, data: { result, isDraft: true }, message: 'changed in the draft of the open session: saved when the author saves' };
	const written = await context.call('doc/blockDataSet', { raw: store.rawDraft, block: diagram.index, doc: diagram.path });
	return written.code === 0 ? { code: 0, data: { result, isDraft: false }, message: '' } : written;
}

// where to put an anchor: a place of the canvas (x, y), or as the data keeps it
function placeInputGet({ x, y, along, offsetX, offsetY }, ends) {
	const isPoint = x !== undefined || y !== undefined;
	if (!isPoint) {
		return { input: { ...(along !== undefined ? { along } : {}), ...(offsetX !== undefined ? { x: offsetX } : {}), ...(offsetY !== undefined ? { y: offsetY } : {}) } };
	}
	if (x === undefined || y === undefined) return { message: 'a place on the canvas needs both x and y' };
	if (!ends) return { message: 'x and y need the diagram drawn on the page, to know where the ends of the line are: open the document, or give along, offsetX and offsetY' };
	return { input: { point: { x, y }, ends, ...(along !== undefined ? { along } : {}) } };
}

// lines of a canvas on top of each other (card-diagram-usage.md#no-lines-on-top-of-each-other)
export function diagramOverlapListGet() {
	return diagramCanvasListGet().map((canvas) => ({ sourcePath: canvas.sourcePath, title: canvas.title, overlapList: routeOverlapListGet(canvas.lineListGet()) }));
}

export function diagramApiListBuild(registry) {
	const changeApi = (options, command) => apiDefine({
		palette: false,
		...options,
		paramList: [...options.paramList, blockParam, docParam],
		isAvailable: ({ stores }) => stores.editStore.isAvailable || stores.envStore.reasonGet('edit'),
		run: (context, params) => diagramChange(context, params, registry, (store, endsGet, diagram) => command(store, params, endsGet, diagram)),
	});
	return [
		apiDefine({
			name: 'connectionRouteGet',
			label: 'Read the route of a connection line',
			description: 'Its line type, its route as the data keeps it, and, when the diagram is drawn on the page, where its anchors are and which way their handles point.',
			palette: false,
			paramList: [connectionParam, blockParam, docParam],
			run: async (context, params) => {
				const diagram = await diagramLocate(context, params, registry);
				if (diagram.message) return { code: -1, message: diagram.message };
				const connection = diagram.store.connectionGet(params.connectionId);
				if (!connection) return { code: -1, message: `no connection has the id "${params.connectionId}"` };
				const lineType = diagram.store.connectionLineTypeGet(connection);
				const hasAnchors = routeTypeHasAnchors(lineType);
				const route = hasAnchors ? diagram.store.connectionRouteGet(connection.id) : null;
				const ends = diagram.canvas?.endsGet(connection.id, connection);
				const resolved = hasAnchors && ends ? routeResolve(lineType, route, ends) : null;
				return {
					blockIndex: diagram.index, lineType, hasAnchors, route, isDrawn: Boolean(ends),
					ends: ends ? { source: { x: ends.sourceX, y: ends.sourceY, side: ends.sourcePosition }, target: { x: ends.targetX, y: ends.targetY, side: ends.targetPosition } } : undefined,
					anchorList: resolved?.anchorList,
					pointList: resolved && !routeTypeIsBezier(lineType) ? resolved.pointList : undefined,
				};
			},
		}),
		apiDefine({
			name: 'connectionOverlapListGet',
			label: 'Find connection lines on top of each other',
			description: 'The check of a drawn diagram: for every canvas on the page now, the pairs of right-angled lines sharing a stretch beyond the final segment into an endpoint they have in common, or, between the same two endpoints, with nothing of their own.',
			palette: false,
			run: () => diagramOverlapListGet(),
		}),
		apiDefine({
			name: 'diagramArrangerListGet',
			label: 'List the arrangers of a diagram',
			description: 'What can arrange diagrams of this component, and, for the diagram named, whether it applies (card-diagram-arrange.md).',
			palette: false,
			paramList: [blockParam, docParam],
			run: async (context, params) => {
				const diagram = await diagramLocate(context, params, registry);
				if (diagram.message) return { code: -1, message: diagram.message };
				return { arrangerList: registry.arrangerList.map(({ id, label, description, isApplicable }) => ({ id, label, description, isApplicable: isApplicable?.(diagram.store.value) ?? true })) };
			},
		}),
		changeApi({
			name: 'diagramArrangerApply',
			label: 'Arrange a diagram by an arranger',
			description: 'Replaces the anchors of its lines, and, if the arranger places cards, moves its cards. Uses where things are drawn when the diagram is on the page, an estimate otherwise. Answers what the arranger reports.',
			paramList: [
				{ name: 'arrangerId', type: 'string', isRequired: true, description: 'the id of the arranger (diagramArrangerListGet lists them)' },
				{ name: 'connectionIdList', type: 'list', description: 'only these lines; the others stay as they are and are kept clear of' },
			],
		}, (store, { arrangerId, connectionIdList }, _endsGet, diagram) => {
			const arranger = registry.arrangerList.find((item) => item.id === arrangerId);
			if (!arranger) { store.message = `no arranger has the id "${arrangerId}"`; return false; }
			const reportList = store.arrangeApply(arranger, { geometry: diagram.canvas?.geometryGet?.(), ...(connectionIdList ? { connectionIdList } : {}) });
			return reportList ? { arrangerId, reportList } : false;
		}),
		changeApi({ name: 'connectionLineTypeSet', label: 'Set the line type of a connection', description: 'A route is kept between the right-angled types and dropped on any other change.', paramList: [connectionParam, { name: 'lineType', type: 'string', isRequired: true, valueList: lineTypeList, description: 'the line type' }] },
			(store, { connectionId, lineType }) => store.connectionSet(connectionId, 'lineType', lineType)),
		changeApi({ name: 'connectionAnchorAdd', label: 'Add an anchor to a connection line', description: 'On the line nearest to a place (x, y; a curve keeps its shape), or at a place as the data keeps it (along, offsetX, offsetY). Answers the id of the anchor.', paramList: [connectionParam, ...placeParamList, { name: 'index', type: 'number', description: 'its place among the anchors, with along: the end of the list when absent' }, { name: 'handleIn', type: 'any', description: handleValueParam.description }, { name: 'handleOut', type: 'any', description: handleValueParam.description }, { name: 'isCoupled', type: 'boolean', description: 'a curve: its handles on one straight line (default true)' }] },
			(store, params, endsGet) => {
				const { connectionId, index, handleIn, handleOut, isCoupled } = params;
				const place = placeInputGet(params, endsGet(connectionId));
				if (place.message) { store.message = place.message; return false; }
				return store.connectionAnchorAdd(connectionId, place.input.point ? place.input : { ...place.input, ...(index !== undefined ? { index } : {}), ...(handleIn != null ? { handleIn } : {}), ...(handleOut != null ? { handleOut } : {}), ...(isCoupled !== undefined ? { isCoupled } : {}) });
			}),
		changeApi({ name: 'connectionAnchorMove', label: 'Move an anchor of a connection line', description: 'To a place (x, y), or as the data keeps it (along, offsetX, offsetY).', paramList: [connectionParam, anchorParam, ...placeParamList] },
			(store, params, endsGet) => {
				const place = placeInputGet(params, endsGet(params.connectionId));
				if (place.message) { store.message = place.message; return false; }
				return store.connectionAnchorMove(params.connectionId, params.anchorId, place.input);
			}),
		changeApi({ name: 'connectionAnchorRemove', label: 'Remove an anchor of a connection line', description: 'Its neighbours keep their handles.', paramList: [connectionParam, anchorParam] },
			(store, { connectionId, anchorId }) => store.connectionAnchorRemove(connectionId, anchorId)),
		changeApi({ name: 'connectionAnchorHandleSet', label: 'Set a handle of an anchor', description: 'On a curve a coupled handle takes the other along, unless isDecouple.', paramList: [connectionParam, anchorParam, { name: 'side', type: 'string', isRequired: true, valueList: ['in', 'out'], description: 'which handle' }, handleValueParam, { name: 'isDecouple', type: 'boolean', description: 'a curve: this handle moves alone from now on' }] },
			(store, { connectionId, anchorId, side, value, isDecouple }) => store.connectionAnchorHandleSet(connectionId, anchorId, side, value ?? null, { isDecouple: isDecouple === true })),
		changeApi({ name: 'connectionAnchorCoupleSet', label: 'Couple or decouple the handles of an anchor', description: 'A curve only. Coupling turns the in handle onto the straight line of the out handle, keeping its length.', paramList: [connectionParam, anchorParam, { name: 'isCoupled', type: 'boolean', isRequired: true, description: 'on one straight line, or free of each other' }] },
			(store, { connectionId, anchorId, isCoupled }) => store.connectionAnchorCoupleSet(connectionId, anchorId, isCoupled)),
		changeApi({ name: 'connectionEndHandleSet', label: 'Set the handle of an end of a connection line', description: 'null: none, the line leaves or arrives perpendicular to the border of the card.', paramList: [connectionParam, { name: 'role', type: 'string', isRequired: true, valueList: ['source', 'target'], description: 'which end' }, handleValueParam] },
			(store, { connectionId, role, value }) => store.connectionEndHandleSet(connectionId, role, value ?? null)),
		changeApi({ name: 'connectionRouteSet', label: 'Set the whole route of a connection line', description: 'As the data keeps it, or null: back to what the line type draws by itself.', paramList: [connectionParam, { name: 'route', type: 'any', description: '{ anchorList, source, target }, or null' }] },
			(store, { connectionId, route }) => store.connectionRouteSet(connectionId, route ?? null)),
	];
}
