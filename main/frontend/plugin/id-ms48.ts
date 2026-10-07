// ms_48 ids (ai-skills id-format.md): a 64-bit number whose high 48 bits are
// the unix time in milliseconds and whose low 16 bits are a random offset,
// displayed as digits and lowercase letters (base 36). Ids carry no prefix
// or suffix; sorting them sorts by creation time.
//
//   high |-------48bit------|---16bit---| low
//   high |---unix_stamp_ms--|---offset--| low

const OFFSET_BITS = 16n;
const OFFSET_COUNT = 1 << 16;

// isUsed(id): true when the id already exists where it will be stored; a
// new offset is drawn until the id is free
export function idMs48Create(isUsed: (id: string) => boolean = () => false): string {
  for (;;) {
    const offset = Math.floor(Math.random() * OFFSET_COUNT);
    const value = (BigInt(Date.now()) << OFFSET_BITS) | BigInt(offset);
    const id = value.toString(36);
    if (!isUsed(id)) return id;
  }
}

// the millisecond time an id was created at
export function idMs48TimeGet(id: string): number {
  // parseInt(id, 36) would round above 2^53; the digits are read one by one
  let value = 0n;
  for (const character of id) value = value * 36n + BigInt(parseInt(character, 36));
  return Number(value >> OFFSET_BITS);
}

export function idMs48Is(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-z]{1,13}$/.test(value);
}
