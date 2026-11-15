import { awsIconUrlRegister } from './AwsIcon.js';

// The official icons fetched into icon-official/ (AwsIcon.js), registered for the kinds of the
// series. Imported by the components only (aws-comp.js): the glob is vite's, and a folder with
// nothing fetched into it gives nothing, so the kinds keep their own icons.
awsIconUrlRegister(import.meta.glob('./icon-official/*.svg', { eager: true, query: '?url', import: 'default' }));
