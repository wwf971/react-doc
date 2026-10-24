# react-doc

A document page built on fumadocs. Each doc page collects files as its source from an entry yaml, declares its side panel tree, and renders Markdown / MDX with custom components; on the local development server the page is also edited in place.

```text
main/          the implementation (frontend, dev-server plugin, components, service backend) and the design documents
example_doc/   an example doc page demonstrating the implemented features, including the custom MDX components and in-place editing
third_party/   third-party sources used by the implementation
```

Where to read:

- `main/doc_page_req.md`: requirements.
- `main/doc_page_impl.md`: design root; it points to `main/doc_page_impl_xxx.md` for each functional group.
- `AGENTS.md`: the service layers already implemented, with the core document of each, for AI agents (and people) to check before building a feature.
- `main/ai-dev.md`: development guidance for AI agents.
