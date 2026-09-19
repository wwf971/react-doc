import { observer } from 'mobx-react-lite';
import { textLocalizedGet } from './DocIndexData.js';
import { IndexSubtopicContent } from './IndexSubtopicContent.jsx';

const IndexTitleSubtopicsItemsHorizontalWrap = observer(function IndexTitleSubtopicsItemsHorizontalWrap({
	data = {},
	config = {},
	docStore,
	languagePreferred,
}) {
	return (
		<div className="doc-index-subtopic-list">
			{data.subtopics.map((subtopic, subtopicIndex) => {
				const titleSubtopic = textLocalizedGet(subtopic.title, languagePreferred);
				return (
					<div
						className="doc-index-subtopic"
						key={subtopic.id || `${titleSubtopic.text}-${subtopicIndex}`}
					>
						<div className="doc-index-subtopic-title" lang={titleSubtopic.language || undefined}>
							{titleSubtopic.text}
						</div>
						<IndexSubtopicContent
							config={config}
							docStore={docStore}
							languagePreferred={languagePreferred}
							subtopic={subtopic}
						/>
					</div>
				);
			})}
		</div>
	);
});

export { IndexTitleSubtopicsItemsHorizontalWrap };
