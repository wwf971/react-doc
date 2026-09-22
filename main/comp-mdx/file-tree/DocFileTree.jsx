import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { FileIcon, FolderIcon, FolderOpenIcon } from '#react-doc/frontend/UICommon.js';
import { DocFileTreeStore } from './DocFileTreeStore.js';
import './DocFileTree.css';

// file tree display independent of fumadocs. authored input:
//
//   <DocFileTree
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
const DocFileTree = observer(function DocFileTree({ data = {} }) {
	const [store] = useState(() => new DocFileTreeStore(data));
	const sourceKey = data.raw ?? JSON.stringify(data.tree ?? null) + String(data.maxHeight ?? '');

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
	return (
		<div
			className={`not-prose doc-file-tree${heightCss ? ' doc-file-tree-height-fixed' : ''}`}
			style={heightCss ? { height: heightCss } : undefined}
		>
			{store.nodeList.map((node) => (
				<FileTreeNode key={node.key} node={node} store={store} />
			))}
		</div>
	);
});

const FileTreeNode = observer(function FileTreeNode({ node, store }) {
	if (!node.isFolder) {
		return (
			<div className="doc-file-tree-row">
				<FileIcon className="doc-file-tree-icon" />
				<span className="doc-file-tree-name">{node.name}</span>
			</div>
		);
	}

	const isOpen = store.folderIsOpen(node.key);
	return (
		<div className="doc-file-tree-folder">
			<div
				className="doc-file-tree-row doc-file-tree-row-folder"
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
				{isOpen
					? <FolderOpenIcon className="doc-file-tree-icon" />
					: <FolderIcon className="doc-file-tree-icon" />}
				<span className="doc-file-tree-name">{node.name}</span>
			</div>
			<div className={`doc-file-tree-children-clip${isOpen ? ' doc-file-tree-children-open' : ''}`}>
				<div className="doc-file-tree-children">
					{node.children.map((nodeChild) => (
						<FileTreeNode key={nodeChild.key} node={nodeChild} store={store} />
					))}
				</div>
			</div>
		</div>
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

export { DocFileTree };
