/**
 * Unit tests for areas service utility functions
 *
 * These tests do NOT require a database — they test pure functions.
 */

import { describe, expect, it } from 'vitest';
import { polygonCoordsToWkt, computeGeometrySha256 } from '../src/services/areas.service.js';
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
