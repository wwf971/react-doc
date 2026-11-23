import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { Panel } from '@xyflow/react';
import { BadgePlus, Captions, Check, ChevronDown, Circle, CircleDashed, Columns3, Copy, Database, Diamond, Ellipsis, Grid3x3, Group, Hexagon, Layers, LayoutTemplate, LocateFixed, MousePointer2, RectangleHorizontal, Route, Rows3, Scan, Shapes, Square, Squircle, SquareDashedMousePointer, PanelBottom, PictureInPicture2, StickyNote, Table2, TagIcon, Trash2, Triangle, Type, Waypoints } from '../../../../main/frontend/UICommon.js';
import { DiagramEditCardBody } from '../card-diagram/DiagramEditCard.jsx';
import { CheckValue } from '../card-diagram/DiagramValueControls.jsx';
import { toolBarBuild } from './ParametricTool.js';
import { toolDetailBuild } from './ParametricToolModel.js';

// the icons a tool or a create mode may name (ParametricTool.js, ParametricCreateMode.js: icon)
export const TOOL_ICON_BY_NAME = { group: Group, note: StickyNote, label: TagIcon, card: Square, icon: CircleDashed, table: Table2, database: Database, block: SquareDashedMousePointer, row: Columns3, column: Rows3, repeat: Copy, line: Waypoints, shapes: Shapes, layers: Layers, pointer: MousePointer2, box: Scan, beside: LocateFixed, route: Route, remove: Trash2, dock: PanelBottom, float: PictureInPicture2, text: Type, rect: RectangleHorizontal, rounded: Squircle, ellipse: Circle, diamond: Diamond, triangle: Triangle, hexagon: Hexagon, grid: Grid3x3, pattern: LayoutTemplate, caption: Captions, badge: BadgePlus };
export const iconOf = name => TOOL_ICON_BY_NAME[name] ?? Shapes;
export const toolIconOf = tool => iconOf(tool?.icon);

// The tool bar of the parametric canvas (card-diagram-parametric-canvas.md#the-tool-bar), over the
// top left of the canvas while the diagram is edited. It is hierarchical: the major tools stand on
// the bar, a group of tools opens a dropdown of its tools, and every tool opens its parameters.
//
//   a click on a tool        arms it in its default create mode: the next gesture on the canvas
//                            places what it makes (Escape lets it go); into the group of what is
//                            selected, else free
//   the chevron of a tool    how it is placed: the create modes it offers (a click arms it in that
//                            one; the mark says which is its default), each opening its own
//                            parameters; then the parameters of the tool. Changed where they are
//                            shown and kept with the tool (ParametricEditStore.toolSet)
//   a group of tools         a dropdown of its tools, each with its chevron
//   More                     the tools kept off the bar
//
// What the bar holds is data (ParametricTool.js), read from the session, which knows where it is kept.
export const ParametricToolBar = observer(function ParametricToolBar({ session, editor }) {
	const root = useRef(null);
	const bar = toolBarBuild(session.toolList);
	const armed = session.toolArmed;
	const openId = session.toolBar.openId;
	// a pointer going down elsewhere closes the dropdown
	useEffect(() => {
		if (!openId) return undefined;
		const pointerDown = (event) => { if (!root.current?.contains(event.target) && !event.target.closest?.('.doc-vis-menu, .prop-editor-color-popover')) session.toolBarClose(); };
		document.addEventListener('pointerdown', pointerDown, true);
		return () => document.removeEventListener('pointerdown', pointerDown, true);
	}, [openId, session]);
	const itemRender = tool => (tool.type === 'group'
		? <ToolGroup key={tool.id} session={session} editor={editor} group={tool} toolList={bar.childListOf(tool.id)} />
		: <ToolItem key={tool.id} session={session} editor={editor} tool={tool} />);
	return (
		<Panel position="top-left" className="doc-param-toolbar nodrag nopan">
			<div ref={root} className="doc-param-toolbar-row" role="toolbar" aria-label="Tools" onDoubleClick={event => event.stopPropagation()}>
				{bar.topList.map(itemRender)}
				{bar.moreList.length ? <ToolGroup session={session} editor={editor} group={{ id: '~more', label: 'More', description: 'The tools kept off the bar.' }} Icon={Ellipsis} toolList={bar.moreList} isLabelHidden /> : null}
			</div>
			{armed ? <div className="doc-param-toolbar-hint" role="status"><strong>{armed.label}</strong>: {session.toolModeArmed?.hint ?? 'it cannot be placed here'}{session.placeTarget ? ' · into the group selected' : ''}{armed.isKeptArmed ? ' · stays armed' : ''} · Esc or right-click: cancel</div> : null}
		</Panel>
	);
});

// a tool on the bar: its button arms it, its chevron opens what it is and its parameters
const ToolItem = observer(function ToolItem({ session, editor, tool }) {
	const Icon = toolIconOf(tool);
	const isArmed = session.toolArmedId === tool.id;
	const isOpen = session.toolBar.openId === tool.id;
	return (
		<span className={`doc-param-tool${isArmed ? ' is-armed' : ''}${isOpen ? ' is-open' : ''}`}>
			<button type="button" className="doc-param-tool-main" title={tool.description ?? tool.label} aria-pressed={isArmed} disabled={editor.isLocked} onClick={() => session.toolArm(tool.id)}>
				<Icon size={14} aria-hidden="true" /><span>{tool.label}</span>
			</button>
			<button type="button" className="doc-param-tool-more" title={`${tool.label}: what it makes and its parameters`} aria-label={`Parameters of ${tool.label}`} aria-expanded={isOpen} onClick={() => session.toolBarOpenSet(tool.id)}><ChevronDown size={11} aria-hidden="true" /></button>
			{isOpen ? <div className="doc-param-tool-drop"><ToolDetail session={session} editor={editor} tool={tool} /></div> : null}
		</span>
	);
});

