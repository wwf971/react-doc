import { observer } from 'mobx-react-lite';
import { useDocLanguage } from '../multi-lang/MultiLangContext.jsx';
import { useDocStores } from '../../frontend/src/store/context.js';
import { textLocalizedGet } from './DocIndexData.js';
import { IndexTitleSubtopicsItemsHorizontalWrap } from './IndexTitleSubtopicsItemsHorizontalWrap.jsx';
import { IndexTitleSubtopicsItemsVerticalList } from './IndexTitleSubtopicsItemsVerticalList.jsx';

const componentByLayout = {
	'horizontal-wrap': IndexTitleSubtopicsItemsHorizontalWrap,
	'vertical-list': IndexTitleSubtopicsItemsVerticalList,
};

const IndexTitleSubtopicsItems = observer(function IndexTitleSubtopicsItems({
	data = {},
	config = {},
	onEvent,
}) {
	const { docStore } = useDocStores();
	const languagePreferred = useDocLanguage();
	const title = textLocalizedGet(data.title, languagePreferred);
	const ComponentLayout = componentByLayout[data.layout];
	const SegmentedControl = config.SegmentedControl;
	const isDisplayModeControlVisible = Boolean(
		config.isDisplayModeControlEnabled
		&& SegmentedControl
		&& Array.isArray(config.displayModeSegList)
	);
	const isPartIndexPlacement = config.placement === 'partIndex';

	if (!ComponentLayout) {
		return (
			<div className="doc-index-error" role="alert">
				<strong>Failed to render document index.</strong>
				<span>Unsupported title-subtopics-items layout: {String(data.layout)}</span>
			</div>
		);
	}

	return (
		<nav
			className={`doc-index-title-subtopics-items is-layout-${data.layout}${isPartIndexPlacement ? ' is-placement-part-index' : ''}`}
			aria-label={title.text}
		>
			<div className="doc-index-title-subtopics-items-content">
				<div className="doc-index-title-line">
					<div className="doc-index-title" lang={title.language || undefined}>
						<span className={config.isPartRootCurrent ? 'is-current-part-root' : undefined}>
							{title.text}
						</span>
					</div>
					{isDisplayModeControlVisible ? (
						<SegmentedControl
							data={{
								valueSelected: config.displayMode,
								segList: config.displayModeSegList,
							}}
							config={{
								classNameTrack: 'doc-index-display-mode-segments',
								isInitialAnimationEnabled: true,
								widthModeSegment: 'auto',
							}}
							onEvent={(eventType, eventData) => {
								if (eventType === 'valueSelectedChange') {
									onEvent?.('displayModeChange', { displayMode: eventData.valueSelected });
								}
							}}
						/>
					) : null}
				</div>
				<ComponentLayout
					data={data}
					config={config}
					docStore={docStore}
					languagePreferred={languagePreferred}
					onEvent={onEvent}
				/>
			</div>
		</nav>
	);
});

export { IndexTitleSubtopicsItems };
