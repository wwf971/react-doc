import { isValidElement, useEffect, useRef } from 'react';
import { Move, Pencil } from '../../frontend/UICommon.js';
import { TagList } from '../../comp-mdx/tag/TagList.jsx';
import './SidePanelItem.css';

// Default side-panel item label: the item text, followed by the tags of the
// asset the item is bound to. Registered as common/SidePanelItem under the
// built-in name SidePanelItem; mapping that name in compRegistry replaces it.
//
//   data.text            the label, a plain string in the selected language;
//                        the text the label is edited as
//   data.textDisplay     optional: what is shown in place of data.text
//                        outside editing (a custom renderer's decorated
//                        label: icons, file names), never edited
//   data.textLanguage    language of data.text, '' for a plain-string label
//   data.textMessage     '' or the diagnostic of an invalid authored text
//   data.tagList         resolved tags [{ id, compName, data }], unfiltered
//   data.kind            separator | folder | folder-file | file | panel | inline
//   data.itemDeclared    the side-panel yaml node, without children; its
//                        "text" is authored data and can be a language mapping
//   config.surface       sidebar | breadcrumb | footer | tocPopover
//   config.configGlobal  page-level config, see doc_page_impl_config.md
//                          TagsDisplayAtSidePanelItemIsOn     show tags at all
//                          TagsDisplayAtSidePanelItemsList    tag ids to show, null = all
//   config.isTagOverviewAvailable  clicking a tag may open the tag overview
//   config.tagService, config.configService   queries
//   config.isTextEditable    edit mode: the label may be edited in place
//   config.textEditStatus    '' | editing | submitting | error, for this
//                            rendering of the label (SidePanelItemHost)
//   config.textEditMessage   why the last save failed
//   config.isMovable         edit mode: the item can be moved (dragged by its
//                            row, which the host handles, or placed through
//                            the move picker)
//
// Events emitted:
//   tagOverviewOpenRequest { tagId }      a tag was clicked
//   sidePanelTextEditStartRequest         the edit button of the label was clicked
//   sidePanelTextSubmitRequest { text }   the edited label (Enter, focus left)
//   sidePanelTextCancelRequest            the edit was dropped (Escape)
//   sidePanelItemMovePickerOpenRequest    the move button was clicked (with
//                                         the pointer, where the picker opens)
//
// The label is always inside the .doc-side-panel-item host, with or without
// tags. On the sidebar surface the host wraps long names onto more lines
// (SidePanelItem.css) instead of clipping them. A custom renderer that only
// changes how the label looks renders this component with its data and
// config, adding its markup as data.textDisplay and keeping data.text the
// plain label, so tags, wrapping, the lang attribute and editing stay. A
// label whose data.text is not a string (an element, from a renderer written
// before data.textDisplay) is displayed, and cannot be edited.
//
// Editing happens in the text span itself, made contenteditable, so the row
// keeps its size; the edit and move buttons sit in a zero-width anchor after
// the label, styled like block toolbar buttons, and are shown on hover, so
// entering and leaving edit mode moves nothing. The label is inside the
// sidebar link or folder button: both stop their pointer events from
// reaching it, and the editor keeps its keys from activating it (Space types
// a space without toggling the folder, Enter saves without following the
// link, Escape drops the edit).
export function SidePanelItem({ data = {}, config = {}, onEvent }) {
  const tagList = sidePanelItemTagListShownGet(data, config);
  const isTextInvalid = Boolean(data.textMessage);
  const textEditStatus = config.textEditStatus ?? '';
  const isTextEditing = textEditStatus === 'editing' || textEditStatus === 'submitting';
  const isTextEditFailed = textEditStatus === 'error';
  const isTextPlain = typeof data.text === 'string';
  const titleText = isTextInvalid ? data.textMessage : (isTextEditFailed ? config.textEditMessage : undefined);
  const isEditButtonShown = config.isTextEditable === true && isTextPlain && !isTextEditing;
  const isMoveButtonShown = config.isMovable === true && !isTextEditing;
  return (
    <span className="doc-side-panel-item" data-surface={config.surface ?? 'sidebar'}>
      {isTextEditing ? (
        <SidePanelItemTextEdit
          key="edit"
          text={isTextPlain ? data.text : ''}
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
          {data.textDisplay ?? textRenderableGet(data.text)}
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
      {isEditButtonShown || isMoveButtonShown ? (
        <span className="doc-side-panel-item-edit">
          <span className="doc-side-panel-item-edit-group">
            {isEditButtonShown ? (
              <button
                type="button"
                className="doc-button-icon doc-side-panel-item-edit-button"
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
            ) : null}
            {isMoveButtonShown ? (
              <button
                type="button"
                className="doc-button-icon doc-side-panel-item-edit-button"
                title="Move this item (or drag its row)"
                aria-label="Move this item"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onEvent?.('sidePanelItemMovePickerOpenRequest', {}, { point: event });
                }}
              >
                <Move aria-hidden="true" className="doc-side-panel-item-edit-icon" size={11} strokeWidth={2} />
              </button>
            ) : null}
          </span>
        </span>
      ) : null}
    </span>
  );
}

// the text span while its label is edited: the same span, contenteditable.
// uncontrolled while typing; Enter and leaving focus submit, Escape drops.
// a button activates on the key-up of Space and Enter: the key-up is kept
// from the folder button around the label, while the key-down still types.
function SidePanelItemTextEdit({ text, language, isLocked, onEvent }) {
  const elementRef = useRef(null);
  const isCancelRef = useRef(false);

  // the label is written once, then the caret goes to its end
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.textContent = text;
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

  const keyUpHandle = (event) => {
    event.stopPropagation();
    if (event.nativeEvent?.isComposing) return;
    if (event.key === ' ' || event.key === 'Enter') event.preventDefault();
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
      onKeyUp={keyUpHandle}
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

// a renderer written before data.textDisplay may pass an element as
// data.text; a plain object, such as an authored language mapping passed by
// mistake, is not renderable
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
