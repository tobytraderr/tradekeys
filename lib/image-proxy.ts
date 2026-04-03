export function buildImageProxyUrl(url?: string) {
  if (!url) return undefined
  return `/api/image?url=${encodeURIComponent(url)}`
}
