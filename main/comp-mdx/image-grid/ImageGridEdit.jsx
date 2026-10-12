import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Plus, X } from '../../frontend/UICommon.js';
import { EditActions } from '../../comp-doc/edit/EditActions.jsx';
import { EditFloatingPanel } from '../../comp-doc/edit/EditFloatingPanel.jsx';
import { EditValueInline } from '../../comp-doc/edit/EditValueInline.jsx';
import { Image } from '../image/Image.jsx';
import { ImageGridRender, imageSlotConfigBuild } from './ImageGrid.jsx';
import { imageGridEditFieldList, ImageGridEditStore } from './ImageGridEditStore.js';
import './ImageGrid.css';

// The 'images' edit mode of ImageGrid. The grid stays in the flow, rendered
// from the draft by the same ImageGridRender the document body uses, so it
// does not move when editing starts; each slot is an Image bound to the
// draft, so a pasted image becomes the source of that slot without the
// block being rewritten, and a small floating button removes the slot. The
// layout fields (gap, itemWidth) and "add image" are in the floating bar
// above the grid (doc_page_impl_edit.md#no-jitter-rule). Every change is
// reported to the edit layer as the new yaml, so leaving the block saves it.
//
// what this mode is for: a reader who clicks a grid in edit mode wants to
// paste or arrange images, not to see yaml; the yaml is the built-in
// 'source' mode of the block, one entry away in the mode menu.
//
//   data                     the block as authored (raw yaml or fields)
//   config.edit.session      status / message of the pending change request
//
// events (handled by the edit layer):
//   editDraftChange { raw }
//   editSubmitRequest
//   editCancelRequest
export const ImageGridEdit = observer(function ImageGridEdit({ data = {}, config = {}, onEvent }) {
	const [store] = useState(() => new ImageGridEditStore(data));
	const session = config.edit?.session ?? {};
	const isLocked = session.status === 'submitting';

	// a change of the draft: applied to the store, then reported as the yaml
	// the block would be saved as
	const draftChange = (change) => {
		change();
		void onEvent?.('editDraftChange', { raw: store.rawYaml });
	};
	const submitRequest = () => {
		if (isLocked) return;
		void onEvent?.('editSubmitRequest');
	};
	const cancelRequest = () => {
		if (isLocked) return;
		void onEvent?.('editCancelRequest');
	};

	// what a slot reports: the file of a paste is written by the source
	// layer as usual; the pasted source goes to the draft (onSourcePaste),
	// so no slot asks for the block to be rewritten
	const slotEventHandle = (index) => (eventType, eventData, eventContext) => {
		if (eventType === 'fileCreateRequest') return onEvent?.(eventType, eventData, eventContext);
		return onEvent?.(`image:${eventType}`, { ...eventData, imageIndex: index }, eventContext);
	};

	return (
		<>
			<ImageGridRender
				imageList={store.imageList}
				options={store.options}
				slotRender={(image, index) => (
					<>
						<Image
							data={image}
							config={imageSlotConfigBuild({ ...config, blockIndex: undefined }, image)}
							onEvent={slotEventHandle(index)}
							onSourcePaste={(sourcePath) => draftChange(() => store.imageSourceSet(index, sourcePath))}
						/>
						<button
							type="button"
							className="doc-image-grid-slot-remove not-prose"
							title="Remove this image from the grid"
							aria-label="Remove this image from the grid"
							disabled={isLocked}
							onClick={() => draftChange(() => store.imageRemove(index))}
						>
							<X size={12} aria-hidden="true" />
						</button>
					</>
				)}
			/>
			<EditFloatingPanel
				label="ImageGrid"
				head={(
					<>
						<button
							type="button"
							className="doc-edit-action"
							disabled={isLocked}
							onClick={() => draftChange(() => store.imageAdd())}
						>
							<Plus size={12} aria-hidden="true" />
							<span>Add image</span>
						</button>
						{imageGridEditFieldList.map((name) => (
							<label key={name} className="doc-image-grid-edit-field">
								<span className="doc-image-grid-edit-field-name">{name}</span>
								<EditValueInline
									value={store.fields[name] === undefined ? '' : String(store.fields[name])}
									placeholder="(default)"
									isLocked={isLocked}
									onCommit={(value) => draftChange(() => store.fieldSet(name, value))}
								/>
							</label>
						))}
						{store.message ? <span className="doc-edit-message" role="alert">{store.message}</span> : null}
					</>
				)}
				actions={(
					<EditActions status={session.status} message={session.message} onSubmit={submitRequest} onCancel={cancelRequest} />
				)}
			/>
		</>
	);
});
