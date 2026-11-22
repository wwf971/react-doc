import { useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { DocsBody, DocsDescription, DocsTitle } from '../../../main/frontend/UICommon.js';
import { buildMdxComps } from '../../../main/frontend/src/lib/mdx-comps.js';
import { useDocStores } from '../../../main/frontend/src/store/context.js';
import { DocLanguageProvider } from '../multi-lang/MultiLangContext.jsx';
import { DocPopupBody } from '../../../main/comp-doc/edit/DocPopupBody.jsx';
import { DocHistoryButtons } from '../../../main/comp-doc/edit/DocHistoryButtons.jsx';
import './SourceLink.css';

// render-mode popup for SourceLink: shows the compiled document instead of its
// source text, and edits it in edit mode where the page can write it
// (DocPopupBody: the edit body of the document, as on the page). the target is compiled through the normal DocSourceStore
// pipeline; components inside the popup receive the target as their source
// path so registered-component configuration and identity stay scoped to it.
const SourceLinkRenderPopup = observer(function SourceLinkRenderPopup({ Panel, store }) {
	const { compById, docStore, editStore, sourceStore } = useDocStores();
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
			// an editor of the document in the popup takes Escape first (cancel)
			if (event.key === 'Escape' && !event.defaultPrevented) store.popupClose();
		};
		window.addEventListener('keydown', keyDownHandle);
		return () => window.removeEventListener('keydown', keyDownHandle);
	}, [store, store.isPopupOpen]);

	if (!Panel || !store.isPopupOpen || compiled?.status !== 'done') return null;

	const Body = compiled.Body;
	// the document edited here has its own history, the one it has wherever it is edited
	// (doc_page_impl_edit_history.md)
	const isEdited = Boolean(editStore?.isEditMode && editStore.docIsEditable(pathPopup));
	return (
		<Panel
			data={{ title: <span>{entryPopup?.name ?? pathPopup}</span> }}
			headerRightContent={isEdited ? (
				<span className="doc-block-popup-head not-prose"><DocHistoryButtons path={pathPopup} variant="header" /></span>
			) : undefined}
			config={{
				isPopup: true,
				isCloseVisible: true,
				// a popup of the edit layer: a click in it is not a click on the block it belongs to
				className: 'doc-code-block-compact-popup doc-source-link-render-popup doc-edit-popup',
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
							{/* in edit mode, where the page can write it, the document is edited here */}
							<DocPopupBody path={pathPopup}>
								{compiled.isContentEmpty
									? <p className="doc-content-empty">This Markdown file is empty. Content can be added later.</p>
									: <Body components={mdxComps} />}
							</DocPopupBody>
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
