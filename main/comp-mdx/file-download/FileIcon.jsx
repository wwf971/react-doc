export function FileIcon({ data = {} }) {
	const style = data.color ? { color: data.color } : undefined;
	return (
		<svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className="file-download-icon-svg" style={style}>
			<path d="M12 8 L12 56 L52 56 L52 20 L40 8 Z" className="file-download-icon-body" />
			<path d="M40 8 L40 20 L52 20" className="file-download-icon-fold" />
			<path d="M18 28 H46 M18 34 H42 M18 40 H46 M18 46 H38" className="file-download-icon-lines" />
		</svg>
	);
}