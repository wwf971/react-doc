import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { FileIcon, FolderIcon, FolderOpenIcon, ProjectIcon } from '#react-doc/frontend/UICommon.js';
import { RegisteredComp } from '#react-doc/comp-doc/registry/RegisteredComp.jsx';
import { FileTreeOverlay, FileTreeOverlayWarning } from './FileTreeOverlay.jsx';
import { FileTreeOverlayStore } from './FileTreeOverlayStore.js';
import { FileTreeStore } from './FileTreeStore.js';
import './FileTree.css';

// file tree display independent of fumadocs. authored input:
//
//   <FileTree
//     maxHeight="12rem"
//     tree={[
//       { name: 'src', defaultOpen: true, children: [{ name: 'index.js' }] },
//       { name: 'package.json' },
//     ]}
//   />
//
// or the degradation-compatible comment-block form with the same shape in yaml.
// when maxHeight is given, the component reserves exactly that height and
// scrolls inside, so folder toggling never changes the outer page layout.
//
// optional "annotations" (for example arrows between nodes) are drawn by
// FileTreeOverlay above the rows. FileTree only reserves a gutter column of
// the width the overlay asks for, and marks rows, names, and children clips
// with data attributes so the overlay can measure them.
const FileTree = observer(function FileTree({ data = {}, config = {} }) {
	const [store] = useState(() => new FileTreeStore(data));
	const [overlayStore] = useState(() => new FileTreeOverlayStore(store));
	const rootRef = useRef(null);
	const sourceKey = JSON.stringify([
		data.raw ?? null,
		data.tree ?? null,
		data.maxHeight ?? null,
		data.annotations ?? null,
		data.annotationStyle ?? null,
		data.dataRefResolved?.data ?? null,
	]);

	useEffect(() => {
		store.dataLoad(data);
		// reload only when the authored content changes, not on every render,
		// so folder open/closed ui state survives document re-renders.
	}, [sourceKey, store]); // eslint-disable-line react-hooks/exhaustive-deps

	if (store.message) {
		return (
			<div className="doc-file-tree-error" role="alert">
				<strong>Failed to render file tree.</strong>
				<span>{store.message}</span>
			</div>
		);
	}

	const heightCss = sizeCssGet(store.maxHeight);
	const isOverlayOn = overlayStore.annotationList.length > 0;
	const styleRoot = { '--doc-file-tree-gutter-width': `${overlayStore.gutterWidth}px` };
	if (heightCss) styleRoot.height = heightCss;
	return (
		<>
			<div
				ref={rootRef}
				className={`not-prose doc-file-tree${heightCss ? ' doc-file-tree-height-fixed' : ''}`}
				style={styleRoot}
				data-file-tree-root=""
			>
				{store.nodeList.map((node) => (
					<FileTreeNode
						key={node.key}
						node={node}
						store={store}
						instanceIdParent={config.instanceId}
					/>
				))}
				{isOverlayOn ? <FileTreeOverlay overlayStore={overlayStore} rootRef={rootRef} /> : null}
			</div>
			<FileTreeOverlayWarning overlayStore={overlayStore} />
		</>
	);
});

// the inner function must not be named FileTreeNode: inside a named function
// expression that name refers to the function itself, so nested <FileTreeNode>
// would render the unwrapped function, which never reacts to folder toggling.
const FileTreeNode = observer(function FileTreeNodeRender({ node, store, instanceIdParent }) {
	if (node.type === 'file') {
		return (
			<div className="doc-file-tree-row" data-file-tree-row-key={node.key}>
				<span className="doc-file-tree-main" data-file-tree-main="">
					<FileIcon className="doc-file-tree-icon" />
					<span className="doc-file-tree-name" data-file-tree-name="">{node.name}</span>
				</span>
				<FileTreeDescription node={node} instanceIdParent={instanceIdParent} />
			</div>
		);
	}

	const isOpen = store.folderIsOpen(node.key);
	return (
		<div className="doc-file-tree-folder">
			{/* the description column stays outside the toggle button, so links
			    and other controls inside a description never toggle the folder. */}
			<div className="doc-file-tree-row" data-file-tree-row-key={node.key}>
				<div
					className="doc-file-tree-main doc-file-tree-folder-toggle"
					data-file-tree-main=""
					role="button"
					tabIndex={0}
					aria-expanded={isOpen}
					onClick={() => store.folderToggle(node.key)}
					onKeyDown={(event) => {
						if (event.key !== 'Enter' && event.key !== ' ') return;
						event.preventDefault();
						store.folderToggle(node.key);
					}}
				>
					{nodeIconRender(node, isOpen)}
					<span className="doc-file-tree-name" data-file-tree-name="">{node.name}</span>
				</div>
				<FileTreeDescription node={node} instanceIdParent={instanceIdParent} />
			</div>
			<div
				className={`doc-file-tree-children-clip${isOpen ? ' doc-file-tree-children-open' : ''}`}
				data-file-tree-clip-key={node.key}
			>
				<div className="doc-file-tree-children">
					{node.children.map((nodeChild) => (
						<FileTreeNode
							key={nodeChild.key}
							node={nodeChild}
							store={store}
							instanceIdParent={instanceIdParent}
						/>
					))}
				</div>
			</div>
		</div>
	);
});

function nodeIconRender(node, isOpen) {
	if (node.type === 'project') return <ProjectIcon className="doc-file-tree-icon" />;
	if (isOpen) return <FolderOpenIcon className="doc-file-tree-icon" />;
	return <FolderIcon className="doc-file-tree-icon" />;
}

// description column of one row. a plain text description renders as-is;
// a { component, data, config } description renders through the registry
// with placement "fileTreeDescription". FileTree does not interpret the
// component's meaning; for example it never knows a description is a link.
const FileTreeDescription = observer(function FileTreeDescription({ node, instanceIdParent }) {
	if (!node.descriptionComponent && !node.descriptionText) return null;
	// one descriptionIndent unit equals one tree indent level (1rem), so a
	// shallow node's description can align with descriptions of deeper nodes.
	const styleIndent = node.descriptionIndent > 0
		? { paddingInlineStart: `${node.descriptionIndent}rem` }
		: undefined;
	return (
		<span className="doc-file-tree-description" style={styleIndent}>
			{node.descriptionComponent ? (
				<RegisteredComp
					compName={node.descriptionComponent.component}
					configRuntime={{
						instanceId: `${instanceIdParent ?? 'file-tree'}:description:${node.key}`,
					}}
					input={{
						config: node.descriptionComponent.config,
						data: node.descriptionComponent.data,
					}}
					placement="fileTreeDescription"
				/>
			) : node.descriptionText}
		</span>
	);
});

function sizeCssGet(value) {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value === 'number') return value >= 0 ? `${value}px` : undefined;
	const valueTrimmed = String(value).trim();
	if (/^\d+(?:\.\d+)?$/.test(valueTrimmed)) return `${valueTrimmed}px`;
	if (/^\d+(?:\.\d+)?(?:px|rem|em|vh|%)$/.test(valueTrimmed)) return valueTrimmed;
	return undefined;
}

export { FileTree, FileTree as DocFileTree };
