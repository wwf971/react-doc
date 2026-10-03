import { observer } from 'mobx-react-lite';
import { DocLink } from '../../comp-doc/link/DocLink.jsx';
import { SourceLink } from '../source-link/SourceLink.jsx';
import { textLocalizedGet } from './IndexData.js';

// item.tagsDisplay (before | after | on | off) is the per-item tag override;
// both item kinds pass it to their link renderer, which shares one tag policy.
// links belong to the document containing the index (config.sourcePath), also
// when a part index is hosted beside another document, so relative targets and
// the TagsDisplayAtLink... config do not change with the visible document.
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
			<DocLink
				target={item.target}
				from={config.sourcePath || docStore.docCurrentPath}
				kind="index-item"
				tagsDisplay={item.tagsDisplay ?? ''}
				configDocOverride={config.configDocOverride}
			>
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
				data={{ label: titleItem.text, tagsDisplay: item.tagsDisplay, target: item.target }}
				config={config}
			/>
		</div>
	);
});

export { IndexItem };
