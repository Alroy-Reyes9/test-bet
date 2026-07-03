// BigInt is not JSON-serializable; render chip amounts as strings.
export function chips(n: bigint): string {
  return n.toString()
}
