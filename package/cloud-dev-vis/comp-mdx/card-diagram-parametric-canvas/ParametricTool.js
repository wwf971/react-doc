// The tools of the parametric canvas (card-diagram-parametric-canvas.md#the-tool-bar): a tool is
// something that can be created, a template with its parameters. Pure.
//
// The tool bar is data, a mapping of ids to tools and groups of tools, so that it can be kept in
// the config layers and each layer can add to it, change it or take from it entry by entry:
//
//   ParametricToolMap
//     {id}: { type?: tool | group, label, description?, icon?, rank?, parent?, isHidden?, create? }
//       type      tool (the default): it creates something; group: a dropdown holding tools
//       icon      a word of the icons of the tool bar (ParametricToolBar.jsx: TOOL_ICON_BY_NAME)
//       rank      where it stands among those beside it: a string compared character by character
//                 (c < ci < d), so a tool goes between two others without renumbering any
//       parent    the id of the group it stands in; at the top of the bar when absent
//       isHidden  not on the bar itself: under More
//       create    what a click on the canvas with the tool makes:
//                 { what: node, kind, data?, size?, style? }   a node of a kind of the registry, data over its
//                                                         own, style its colors (DiagramNodeStyle.js)
//                 { what: layout, layout: { type, ... } } a layout member (an array, a repeat, a grid); a
//                                                         pattern is made whole, its slots filled
//                 { what: group }                         a parametric group, its origin there
//                 { what: connection }                    a line with two free ends
//                 `what` names the creator that makes it (ParametricCreator.js)
//       mode      the id of the create mode it places by when clicked on the bar
//                 (ParametricCreateMode.js); the first its creator prefers when absent
//       modeParam { {modeId}: { ... } }: the parameters of a mode as this tool keeps them
//       modeList  the ids of the modes it offers, to offer fewer than its creator takes
//       isKeptArmed   it stays armed after it placed something
//     {id}: null  takes away the tool a layer below gave
export const PARAMETRIC_TOOL_KEY = 'ParametricToolMap';

