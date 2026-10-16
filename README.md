# @cedarjs/uploads-sharp

Image thumbnails and resizes for [Cedar](https://cedarjs.com)'s derived files
(`defineDerivedFiles()` in `@cedarjs/uploads`), built on
[sharp](https://sharp.pixelplumbing.com). **Experimental**, like derived files.

## Install

```bash
yarn workspace api add @cedarjs/uploads-sharp sharp
```

## Usage

```ts
import { sharpVariant } from '@cedarjs/uploads-sharp'

// In defineDerivedFiles()
variants: {
  // 164 × 164, cropped from the middle, as WebP
  'thumb-164': sharpVariant({ width: 164 }),
  // The whole photo, at most 1600 × 1200, as JPEG
  large: sharpVariant({
    width: 1600,
    height: 1200,
    fit: 'inside',
    format: 'jpeg',
    quality: 85,
  }),
},
```

| Option     | Default    | What it does                                                                                                                                                                                                                                                       |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `width`    | (required) | Width in pixels                                                                                                                                                                                                                                                    |
| `height`   | `width`    | Height in pixels                                                                                                                                                                                                                                                   |
| `fit`      | `'cover'`  | `'cover'` crops to exactly `width` × `height`, as a thumbnail tile needs, keeping the middle unless `position` says otherwise. `'inside'` fits the whole image within them, and never enlarges it                                                                  |
| `position` | `'centre'` | For `'cover'`, the part kept: `'top'`, `'right top'`, `'right'`, `'right bottom'`, `'bottom'`, `'left bottom'`, `'left'`, `'left top'`, `'centre'`, or `'entropy'` (the most detailed part) or `'attention'` (the most eye-catching). `'top'` suits document pages |
| `format`   | `'webp'`   | `'webp'`, `'jpeg'`, `'png'` or `'avif'`                                                                                                                                                                                                                            |
| `quality`  | `80`       | 1–100, for WebP, JPEG and AVIF                                                                                                                                                                                                                                     |

The image is turned the right way up by its EXIF orientation, and the made file
carries no metadata (no GPS position, no camera). Only JPEG, PNG, WebP, GIF,
AVIF and TIFF files are decoded, told apart by their bytes, not by the type a
source claims: anything else, such as a PDF, gets `null` and is remembered as
failed. Images over 100 megapixels are refused. A `'cover'` image is exactly
`width` × `height`, however small the photo, so that can be at most 100
megapixels too. Without sharp installed, or with sharp unable to load its native
library on your platform, `sharpVariant()` throws when your app starts, saying
how to fix it, rather than failing every file later.

## HEIC photos

`sharpVariant()` doesn't read HEIC files, the format iPhones take photos in by
default: sharp's prebuilt libvips has no HEVC decoder, for licensing reasons. A
HEIC file gets `null`, and is remembered as failed, like a PDF. To make
thumbnails of HEIC photos, decode them with a package of your own, such as
[heic-decode](https://www.npmjs.com/package/heic-decode), and hand everything
else to `sharpVariant()`:

```bash
yarn workspace api add heic-decode
yarn workspace api add -D @types/heic-decode
```

```ts title="api/src/lib/derivedFiles.ts"
import decodeHeic from 'heic-decode'
import sharp from 'sharp'

import { detectContentType } from '@cedarjs/uploads'
import type { DerivedFileGenerator } from '@cedarjs/uploads'
import { sharpVariant } from '@cedarjs/uploads-sharp'

// A size × size WebP from HEIC too
const thumb = (size: number): DerivedFileGenerator => {
  const fromSharp = sharpVariant({ width: size })

  return async (context) => {
    const { data } = await context.readSource()

    if (detectContentType(data) !== 'image/heic') {
      return fromSharp(context)
    }

    const { width, height, data: rgba } = await decodeHeic({ buffer: data })

    return {
      data: await sharp(Buffer.from(rgba), {
        raw: { width, height, channels: 4 },
        limitInputPixels: 100_000_000,
      })
        .resize(size, size, { fit: 'cover' })
        .webp()
        .toBuffer(),
      mimeType: 'image/webp',
    }
  }
}
```

Then use `thumb(164)` in `variants` instead of `sharpVariant({ width: 164 })`.
`readSource()` reads the file once, so calling it here and again in
`sharpVariant()` costs nothing. heic-decode decodes the whole image before sharp
sees its size, so a huge HEIC uses that much memory first; for HEIC from
untrusted sources, consider decoding it in a
[sandboxed child process](https://cedarjs.com/docs/uploads#server-generated-files).

## Running sharp in a sandbox

`sharpVariant()` runs sharp in your API process. For images from people or
systems you don't trust, you can run sharp in a
[sandboxed child process](https://cedarjs.com/docs/uploads#server-generated-files)
instead, with a generator of your own. sharp's libvips is native code: Node's
permission model only decides whether a native addon may load at all (sharp
needs `allowAddons: true`) and doesn't confine what it does once loaded, so for
sharp the sandbox gives you an empty environment (none of your secrets), a
separate process (a crash in libvips doesn't take your server down), and caps on
its JavaScript heap, time and output size. The heap cap doesn't limit the memory
libvips uses to decode an image; that needs an operating-system limit, such as a
container's.

The child script lives in your `api/src`, where every kind of build finds it and
ships it with sharp, `cedar build --ud` too:

```ts title="api/src/lib/square.child.ts"
import sharp from 'sharp'

const size = Number(process.argv[2])

const chunks: Buffer[] = []
for await (const chunk of process.stdin) {
  chunks.push(chunk)
}

// Only the decoders you need: every other libvips loader stays off
sharp.block({ operation: ['VipsForeignLoad'] })
sharp.unblock({
  operation: ['VipsForeignLoadJpegBuffer', 'VipsForeignLoadPngBuffer'],
})

const webp = await sharp(Buffer.concat(chunks), {
  // 'warning' also refuses JPEGs some phones write slightly off
  failOn: 'error',
  limitInputPixels: 100_000_000,
})
  .autoOrient()
  .resize(size, size, { fit: 'cover' })
  .webp()
  .toBuffer()

process.stdout.write(webp)
```

```ts title="api/src/lib/derivedFiles.ts"
import {
  createConcurrencyLimiter,
  findChildScript,
  runSandboxedChild,
} from '@cedarjs/api/sandbox'
import { detectContentType } from '@cedarjs/uploads'
import type { DerivedFileGenerator } from '@cedarjs/uploads'

// Each child is a whole Node process: two at a time per server process
const limit = createConcurrencyLimiter(2)

const square =
  (size: number): DerivedFileGenerator =>
  async ({ readSource }) => {
    const { data } = await readSource()
    const type = detectContentType(data)

    if (type !== 'image/jpeg' && type !== 'image/png') {
      return null
    }

    const result = await limit(() =>
      runSandboxedChild({
        script: findChildScript(import.meta.dirname, 'square.child'),
        packages: ['sharp'],
        allowAddons: true,
        heapMb: 128,
        input: data,
        args: [String(size)],
        maxInputBytes: 40 * 1024 * 1024,
        maxOutputBytes: 1024 * 1024,
      }),
    )

    // Thrown, so it's logged, and tried again a few times
    if (!result.ok) {
      throw new Error(`no ${size} px square: ${result.message}`)
    }

    // The output is untrusted too: check it's what you asked for
    if (result.output.toString('latin1', 8, 12) !== 'WEBP') {
      throw new Error(`no ${size} px square: the output isn't a WebP`)
    }

    return { data: result.output, mimeType: 'image/webp' }
  }
```

Then use `square(164)` in `variants` as you would
`sharpVariant({ width: 164 })`. See
[the sandbox's README](https://github.com/cedarjs/cedar/blob/main/packages/api/src/sandbox/README.md)
for what it does and doesn't protect against.

## Development

```bash
yarn install
yarn test
yarn typecheck
yarn format
```
