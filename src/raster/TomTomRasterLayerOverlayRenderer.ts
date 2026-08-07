import type { LayerSpecification } from 'maplibre-gl';
import {
  type MapCameraPosition,
  type RasterLayerAddParams,
  type RasterLayerChangeParams,
  type RasterLayerEntity,
  type RasterLayerOverlayRenderer,
  type RasterLayerState,
} from '@mapconductor/js-sdk-core';
import { bringMarkerLayersToFront, createRasterSource, removeLayerIfExists, removeSourceIfExists } from '../helpers';
import { TomTomMapViewHolder } from '../TomTomMapViewHolder';

/** GL のソース／レイヤー ID の対。android-sdk の TomTomRasterLayerHandle と同一。 */
export interface TomTomRasterLayerHandle {
  readonly sourceId: string;
  readonly layerId: string;
}

/**
 * android-sdk と同じく汎用 RasterLayerController が駆動する OverlayRenderer 実装。
 * onAdd/onChange/onRemove でネイティブ GL のソース・レイヤーを操作する。スタイルが
 * まだ編集できない場合はハンドルだけ返し、スタイル (再)読み込み後に controller.resync()
 * で貼り直す。
 */
export class TomTomRasterLayerOverlayRenderer
  implements RasterLayerOverlayRenderer<TomTomRasterLayerHandle>
{
  constructor(
    readonly holder: TomTomMapViewHolder,
    private readonly canEditStyle: () => boolean,
  ) {}

  private sourceId(id: string): string {
    return `mc-raster-src-${id}`;
  }

  private layerId(id: string): string {
    return `mc-raster-lyr-${id}`;
  }

  async onAdd(data: RasterLayerAddParams[]): Promise<(TomTomRasterLayerHandle | null)[]> {
    const handles = data.map((params) => this.addLayer(params.state));
    bringMarkerLayersToFront(this.holder.map);
    return handles;
  }

  async onChange(
    data: RasterLayerChangeParams<TomTomRasterLayerHandle>[],
  ): Promise<(TomTomRasterLayerHandle | null)[]> {
    const handles = data.map((params) => {
      const { prev } = params;
      const next = params.current.state;
      if (prev.state.source !== next.source) {
        this.removeLayer(prev.layer);
        return this.addLayer(next);
      }
      this.updateLayer(prev.layer, next);
      return prev.layer;
    });
    bringMarkerLayersToFront(this.holder.map);
    return handles;
  }

  async onRemove(data: RasterLayerEntity<TomTomRasterLayerHandle>[]): Promise<void> {
    for (const entity of data) this.removeLayer(entity.layer);
    bringMarkerLayersToFront(this.holder.map);
  }

  async onCameraChanged(_mapCameraPosition: MapCameraPosition): Promise<void> {}

  async onPostProcess(): Promise<void> {}

  private addLayer(state: RasterLayerState): TomTomRasterLayerHandle {
    const handle: TomTomRasterLayerHandle = {
      sourceId: this.sourceId(state.id),
      layerId: this.layerId(state.id),
    };
    if (!this.canEditStyle()) return handle;

    if (!this.holder.map.getSource(handle.sourceId)) {
      this.holder.map.addSource(handle.sourceId, createRasterSource(state.source));
    }
    const opacity = state.visible ? state.opacity : 0;
    if (!this.holder.map.getLayer(handle.layerId)) {
      this.holder.map.addLayer({
        id: handle.layerId,
        type: 'raster',
        source: handle.sourceId,
        paint: { 'raster-opacity': opacity },
      } as LayerSpecification);
    } else {
      this.holder.map.setPaintProperty(handle.layerId, 'raster-opacity', opacity);
    }
    return handle;
  }

  private updateLayer(handle: TomTomRasterLayerHandle, state: RasterLayerState): void {
    if (!this.canEditStyle()) return;
    if (!this.holder.map.getLayer(handle.layerId)) return;
    this.holder.map.setPaintProperty(handle.layerId, 'raster-opacity', state.visible ? state.opacity : 0);
  }

  private removeLayer(handle: TomTomRasterLayerHandle): void {
    if (!this.canEditStyle()) return;
    removeLayerIfExists(this.holder.map, handle.layerId);
    removeSourceIfExists(this.holder.map, handle.sourceId);
  }
}
