// Deliberately scoped to the PostGIS point tiles used by this fixture.
// Wire contract: https://github.com/mapbox/vector-tile-spec/blob/master/2.1/vector_tile.proto
function varint(buffer, position) {
  let value = 0n;
  for (let shift = 0n; shift < 70n; shift += 7n) {
    if (position.offset >= buffer.length) throw new Error('Truncated protobuf varint.');
    const byte = buffer[position.offset++];
    value |= BigInt(byte & 127) << shift;
    if (!(byte & 128)) return value;
  }
  throw new Error('Oversized protobuf varint.');
}
function number(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('Protobuf integer exceeds fixture limits.');
  return result;
}
function fields(buffer) {
  const result = [];
  const position = { offset: 0 };
  while (position.offset < buffer.length) {
    const tag = number(varint(buffer, position));
    const field = tag >>> 3;
    const wire = tag & 7;
    if (!field) throw new Error('Invalid protobuf field.');
    if (wire === 0) result.push({ field, value: varint(buffer, position) });
    else {
      const length = wire === 1 ? 8 : wire === 5 ? 4 : wire === 2 ? number(varint(buffer, position)) : -1;
      if (length < 0 || position.offset + length > buffer.length) throw new Error('Invalid protobuf wire payload.');
      result.push({ field, value: buffer.subarray(position.offset, position.offset + length) });
      position.offset += length;
    }
  }
  return result;
}
const get = (message, field) => message.find((entry) => entry.field === field)?.value;
function packed(buffer) {
  const position = { offset: 0 };
  const result = [];
  while (position.offset < buffer.length) result.push(number(varint(buffer, position)));
  return result;
}
function decodeValue(buffer) {
  const message = fields(buffer);
  if (message.length !== 1) throw new Error('Invalid MVT property value.');
  const { field, value } = message[0];
  if (field === 1) return value.toString('utf8');
  if (field === 2) return value.readFloatLE();
  if (field === 3) return value.readDoubleLE();
  if (field === 4 || field === 5) return number(value);
  if (field === 6) return number((value >> 1n) ^ -(value & 1n));
  if (field === 7) return value !== 0n;
  throw new Error('Unsupported MVT value.');
}

export function decodeMvtPoints(buffer) {
  return fields(buffer).filter((entry) => entry.field === 3).map(({ value }) => {
    const layer = fields(value);
    const keys = layer.filter((entry) => entry.field === 3).map((entry) => entry.value.toString('utf8'));
    const values = layer.filter((entry) => entry.field === 4).map((entry) => decodeValue(entry.value));
    const features = layer.filter((entry) => entry.field === 2).map((entry) => {
      const feature = fields(entry.value);
      if (get(feature, 3) !== 1n) throw new Error('Expected MVT POINT geometry.');
      const tags = packed(get(feature, 2) ?? Buffer.alloc(0));
      if (tags.length % 2) throw new Error('Invalid MVT tags.');
      const properties = Object.create(null);
      for (let i = 0; i < tags.length; i += 2) {
        if (tags[i] >= keys.length || tags[i + 1] >= values.length) throw new Error('Invalid MVT dictionary index.');
        properties[keys[tags[i]]] = values[tags[i + 1]];
      }
      const commands = packed(get(feature, 4) ?? Buffer.alloc(0));
      if (commands.length !== 3 || commands[0] !== 9) throw new Error('Expected a single MoveTo point.');
      const zigzag = (integer) => integer % 2 ? -(integer + 1) / 2 : integer / 2;
      return { x: zigzag(commands[1]), y: zigzag(commands[2]), properties };
    });
    return { name: get(layer, 1)?.toString('utf8'), extent: number(get(layer, 5) ?? 4096n),
      version: number(get(layer, 15) ?? 1n), features };
  });
}
