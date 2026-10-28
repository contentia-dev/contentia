// `pathToSegments` and `pathCombine` are re-exported from `contentia/storage`
// so the two packages share a single implementation. Document-specific path
// helpers (if any are added later) belong in this file alongside the
// re-exports.
export { pathCombine, pathToSegments } from 'contentia/storage';
