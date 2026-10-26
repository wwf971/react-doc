const variantSet = new Set(['simple', 'mdx']);

function blockVariantGet(data = {}) {
  const variant = String(data.variant ?? '').trim().toLowerCase();
  if (variantSet.has(variant)) return variant;
  const language = String(data.lang ?? '').trim().toLowerCase();
  return language === 'markdown' || language === 'mdx' ? 'mdx' : 'simple';
}

export { blockVariantGet };
