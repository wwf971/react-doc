// A tool of the tool bar as its dropdown shows it (card-diagram-parametric-canvas.md#the-tool-bar):
// how it places (the create modes it offers, each with its parameters), and its own parameters, as
// sections of properties in the form of the edit card (DiagramEditCardModel.js), so the tool bar
// draws them with the components of the edit card. Nothing here names a kind of thing: the modes
// come from the session (ParametricEditStore.toolModeListOf), the parameters from the creator of
// the tool (ParametricCreator.js). A change writes the whole tool again (toolSet), wherever the
// tool bar is kept.
//
//   toolDetailBuild(session, tool) -> {
//     modeList     [{ mode, isDefault, isArmed, paramSection | null, defaultSet() }]: the first
//                  level revealed: a click arms the tool in that mode
//     isKeptArmed, keptArmedSet(value)   whether the tool stays armed after it placed something
//     sectionList  its name, and what its creator says of what it makes }
export function toolDetailBuild(session, tool) {
	const toolWrite = (patch) => { session.toolSet(tool.id, { ...tool, ...patch }); return true; };
	const creator = session.creatorOf(tool);
	const modeDefault = session.toolModeDefaultOf(tool);
	const modeArmed = session.toolArmedId === tool.id ? session.toolModeArmed : null;
	const modeList = session.toolModeListOf(tool).map((mode) => {
		const param = session.toolModeParamOf(tool, mode);
		const paramSet = (id, value) => toolWrite({ modeParam: { ...(tool.modeParam ?? {}), [mode.id]: { ...(tool.modeParam?.[mode.id] ?? {}), [id]: value } } });
		return {
			mode, isDefault: mode.id === modeDefault?.id, isArmed: mode.id === modeArmed?.id,
			paramSection: mode.paramList.length ? { id: `mode-${mode.id}`, label: '', actionList: [], propertyList: mode.paramList.map(definition => paramPropertyOf(definition, param[definition.id], value => paramSet(definition.id, value))) } : null,
			defaultSet: () => toolWrite({ mode: mode.id }),
		};
	});
	const wordsSection = {
		id: 'tool', label: 'Tool', actionList: [],
		propertyList: [{ id: 'label', label: 'Name', kind: 'text', value: tool.label, set: (value) => { const label = String(value).trim(); return Boolean(label) && toolWrite({ label }); } }],
	};
	return {
		modeList,
		isKeptArmed: Boolean(tool.isKeptArmed),
		keptArmedSet: value => toolWrite({ isKeptArmed: Boolean(value) }),
		sectionList: [wordsSection, ...(creator?.paramSectionListGet(tool.create ?? {}, createNext => toolWrite({ create: createNext }), session.createContextOf()) ?? [])],
	};
}

// a parameter of a create mode as a property of the edit card
function paramPropertyOf(definition, value, set) {
	if (definition.kind === 'bool') return { id: definition.id, label: definition.label, kind: 'bool', value: Boolean(value), set: next => set(Boolean(next)) };
	if (definition.kind === 'enum') return { id: definition.id, label: definition.label, kind: 'enum', value: String(value), values: definition.values.map(String), valueLabels: Object.fromEntries(definition.values.map(item => [String(item), definition.valueLabels?.[item] ?? String(item)])), set: next => set(definition.values.find(item => String(item) === next)) };
	return { id: definition.id, label: definition.label, kind: 'number', value, step: definition.step, min: definition.min, max: definition.max, set: (next) => { const number = Number(next); return Number.isFinite(number) && set(number); } };
}
