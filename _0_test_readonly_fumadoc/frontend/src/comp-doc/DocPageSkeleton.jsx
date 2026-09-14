import { Skeleton } from '../../UICommon.js';
import './DocPageSkeleton.css';

function DocPageSkeleton() {
	return (
		<div className="doc-page-skeleton" aria-busy="true" aria-label="Loading document">
			<span className="sr-only">Loading document</span>
			<Skeleton className="h-8 w-3/5 max-w-lg" />
			<Skeleton className="h-4 w-2/5 max-w-sm" />
			<div className="doc-page-skeleton-body">
				<div className="doc-page-skeleton-section">
					<Skeleton className="h-5 w-1/3 max-w-xs" />
					<Skeleton className="h-4 w-full" />
					<Skeleton className="h-4 w-11/12" />
					<Skeleton className="h-4 w-4/5" />
				</div>
				<Skeleton className="h-32 w-full" />
				<div className="doc-page-skeleton-section">
					<Skeleton className="h-5 w-2/5 max-w-sm" />
					<Skeleton className="h-4 w-5/6" />
					<Skeleton className="h-4 w-full" />
					<Skeleton className="h-4 w-3/4" />
				</div>
				<div className="doc-page-skeleton-card-row">
					<Skeleton className="h-28 w-full" />
					<Skeleton className="h-28 w-full" />
				</div>
				<div className="doc-page-skeleton-section">
					<Skeleton className="h-5 w-1/4 max-w-48" />
					<Skeleton className="h-4 w-full" />
					<Skeleton className="h-4 w-4/5" />
				</div>
			</div>
		</div>
	);
}

export { DocPageSkeleton };