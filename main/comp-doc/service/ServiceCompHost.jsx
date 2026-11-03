import { Component, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { ObjectViewFallback } from '../object/ObjectViewFallback.jsx';

// The frame of a component of a service template (service-comp-define.js):
// which instance's module it is loaded from, and what is drawn while it
// cannot be (the fallback view of the object, with the reason). The
// instance is the one providing the object drawn, when it was created from
// the template; else the first ready instance of the template with a built
// module: every instance serves its own copy of the module, and any of them
// draws the template's component.
export const ServiceCompHost = observer(function ServiceCompHost({ data = {}, config = {}, onEvent }) {
  const { serviceStore } = useDocStores();
  const templateName = config.serviceTemplateName;
  const compId = config.serviceCompId;
  const providerServiceId = String(data.descriptor?.provider?.id ?? '').replace(/^service:/, '');
  const instanceList = serviceStore.instanceListOfTemplateName(templateName)
    .filter((instance) => instance.status === 'ready' && instance.dashboardBuild?.isBuilt);
  const instance = instanceList.find((item) => item.serviceId === providerServiceId) ?? instanceList[0];
  const serviceId = instance?.serviceId ?? '';
  const exportName = instance?.expose?.compList?.find((comp) => comp.id === compId)?.export ?? '';

  useEffect(() => {
    if (serviceId) void serviceStore.moduleLoad(serviceId);
  }, [serviceId, instance?.dashboardBuild?.timeBuilt, serviceStore]);

  const CompModule = serviceId ? serviceStore.moduleExportGet(serviceId, exportName) : undefined;
  if (!CompModule) {
    const moduleState = serviceId ? serviceStore.moduleStateGet(serviceId) : undefined;
    const reason = !instance
      ? `no ready instance of the service template ${templateName} serves its component ${compId}`
      : moduleState?.status === 'error' ? moduleState.message : `loading the component ${compId} of ${templateName}…`;
    return <ObjectViewFallback data={data} config={{ ...config, objectView: { ...config.objectView, note: reason } }} onEvent={onEvent} />;
  }
  return (
    <ServiceCompBoundary key={serviceId} fallback={(message) => <ObjectViewFallback data={data} config={{ ...config, objectView: { ...config.objectView, note: message } }} onEvent={onEvent} />}>
      <CompModule data={data} config={config} onEvent={onEvent} />
    </ServiceCompBoundary>
  );
});

// a component of a module that throws is one object drawn by its fallback, not the page
class ServiceCompBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { message: '' };
  }

  static getDerivedStateFromError(error) {
    return { message: `the component failed: ${String(error?.message ?? error)}` };
  }

  render() {
    return this.state.message ? this.props.fallback(this.state.message) : this.props.children;
  }
}
