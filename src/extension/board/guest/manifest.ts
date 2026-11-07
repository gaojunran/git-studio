import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { parseManifestJson } from '@openchamber/sdk/schemas';
import type { OpenChamberManifest, SourceControlContribution } from '@openchamber/sdk';

export interface GuestManifest {
  id: string;
  name: string;
  version: string;
  packageRoot: string;
  entry: string;
  descriptor: SourceControlContribution;
}

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
  const descriptor = manifest.contributes.sourceControl;
  const panel = manifest.contributes.panel;
  if (!service || !service.provides?.includes('source-control')) {
    throw new Error('This package is not a source-control integration (service.provides must include "source-control").');
  }
  if (!descriptor) {
    throw new Error('This package has no contributes.sourceControl descriptor.');
  }
  if (!panel?.id || !panel.name) {
    throw new Error('This package has no panel id and name.');
  }
  const entry = path.resolve(packageRoot, service.entry);
  if (!entry.startsWith(path.resolve(packageRoot) + path.sep)) {
    throw new Error('service.entry must stay inside the package folder.');
  }
  return {
    id: panel.id,
    name: panel.name,
    version,
    packageRoot,
    entry,
    descriptor
  };
}
