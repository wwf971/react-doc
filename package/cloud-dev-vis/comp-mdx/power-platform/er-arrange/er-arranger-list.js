import { erArrangerColumns } from './ErArrangerColumns.js';
import { erArrangerLanes } from './ErArrangerLanes.js';
import { erArrangerSpread } from './ErArrangerSpread.js';

// The arrangers of ER diagrams (card-diagram-arrange.md), offered by the registry of the
// series. One more is one more file and one more line here.
export const erArrangerList = [erArrangerLanes, erArrangerSpread, erArrangerColumns];
export { erArrangerColumns, erArrangerLanes, erArrangerSpread };
