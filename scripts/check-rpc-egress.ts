import { checkRpcEgress } from '../tests/privacy/egress/static.mjs';

const result = await checkRpcEgress();
console.info(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
