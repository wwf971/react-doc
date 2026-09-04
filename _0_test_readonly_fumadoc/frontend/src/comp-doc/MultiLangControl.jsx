import { observer } from 'mobx-react-lite';
import { useDocStores } from '../store/context.js';
import './MultiLangControl.css';

export const MultiLangControl = observer(function MultiLangControl() {
  const { componentConfig, docStore } = useDocStores();
  const SegmentedControl = componentConfig.SegmentedControl;
  const languageList = docStore.languageListCurrent;
  if (!SegmentedControl || languageList.length === 0) return null;

  return (
    <div className="multi-lang-control" role="group" aria-label="Document language">
      <SegmentedControl
        data={{
          valueSelected: docStore.languageSelected,
          segList: languageList.map((language) => ({ value: language, labelText: language })),
        }}
        config={{
          classNameTrack: 'multi-lang-segments',
          isInitialAnimationEnabled: true,
          widthModeSegment: 'auto',
        }}
        onEvent={(eventType, eventData) => {
          if (eventType === 'valueSelectedChange') {
            docStore.setLanguageSelected(eventData.valueSelected);
          }
        }}
      />
    </div>
  );
});