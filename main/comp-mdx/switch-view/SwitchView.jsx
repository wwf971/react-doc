import { useId, useState } from 'react';
import { Grid2X2, ListIcon, PanelsTopLeft, Table2 } from '../../frontend/UICommon.js';
import { RegisteredComp } from '../../comp-doc/registry/RegisteredComp.jsx';
import { switchViewDataParse } from './SwitchViewData.js';
import './SwitchView.css';

const iconByName = { table: Table2, list: ListIcon, grid: Grid2X2 };

function SwitchView({ data = {}, config = {}, onEvent }) {
  let value;
  try {
    value = switchViewDataParse(data);
  } catch (error) {
    return <div role="alert">{String(error.message ?? error)}</div>;
  }
  return <SwitchViewPanel key={JSON.stringify(value)} value={value} config={config} onEvent={onEvent} />;
}

function SwitchViewPanel({ value, config, onEvent }) {
  const id = useId();
  const [viewCurrent, setViewCurrent] = useState(value.viewDefault);
  const [viewsVisited, setViewsVisited] = useState([value.viewDefault]);
  const viewSelect = (viewId) => {
    setViewCurrent(viewId);
    setViewsVisited((previous) => previous.includes(viewId) ? previous : [...previous, viewId]);
  };
  return (
    <div className="switch-view not-prose">
      <div className="switch-view-tabs" role="tablist" aria-label={value.label} onKeyDown={(event) => {
        const index = value.views.findIndex((view) => view.id === viewCurrent);
        const indexNext = event.key === 'Home' ? 0 : event.key === 'End' ? value.views.length - 1
          : event.key === 'ArrowRight' ? (index + 1) % value.views.length
          : event.key === 'ArrowLeft' ? (index - 1 + value.views.length) % value.views.length : null;
        if (indexNext === null) return;
        event.preventDefault();
        viewSelect(value.views[indexNext].id);
        event.currentTarget.querySelectorAll('[role="tab"]')[indexNext].focus();
      }}>
        {value.views.map((view, index) => {
          const Icon = iconByName[view.icon] ?? PanelsTopLeft;
          return <button key={view.id} type="button" role="tab" id={`${id}-tab-${index}`}
            aria-controls={`${id}-panel-${index}`} aria-selected={view.id === viewCurrent}
            tabIndex={view.id === viewCurrent ? 0 : -1} title={view.label} onClick={() => viewSelect(view.id)}>
            <Icon size={16} aria-hidden="true" /><span>{view.label}</span>
          </button>;
        })}
      </div>
      {value.views.map((view, index) => (
        <div key={view.id} role="tabpanel" id={`${id}-panel-${index}`} aria-labelledby={`${id}-tab-${index}`}
          hidden={view.id !== viewCurrent} tabIndex={0}>
          {viewsVisited.includes(view.id) ? <RegisteredComp compName={view.component} placement="commentBlock"
            configRuntime={{ sourcePath: config.sourcePath, instanceId: `${config.instanceId ?? id}:view:${view.id}` }}
            input={{ raw: view.raw, lang: 'yaml', propsAuthored: view.props,
              data: Array.isArray(view.data) ? {} : view.data }} onEventRuntime={onEvent} /> : null}
        </div>
      ))}
    </div>
  );
}

export { SwitchView };