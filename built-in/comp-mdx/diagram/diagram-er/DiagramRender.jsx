import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import { BaseEdge, Handle, Position, getBezierPath, getSmoothStepPath, getStraightPath, useUpdateNodeInternals } from '@xyflow/react';
import { RegisteredComp } from '../../../../main/comp-doc/registry/RegisteredComp.jsx';
import { DataverseCard } from './DataverseCard.jsx';
import { PowerAutomateNode } from './PowerAutomateNode.jsx';
import { BusinessRuleNode } from './BusinessRuleNode.jsx';

export const DiagramRenderContext = createContext({});
const positions = { left: Position.Left, right: Position.Right, top: Position.Top, bottom: Position.Bottom };

export function DiagramNode({ id, data }) {
	const { node } = data;
	const { config = {}, measurementSet, editor } = useContext(DiagramRenderContext);
	const root = useRef(null);
	const anchors = useRef(new Map());
	const refs = useRef(new Map());
	const measureCurrent = useRef(() => {});
	const [geometry, geometrySet] = useState({ handles: [], missing: [] });
	const updateNodeInternals = useUpdateNodeInternals();
	const anchorRef = anchorId => {
		if (!refs.current.has(anchorId)) refs.current.set(anchorId, element => {
			if (element) anchors.current.set(anchorId, element);
			else anchors.current.delete(anchorId);
			measureCurrent.current();
		});
		return refs.current.get(anchorId);
	};
	useLayoutEffect(() => {
		let frame;
		const measure = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const element = root.current;
				if (!element || !element.offsetWidth) return;
				const bounds = element.getBoundingClientRect();
				const scale = bounds.width / element.offsetWidth || 1;
				const missing = node.anchors.filter(anchor => anchor.id !== 'body' && !anchors.current.has(anchor.id)).map(anchor => anchor.id);
				const handles = node.handles.flatMap(handle => {
					const target = handle.anchor.target === 'body' ? element : anchors.current.get(handle.anchor.target);
					if (!target) return [];
					observer.observe(target);
					const rect = target.getBoundingClientRect();
					const { side, offset } = handle.anchor;
					const horizontal = side === 'top' || side === 'bottom';
					const left = ((horizontal ? rect.left + rect.width * offset : side === 'left' ? rect.left : rect.right) - bounds.left) / scale;
					const top = ((horizontal ? side === 'top' ? rect.top : rect.bottom : rect.top + rect.height * offset) - bounds.top) / scale;
					return [{ ...handle, left, top, isHidden: top < 0 || top > element.offsetHeight || left < -1 || left > element.offsetWidth + 1 }];
				});
				geometrySet(previous => JSON.stringify(previous) === JSON.stringify({ handles, missing }) ? previous : { handles, missing });
				measurementSet?.(id, { width: element.offsetWidth, height: element.offsetHeight });
			});
		};
		const observer = new ResizeObserver(measure);
		measureCurrent.current = measure;
		observer.observe(root.current);
		root.current.addEventListener('scroll', measure, true);
		measure();
		return () => {
			measureCurrent.current = () => {};
			cancelAnimationFrame(frame);
			observer.disconnect();
			root.current?.removeEventListener('scroll', measure, true);
		};
	}, [id, node, measurementSet]);
	useLayoutEffect(() => { updateNodeInternals(id); }, [geometry, id, updateNodeInternals]);
	const visualization = { nodeId: id, size: node.size, isEdit: false, anchorRef };
	return (
		<div ref={root} className={`doc-vis-node${node.size.height === 'auto' ? ' is-height-auto' : ''}`} style={{ height: node.size.height === 'auto' ? 'auto' : '100%' }}>
			<div className="doc-vis-node-content nowheel">
				{node.renderer.component ? (
					<RegisteredComp compName={node.renderer.component} placement="visualizationNode" input={{ data: node.data }} configRuntime={{ ...config, instanceId: `${config.instanceId ?? 'diagram'}:node:${id}`, isEdit: false, visualization }} />
				) : node.renderer.type === 'power-automate' ? <PowerAutomateNode data={node.data} anchorRef={anchorRef} editor={editor} nodeId={id} />
				: node.renderer.type === 'business-rule' ? <BusinessRuleNode data={node.data} anchorRef={anchorRef} editor={editor} nodeId={id} />
				: node.renderer.type === 'operator' ? (
					<div className="doc-vis-operator"><strong>{node.data.label ?? node.data.name ?? id}</strong>{node.data.description ? <p>{node.data.description}</p> : null}</div>
				) : <DataverseCard data={node.data} type={node.renderer.type} anchorRef={anchorRef} editor={editor} nodeId={id} />}
			</div>
			{geometry.missing.length ? <div className="doc-vis-node-error" role="alert">Missing anchors: {geometry.missing.join(', ')}</div> : null}
			{node.handles.map(handle => geometry.handles.find(item => item.id === handle.id) ?? { ...handle, left: '50%', top: '50%', isHidden: true }).flatMap(handle => (handle.direction === 'both' ? ['source', 'target'] : [handle.direction === 'out' ? 'source' : 'target']).map(role => (
				<Handle key={`${role}:${handle.id}`} id={`${role}:${handle.id}`} type={role} position={positions[handle.anchor.side]} isConnectable={false}
					className={`doc-er-table-handle is-${role}`} style={{ left: handle.left, top: handle.top, right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)', visibility: handle.isHidden ? 'hidden' : 'visible' }} />
			)))}
		</div>
	);
}

