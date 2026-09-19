import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DocImage } from '../image/DocImage.jsx';
import { DocImageGridStore } from './DocImageGridStore.js';
import './DocImageGrid.css';

const DocImageGrid = observer(function DocImageGrid({ data = {}, config = {}, onEvent }) {
	const [store] = useState(() => new DocImageGridStore(data));
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
					<DocImage
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

export { DocImageGrid };