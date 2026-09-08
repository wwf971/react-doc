import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { LogOut } from 'lucide-react';
import { DocLink } from '../../frontend/src/comp-doc/DocLink.jsx';
import { useDocStores } from '../../frontend/src/store/context.js';
import { CodeBlockCompactPopup } from '../code-block/CodeBlockCompactPopup.jsx';
import { CodeBlockCompactStore } from '../code-block/CodeBlockCompactStore.js';
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
	const { sourceStore } = useDocStores();
	const [store] = useState(() => new CodeBlockCompactStore());
	const titleItem = textLocalizedGet(item.title, languagePreferred);
	const sourceState = sourceStore.rawByPath[item.target];
	const isReady = sourceState?.status === 'done';
	const Panel = config.panelComponent;

	useEffect(() => {
		void sourceStore.loadRaw(item.target);
	}, [item.target, sourceStore]);

	useEffect(() => () => store.dispose(), [store]);

	return (
		<div className="doc-index-item is-inline-link">
			<button
				type="button"
				className="doc-index-inline-link"
				disabled={!isReady || !Panel}
				title={!Panel
					? 'Inline links require config.panelComponent.'
					: sourceState?.status === 'error'
						? sourceState.message
						: isReady ? `View source: ${item.target}` : 'Loading source…'}
				aria-haspopup="dialog"
				onClick={() => store.popupOpen(item.target)}
			>
				<span lang={titleItem.language || undefined}>{titleItem.text}</span>
				<LogOut
					className="doc-index-inline-link-icon"
					aria-hidden="true"
					width={13}
					height={13}
				/>
			</button>
			<CodeBlockCompactPopup Panel={Panel} sourceStore={sourceStore} store={store} />
		</div>
	);
});

export { IndexItem };
