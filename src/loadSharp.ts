import type SharpConstructor from 'sharp'

import { UploadError } from '@cedarjs/uploads'

/** The parts of `require()` that `loadSharp()` uses. */
export type SharpRequire = ((id: string) => unknown) & {
  resolve: (id: string) => string
}

/**
 * Loads sharp, and its native library, with `require`, or says how to fix
 * it.
 */
export function loadSharp(require: SharpRequire): typeof SharpConstructor {
  try {
    require.resolve('sharp')
  } catch (e) {
    throw new UploadError(
      'CONFIGURATION',
      "sharpVariant() needs the 'sharp' package, which isn't installed. " +
        'Add it to your api side with `yarn workspace api add sharp`, or ' +
        'write your own generator.',
      e,
    )
  }

  try {
    return require('sharp') as typeof SharpConstructor
  } catch (e) {
    throw new UploadError(
      'CONFIGURATION',
      "sharpVariant() can't load the 'sharp' package, which is installed. " +
        'Usually its native library for this platform is missing; see ' +
        'https://sharp.pixelplumbing.com/install. sharp says: ' +
        (e instanceof Error ? e.message : String(e)),
      e,
    )
  }
}