// a group of tools on the bar: a dropdown of its tools; a tool of it armed shows on the group
const ToolGroup = observer(function ToolGroup({ session, editor, group, toolList, Icon: IconGiven, isLabelHidden = false }) {
	const isOpen = session.toolBar.openId === group.id;
	const armed = toolList.find(tool => tool.id === session.toolArmedId);
	const Icon = IconGiven ?? toolIconOf(armed ?? group);
	return (
		<span className={`doc-param-tool is-group${armed ? ' is-armed' : ''}${isOpen ? ' is-open' : ''}`}>
			<button type="button" className="doc-param-tool-main" title={group.description ?? group.label} aria-haspopup="menu" aria-expanded={isOpen} disabled={editor.isLocked} onClick={() => session.toolBarOpenSet(group.id)}>
				<Icon size={14} aria-hidden="true" />{isLabelHidden && !armed ? null : <span>{armed ? armed.label : group.label}</span>}<ChevronDown size={11} aria-hidden="true" />
			</button>
			{isOpen ? (
				<div className="doc-param-tool-drop" role="menu" aria-label={group.label}>
					{toolList.map((tool) => {
						const ToolIcon = toolIconOf(tool);
						const isDetail = session.toolBar.detailId === tool.id;
						return (
							<div key={tool.id} className={`doc-param-tool-entry${session.toolArmedId === tool.id ? ' is-armed' : ''}`}>
								<div className="doc-param-tool-entry-row">
									<button type="button" role="menuitem" className="doc-param-tool-entry-main" title={tool.description ?? tool.label} onClick={() => session.toolArm(tool.id)}>
										<ToolIcon size={14} aria-hidden="true" /><span className="doc-param-tool-entry-label">{tool.label}</span><span className="doc-param-tool-entry-description">{tool.description ?? ''}</span>
									</button>
									<button type="button" className="doc-param-tool-more" title={`${tool.label}: its parameters`} aria-label={`Parameters of ${tool.label}`} aria-expanded={isDetail} onClick={() => session.toolBarDetailSet(tool.id)}><ChevronDown size={11} aria-hidden="true" /></button>
								</div>
								{isDetail ? <ToolDetail session={session} editor={editor} tool={tool} /> : null}
							</div>
						);
					})}
				</div>
			) : null}
		</span>
	);
});

// a tool opened: how it is placed, then its parameters. The create modes are the first level
// revealed (a click on one arms the tool in it); a mode opens its own parameters a level deeper
const ToolDetail = observer(function ToolDetail({ session, editor, tool }) {
	const detail = toolDetailBuild(session, tool);
	return (
		<div className="doc-param-tool-detail doc-vis-card-panel">
			{tool.description ? <p className="doc-note doc-param-tool-detail-note">{tool.description}</p> : null}
			<div className="doc-param-tool-heading">Placed by</div>
			{detail.modeList.length === 0 ? <p className="doc-note doc-param-tool-detail-note">Nothing here can place it.</p> : null}
			{detail.modeList.map(({ mode, isDefault, isArmed, paramSection, defaultSet }) => {
				const ModeIcon = TOOL_ICON_BY_NAME[mode.icon] ?? MousePointer2;
				const isOpen = session.toolBar.modeId === mode.id;
				return (
					<div key={mode.id} className={`doc-param-mode${isArmed ? ' is-armed' : ''}`}>
						<div className="doc-param-mode-row">
							<button type="button" className="doc-param-mode-main" title={`${mode.description} Click to place ${tool.label} this way`} disabled={editor.isLocked} onClick={() => session.toolArm(tool.id, mode.id)}>
								<ModeIcon size={13} aria-hidden="true" />
								<span className="doc-param-mode-label">{mode.label}</span>
								<span className="doc-param-mode-description">{mode.description}</span>
								{isDefault ? <span className="doc-param-mode-default" title="The way this tool places when it is clicked on the bar"><Check size={10} aria-hidden="true" />default</span> : null}
							</button>
							<button type="button" className="doc-param-tool-more" title={`${mode.label}: its parameters`} aria-label={`Parameters of ${mode.label}`} aria-expanded={isOpen} onClick={() => session.toolBarModeSet(mode.id)}><ChevronDown size={11} aria-hidden="true" /></button>
						</div>
						{isOpen ? (
							<div className="doc-param-mode-detail">
								<p className="doc-note doc-param-tool-detail-note">{mode.description}</p>
								{paramSection ? <DiagramEditCardBody model={{ view: { type: 'detail', sectionList: [paramSection] } }} editor={editor} /> : null}
								<button type="button" className="doc-button" disabled={isDefault || editor.isLocked} title={isDefault ? 'It is the default of this tool' : `A click on ${tool.label} on the bar places this way`} onClick={defaultSet}>Use by default</button>
							</div>
						) : null}
					</div>
				);
			})}
			<div className="doc-param-tool-kept"><CheckValue label="Stay armed after placing" isChecked={detail.isKeptArmed} isLocked={editor.isLocked} onChange={detail.keptArmedSet} /></div>
			<DiagramEditCardBody model={{ view: { type: 'detail', sectionList: detail.sectionList } }} editor={editor} />
		</div>
	);
});
