import { Box } from '../../frontend/UICommon.js';
import { compDefine } from '../registry/comp-registry.js';
import { ServiceCompHost } from './ServiceCompHost.jsx';

// The further components of service templates as components of the
// registry (design: doc_page_impl_obj.md#object-views). A template declares
// them in expose.compList of its script, beside its dashboards, exported by
// the same federated module; their id names them:
//
//   service/{templateName}/comp/{compId}
//
// Like a dashboard's, the definition is built from the id alone, so it
// exists while the backend is down; the module is loaded at render time from
// an instance of the template (ServiceCompHost): the instance that provides
// the object drawn when it is one of the template's, else any ready one. A
// template whose objects another template's component draws therefore
// depends on an instance of that template running: what its script's
// requireList declares, and what the Services tab shows.
//
// Today such a component is an object view only: it renders in the
// placement objectView, with { data: { ref, descriptor }, config.objectView }.

const REGEX_SERVICE_COMP_ID = /^service\/([a-z0-9][a-z0-9_-]*)\/comp\/([a-z][a-zA-Z0-9-]*)$/;

const definitionByCompId = new Map();

export function serviceCompIdBuild(templateName, compId) {
  return `service/${templateName}/comp/${compId}`;
}

export function serviceCompIdParse(compId) {
  const match = REGEX_SERVICE_COMP_ID.exec(String(compId ?? ''));
  return match ? { templateName: match[1], compId: match[2] } : undefined;
}

export function serviceCompDefinitionGet(compId) {
  const parsed = serviceCompIdParse(compId);
  if (!parsed) return undefined;
  if (!definitionByCompId.has(compId)) {
    definitionByCompId.set(compId, compDefine(ServiceCompHost, {
      placementList: ['objectView'],
      dataBuild: (input) => ({
        data: input.data,
        config: { serviceTemplateName: parsed.templateName, serviceCompId: parsed.compId },
      }),
      expose: {
        meta: {
          label: `${parsed.templateName} · ${parsed.compId}`,
          description: `the component ${parsed.compId} of the service template ${parsed.templateName}`,
          isNotInDoc: true,
          isReadOnly: true,
          isServiceComp: true,
        },
        icon: Box,
      },
    }));
  }
  return definitionByCompId.get(compId);
}