// the tools the feature ships: the default of the config key
export const parametricToolMapDefault = {
	group: { label: 'Group', description: 'A parametric group: a origin that what you put in it follows.', icon: 'group', rank: 'c', create: { what: 'group' } },
	note: { label: 'Note', description: 'A note card: a title and a line of text.', icon: 'note', rank: 'e', create: { what: 'node', kind: 'card-note' } },
	label: { label: 'Label', description: 'A pill as wide as its words.', icon: 'label', rank: 'g', create: { what: 'node', kind: 'card-label' } },
	text: { label: 'Text', description: 'Words by themselves: a title, a remark.', icon: 'text', rank: 'h', create: { what: 'node', kind: 'text' } },
	shape: { type: 'group', label: 'Shapes', description: 'Shapes drawn to a size, with words inside; their fill and edge in the edit card.', icon: 'shapes', rank: 'hm' },
	'shape-rect': { label: 'Rectangle', icon: 'rect', rank: 'c', parent: 'shape', create: { what: 'node', kind: 'shape', data: { shape: 'rect' } } },
	'shape-rounded': { label: 'Rounded rectangle', icon: 'rounded', rank: 'e', parent: 'shape', create: { what: 'node', kind: 'shape', data: { shape: 'rounded' } } },
	'shape-ellipse': { label: 'Ellipse', icon: 'ellipse', rank: 'g', parent: 'shape', create: { what: 'node', kind: 'shape', data: { shape: 'ellipse' } } },
	'shape-diamond': { label: 'Diamond', icon: 'diamond', rank: 'i', parent: 'shape', create: { what: 'node', kind: 'shape', data: { shape: 'diamond' } } },
	'shape-triangle': { label: 'Triangle', icon: 'triangle', rank: 'k', parent: 'shape', create: { what: 'node', kind: 'shape', data: { shape: 'triangle' } } },
	'shape-hexagon': { label: 'Hexagon', icon: 'hexagon', rank: 'm', parent: 'shape', create: { what: 'node', kind: 'shape', data: { shape: 'hexagon' } } },
	card: { type: 'group', label: 'Cards', description: 'The cards of this diagram.', icon: 'card', rank: 'i' },
	'card-brief': { label: 'Brief card', icon: 'card', rank: 'c', parent: 'card', create: { what: 'node', kind: 'card-brief' } },
	'card-icon': { label: 'Icon', icon: 'icon', rank: 'e', parent: 'card', create: { what: 'node', kind: 'card-icon' } },
	'card-table': { label: 'Table', icon: 'table', rank: 'g', parent: 'card', create: { what: 'node', kind: 'table' } },
	'card-operator': { label: 'Operator', icon: 'card', rank: 'i', parent: 'card', create: { what: 'node', kind: 'operator' } },
	'card-database': { label: 'Database', icon: 'database', rank: 'k', parent: 'card', create: { what: 'node', kind: 'card-database' } },
	'card-block': { label: 'Color block', icon: 'block', rank: 'm', parent: 'card', create: { what: 'node', kind: 'color-block' } },
	layout: { type: 'group', label: 'Layouts', description: 'Members that arrange what is put under them.', icon: 'row', rank: 'k' },
	'layout-row': { label: 'Row', description: 'An array: its children in a row at one gap.', icon: 'row', rank: 'c', parent: 'layout', create: { what: 'layout', layout: { type: 'array', direction: 'row', gap: 40 } } },
	'layout-column': { label: 'Column', description: 'An array: its children in a column at one gap.', icon: 'column', rank: 'e', parent: 'layout', create: { what: 'layout', layout: { type: 'array', direction: 'column', gap: 24 } } },
	'layout-repeat': { label: 'Repeat', description: 'Its one child spawned a number of times.', icon: 'repeat', rank: 'g', parent: 'layout', create: { what: 'layout', layout: { type: 'repeat', count: 3, direction: 'row', gap: 40 } } },
	'layout-grid': { label: 'Grid', description: 'Its children in rows of a number of columns.', icon: 'grid', rank: 'i', parent: 'layout', create: { what: 'layout', layout: { type: 'grid', columns: 3, gapX: 24, gapY: 24 } } },
	pattern: { type: 'group', label: 'Patterns', description: 'Things made together, whose relations are fixed: only their parameters change.', icon: 'pattern', rank: 'l' },
	'pattern-caption': { label: 'Captioned', description: 'A shape and its caption, on the side you choose.', icon: 'caption', rank: 'c', parent: 'pattern', create: { what: 'layout', layout: { type: 'caption' } } },
	'pattern-badge': { label: 'Badged', description: 'A shape and a badge on one of its corners.', icon: 'badge', rank: 'e', parent: 'pattern', create: { what: 'layout', layout: { type: 'badge' } } },
	line: { label: 'Line', description: 'A line with two free ends: drag an end onto a handle.', icon: 'line', rank: 'm', create: { what: 'connection' } },
};

// a mapping of tools over another, entry by entry: an entry replaces the one below, null takes it
// away. What the config system does for a key merged by entry, for whoever merges by hand
export function toolMapMerge(below = {}, above = {}) {
	const result = { ...below };
	for (const [id, tool] of Object.entries(above ?? {})) {
		if (tool === null) delete result[id];
		else result[id] = tool;
	}
	return result;
}

// by rank, a thing without one after every ranked one, then by id
function rankCompare(a, b) {
	const rankA = typeof a.rank === 'string' ? a.rank : '';
	const rankB = typeof b.rank === 'string' ? b.rank : '';
	if (rankA !== rankB) {
		if (!rankA) return 1;
		if (!rankB) return -1;
		return rankA < rankB ? -1 : 1;
	}
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// the tools of a mapping as a list, in order: what is not a tool or a group is left out, and a
// tool whose group is gone stands at the top
export function toolListBuild(toolMap) {
	const list = Object.entries(toolMap ?? {})
		.filter(([, tool]) => tool && typeof tool === 'object' && !Array.isArray(tool))
		.map(([id, tool]) => ({ ...tool, id, type: tool.type === 'group' ? 'group' : 'tool', label: typeof tool.label === 'string' && tool.label ? tool.label : id }));
	const groupIdSet = new Set(list.filter(tool => tool.type === 'group').map(tool => tool.id));
	return list.map(tool => (tool.type === 'tool' && tool.parent && groupIdSet.has(tool.parent) ? tool : { ...tool, parent: undefined })).sort(rankCompare);
}

// the bar: what stands on it, what a group holds, what is under More
export function toolBarBuild(toolList) {
	const childListOf = groupId => toolList.filter(tool => tool.parent === groupId);
	const topAllList = toolList.filter(tool => !tool.parent && (tool.type === 'tool' || childListOf(tool.id).length > 0));
	return { topList: topAllList.filter(tool => !tool.isHidden), moreList: topAllList.filter(tool => tool.isHidden), childListOf };
}
