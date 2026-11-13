/**
 * Unit tests for areas service utility functions
 *
 * These tests do NOT require a database — they test pure functions.
 */

import { describe, expect, it } from 'vitest';
import { areaToWkt, computeGeometrySha256, normalizeArea, polygonCoordsToWkt } from '../src/services/areas.service.js';
import type { AreaCreateInput } from '../src/validators/areas.validator.js';

type PolygonGeometry = AreaCreateInput['geometry'];

describe('polygonCoordsToWkt', () => {
  it('converts a simple exterior ring to valid WKT', () => {
    const coords: number[][][] = [
      [[2.0, 43.0], [3.0, 43.0], [3.0, 44.0], [2.0, 44.0], [2.0, 43.0]]
    ];
    const wkt = polygonCoordsToWkt(coords);
    expect(wkt).toBe('POLYGON((2 43, 3 43, 3 44, 2 44, 2 43))');
  });

  it('handles multiple rings (exterior + hole)', () => {
    const coords: number[][][] = [
      [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]],
      [[2.0, 2.0], [8.0, 2.0], [8.0, 8.0], [2.0, 8.0], [2.0, 2.0]] // hole
    ];
    const wkt = polygonCoordsToWkt(coords);
    expect(wkt).toContain('POLYGON(');
    expect(wkt).toContain('(0 0, 10 0, 10 10, 0 10, 0 0)');
    expect(wkt).toContain('(2 2, 8 2, 8 8, 2 8, 2 2)');
  });
});

describe('computeGeometrySha256', () => {
  const polygon: PolygonGeometry = {
    type: 'Polygon',
    coordinates: [
      [[2.0, 43.0], [3.0, 43.0], [3.0, 44.0], [2.0, 44.0], [2.0, 43.0]]
    ]
  };

  it('produces a 64-character hex string', () => {
    const hash = computeGeometrySha256(polygon);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the same hash for identical geometries', () => {
    const hash1 = computeGeometrySha256(polygon);
    const hash2 = computeGeometrySha256({
      type: 'Polygon',
      coordinates: [
        [[2.0, 43.0], [3.0, 43.0], [3.0, 44.0], [2.0, 44.0], [2.0, 43.0]]
      ]
    });
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different geometries', () => {
    const hash1 = computeGeometrySha256(polygon);
    const hash2 = computeGeometrySha256({
      type: 'Polygon',
      coordinates: [
        [[5.0, 43.0], [6.0, 43.0], [6.0, 44.0], [5.0, 44.0], [5.0, 43.0]]
      ]
    });
    expect(hash1).not.toBe(hash2);
  });

  it('is stable across floating point noise within 8 decimal places', () => {
    // A coordinate pair that differs only at 9+ decimal places should hash identically.
    const hash1 = computeGeometrySha256({
      type: 'Polygon',
      coordinates: [[[2.0, 43.0], [3.0, 43.0], [3.0, 44.0], [2.0, 44.0], [2.0, 43.0]]]
    });
    const hash2 = computeGeometrySha256({
      type: 'Polygon',
      coordinates: [
        [
          [2.000000001, 43.0], // differs at 9th decimal — rounds to same
          [3.0, 43.0],
          [3.0, 44.0],
          [2.000000001, 44.0],
          [2.000000001, 43.0]
        ]
      ]
    });
    expect(hash1).toBe(hash2);
  });
});

describe('multi-part areas', () => {
  const west = [[[2.0, 43.0], [3.0, 43.0], [3.0, 44.0], [2.0, 44.0], [2.0, 43.0]]];
  const east = [[[5.0, 43.0], [6.0, 43.0], [6.0, 44.0], [5.0, 44.0], [5.0, 43.0]]];

  it('keeps the hash of an existing polygon unchanged', () => {
    // Recorded with the Polygon-only implementation: saved areas must keep their identity.
    expect(computeGeometrySha256({ type: 'Polygon', coordinates: west })).toBe('2d3b8fbcd1316fb89b1ecbe4051c8d198dc6690205dac547cfffd60c02adebf1');
  });

  it('writes MULTIPOLYGON WKT with one parenthesised polygon per part', () => {
    expect(areaToWkt({ type: 'MultiPolygon', coordinates: [west, east] })).toBe(
      'MULTIPOLYGON(((2 43, 3 43, 3 44, 2 44, 2 43)), ((5 43, 6 43, 6 44, 5 44, 5 43)))'
    );
    expect(areaToWkt({ type: 'Polygon', coordinates: west })).toBe('POLYGON((2 43, 3 43, 3 44, 2 44, 2 43))');
  });

  it('treats a single-part MultiPolygon as the same area as its polygon', () => {
    expect(normalizeArea({ type: 'MultiPolygon', coordinates: [west] }).type).toBe('Polygon');
    expect(computeGeometrySha256({ type: 'MultiPolygon', coordinates: [west] })).toBe(
      computeGeometrySha256({ type: 'Polygon', coordinates: west })
    );
  });

  it('hashes the same parts identically whatever their order, and differently from one part alone', () => {
    const forward = computeGeometrySha256({ type: 'MultiPolygon', coordinates: [west, east] });
    expect(computeGeometrySha256({ type: 'MultiPolygon', coordinates: [east, west] })).toBe(forward);
    expect(forward).not.toBe(computeGeometrySha256({ type: 'Polygon', coordinates: west }));
  });

  it('normalises a part that crosses the dateline like a polygon', () => {
    const across = [[[179.5, 10.0], [-179.5, 10.0], [-179.5, 11.0], [179.5, 11.0], [179.5, 10.0]]];
    const area = normalizeArea({ type: 'MultiPolygon', coordinates: [across, east] });
    expect(area.type).toBe('MultiPolygon');
    for (const part of area.coordinates as number[][][][]) {
      const longitudes = part.flat().map((p) => p[0]!);
      expect(Math.max(...longitudes) - Math.min(...longitudes)).toBeLessThan(180); // each part stays contiguous
    }
  });
});
