import { AnonRpcWorker as OfficialWorker } from '@mn009/official-browser-harness';
import type { WorkerInit } from '@mn009/official-browser-harness';
import { captureLabConfiguration, installLabHeaderBinding } from './lab-driver.js';
import type { LabConfiguration, WorkerHttpDiagnostic } from './lab-driver.js';

/**
 * MN009-only Vite composition alias. The original public SDK constructs the
 * worker, checks its bundle and owns its lifecycle. Its constructor installs
 * an instance-bound fetch; decorate that instance after super(), never the
 * shadowed prototype. No SDK file or production adapter is modified.
 */
export class AnonRpcWorker extends OfficialWorker {
  constructor(init: WorkerInit) {
    const parent = window.parent as Window & { mn009HostConfiguration?: LabConfiguration;
      mn009WorkerHttp?: WorkerHttpDiagnostic[] };
    if (window.parent === window || parent.location.origin !== location.origin || !parent.mn009HostConfiguration) {
      throw new Error('Lab worker requires its configured parent.');
    }
    const settings = captureLabConfiguration(parent.mn009HostConfiguration);
    super(init);
    parent.mn009WorkerHttp = [];
    installLabHeaderBinding(this as unknown as { fetch: typeof fetch }, settings, (diagnostic) => {
      if (parent.mn009WorkerHttp && parent.mn009WorkerHttp.length < 8) parent.mn009WorkerHttp.push(diagnostic);
    });
  }
}
