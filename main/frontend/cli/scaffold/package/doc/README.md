# {{title}}

The root document of the package `{{name}}`. A workspace imports the package by its folder (`packageList` of its workspace file); its components are then mounted under the ids `{{name}}/{tagName}`, and its service templates join the service registry.

- `comp-mdx/`: the components, described by `comp.yaml` manifests
- `service-template-app/`, `service-template-infra/`: its service templates, `{templateId}--{name}/`
