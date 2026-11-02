import { LocalBackupDashboard, StatusDot } from './LocalBackupDashboard.jsx';

// The config dashboard of local-backup ("Backup folder"), shown in the
// Services tab under the instance: the instance as the backend lists it and
// its config (backupDir, versionKeepMax), then the browser of the default
// dashboard. The config is edited in the instance's service.yaml.
//
//   config.service.instance   the instance as the backend lists it
export function LocalBackupConfigDashboard({ config = {}, onEvent }) {
  const instance = config.service?.instance;
  const instanceConfig = instance?.config ?? {};
  return (
    <LocalBackupDashboard onEvent={onEvent}>
      <span className="local-backup-key">instance</span>
      <span>
        {instance?.name} <span className="local-backup-muted">({instance?.serviceId})</span>
        {' '}<StatusDot status={instance?.status} />{instance?.status}
        {instance?.message ? <span className="local-backup-muted"> {instance.message}</span> : null}
      </span>
      <span className="local-backup-key">config</span>
      <span>
        backupDir <span className="local-backup-code">{instanceConfig.backupDir ? instanceConfig.backupDir : "''"}</span>
        <span className="local-backup-muted"> ({instanceConfig.backupDir ? 'a path, relative to the instance folder unless absolute' : 'the default folder'})</span>
        {' · '}versionKeepMax <span className="local-backup-code">{instanceConfig.versionKeepMax ?? 0}</span>
        <span className="local-backup-muted"> ({instanceConfig.versionKeepMax ? `the oldest backups of a consumer beyond ${instanceConfig.versionKeepMax} are removed when one is made` : 'every backup is kept'})</span>
        <span className="local-backup-muted"> · edited in the instance's service.yaml</span>
      </span>
    </LocalBackupDashboard>
  );
}
