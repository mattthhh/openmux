/**
 * Placement module - Kitty graphics placement storage in scrollback.
 * Re-exports from the archive-placement module for convenience.
 */

export {
  PLACEMENT_SIZE,
  packPlacement,
  unpackPlacement,
  packPlacements,
  unpackPlacements,
  toArchivePlacement,
  type ArchivePlacement,
} from "../../kitty-graphics/archive-placement"
