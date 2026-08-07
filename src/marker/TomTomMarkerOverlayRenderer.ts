import {
  AbstractMarkerOverlayRenderer,
  createDefaultIcon,
  createMarkerEntity,
  markerIconHashCode,
  type AddParams,
  type BitmapIcon,
  type ChangeParams,
  type GeoPoint,
  type MarkerEntity,
  type MarkerManager,
  type MarkerState,
} from '@mapconductor/js-sdk-core';
import { TomTomMapViewHolder } from '../TomTomMapViewHolder';
import { MarkerDragLayer } from './MarkerDragLayer';
import {
  TomTomMarkerProp,
  MarkerLayer,
  type TomTomActualMarker,
} from './MarkerLayer';

const DEFAULT_ICON_ID = 'mc-default';

export class TomTomMarkerOverlayRenderer extends AbstractMarkerOverlayRenderer<
  TomTomMapViewHolder,
  TomTomActualMarker
> {
  private readonly defaultMarkerIcon = createDefaultIcon().toBitmapIcon();
  private readonly iconRefCounter = new Map<string, number>();
  private readonly iconBitmaps = new Map<string, BitmapIcon>();
  private readonly pendingImageRemovals = new Set<string>();

  readonly markerManager: MarkerManager<TomTomActualMarker>;
  readonly markerLayer: MarkerLayer;
  readonly dragLayer: MarkerDragLayer;

  constructor({
    holder,
    markerManager,
    markerLayer,
    dragLayer,
  }: {
    holder: TomTomMapViewHolder;
    markerManager: MarkerManager<TomTomActualMarker>;
    markerLayer: MarkerLayer;
    dragLayer: MarkerDragLayer;
  }) {
    super({ holder });
    this.markerManager = markerManager;
    this.markerLayer = markerLayer;
    this.dragLayer = dragLayer;
    // MarkerLayer.draw() already filters out entities with visible=false,
    // so hiding the native marker while the animation overlay plays is free.
    this.supportsAnimationOverlay = true;
  }

  async onAdd(data: AddParams[]): Promise<(TomTomActualMarker | null)[]> {
    return Promise.all(data.map(async ({ state, bitmapIcon }) => {
      this.retainIcon(state, bitmapIcon);
      return this.createMarkerFeature(state, bitmapIcon);
    }));
  }

  async onChange(
    data: ChangeParams<TomTomActualMarker>[],
  ): Promise<(TomTomActualMarker | null)[]> {
    return Promise.all(data.map(async ({ current, prev, bitmapIcon }) => {
      const prevKey = this.customIconKey(prev.state);
      const currentKey = this.customIconKey(current.state);
      if (prevKey !== currentKey) {
        this.releaseIcon(prev.state);
        this.retainIcon(current.state, bitmapIcon);
      } else if (currentKey) {
        this.iconBitmaps.set(currentKey, bitmapIcon);
      }
      return this.createMarkerFeature(current.state, bitmapIcon);
    }));
  }

  async onRemove(data: MarkerEntity<TomTomActualMarker>[]): Promise<void> {
    for (const entity of data) this.releaseIcon(entity.state);
  }

  override async onPostProcess(): Promise<void> {
    await this.ensureImages();
    this.redraw();
    this.drawDragLayer();
    this.syncIconOffsets();
    this.removeUnusedImages();
  }

  override setMarkerVisible(entity: MarkerEntity<TomTomActualMarker>, visible: boolean): void {
    entity.visible = visible;
    this.redraw();
  }

  setMarkerPosition(
    entity: MarkerEntity<TomTomActualMarker>,
    position: GeoPoint,
  ): void {
    if (!entity.marker) return;
    entity.marker = {
      ...entity.marker,
      geometry: {
        type: 'Point',
        coordinates: [position.longitude, position.latitude],
      },
      properties: {
        ...entity.marker.properties,
        [TomTomMarkerProp.Z_INDEX]: resolveZIndex(entity.state),
      },
    };
    this.markerLayer.draw(this.markerManager.allEntities());
  }

  async updateSelectedMarker({
    entity,
    state,
    bitmapIcon,
  }: {
    entity: MarkerEntity<TomTomActualMarker>;
    state: MarkerState;
    bitmapIcon: BitmapIcon;
  }): Promise<void> {
    const prevKey = this.customIconKey(entity.state);
    const currentKey = this.customIconKey(state);
    if (prevKey !== currentKey) {
      this.releaseIcon(entity.state);
      this.retainIcon(state, bitmapIcon);
    }
    entity.state = state;
    entity.fingerPrint = state.fingerPrint();
    entity.marker = await this.createMarkerFeature(state, bitmapIcon);
    this.dragLayer.selected = entity;
    this.drawDragLayer();
    this.syncIconOffsets();
  }

  drawDragLayer(): void {
    this.dragLayer.drawSelected();
  }

  redraw(): void {
    this.markerLayer.draw(this.markerManager.allEntities());
  }

  async resync(): Promise<void> {
    await this.ensureImages();
    this.redraw();
    this.drawDragLayer();
    this.syncIconOffsets();
  }

  private async createMarkerFeature(
    state: MarkerState,
    bitmapIcon: BitmapIcon,
  ): Promise<TomTomActualMarker> {
    const customIconId = this.customIconKey(state);
    const requestedIconId = customIconId ?? DEFAULT_ICON_ID;
    const imageAvailable = await this.ensureImage(requestedIconId, bitmapIcon);
    const iconId = imageAvailable ? requestedIconId : DEFAULT_ICON_ID;

    return {
      type: 'Feature',
      id: `marker-${state.id}`,
      geometry: {
        type: 'Point',
        coordinates: [state.position.longitude, state.position.latitude],
      },
      properties: {
        [TomTomMarkerProp.ID]: state.id,
        [TomTomMarkerProp.ICON_ID]: iconId,
        [TomTomMarkerProp.Z_INDEX]: resolveZIndex(state),
      },
    };
  }

  private retainIcon(state: MarkerState, bitmapIcon: BitmapIcon): void {
    const key = this.customIconKey(state);
    if (!key) return;
    this.iconBitmaps.set(key, bitmapIcon);
    this.iconRefCounter.set(key, (this.iconRefCounter.get(key) ?? 0) + 1);
    this.pendingImageRemovals.delete(key);
  }

  private releaseIcon(state: MarkerState): void {
    const key = this.customIconKey(state);
    if (!key) return;
    const next = (this.iconRefCounter.get(key) ?? 1) - 1;
    if (next > 0) {
      this.iconRefCounter.set(key, next);
      return;
    }
    this.iconRefCounter.delete(key);
    this.iconBitmaps.delete(key);
    this.pendingImageRemovals.add(key);
  }

  private customIconKey(state: MarkerState): string | null {
    if (!state.icon) return null;
    return `mc-icon-${markerIconHashCode(state.icon)}`;
  }

  private async ensureImages(): Promise<void> {
    await this.ensureImage(DEFAULT_ICON_ID, this.defaultMarkerIcon);
    for (const [id, bitmapIcon] of this.iconBitmaps) {
      await this.ensureImage(id, bitmapIcon);
    }
  }

  private async ensureImage(id: string, bitmapIcon: BitmapIcon): Promise<boolean> {
    if (this.holder.map.hasImage(id)) return true;
    try {
      const image = await this.loadBitmapIcon(bitmapIcon.url);
      if (!this.holder.map.hasImage(id)) {
        this.holder.map.addImage(id, image);
      }
      return true;
    } catch {
      if (id === DEFAULT_ICON_ID) {
        return this.ensureFallbackDefaultIcon();
      }
      return false;
    }
  }

  private async loadBitmapIcon(
    url: string,
  ): Promise<HTMLImageElement | ImageBitmap | ImageData> {
    try {
      const image = await this.holder.map.loadImage(url);
      return image.data;
    } catch {
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(`Failed to load marker icon: ${url}`));
      });
      return image;
    }
  }

  private ensureFallbackDefaultIcon(): boolean {
    if (this.holder.map.hasImage(DEFAULT_ICON_ID)) return true;
    const size = 48;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return false;

    context.beginPath();
    context.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    context.fillStyle = '#ff0000';
    context.fill();
    context.strokeStyle = '#ffffff';
    context.lineWidth = 2;
    context.stroke();
    this.holder.map.addImage(DEFAULT_ICON_ID, context.getImageData(0, 0, size, size));
    return true;
  }

  private removeUnusedImages(): void {
    for (const id of this.pendingImageRemovals) {
      if (this.holder.map.hasImage(id)) {
        try {
          this.holder.map.removeImage(id);
        } catch {
          continue;
        }
      }
      this.pendingImageRemovals.delete(id);
    }
  }

  private syncIconOffsets(): void {
    const offsets = new Map<string, [number, number]>();
    for (const [iconId, bitmapIcon] of this.iconBitmaps) {
      offsets.set(iconId, createIconOffset(bitmapIcon));
    }
    const fallback = createIconOffset(this.defaultMarkerIcon);
    this.markerLayer.setIconOffsets(offsets, fallback);
    this.dragLayer.setIconOffsets(offsets, fallback);
  }

  buildEntity(
    marker: TomTomActualMarker,
    state: MarkerState,
  ): MarkerEntity<TomTomActualMarker> {
    return createMarkerEntity({
      marker,
      state,
      visible: true,
      isRendered: true,
    });
  }
}

function createIconOffset(icon: BitmapIcon): [number, number] {
  return [
    -icon.size.width * icon.anchor.x,
    -icon.size.height * icon.anchor.y,
  ];
}

function resolveZIndex(state: MarkerState): number {
  // android-sdk と同じく、未指定(null)のときだけ緯度による自動 z-order にフォールバックする。
  // 明示的な 0 は「z-order 0」として尊重する。
  if (state.zIndex != null) return state.zIndex;
  return Math.round(-state.position.latitude * 1_000_000 - state.position.longitude);
}
