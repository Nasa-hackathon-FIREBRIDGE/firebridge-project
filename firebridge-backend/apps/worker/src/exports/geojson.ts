import type { DetectionRow } from '@firebridge/results';

export async function* geojsonChunks(rows: AsyncIterable<DetectionRow>): AsyncGenerator<string> {
  yield '{"type":"FeatureCollection","features":[';
  let separator = '';
  for await (const { id, longitude, latitude, ...properties } of rows) {
    yield separator + JSON.stringify({ type: 'Feature', id,
      geometry: { type: 'Point', coordinates: [longitude, latitude] }, properties });
    separator = ',';
  }
  yield ']}';
}
