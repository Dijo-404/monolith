import {
  addressSchema, hex32Schema, hexQuantitySchema, makeError,
  type JsonValue, type ReadMethod, type Result,
} from '@monolith/shared';

const quantity = (value: unknown): value is string => typeof value === 'string'
  && value.length <= 66 && hexQuantitySchema.safeParse(value).success;
const bytes = (value: unknown): value is string => typeof value === 'string'
  && /^0x(?:[0-9a-fA-F]{2})*$/.test(value);
const record = (value: JsonValue): value is { [key: string]: JsonValue } => value !== null
  && typeof value === 'object' && !Array.isArray(value);

/** Protocol envelopes alone cannot turn malformed method results into successful reads. */
export function decodeReadResult(method: ReadMethod, value: JsonValue): Result<JsonValue> {
  let valid: boolean;
  switch (method) {
    case 'eth_chainId':
    case 'eth_blockNumber':
    case 'eth_getBalance':
      valid = quantity(value);
      break;
    case 'eth_call':
      valid = bytes(value);
      break;
    case 'eth_getTransactionReceipt':
      valid = value === null || (record(value)
        && hex32Schema.safeParse(value['transactionHash']).success
        && hex32Schema.safeParse(value['blockHash']).success
        && quantity(value['blockNumber'])
        && (value['status'] === '0x0' || value['status'] === '0x1')
        && addressSchema.safeParse(value['from']).success
        && (value['to'] === null || addressSchema.safeParse(value['to']).success)
        && Array.isArray(value['logs']) && value['logs'].every((log) => record(log)
          && addressSchema.safeParse(log['address']).success
          && Array.isArray(log['topics']) && log['topics'].every((topic) => hex32Schema.safeParse(topic).success)
          && bytes(log['data'])));
      break;
  }
  return valid ? { ok: true, value } : { ok: false, error: makeError('RPC_RESPONSE_INVALID') };
}
