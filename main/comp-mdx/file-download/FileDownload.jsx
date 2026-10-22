import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { RegisteredComp } from '../../comp-doc/registry/RegisteredComp.jsx';
import { compIdResolve } from '../../comp-doc/registry/comp-registry.js';
import { fileDownloadDataParse } from './FileDownloadData.js';
import './FileDownload.css';

// A file of the document source as a download card (data: FileDownloadData.js).
// The file is resolved like the src of an Image (config.assetUrlGet, the
// doc page source service layer by default). The icon is a registered component of placement
// fileDownloadIcon: data.icon, else config.iconByExtension[extension] (a host
// setting through compConfigHost), else config.iconFallback, by default
// common/FileIcon.
const iconIdFallbackDefault = 'common/FileIcon';

export const FileDownload = observer(function FileDownload({ data = {}, config = {} }) {
	const { compById, sourceStore } = useDocStores();
	let value;
	let errorMessage = '';
	try {
		value = fileDownloadDataParse(data);
	} catch (error) {
		errorMessage = String(error.message ?? error);
		value = {
			extension: '',
			fileName: 'Invalid download',
			icon: '',
			size: '',
			src: '',
			view: 'detailed',
		};
	}

	const sourceUrl = errorMessage ? '' : config.assetUrlGet?.(value.src);
	if (!sourceUrl && !errorMessage) errorMessage = `Download file not found: ${value.src}`;
	const iconName = value.icon || config.iconByExtension?.[value.extension] || '';
	const iconIdRequested = iconName ? compIdResolve(sourceStore.configDoc, iconName) : '';
	const iconId = compById[iconIdRequested] ? iconIdRequested : (config.iconFallback ?? iconIdFallbackDefault);
	const icon = (
		<span className="file-download-icon">
			<RegisteredComp
				compId={iconId}
				input={{ data: { extension: value.extension, fileName: value.fileName } }}
				placement="fileDownloadIcon"
			/>
		</span>
	);
	const content = value.view === 'compact' ? (
		<>
			{icon}
			<span className="file-download-name">{value.fileName}</span>
		</>
	) : (
		<>
			{icon}
			<span className="file-download-details">
				<span className="file-download-name" title={value.fileName}>{value.fileName}</span>
				<span className="file-download-size">{errorMessage || value.size || 'Download'}</span>
			</span>
		</>
	);
	const className = `file-download file-download-${value.view} not-prose`;

	if (errorMessage) {
		return (
			<span className={`${className} file-download-disabled`} role="alert" aria-disabled="true" title={errorMessage}>
				{content}
			</span>
		);
	}

	return (
		<a className={className} href={sourceUrl} download={value.fileName} title={value.fileName}>
			{content}
		</a>
	);
});
