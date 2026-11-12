import { type AttributionRule, type MapDesignTypeInterface } from '@mapconductor/js-sdk-core';
import type { StyleInput } from '@tomtom-org/maps-sdk/map';

export interface TomTomMapDesignType extends MapDesignTypeInterface<string> {
  /** TomTom Orbis style: a standard style id ('streetLight' etc.) or a StandardStyle config. */
  readonly style: StyleInput;
}

/**
 * TomTom Orbis map design (style).
 *
 * `id` / `getValue()` is the stable key (used for save/restore and as the map
 * re-init trigger); the value actually loaded by the SDK is [style] (a TomTom
 * Orbis {@link StyleInput}). Mirrors android `TomTomMapDesign` (Standard /
 * Driving / Satellite), with light/dark variants exposed like the other web
 * providers.
 */
export class TomTomDesign implements TomTomMapDesignType {
  readonly id: string;
  readonly style: StyleInput;
  readonly attributionRules: readonly AttributionRule[];

  constructor(
    id: string,
    style: StyleInput,
    attributionRules: readonly AttributionRule[] = []
  ) {
    this.id = id;
    this.style = style;
    this.attributionRules = attributionRules;
  }

  getValue(): string {
    return `mapDesign_id=${this.id},style=${JSON.stringify(this.style)}`;
  }

  /**
   * No basemap: a background colour and nothing else.
   *
   * SDK 1.0 loads TomTom standard styles only (a style JSON such as
   * `BLANK_MAP_STYLE` is refused), so this loads the lightest standard style
   * with none of its optional parts and the controller hides every layer the
   * style itself declares, keeping only its background in the blank colour
   * (see `TomTomBlankBasemap`). Layers the SDK modules or MapConductor add are
   * not the style's and stay visible.
   */
  static readonly None = new TomTomDesign('none', { type: 'standard', id: 'monoLight', include: [] });
  /** Default (browsing) light style. */
  static readonly Standard = new TomTomDesign('standard', 'streetLight');
  static readonly StandardLight = new TomTomDesign('standard-light', 'streetLight');
  static readonly StandardDark = new TomTomDesign('standard-dark', 'streetDark');
  /** Navigation-oriented styles. */
  static readonly Driving = new TomTomDesign('driving', 'streetLightDriving');
  static readonly DrivingLight = new TomTomDesign('driving-light', 'streetLightDriving');
  static readonly DrivingDark = new TomTomDesign('driving-dark', 'streetDarkDriving');
  /** Minimalist monochrome styles. */
  static readonly MonoLight = new TomTomDesign('mono-light', 'monoLight');
  static readonly MonoDark = new TomTomDesign('mono-dark', 'monoDark');
  /** Satellite imagery basemap. */
  static readonly Satellite = new TomTomDesign('satellite', 'streetSatellite');
}
