// a log group of CloudWatch (doc/aws.md): a compact card, its name and how long it keeps its logs.
// a line joins its body
export const awsLogGroupNodeContract = {
	dataNormalize: (data) => {
		for (const key of ['name', 'retention']) if (data[key] !== undefined && typeof data[key] !== 'string') throw new Error(`${key} must be text.`);
		return { ...data, name: data.name ?? '', retention: data.retention ?? '' };
	},
	anchorListGet: () => [{ id: 'body', sideList: ['left', 'right', 'top', 'bottom'] }],
	sizeDefault: { width: 240, height: 44 },
	searchMatch: (node, helper) => ([node.data?.name, node.data?.retention].some((text) => helper.test(text)) ? { partList: [], childList: [], isWhole: true } : null),
};
