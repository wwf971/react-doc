// The module the page loads (container serviceNoteDb, module ./dashboard).
// Every export named by expose.dashboardList[].export of service_type.py is
// one dashboard component; the page renders it with { data, config, onEvent }
// (doc_page_impl_service_instance.md#dashboard-props).
import noteDbCssText from './NoteDb.css?inline';

// the module adds its own stylesheet: the federation plugin links an emitted
// stylesheet by an url it joins wrong for pages served from a host without a
// dot in its name (localhost)
const STYLE_ELEMENT_ID = 'service-note-db-style';
if (!document.getElementById(STYLE_ELEMENT_ID)) {
  const styleElement = document.createElement('style');
  styleElement.id = STYLE_ELEMENT_ID;
  styleElement.textContent = noteDbCssText;
  document.head.appendChild(styleElement);
}

export { NoteDbDashboard } from './NoteDbDashboard.jsx';
export { NoteDbConfigDashboard } from './NoteDbConfigDashboard.jsx';
export { NoteDbStatDashboard } from './NoteDbStatDashboard.jsx';
