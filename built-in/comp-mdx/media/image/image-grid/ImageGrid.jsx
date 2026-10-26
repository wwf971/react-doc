import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Image } from '../image/Image.jsx';
import { ImageGridEdit } from './ImageGridEdit.jsx';
import { ImageGridStore } from './ImageGridStore.js';
import './ImageGrid.css';

// A grid of Image. Each slot is an Image with the grid's config passed
// down (doc page source service layer, component config, the block), so a slot takes a
// pasted image like a standalone Image does: the Image under the pointer
// handles the paste (image-grid-req.md#paste). The grid translates what a
// slot reports: fileCreateRequest passes through unchanged; a slot's
// dataReplaceRequest (the yaml of that one image) becomes the grid's own
// dataReplaceRequest with that slot replaced; every other report is
// prefixed "image:" with the slot index.
//
// in edit mode (config.isEdit, set by the edit layer) ImageGridEdit edits
// the slots in place: pastes go to its draft, slots are added and removed,
// the layout fields are in the floating bar. 'images' is the one edit mode
// ImageGrid exposes (image-grid-expose.js). the grid in the flow is the
// same ImageGridRender in both modes.
function ImageGrid({ data = {}, config = {}, onEvent }) {
	if (config.isEdit) return <ImageGridEdit data={data} config={config} onEvent={onEvent} />;
	return <ImageGridView data={data} config={config} onEvent={onEvent} />;
}

const ImageGridView = observer(function ImageGridView({ data = {}, config = {}, onEvent }) {
	const [store] = useState(() => new ImageGridStore(data));
	const source = data.raw ?? data;

	useEffect(() => {
		store.dataLoad(data);
	}, [source, store]);

	const slotEventHandle = (index) => (eventType, eventData, eventContext) => {
		if (eventType === 'fileCreateRequest') return onEvent?.(eventType, eventData, eventContext);
		if (eventType === 'dataReplaceRequest') {
			return onEvent?.('dataReplaceRequest', { raw: store.rawWithImageReplaced(index, eventData.raw) }, eventContext);
		}
		return onEvent?.(`image:${eventType}`, { ...eventData, imageIndex: index }, eventContext);
	};

	if (store.message) {
		return (
			<div className="doc-image-grid-error" role="alert">
				<strong>Failed to render image grid.</strong>
				<span>{store.message}</span>
			</div>
		);
	}

	return (
		<ImageGridRender
			imageList={store.imageList}
			options={store.options}
			slotRender={(image, index) => (
				<Image
					data={image}
					config={imageSlotConfigBuild(config, image)}
					onEvent={slotEventHandle(index)}
				/>
			)}
		/>
	);
});

// the grid layout of both modes: the slots in a wrapping row, each the
// grid's item width. slotRender(image, index) renders the content of a
// slot; the editor renders an Image bound to its draft and a remove button.
export function ImageGridRender({ imageList, options = {}, slotRender }) {
	const style = {
		'--doc-image-grid-gap': sizeCssGet(options.gap) ?? '0.75rem',
		'--doc-image-grid-item-width': sizeCssGet(options.itemWidth) ?? '16rem',
	};
	return (
		<div className="doc-image-grid" style={style}>
			{imageList.map((image, index) => (
				<div className="doc-image-grid-item" key={image.id ?? `${image.src ?? image.source ?? ''}:${index}`}>
					{slotRender(image, index)}
				</div>
			))}
		</div>
	);
}

// the config of one slot's Image: what the grid received from the page
// (doc page source service layer, component config, the asset the data is, the block), and
// the slot's own display values; a slot fills the width of its item
export function imageSlotConfigBuild(config, image) {
	return {
		assetUrlGet: config.assetUrlGet,
		source: config.source,
		compConfig: config.compConfig,
		assetInfo: config.assetInfo,
		blockIndex: config.blockIndex,
		displayMode: image.displayMode,
		height: image.height,
		width: '100%',
	};
}

function sizeCssGet(value) {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value === 'number') return value >= 0 ? `${value}px` : undefined;
	const valueTrimmed = String(value).trim();
	if (/^\d+(?:\.\d+)?$/.test(valueTrimmed)) return `${valueTrimmed}px`;
	if (/^\d+(?:\.\d+)?(?:px|rem|em|vw|%)$/.test(valueTrimmed)) return valueTrimmed;
	return undefined;
}

export { ImageGrid, ImageGrid as DocImageGrid };
