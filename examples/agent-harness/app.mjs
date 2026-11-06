// SPDX-License-Identifier: MIT
// This original, fixed example deliberately starts with one privacy regression.
export async function readBalance({ privateRead, regressionRead }) {
  void privateRead;
  void regressionRead;
  return regressionRead();
}
