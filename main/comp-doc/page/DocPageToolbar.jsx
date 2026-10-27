import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { DocNavigationButtons } from './DocNavigationButtons.jsx';
import { MultiLangControl } from '../../../built-in/comp-mdx/multi-lang/MultiLangControl.jsx';
import { DocEditToggle } from '../edit/DocEditToggle.jsx';
import { DocEditDocControls } from '../edit/DocEditDocControls.jsx';
import './DocPageToolbar.css';

// The toolbar never shows a scrollbar. When it is wider than the page column,
// the host's ScrollHorizontal (config.components.ScrollHorizontal) clips it
// and moves it by the mouse wheel over it; the offset is DocStore.toolbarScrollLeft.
// Without that component the buttons wrap onto a second row instead.
export const DocPageToolbar = observer(function DocPageToolbar() {
  const { componentConfig, docStore } = useDocStores();
  const ScrollHorizontal = componentConfig.ScrollHorizontal;
  const content = (
    <>
      <DocNavigationButtons />
      <MultiLangControl />
      <DocEditToggle />
      <DocEditDocControls />
    </>
  );

  if (!ScrollHorizontal) {
    return (
      <div className="doc-page-toolbar is-wrap" role="toolbar" aria-label="Document actions">
        {content}
      </div>
    );
  }
  return (
    <div className="doc-page-toolbar-frame" role="toolbar" aria-label="Document actions">
      <ScrollHorizontal
        data={{ scrollLeft: docStore.toolbarScrollLeft, content }}
        config={{ classNameTrack: 'doc-page-toolbar' }}
        onEvent={(eventType, eventData) => {
          if (eventType === 'scrollLeftSet') docStore.toolbarScrollLeftSet(eventData.scrollLeft);
        }}
      />
    </div>
  );
});
