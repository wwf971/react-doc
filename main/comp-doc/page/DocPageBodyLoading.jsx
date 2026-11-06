import { LoaderCircle } from '../../frontend/UICommon.js';

// What the body of a document shows until it is mounted: painted first, so a click on a
// document answers at once however long its components take to mount (DocPageView).
export function DocPageBodyLoading() {
	return (
		<div className="doc-page-body-loading" role="status" aria-busy="true">
			<LoaderCircle aria-hidden="true" size={18} className="doc-spin" />
			<span>Loading the document</span>
		</div>
	);
}
