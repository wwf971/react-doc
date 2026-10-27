// the yaml package, re-exported so every module of the package (the
// built-in components included, server-side modules too) resolves the one
// dependency of the frontend. yamlDocumentParse: the document form, for a
// text written back with its comments kept (doc_page_impl_yaml_utils.md)
export { parse as yamlParse, parseDocument as yamlDocumentParse, stringify as yamlStringify } from 'yaml';
