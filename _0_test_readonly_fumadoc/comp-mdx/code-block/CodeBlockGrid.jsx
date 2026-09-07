import { yamlParse } from '../../frontend/src/lib/yaml.js';
import CodeBlock from './CodeBlock.jsx';

function CodeBlockGrid({ data = {}, config = {} }) {
	try {
		const dataGrid = data.raw?.trim() ? yamlParse(data.raw) : data;
		const pathValues = Array.isArray(dataGrid) ? dataGrid : dataGrid?.paths;
		if (!Array.isArray(pathValues)) throw new Error('Expected a paths list.');
		const paths = pathValues
			.map((value) => typeof value === 'string' ? value : value?.path)
			.filter((value) => typeof value === 'string' && value !== '');
		if (paths.length !== pathValues.length) throw new Error('Every code block requires a path.');

		return (
			<CodeBlock
				data={{
					paths,
					title: dataGrid?.title ?? data.title,
					type: 'compact',
					isGrid: true,
				}}
				config={config}
			/>
		);
	} catch (error) {
		return (
			<div className="doc-code-block-grid-error" role="alert">
				Failed to read code block data: {String(error?.message ?? error)}
			</div>
		);
	}
}

export { CodeBlockGrid };
