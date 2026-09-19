import { observer } from 'mobx-react-lite';
import { DocNavigationButtons } from './DocNavigationButtons.jsx';
import { MultiLangControl } from '../../../comp-mdx/multi-lang/MultiLangControl.jsx';
import './DocPageToolbar.css';

export const DocPageToolbar = observer(function DocPageToolbar() {
  return (
    <div className="doc-page-toolbar" role="toolbar" aria-label="Document actions">
      <DocNavigationButtons />
      <MultiLangControl />
    </div>
  );
});