import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { parseManifestJson } from '@openchamber/sdk/schemas';
import type { OpenChamberManifest, SourceControlContribution, TrackerContribution } from '@openchamber/sdk';

export type GuestManifest =
  | {
      id: string;
      name: string;
      version: string;
      packageRoot: string;
      entry: string;
      role: 'source-control';
      descriptor: SourceControlContribution;
    }
  | {
      id: string;
      name: string;
      version: string;
      packageRoot: string;
      entry: string;
      role: 'tracker';
      tracker: TrackerContribution;
    };

export async function readGuestManifest(packageRoot: string): Promise<GuestManifest> {
  const raw = await readFile(path.join(packageRoot, 'package.json'), 'utf8');
  const parsed = parseManifestJson(raw);
  if (!parsed.ok) {
    throw new Error(`Invalid OpenChamber manifest (${parsed.code}): ${parsed.message}`);
  }
  return manifestOf(parsed.manifest, parsed.version ?? '0.0.0', packageRoot);
}

function manifestOf(manifest: OpenChamberManifest, version: string, packageRoot: string): GuestManifest {
  const service = manifest.contributes.service;
  const panel = manifest.contributes.panel;
  const provides = service?.provides ?? [];
  const sourceControl = provides.includes('source-control');
  const tracker = provides.includes('tracker');
  if (!service || (!sourceControl && !tracker)) {
    throw new Error('This package is not an OpenChamber integration (service.provides must include "source-control" or "tracker").');
  }
  if (sourceControl && tracker) {
    throw new Error('An integration cannot provide both source-control and tracker.');
  }
  if (!panel?.id || !panel.name) {
    throw new Error('This package has no panel id and name.');
  }
  const entry = path.resolve(packageRoot, service.entry);
  if (!entry.startsWith(path.resolve(packageRoot) + path.sep)) {
    throw new Error('service.entry must stay inside the package folder.');
  }
  const base = { id: panel.id, name: panel.name, version, packageRoot, entry };

  if (tracker) {
    const descriptor = manifest.contributes.tracker;
    if (!descriptor) {
      throw new Error('This package has no contributes.tracker descriptor.');
    }
    return { ...base, role: 'tracker', tracker: descriptor };
  }

  const descriptor = manifest.contributes.sourceControl;
  if (!descriptor) {
    throw new Error('This package has no contributes.sourceControl descriptor.');
  }
  return { ...base, role: 'source-control', descriptor };
}
