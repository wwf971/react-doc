// How complete an answer of the registry is (doc_page_impl_obj.md#completeness):
// one line, and every provider that answered or did not in its title, so a
// list of objects never claims more than its providers said.
const STATUS_OK_LIST = ['answered', 'cached', 'registered'];

export function ObjectCompleteness({ completeness, count, isTruncated = false, isLoading = false }) {
  if (!completeness) return <p className="doc-status">{isLoading ? 'asking the providers…' : ''}</p>;
  const providerList = completeness.providerList ?? [];
  const problemList = providerList.filter((item) => !STATUS_OK_LIST.includes(item.status));
  const detail = providerList
    .map((item) => `${item.label || item.providerId} (${item.registry}): ${item.status}, ${item.count}${item.message ? ` — ${item.message}` : ''}`)
    .join('\n');
  const text = [
    `${count} object${count === 1 ? '' : 's'}`,
    isTruncated ? 'more not shown' : '',
    completeness.isComplete ? `from ${providerList.length} provider${providerList.length === 1 ? '' : 's'}` : '',
    ...problemList.map((item) => `${item.label || item.providerId}: ${item.status}${item.message ? ` (${item.message})` : ''}`),
  ].filter(Boolean).join(' · ');
  return (
    <p className="doc-note doc-object-completeness" title={detail} {...(completeness.isComplete ? {} : { 'data-incomplete': '' })}>
      {isLoading ? 'asking again… · ' : ''}{text}
    </p>
  );
}
