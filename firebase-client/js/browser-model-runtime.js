// The WASM cache creates blob: module URLs, which this site's script policy
// deliberately does not allow. Load the pinned runtime directly from the allowed
// CDN instead. Model weights still use the normal browser cache.
export function configureBrowserModels(env) {
  env.useWasmCache = false;
  env.backends.onnx.wasm.proxy = false;
  // Firebase Hosting isn't cross-origin isolated. A single-threaded runtime also
  // works on mobile without SharedArrayBuffer or an extra generated worker.
  env.backends.onnx.wasm.numThreads = 1;
}
