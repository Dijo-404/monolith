/**
 * Design-only prefunded-credit intent. MN-018 selects the supported authorization route,
 * and MN-019 must freeze its ABI/domain. No payment validator or activated API is provided.
 */
export type ProvisionalPayIntent = {
  payer: string;
  merchant: string;
  amount: string;
  orderId: string;
  nonce: string;
  deadline: string;
};
