/**
 * BRAND CHARACTER BARREL EXPORT
 *
 * Consumers ko `@wideo11/ui/brand/characters` ya `@wideo11/ui/brand/characters-manifest`
 * se import karna chahiye. Ye index convenience ke liye hai - dono files ke
 * saare public exports yahan se re-export hote hain.
 *
 * Hinglish: ek jagah se sab kuch mile, to imports short rahein
 */

export {
  // ---- Manifest (data/spec) ----
  CHARACTER_SPEC_REVISION,
  CHARACTER_CHANGELOG,
  CHARACTER_MANIFEST,
  CHARACTER_REGISTRY,
  CHARACTER_IDS,
  CANVAS,
  WINO,
  RINO,
  getCharacter,
  validateMinLegibleGeometry,
  characterAdMetadata,
  type CharacterId,
} from './characters-manifest';

export {
  // ---- Components (rendered SVG) ----
  WinoCharacter,
  RinoCharacter,
  BrandCharacter,
  BrandLockup,
  type BrandCharacterProps,
} from './characters';
