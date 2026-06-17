// src/lib/face.ts
// CLIENT-ONLY on-device face descriptor computation via @vladmandic/face-api.
// Imported dynamically so the (large) tfjs/face-api bundle is code-split and
// never pulled into SSR. Model weights are served from /public/models.
//
// Used in two places, both on-device:
//   • admin browser, at reference-photo upload -> compute the stored descriptor
//   • picker phone, at punch -> compute the live-frame descriptor to compare
// The face image is never uploaded for matching — only the 128-float array.

let faceapiMod: any = null
let modelsPromise: Promise<void> | null = null

async function getFaceApi(): Promise<any> {
  if (!faceapiMod) faceapiMod = await import('@vladmandic/face-api')
  return faceapiMod
}

// Loads the detector + landmark + recognition models once (cached for the page).
export async function loadFaceModels(): Promise<void> {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const faceapi = await getFaceApi()
      const url = '/models'
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(url),
        faceapi.nets.faceLandmark68Net.loadFromUri(url),
        faceapi.nets.faceRecognitionNet.loadFromUri(url),
      ])
    })().catch((e) => {
      modelsPromise = null // allow retry on failure
      throw e
    })
  }
  return modelsPromise
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load image for face detection'))
    img.src = url
  })
}

type FaceInput = HTMLImageElement | HTMLCanvasElement | HTMLVideoElement

// Detect a single face and return its 128-float descriptor, or null if no face
// is found (caller decides what "no face" means — e.g. retry or auto-flag).
export async function computeDescriptor(input: FaceInput): Promise<Float32Array | null> {
  const faceapi = await getFaceApi()
  await loadFaceModels()
  const result = await faceapi
    .detectSingleFace(input)
    .withFaceLandmarks()
    .withFaceDescriptor()
  return result?.descriptor ?? null
}

// Compute a descriptor from a Blob or object/data URL.
export async function computeDescriptorFromSource(src: Blob | string): Promise<Float32Array | null> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src)
  try {
    const img = await loadImage(url)
    return await computeDescriptor(img)
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url)
  }
}

export function descriptorToArray(d: Float32Array): number[] {
  return Array.from(d)
}
