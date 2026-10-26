import { ArrowRight, Workflow } from '../../../../main/frontend/UICommon.js';
import './MigrationStep.css';

// Demonstration node renderer of DiagramER: one step of a data migration
// (a transformation between a source and a target column). It is drawn by
// the diagram through RegisteredComp in the placement visualizationNode
// (comp_db_vis.md#internal-and-registered-renderers); it is not a document
// block of its own.
//
//   data.label       the name of the step
//   data.operation   what it does, shown as code
//   data.note        optional explanation
//   config.visualization.anchorRef(anchorId)
//                    the ref every declared anchor is attached to, so the
//                    diagram draws handles over it: input (left) and output
//                    (right) here; the diagram adds body itself
//
// it only draws: moving, connecting and saving belong to the diagram.
export function MigrationStep({ data = {}, config = {} }) {
  const anchorRef = config.visualization?.anchorRef ?? (() => undefined);
  return (
    <div className="migration-step">
      <div className="migration-step-head">
        <Workflow size={14} aria-hidden="true" />
        <strong>{data.label ?? 'Step'}</strong>
      </div>
      <div className="migration-step-io">
        <span ref={anchorRef('input')} className="migration-step-port">in</span>
        <code>{data.operation ?? '—'}</code>
        <ArrowRight size={13} aria-hidden="true" />
        <span ref={anchorRef('output')} className="migration-step-port">out</span>
      </div>
      {data.note ? <p className="migration-step-note">{data.note}</p> : null}
    </div>
  );
}

export const migrationStepDefineOptions = {
  placementList: ['visualizationNode'],
  expose: {
    meta: { label: 'Migration step (demo)', description: 'A transformation step drawn as a node of a DiagramER diagram (placement visualizationNode).' },
    icon: Workflow,
    // the anchors are known from the data before rendering, so the diagram
    // validates the handles of a node against them
    visualizationNode: {
      anchorListGet: () => [
        { id: 'input', sideList: ['left'] },
        { id: 'output', sideList: ['right'] },
      ],
      sizeDefault: { width: 240, height: 110 },
    },
  },
};
