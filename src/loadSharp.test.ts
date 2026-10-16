import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { UploadError } from '@cedarjs/uploads'

import { loadSharp } from './loadSharp.ts'
import type { SharpRequire } from './loadSharp.ts'

/** The message of the error `loadSharp()` throws with `require`. */
function errorWith(require: SharpRequire) {
  let error: unknown

  try {
    loadSharp(require)
  } catch (e) {
    error = e
  }

  assert.ok(error instanceof UploadError)
  assert.equal(error.code, 'CONFIGURATION')

  return error.message
}

describe('loadSharp', () => {
  test('loads sharp', () => {
    const sharp = () => {}
    const require = Object.assign(() => sharp, {
      resolve: () => '/app/node_modules/sharp/lib/index.js',
    })

    assert.equal(loadSharp(require), sharp)
  })

  test('says how to install sharp when it is missing', () => {
    const notFound = () => {
      throw Object.assign(new Error("Cannot find module 'sharp'"), {
        code: 'MODULE_NOT_FOUND',
      })
    }

    const message = errorWith(Object.assign(notFound, { resolve: notFound }))

    assert.ok(message.includes('yarn workspace api add sharp'))
  })

  test('says when sharp is installed but its native library is not', () => {
    const require = Object.assign(
      () => {
        throw new Error(
          'Could not load the "sharp" module using the linux-x64 runtime',
        )
      },
      { resolve: () => '/app/node_modules/sharp/lib/index.js' },
    )

    const message = errorWith(require)

    assert.ok(message.includes('https://sharp.pixelplumbing.com/install'))
    assert.ok(message.includes('using the linux-x64 runtime'))
  })
})
