import { isValidElement, useEffect, useRef } from 'react';
import { Pencil } from '../../frontend/UICommon.js';
import { TagList } from '../../comp-mdx/tag/TagList.jsx';
import './SidePanelItem.css';

// Default side-panel item label: the item text, followed by the tags of the
// asset the item is bound to. Registered as common/SidePanelItem under the
// built-in name SidePanelItem; mapping that name in compRegistry replaces it.
//
//   data.text            display text, already a string in the selected language
//   data.textLanguage    language of data.text, '' for a plain-string label
//   data.textMessage     '' or the diagnostic of an invalid authored text
//   data.tagList         resolved tags [{ id, compName, data }], unfiltered
//   data.kind            separator | folder | folder-file | file | panel | inline
//   data.itemDeclared    the side-panel yaml node, without children; its
//                        "text" is authored data and can be a language mapping
//   config.surface       sidebar | breadcrumb | footer
//   config.configGlobal  page-level config, see doc_page_impl_config.md
//                          TagsDisplayAtSidePanelItemIsOn     show tags at all
//                          TagsDisplayAtSidePanelItemsList    tag ids to show, null = all
//   config.isTagOverviewAvailable  clicking a tag may open the tag overview
//   config.tagService, config.configService   queries
//   config.isTextEditable    edit mode: the label may be edited in place
//   config.textEditStatus    '' | editing | submitting | error (SidePanelItemHost)
//   config.textEditMessage   why the last save failed
//
// Events emitted:
//   tagOverviewOpenRequest { tagId }      a tag was clicked
//   sidePanelTextEditStartRequest         the edit button of the label was clicked
//   sidePanelTextSubmitRequest { text }   the edited label (Enter, focus left)
//   sidePanelTextCancelRequest            the edit was dropped (Escape)
//
// The label is always inside the .doc-side-panel-item host, with or without
// tags. On the sidebar surface the host wraps long names onto more lines
// (SidePanelItem.css) instead of clipping them. A custom renderer that only
// changes the label should pass it as data.text to this component, which
// keeps tags, wrapping, and the lang attribute.
//
// Editing happens in the text span itself, made contenteditable, so the row
// keeps its size; the edit button sits in a zero-width anchor after the
// label, styled like a block toolbar button, and is shown on hover, so
// entering and leaving edit mode moves nothing. Both stop their pointer
// events from reaching the sidebar link or folder trigger around them.
export function SidePanelItem({ data = {}, config = {}, onEvent }) {
  const tagList = sidePanelItemTagListShownGet(data, config);
  const isTextInvalid = Boolean(data.textMessage);
  const textEditStatus = config.textEditStatus ?? '';
  const isTextEditing = textEditStatus === 'editing' || textEditStatus === 'submitting';
  const isTextEditFailed = textEditStatus === 'error';
  const titleText = isTextInvalid ? data.textMessage : (isTextEditFailed ? config.textEditMessage : undefined);
  return (
    <span className="doc-side-panel-item" data-surface={config.surface ?? 'sidebar'}>
      {isTextEditing ? (
        <SidePanelItemTextEdit
          key="edit"
          text={textRenderableGet(data.text)}
          language={data.textLanguage}
          isLocked={textEditStatus === 'submitting'}
          onEvent={onEvent}
        />
      ) : (
        <span
          key="view"
          className={`doc-side-panel-item-text${isTextInvalid ? ' is-invalid' : ''}`}
          data-edit-status={isTextEditFailed ? 'error' : undefined}
          lang={data.textLanguage || undefined}
          title={titleText}
        >
          {textRenderableGet(data.text)}
        </span>
      )}
      {tagList.length > 0 ? (
        <TagList
          data={{ tagList }}
          config={{ instanceId: config.instanceId, isClickable: config.isTagOverviewAvailable === true }}
          onEvent={(eventType, eventData) => {
            if (eventType === 'tagActivateRequest') onEvent?.('tagOverviewOpenRequest', { tagId: eventData.tagId });
          }}
        />
      ) : null}
      {config.isTextEditable && !isTextEditing ? (
        <span className="doc-side-panel-item-edit">
          <button
            type="button"
            className="doc-side-panel-item-edit-button"
            title="Edit this label"
            aria-label="Edit this label"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onEvent?.('sidePanelTextEditStartRequest');
            }}
          >
            <Pencil aria-hidden="true" className="doc-side-panel-item-edit-icon" size={11} strokeWidth={2} />
          </button>
        </span>
      ) : null}
    </span>
  );
}

// the text span while its label is edited: the same span, contenteditable.
// uncontrolled while typing; Enter and leaving focus submit, Escape drops.
function SidePanelItemTextEdit({ text, language, isLocked, onEvent }) {
  const elementRef = useRef(null);
  const isCancelRef = useRef(false);
  const textValue = typeof text === 'string' ? text : '';

  // the label is written once, then the caret goes to its end
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.textContent = textValue;
    element.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const keyDownHandle = (event) => {
    event.stopPropagation();
    if (event.nativeEvent?.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      isCancelRef.current = true;
      event.currentTarget.blur();
    }
  };

  const blurHandle = (event) => {
    if (isCancelRef.current) {
      isCancelRef.current = false;
      onEvent?.('sidePanelTextCancelRequest');
      return;
    }
    onEvent?.('sidePanelTextSubmitRequest', { text: event.currentTarget.textContent.replace(/\n/g, ' ') });
  };

  return (
    <span
      ref={elementRef}
      className="doc-side-panel-item-text"
      data-edit-status={isLocked ? 'submitting' : 'editing'}
      lang={language || undefined}
      role="textbox"
      contentEditable={isLocked ? 'false' : 'plaintext-only'}
      suppressContentEditableWarning
      spellCheck={false}
      onBlur={blurHandle}
      onKeyDown={keyDownHandle}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDragStart={(event) => event.preventDefault()}
      onPaste={(event) => {
        event.preventDefault();
        document.execCommand('insertText', false, (event.clipboardData?.getData('text/plain') ?? '').replace(/\n/g, ' '));
      }}
    />
  );
}

// a custom renderer may pass an element as data.text; a plain object, such as
// an authored language mapping passed by mistake, is not renderable
function textRenderableGet(text) {
  if (text && typeof text === 'object' && !Array.isArray(text) && !isValidElement(text)) return '';
  return text;
}

function sidePanelItemTagListShownGet(data, config) {
  if (config.surface !== 'sidebar' || !Array.isArray(data.tagList)) return [];
  const configGlobal = config.configGlobal ?? {};
  if (configGlobal.TagsDisplayAtSidePanelItemIsOn === false) return [];
  const tagIdListShown = configGlobal.TagsDisplayAtSidePanelItemsList;
  if (!Array.isArray(tagIdListShown)) return data.tagList;
  return data.tagList.filter((tag) => tagIdListShown.includes(tag.id));
}
