import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixtureDetections, fixtureKey, ids, sha256 } from './fixture.mjs';
import { fixtureDirectory } from './environment.mjs';

export async function writeImmutable(name, value) {
  const filename = resolve(fixtureDirectory, name);
  await mkdir(fixtureDirectory, { recursive: true });
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  try { await writeFile(filename, text, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (await readFile(filename, 'utf8') !== text) throw new Error(`Fixture artifact already exists with different content: ${name}. It was not overwritten.`);
  }
  return filename;
}

export async function prepareAssetArtifacts() {
  const rows = fixtureDetections();
  const uris = {};
  for (const asset of ['asset', 'other-asset']) {
    uris[asset] = pathToFileURL(await writeImmutable(`${asset}.json`, JSON.stringify(rows.filter((row) => row.asset === asset)))).href;
  }
  for (const key of ['release', 'other-release']) {
    const partitionKeys = key === 'release' ? ['main', 'overlap', 'quarantined', 'incomplete'] : ['other'];
    const partitions = partitionKeys.map((partition) => {
      const members = partition === 'overlap' ? [rows[0]] : rows.filter((row) => row.partition === partition);
      return { id: ids[partition], role: partition, row_count: members.length, sha256: sha256(members) };
    });
    uris[key] = pathToFileURL(await writeImmutable(`${key}.json`, { fixture: fixtureKey, id: ids[key], partitions })).href;
  }
  // Partition snapshots have their own content, count and SHA-256, not an
  // unrelated asset URI. Quarantined/incomplete snapshots remain identifiable.
  for (const key of ['main', 'overlap', 'quarantined', 'incomplete', 'other']) {
    const members = key === 'overlap' ? [rows[0]] : rows.filter((row) => row.partition === key);
    uris[key] = pathToFileURL(await writeImmutable(`partition-${key}.json`, JSON.stringify(members))).href;
  }
  return uris;
}
