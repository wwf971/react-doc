import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Image } from '../image/Image.jsx';
import { ImageGridStore } from './ImageGridStore.js';
import './ImageGrid.css';

const ImageGrid = observer(function ImageGrid({ data = {}, config = {}, onEvent }) {
	const [store] = useState(() => new ImageGridStore(data));
	const source = data.raw ?? data;

	useEffect(() => {
		store.dataLoad(data);
	}, [source, store]);

	if (store.message) {
		return (
			<div className="doc-image-grid-error" role="alert">
				<strong>Failed to render image grid.</strong>
				<span>{store.message}</span>
			</div>
		);
	}

	const style = {
		'--doc-image-grid-gap': sizeCssGet(store.options.gap) ?? '0.75rem',
		'--doc-image-grid-item-width': sizeCssGet(store.options.itemWidth) ?? '16rem',
	};

	return (
		<div className="doc-image-grid" style={style}>
			{store.imageList.map((image, index) => (
				<div className="doc-image-grid-item" key={image.id ?? `${image.src ?? image.source}:${index}`}>
					<Image
						data={image}
						config={{
							assetUrlGet: config.assetUrlGet,
							displayMode: image.displayMode,
							height: image.height,
							width: '100%',
						}}
						onEvent={(eventType, eventData) => onEvent?.(`image:${eventType}`, {
							...eventData,
							imageIndex: index,
						})}
					/>
				</div>
			))}
		</div>
	);
});

function sizeCssGet(value) {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value === 'number') return value >= 0 ? `${value}px` : undefined;
	const valueTrimmed = String(value).trim();
	if (/^\d+(?:\.\d+)?$/.test(valueTrimmed)) return `${valueTrimmed}px`;
	if (/^\d+(?:\.\d+)?(?:px|rem|em|vw|%)$/.test(valueTrimmed)) return valueTrimmed;
	return undefined;
}

export { ImageGrid, ImageGrid as DocImageGrid };