import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_OWNERS = ['Mint', 'Electron'];
const DEFAULT_OUTPUT =
  'docs/changes/2026-09-28-macos-sidebar-vibrancy/electron-macos-sidebar-vibrancy.png';

/**
 * Builds the CoreGraphics query used to find an on-screen application window.
 * @param {string|string[]} ownerNames Application owner name(s) to match.
 * @returns {string} Swift source for the query.
 */
export function buildWindowQueryScript(ownerNames) {
  const owners = Array.isArray(ownerNames) ? ownerNames : [ownerNames];
  const escapedOwners = JSON.stringify(owners);
  return `import CoreGraphics
import Foundation
let owners = ${escapedOwners}
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
for item in windows {
  guard let name = item[kCGWindowOwnerName as String] as? String,
        let number = item[kCGWindowNumber as String] as? NSNumber,
        owners.contains(where: { name.localizedCaseInsensitiveContains($0) }),
        (item[kCGWindowLayer as String] as? NSNumber)?.intValue == 0 else { continue }
  print("\\(number.stringValue)\\t\\(name)")
  break
}`;
}

/**
 * Captures the frontmost visible native window owned by the requested app.
 * @param {{ ownerName?: string, outputPath?: string }} options Capture options.
 * @returns {{ ownerName: string, outputPath: string, windowId: string }} Capture metadata.
 */
export function captureMacosWindow({ ownerName, outputPath = DEFAULT_OUTPUT } = {}) {
  if (process.platform !== 'darwin') {
    throw new Error('macOS Window Server capture requires process.platform === "darwin"');
  }

  const ownerPatterns = ownerName ? [ownerName] : DEFAULT_OWNERS;
  for (const ownerPattern of ownerPatterns) {
    try {
      execFileSync('/usr/bin/osascript', [
        '-e',
        `tell application "System Events" to set frontmost of first process whose name contains "${ownerPattern}" to true`,
      ]);
      break;
    } catch {
      continue;
    }
  }

  const windowInfo = execFileSync('/usr/bin/swift', ['-e', buildWindowQueryScript(ownerPatterns)], {
    encoding: 'utf8',
  }).trim();
  if (!windowInfo) {
    throw new Error(`No visible Window Server window found for owner: ${ownerPatterns.join(', ')}`);
  }
  const [windowId, actualOwner] = windowInfo.split('\t');

  const absoluteOutput = resolve(outputPath);
  mkdirSync(dirname(absoluteOutput), { recursive: true });
  execFileSync('/usr/sbin/screencapture', ['-x', '-l', windowId, absoluteOutput]);
  return { ownerName: actualOwner, outputPath: absoluteOutput, windowId };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outputPath = process.argv[2] || DEFAULT_OUTPUT;
  const ownerName = process.argv[3];
  console.log(JSON.stringify(captureMacosWindow({ ownerName, outputPath })));
}
