/**
 * useLayerRegistry — React hook into the LayerRegistry Zustand store.
 *
 * Plain pass-through to the underlying store; consumers receive the full
 * state + actions object. LayerPanel (T12), ImportDialog (T13), and the
 * Convert action (T14) all consume this hook.
 *
 * Performance note: a coarse pass-through re-renders consumers on any store
 * change. If a panel becomes hot, swap to a selector form
 *   `useLayerRegistryStore((s) => s.entries)`
 * at the call site (Zustand handles selector memoization).
 */

import { useLayerRegistryStore } from "../state/layerRegistry";

export const useLayerRegistry = () => useLayerRegistryStore();
