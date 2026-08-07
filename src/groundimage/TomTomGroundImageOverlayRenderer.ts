import type { ImageSource, LayerSpecification, SourceSpecification } from 'maplibre-gl';
import {
  AbstractGroundImageOverlayRenderer,
  type GroundImageEntity,
  type GroundImageState,
} from '@mapconductor/js-sdk-core';
import { bringMarkerLayersToFront, groundImageCoordinates, removeLayerIfExists, removeSourceIfExists } from '../helpers';
import { TomTomMapViewHolder } from '../TomTomMapViewHolder';

type Coordinates = ReturnType<typeof groundImageCoordinates>;
type ImageCoordinates = Parameters<ImageSource['setCoordinates']>[0];

// ActualGroundImage = string (stateId)
export class TomTomGroundImageOverlayRenderer extends AbstractGroundImageOverlayRenderer<
  TomTomMapViewHolder,
  string
> {
  private readonly canEditStyle: () => boolean;
  /** Last values applied to the map style, keyed by state id. */
  private readonly applied = new Map<string, { url: string; coordsKey: string; opacity: number }>();

  constructor({
    holder,
    canEditStyle,
  }: {
    holder: TomTomMapViewHolder;
    canEditStyle: () => boolean;
  }) {
    super(holder);
    this.canEditStyle = canEditStyle;
  }

  sourceId(id: string): string { return `mc-gimg-src-${id}`; }
  layerId(id: string): string { return `mc-gimg-lyr-${id}`; }

  async createGroundImage(state: GroundImageState): Promise<string | null> {
    const coordinates = groundImageCoordinates(state);
    if (!coordinates) return null;

    const sourceId = this.sourceId(state.id);
    const layerId = this.layerId(state.id);
    const source = this.holder.map.getSource(sourceId) as ImageSource | undefined;

    if (!source) {
      // Adding a new source/layer edits the style structure, which is only safe
      // when the style isn't mid-swap. (During a real design swap the source is
      // gone; resync recreates it once the style is ready again.)
      if (!this.canEditStyle()) return null;
      this.holder.map.addSource(sourceId, {
        type: 'image',
        url: state.imageUrl,
        coordinates,
      } as SourceSpecification);
      if (!this.holder.map.getLayer(layerId)) {
        this.holder.map.addLayer({
          id: layerId,
          type: 'raster',
          source: sourceId,
          paint: { 'raster-opacity': state.opacity },
        } as LayerSpecification);
      }
      bringMarkerLayersToFront(this.holder.map);
      this.applied.set(state.id, {
        url: state.imageUrl,
        coordsKey: JSON.stringify(coordinates),
        opacity: state.opacity,
      });
      return state.id;
    }

    // The source already exists — e.g. resync fired after a transient `styledata`
    // that did NOT actually swap the style (common on TomTom's Orbis style while
    // tiles load). Do NOT skip: sync the existing source to the current state so
    // it doesn't keep stale coordinates/opacity.
    if (!this.holder.map.getLayer(layerId)) {
      if (!this.canEditStyle()) return null;
      this.holder.map.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: { 'raster-opacity': state.opacity },
      } as LayerSpecification);
    }
    this.applyToExisting(state, source, layerId, coordinates);
    bringMarkerLayersToFront(this.holder.map);
    return state.id;
  }

  async updateGroundImageProperties({
    current,
  }: {
    groundImage: string;
    current: GroundImageEntity<string>;
    prev: GroundImageEntity<string>;
  }): Promise<string | null> {
    const state = current.state;
    const sourceId = this.sourceId(state.id);
    const layerId = this.layerId(state.id);
    const source = this.holder.map.getSource(sourceId) as ImageSource | undefined;

    // If the source/layer are gone (real style swap), rebuild from scratch.
    if (!source || !this.holder.map.getLayer(layerId)) {
      removeLayerIfExists(this.holder.map, layerId);
      removeSourceIfExists(this.holder.map, sourceId);
      return this.createGroundImage(state);
    }

    const coordinates = groundImageCoordinates(state);
    if (!coordinates) return null;

    // Repositioning / opacity changes on an EXISTING source+layer are safe even
    // while `isStyleLoaded()` is transiently false (tiles loading), so this path
    // is intentionally NOT gated on canEditStyle. That gate conflates "tiles
    // loading" with "style swapping"; on TomTom the former happens constantly
    // during a marker drag and was dropping ground-image reposition updates.
    this.applyToExisting(state, source, layerId, coordinates);
    return state.id;
  }

  /** Sync an already-created image source+layer to the current state (diffed). */
  private applyToExisting(
    state: GroundImageState,
    source: ImageSource,
    layerId: string,
    coordinates: NonNullable<Coordinates>,
  ): void {
    const prev = this.applied.get(state.id);
    const coordsKey = JSON.stringify(coordinates);
    if (!prev || prev.url !== state.imageUrl) {
      source.updateImage({ url: state.imageUrl, coordinates: coordinates as ImageCoordinates });
    } else if (prev.coordsKey !== coordsKey) {
      // Bounds-only change: reposition without reloading the image.
      source.setCoordinates(coordinates as ImageCoordinates);
    }
    if (!prev || prev.opacity !== state.opacity) {
      this.holder.map.setPaintProperty(layerId, 'raster-opacity', state.opacity);
    }
    this.applied.set(state.id, { url: state.imageUrl, coordsKey, opacity: state.opacity });
  }

  async removeGroundImage(entity: GroundImageEntity<string>): Promise<void> {
    this.applied.delete(entity.groundImage);
    if (!this.canEditStyle()) return;
    removeLayerIfExists(this.holder.map, this.layerId(entity.groundImage));
    removeSourceIfExists(this.holder.map, this.sourceId(entity.groundImage));
  }
}
