import { DocLink } from '../../frontend/src/comp-doc/DocLink.jsx';
import { useDocStores } from '../../frontend/src/store/context.js';
import './ref-card.css';

function CardLink({ data = {} }) {
	const { docStore } = useDocStores();
	const type = data.type === 'compact' ? 'compact' : 'full';
	const style = data.backgroundColor
		? { '--doc-mdx-card-background': data.backgroundColor }
		: undefined;

	return (
		<div className={`doc-mdx-card-link is-${type}`} style={style}>
			<DocLink target={data.target ?? ''} from={docStore.docCurrentPath} kind="card">
				<span className="doc-mdx-card-link-content">
					{data.title ? <strong>{data.title}</strong> : null}
					{type === 'full'
						? (data.description ? <span>{data.description}</span> : data.content)
						: null}
				</span>
			</DocLink>
		</div>
	);
}

export { CardLink };
