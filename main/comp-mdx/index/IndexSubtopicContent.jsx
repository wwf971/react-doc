import { RegisteredComp } from '../../frontend/src/comp-doc/RegisteredComp.jsx';
import { IndexItem } from './IndexItem.jsx';

function IndexSubtopicContent({ config, docStore, languagePreferred, subtopic }) {
	if (subtopic.component) {
		return (
			<div className="doc-index-subtopic-component">
				<RegisteredComp
					compName={subtopic.component.name}
					configRuntime={{
						instanceId: `index-subtopic:${config.instanceId ?? 'index'}:${subtopic.id}`,
						navigation: config.navigation,
					}}
					input={{
						config: subtopic.component.config,
						data: subtopic.component.data,
					}}
					placement="indexSubtopic"
				/>
			</div>
		);
	}

	return (
		<div className="doc-index-item-list">
			{subtopic.items.map((item, itemIndex) => (
				<IndexItem
					config={config}
					docStore={docStore}
					item={item}
					key={item.id || `${item.target}-${itemIndex}`}
					languagePreferred={languagePreferred}
				/>
			))}
		</div>
	);
}

export { IndexSubtopicContent };