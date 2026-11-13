import type * as maplibregl from 'maplibre-gl';
import { BLANK_MAP_STYLE } from '@mapconductor/js-sdk-core';
import type { StyleInput, TomTomMap } from '@tomtom-org/maps-sdk/map';
import { TomTomDesign } from './TomTomDesign';

const BLANK_BACKGROUND = BLANK_MAP_STYLE.layers[0].paint['background-color'];

/**
 * Whether a style is the one `TomTomDesign.None` loads.
 * @internal
 */
export function isBlankStyle(style: StyleInput | undefined): boolean {
  return style === TomTomDesign.None.style;
}

/**
 * Shows `TomTomDesign.None` as a blank map.
 *
 * TomTom's SDK 1.0 only loads its own standard styles, so "no basemap" is a
 * standard style with every layer it declares hidden and its background painted
 * the blank colour the other providers use. The SDK tells its own layers apart
 * from the ones its modules or the app add (`_isStyleLayer`), so MapConductor's
 * overlays are never touched. `styledata` fires again after every style load and
 * every layer the SDK restores, so hiding runs there. It reads each layer's
 * current visibility rather than remembering what it hid: a style switch brings
 * layers with the same ids back visible, and `styledata` also fires while the
 * outgoing style is still the one `getStyle()` returns.
 * @internal
 */
export class TomTomBlankBasemap {
  private active = false;
  /** What hiding changed, so leaving `None` can put it back. */
  private readonly hidden = new Set<string>();
  private readonly originalBackgrounds = new Map<string, string>();
  private readonly onStyleData = () => this.hideStyleLayers();

  constructor(
    private readonly map: maplibregl.Map,
    private readonly ttMap: TomTomMap,
    initialStyle: StyleInput | undefined,
  ) {
    map.on('styledata', this.onStyleData);
    this.setActive(isBlankStyle(initialStyle));
  }

  /** Called before every style switch with the style about to load. */
  setActive(active: boolean): void {
    if (this.active && !active) this.restore();
    this.active = active;
    if (active) this.hideStyleLayers();
  }

  /**
   * Undoes the hiding. Needed because a switch to a style with the same id
   * (None loads `monoLight`, and `MonoLight` is that id with every part) does
   * not reload the style in MapLibre, so the hidden layers would stay hidden.
   * When the switch does reload, these are the outgoing style's layers.
   */
  private restore(): void {
    const has = (id: string) => this.map.getLayer(id) !== undefined;
    for (const id of this.hidden) if (has(id)) this.map.setLayoutProperty(id, 'visibility', 'visible');
    for (const [id, color] of this.originalBackgrounds) if (has(id)) this.map.setPaintProperty(id, 'background-color', color);
    this.hidden.clear();
    this.originalBackgrounds.clear();
  }

  destroy(): void {
    this.map.off('styledata', this.onStyleData);
  }

  private hideStyleLayers(): void {
    if (!this.active) return;
    const style = this.map.getStyle();
    if (!style?.layers) return;
    const isStyleLayer = (this.ttMap as unknown as { _isStyleLayer?: (id: string) => boolean })._isStyleLayer;
    for (const layer of style.layers) {
      if (isStyleLayer && !isStyleLayer.call(this.ttMap, layer.id)) continue;
      if (layer.type === 'background') {
        // A colour string in TomTom's styles; kept as-is to put back.
        const color = this.map.getPaintProperty(layer.id, 'background-color') as string;
        if (color !== BLANK_BACKGROUND) {
          this.originalBackgrounds.set(layer.id, color);
          this.map.setPaintProperty(layer.id, 'background-color', BLANK_BACKGROUND);
        }
      } else if (this.map.getLayoutProperty(layer.id, 'visibility') !== 'none') {
        this.hidden.add(layer.id);
        this.map.setLayoutProperty(layer.id, 'visibility', 'none');
      }
    }
  }
}