export function DiagramEdge(props) {
	const { config = {} } = useContext(DiagramRenderContext);
	const { connection } = props.data;
	const pathRef = useRef(null);
	const [labelPoint, labelPointSet] = useState(null);
	let pathValue;
	if (connection.renderer.type === 'polyline') {
		pathValue = `M ${props.sourceX},${props.sourceY} ${[...(connection.route?.waypoints ?? []), { x: props.targetX, y: props.targetY }].map(point => `L ${point.x},${point.y}`).join(' ')}`;
	} else {
		const helper = connection.renderer.type === 'straight' ? getStraightPath : connection.renderer.type === 'bezier' ? getBezierPath : getSmoothStepPath;
		[pathValue] = helper({ ...props, ...(connection.renderer.type === 'step' ? { borderRadius: 0 } : {}) });
	}
	useLayoutEffect(() => {
		if (!pathRef.current) return;
		const point = pathRef.current.getPointAtLength(pathRef.current.getTotalLength() * connection.label.position);
		labelPointSet({ x: point.x, y: point.y });
	}, [pathValue, connection.label.position]);
	if (connection.renderer.component) {
		return <RegisteredComp compName={connection.renderer.component} placement="visualizationEdge" input={{ data: connection.data }} configRuntime={{ ...config, instanceId: `${config.instanceId ?? 'diagram'}:edge:${props.id}`, isEdit: false, visualization: { connectionId: props.id, connection, source: { x: props.sourceX, y: props.sourceY, side: props.sourcePosition }, target: { x: props.targetX, y: props.targetY, side: props.targetPosition }, markerStart: props.markerStart, markerEnd: props.markerEnd, isEdit: false, BaseEdge } }} />;
	}
	return <>
		<path ref={pathRef} d={pathValue} fill="none" stroke="none" pointerEvents="none" />
		<BaseEdge id={props.id} path={pathValue} markerStart={props.markerStart} markerEnd={props.markerEnd} style={connection.style} interactionWidth={20}
			label={connection.label.text} labelX={labelPoint?.x ?? (props.sourceX + props.targetX) / 2} labelY={labelPoint?.y ?? (props.sourceY + props.targetY) / 2}
			labelStyle={{ fontSize: 11, fontWeight: 650 }} labelBgPadding={[6, 3]} labelBgBorderRadius={3} />
	</>;
}