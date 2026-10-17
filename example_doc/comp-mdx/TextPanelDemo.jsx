import { createPortal } from 'react-dom';
import { MaximizeIcon, RestoreIcon } from '@wwf971/react-comp-misc';
import { X } from '../../main/frontend/UICommon.js';
import './TextPanelDemo.css';

// minimal popup panel for the demo app. an embedding host supplies its own
// panel implementation through config.panelComponent; this demo panel only
// implements the popup contract used by CodeBlockCompactPopup,
// SourceLinkRenderPopup and the block popup: data.title, config.className /
// config.bodyClassName, headerRightContent, content, the closeRequest event,
// and, with config.isExpandVisible, a maximize / restore button that asks
// for config.isExpanded to change (expandChangeRequest { isExpanded }).
export function TextPanelDemo({ data = {}, config = {}, headerRightContent, content, onEvent }) {
	const panel = (
		<section
			className={`text-panel${config.isPopup ? ' is-popup' : ''}${config.isExpanded ? ' is-expanded' : ''}${config.className ? ` ${config.className}` : ''} doc-text-panel-demo`}
			role={config.isPopup ? 'dialog' : undefined}
			aria-modal={config.isPopup ? 'true' : undefined}
			aria-label={typeof data.title === 'string' ? data.title : undefined}
			onMouseDown={(event) => event.stopPropagation()}
		>
			<header className="doc-text-panel-demo-header">
				<h2>{data.title}</h2>
				<div className="doc-text-panel-demo-header-actions">
					{headerRightContent}
					{config.isExpandVisible ? (
						<button
							type="button"
							title={config.isExpanded ? '元のサイズに戻す' : '最大化'}
							aria-label={config.isExpanded ? '元のサイズに戻す' : '最大化'}
							onClick={() => onEvent?.('expandChangeRequest', { isExpanded: !config.isExpanded })}
						>
							{config.isExpanded ? <RestoreIcon width={16} height={16} /> : <MaximizeIcon width={16} height={16} />}
						</button>
					) : null}
					{config.isCloseVisible ? (
						<button type="button" title="閉じる" aria-label="閉じる" onClick={() => onEvent?.('closeRequest')}>
							<X size={16} />
						</button>
					) : null}
				</div>
			</header>
			<div className={`doc-text-panel-demo-body${config.bodyClassName ? ` ${config.bodyClassName}` : ''}`}>
				{content}
			</div>
		</section>
	);
	if (!config.isPopup) return panel;
	return createPortal(
		<div className={`doc-text-panel-demo-overlay${config.isExpanded ? ' is-expanded' : ''}`} onMouseDown={() => onEvent?.('closeRequest')}>
			{panel}
		</div>,
		document.body,
	);
}
