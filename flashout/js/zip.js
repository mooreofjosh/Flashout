// Minimal ZIP reader (GDTF and MVR files are ZIP archives).
// Supports stored (0) and deflate (8) entries using the built-in DecompressionStream.

export async function readZip(input) {
  let buf;
  if (input instanceof ArrayBuffer) buf = input;
  else if (ArrayBuffer.isView(input)) buf = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  else buf = await input.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);

  // Find End Of Central Directory record (scan backwards, comment can be up to 64KB).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid ZIP file (no central directory found)');

  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const entries = new Map();
  const dec = new TextDecoder();

  for (let n = 0; n < count; n++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) throw new Error('Corrupt ZIP central directory');
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = dec.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    entries.set(name, { name, method, compSize, localOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  async function data(entry) {
    const lo = entry.localOffset;
    if (view.getUint32(lo, true) !== 0x04034b50) throw new Error('Corrupt ZIP entry ' + entry.name);
    const nameLen = view.getUint16(lo + 26, true);
    const extraLen = view.getUint16(lo + 28, true);
    const start = lo + 30 + nameLen + extraLen;
    const raw = bytes.subarray(start, start + entry.compSize);
    if (entry.method === 0) return raw.slice();
    if (entry.method === 8) {
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error('Unsupported ZIP compression method ' + entry.method);
  }

  function find(name) {
    if (entries.has(name)) return entries.get(name);
    const lower = name.toLowerCase();
    for (const [k, v] of entries) if (k.toLowerCase() === lower) return v;
    return null;
  }

  return {
    names: [...entries.keys()],
    has: (name) => !!find(name),
    async bytes(name) { const e = find(name); return e ? data(e) : null; },
    async text(name) { const b = await this.bytes(name); return b ? dec.decode(b) : null; },
  };
}
