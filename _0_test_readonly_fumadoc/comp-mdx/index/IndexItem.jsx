import { observer } from 'mobx-react-lite';
import { DocLink } from '../../frontend/src/comp-doc/DocLink.jsx';
import { SourceLink } from '../source-link/SourceLink.jsx';
import { textLocalizedGet } from './DocIndexData.js';

const IndexItem = observer(function IndexItem({ config = {}, docStore, item, languagePreferred }) {
	if (item.kind === 'inline-link') {
		return (
			<IndexItemInlineLink
				config={config}
				item={item}
				languagePreferred={languagePreferred}
			/>
		);
	}

	const titleItem = textLocalizedGet(item.title, languagePreferred);
	return (
		<div className="doc-index-item">
			<DocLink target={item.target} from={docStore.docCurrentPath} kind="index-item">
				<span lang={titleItem.language || undefined}>{titleItem.text}</span>
			</DocLink>
		</div>
	);
});

const IndexItemInlineLink = observer(function IndexItemInlineLink({
	config,
	item,
	languagePreferred,
}) {
	const titleItem = textLocalizedGet(item.title, languagePreferred);

	return (
		<div className="doc-index-item is-inline-link">
			<SourceLink
				data={{ label: titleItem.text, target: item.target }}
				config={config}
			/>
		</div>
	);
});

export { IndexItem };
