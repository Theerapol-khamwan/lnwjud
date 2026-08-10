/* global process */
import { startMcpStdio } from '../../dist/stdio.js';

process.stderr.write('lnwjud-stdio-test-diagnostic\n');
startMcpStdio({
  services: {},
  actor: { clientId: 'stdio-test', clientName: 'stdio-test' },
});
