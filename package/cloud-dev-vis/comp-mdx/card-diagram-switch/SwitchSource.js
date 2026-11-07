import { yamlParse } from '../../../../main/frontend/src/lib/yaml.js';
import { switchStackTitleBarNormalize } from './SwitchData.js';

// the starting text of a block, and what its scenes depend on at build time
const SWITCH_SOURCE_DEFAULT = `version: 1
title: Scenes
height: 520
sceneList:
  - path: /overview
    label: Overview
    diagram:
      connections:
        - { id: a-b, source: { nodeId: a, handleId: out }, target: { nodeId: b, handleId: in }, label: { text: reads } }
      nodes:
        - id: a
          renderer: { type: card-note }
          position: { x: 0, y: 120 }
          size: { width: 180, height: auto }
          data: { title: A card, text: Beside an embedded scene, tone: blue }
          handles: [{ id: out, direction: out, anchor: { side: right } }]
        - id: b
          renderer: { type: scene-embed }
          position: { x: 320, y: 0 }
          size: { width: 420, height: 300 }
          data: { scene: /overview/detail, title: Detail, tone: green }
          handles: [{ id: in, direction: in, anchor: { side: left } }]
  - path: /overview/detail
    label: Detail
    diagram:
      nodes:
        - id: table
          renderer: { type: table }
          position: { x: 0, y: 0 }
          size: { width: 320, height: auto }
          data:
            name: A table
            fields: [{ id: name, label: Name }, { id: value, label: Value }]
            rows: [{ id: r1, name: Row, value: "1" }]
`;

export function switchSourceDefaultCreate() {
	return { lang: 'yaml', raw: SWITCH_SOURCE_DEFAULT };
}

// the build-time dependencies of a block: the data of the registered components
// drawing the nodes of its scenes, as for a diagram
export function switchDependenciesCollect(data, context) {
	try {
		const doc = data.source || data.raw ? yamlParse(data.source || data.raw) : data;
    const nodeCollect = (node) => {
      if (node.renderer?.component) context.componentCollect(node.renderer.component, node.data ?? {});
      if (node.renderer?.type !== 'scene-stack') return;
      const title = switchStackTitleBarNormalize(node.data?.titleBar);
      for (const item of title?.itemList ?? []) {
        if (item.type === 'component') context.componentCollect(item.comp, item.data ?? {});
      }
      for (const item of node.data?.itemList ?? []) {
        if (item.node) nodeCollect(item.node);
      }
    };
		for (const scene of doc.sceneList ?? []) {
			for (const holder of [scene, ...(scene.viewList ?? [])]) {
				for (const node of holder.diagram?.nodes ?? []) nodeCollect(node);
			}
		}
  } catch (error) {
    context.warn?.(`Switch dependencies could not be collected: ${error.message}`);
	}
}
