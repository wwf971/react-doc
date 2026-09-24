import { useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { DocsBody, DocsDescription, DocsTitle } from '#react-doc/frontend/UICommon.js';
import { buildMdxComps } from '#react-doc/frontend/src/lib/mdx-comps.js';
import { useDocStores } from '#react-doc/frontend/src/store/context.js';
import { DocLanguageProvider } from '../multi-lang/MultiLangContext.jsx';
import './SourceLink.css';

// render-mode popup for SourceLink: shows the compiled document instead of its
// source text. the target is compiled through the normal DocSourceStore
// pipeline; components inside the popup receive the target as their source
// path so registered-component configuration and identity stay scoped to it.
const SourceLinkRenderPopup = observer(function SourceLinkRenderPopup({ Panel, store }) {
	const { compById, docStore, sourceStore } = useDocStores();
	const pathPopup = store.pathPopup;
	const compiled = pathPopup ? sourceStore.compiledByPath[pathPopup] : undefined;
	const entryPopup = pathPopup ? sourceStore.entryByInternalPath.get(pathPopup) : undefined;
	const mdxComps = useMemo(
		() => buildMdxComps(sourceStore.configDoc, compById, { sourcePath: pathPopup }),
		[compById, pathPopup, sourceStore.configDoc],
	);

	useEffect(() => {
		if (!store.isPopupOpen) return undefined;
		const keyDownHandle = (event) => {
			if (event.key === 'Escape') store.popupClose();
		};
		window.addEventListener('keydown', keyDownHandle);
		return () => window.removeEventListener('keydown', keyDownHandle);
	}, [store, store.isPopupOpen]);

	if (!Panel || !store.isPopupOpen || compiled?.status !== 'done') return null;

	const Body = compiled.Body;
	return (
		<Panel
			data={{ title: entryPopup?.name ?? pathPopup }}
			config={{
				isPopup: true,
				isCloseVisible: true,
				className: 'doc-code-block-compact-popup doc-source-link-render-popup',
				bodyClassName: 'doc-source-link-render-popup-body',
			}}
			content={(
				<DocLanguageProvider language={docStore.languageSelected || compiled.language}>
					<div className="doc-source-link-render-doc" data-doc-content="">
						{compiled.titleFrontmatter
							? <DocsTitle className="doc-page-title">{compiled.titleFrontmatter}</DocsTitle>
							: null}
						{compiled.description
							? <DocsDescription className="doc-page-description">{compiled.description}</DocsDescription>
							: null}
						<DocsBody>
							{compiled.isContentEmpty
								? <p className="doc-content-empty">This Markdown file is empty. Content can be added later.</p>
								: <Body components={mdxComps} />}
						</DocsBody>
					</div>
				</DocLanguageProvider>
			)}
			onEvent={(eventType) => {
				if (eventType === 'closeRequest') store.popupClose();
			}}
		/>
	);
});

export { SourceLinkRenderPopup };
export default SourceLinkRenderPopup;
