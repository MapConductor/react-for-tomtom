import type { AttributionRule, MapDesignTypeInterface } from '@mapconductor/js-sdk-core';
import type { StyleInput } from '@tomtom-org/maps-sdk/map';

export interface TomTomMapDesignType extends MapDesignTypeInterface<string> {
  /** TomTom Orbis style: a standard style id ('standardLight' etc.) or a StandardStyle config. */
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

  /** Default (browsing) light style. */
  static readonly Standard = new TomTomDesign('standard', 'standardLight');
  static readonly StandardLight = new TomTomDesign('standard-light', 'standardLight');
  static readonly StandardDark = new TomTomDesign('standard-dark', 'standardDark');
  /** Navigation-oriented styles. */
  static readonly Driving = new TomTomDesign('driving', 'drivingLight');
  static readonly DrivingLight = new TomTomDesign('driving-light', 'drivingLight');
  static readonly DrivingDark = new TomTomDesign('driving-dark', 'drivingDark');
  /** Minimalist monochrome styles. */
  static readonly MonoLight = new TomTomDesign('mono-light', 'monoLight');
  static readonly MonoDark = new TomTomDesign('mono-dark', 'monoDark');
  /** Satellite imagery basemap. */
  static readonly Satellite = new TomTomDesign('satellite', 'satellite');
}
