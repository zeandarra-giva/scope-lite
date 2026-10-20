// Ported from the React prototype: workspaces.js
(function () {
// Workspaces: one Scope install serves many resolver teams. Each workspace is
// configuration, not code: its ServiceNow assignment groups, roster, resolution
// code prefix and knowledge base. Every workspace gets the same modules.
//
// Prototype: only Solution Center has its own sample data. The other workspaces
// open the same sample data under their own name to show the shell scales.
const WORKSPACES = [
  {
    id: 'sc', name: 'Solution Center', short: 'SC', tone: 'blue', home: true,
    desc: 'Service Desk incident queue, end-user and business application support.',
    groups: ['Service Desk L2', 'Apps Support', 'Infra Ops'],
    codes: ['NET-VPN-01', 'APP-PAY-02', 'ACC-MFA-01'],
    members: 24, open: null, kbPages: 22, // open comes from the live queue
  },
  {
    id: 'pam', name: 'CyberArk PAM', short: 'PA', tone: 'pink',
    desc: 'Privileged access: vault safes, credential rotation and session access.',
    groups: ['PAM Operations', 'CyberArk Engineering'],
    codes: ['PAM-ROT-01', 'PAM-SAFE-02', 'PAM-PSM-01'],
    members: 9, open: 14, kbPages: 41,
  },
  {
    id: 'db', name: 'Database Engineering', short: 'DB', tone: 'green',
    desc: 'Oracle, SQL Server and PostgreSQL: blocking sessions, space, backups and failover.',
    groups: ['DBA Oracle', 'DBA SQL Server', 'DBA PostgreSQL'],
    codes: ['DB-LCK-01', 'DB-SPC-02', 'DB-BKP-01'],
    members: 16, open: 22, kbPages: 58,
  },
  {
    id: 'mf', name: 'Mainframe Operations', short: 'MF', tone: 'yellow',
    desc: 'z/OS batch, CICS regions and JCL abends across the overnight cycle.',
    groups: ['Mainframe Batch', 'CICS Support'],
    codes: ['MF-ABN-01', 'MF-CICS-02', 'MF-JCL-01'],
    members: 11, open: 9, kbPages: 33,
  },
]

const workspaceById = (id) => WORKSPACES.find((w) => w.id === id)

  Object.assign(S, { WORKSPACES, workspaceById })
})()
