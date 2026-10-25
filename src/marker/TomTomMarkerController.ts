import {
  AbstractMarkerController,
  createDefaultIcon,
  createRasterLayerState,
  fingerPrintEquals,
  LocalTileServer,
  MARKER_HIT_RADIUS_MOUSE_PX,
  MARKER_HIT_RADIUS_TOUCH_PX,
  MarkerTileRenderer,
  MarkerTilingOptions,
  RasterLayerSource,
  type GeoPoint,
  type MarkerEntity,
  type MarkerFingerPrint,
  type MarkerState,
  type RasterLayerState,
  markerSearchBounds,
  pickMarkerHit,
  preferMarkerHit,
  type MarkerHit,
  type GeoPointInterface,
} from '@mapconductor/js-sdk-core';
import * as maplibregl from 'maplibre-gl';
import { TomTomMapViewHolder } from '../TomTomMapViewHolder';
import { TomTomMarkerOverlayRenderer } from './TomTomMarkerOverlayRenderer';
import {
  type TomTomActualMarker,
} from './MarkerLayer';

const MAPCONDUCTOR_TILE_PROTOCOL = 'mc-local-tile';

const EMPTY_TILE = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10,
  0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 11, 73, 68, 65, 84, 8, 215, 99, 96, 0, 2, 0, 0, 5, 0, 1, 226, 38, 5, 155,
  0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

let mapLibreTileProtocolRegistered = false;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function parseLocalTileUrl(urlString: string): { routeId: string; x: number; y: number; z: number } | null {
  const url = new URL(urlString);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 4 && parts.length !== 5) return null;

  const offset = parts.length === 5 ? 1 : 0;
  const z = Number(parts[1 + offset]);
  const x = Number(parts[2 + offset]);
  const y = Number(parts[3 + offset].replace(/\.png$/, ''));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;

  return { routeId: url.hostname, x, y, z };
}

function registerTomTomTileProtocol(): void {
  if (mapLibreTileProtocolRegistered) return;

  const protocolApi = maplibregl as unknown as {
    addProtocol?: (
      customProtocol: string,
      loadFn: (params: { url: string }) => Promise<{ data: ArrayBuffer }>,
    ) => void;
  };
  if (!protocolApi.addProtocol) return;

  protocolApi.addProtocol(MAPCONDUCTOR_TILE_PROTOCOL, async (params) => {
    const parsed = parseLocalTileUrl(params.url);
    if (!parsed) return { data: toArrayBuffer(EMPTY_TILE) };

    // An empty spot comes back as a transparent tile; a render that failed
    // throws, which the protocol reads as a load to retry. Answering a
    // failure with a transparent tile would cache a hole instead.
    const bytes = await LocalTileServer.startServer().fetchTileOrThrow(parsed.routeId, {
      x: parsed.x,
      y: parsed.y,
      z: parsed.z,
    });
    return { data: toArrayBuffer(bytes) };
  });

  mapLibreTileProtocolRegistered = true;
}

function localTileUrlTemplate({
  routeId,
  tileSize,
  cacheKey,
}: {
  routeId: string;
  tileSize: number;
  cacheKey?: string;
}): string {
  const base = `${MAPCONDUCTOR_TILE_PROTOCOL}://${routeId}/${tileSize}`;
  if (cacheKey) {
    return `${base}/${cacheKey}/{z}/{x}/{y}.png`;
  }
  return `${base}/{z}/{x}/{y}.png`;
}

export class TomTomMarkerController extends AbstractMarkerController<TomTomActualMarker> {
  declare readonly renderer: TomTomMarkerOverlayRenderer;

  private selected: MarkerEntity<TomTomActualMarker> | null = null;
  private pendingSelectedPosition: GeoPoint | null = null;
  private selectedPositionFrame: number | null = null;

  // ── Tile rendering ────────────────────────────────────────────────────────
  private readonly tilingOptions: MarkerTilingOptions;
  private tileRenderer: MarkerTileRenderer<MarkerState> | null = null;
  private tileRouteId: string | null = null;
  private tileVersion = 0;
  // Bumped on every syncTiledOverlay()/removeTileOverlay() call. syncTiledOverlay
  // awaits SW round-trips, so a later call (or clear()/destroy()) can finish first;
  // an earlier call resuming afterward must not clobber the newer result.
  private tileGeneration = 0;

  /** Called by TomTomViewController when RasterLayerState changes. */
  onRasterLayerUpdate: ((state: RasterLayerState | null) => Promise<void>) | null = null;

  constructor(
    private readonly holder: TomTomMapViewHolder,
    renderer: TomTomMarkerOverlayRenderer,
    tilingOptions: MarkerTilingOptions = MarkerTilingOptions.Default,
  ) {
    super({ markerManager: renderer.markerManager, renderer });
    this.tilingOptions = tilingOptions;
  }

  // ── shouldTile ────────────────────────────────────────────────────────────

  protected override shouldTile(state: MarkerState, totalCount: number): boolean {
    return (
      this.tilingOptions.enabled &&
      totalCount >= this.tilingOptions.minMarkerCount &&
      !state.draggable &&
      state.getAnimation() == null
    );
  }

  // ── onTiledMarkersChanged ─────────────────────────────────────────────────

  protected override async onTiledMarkersChanged(): Promise<void> {
    await this.syncTiledOverlay();
  }

  private async syncTiledOverlay(): Promise<void> {
    const generation = ++this.tileGeneration;

    const tiledStates = this.markerManager
      .allEntities()
      .filter(e => e.tiling)
      .map((e) => e.state);

    if (tiledStates.length === 0) {
      await this.removeTileOverlay();
      return;
    }

    if (!this.tileRouteId) {
      this.tileRouteId = `mc-tile-${generateId()}`;
    }

    const server = LocalTileServer.startServer();

    const { iconScaleCallback } = this.tilingOptions;
    const tileRenderer = new MarkerTileRenderer<MarkerState>(tiledStates, 256, iconScaleCallback ?? undefined);
    this.tileRenderer = tileRenderer;
    this.tileVersion++;
    server.register(this.tileRouteId, tileRenderer);

    const template = LocalTileServer.isServiceWorkerSupported()
      ? await this.serviceWorkerTileTemplate(server, tileRenderer)
      : this.localTileTemplate();

    // A newer sync (or clear()/destroy(), which unregisters our route and
    // bumps the generation) already ran while we were awaiting the SW
    // round-trip. Applying our (stale) result now would either resurrect a
    // removed overlay or overwrite a newer one — bail out.
    if (generation !== this.tileGeneration) return;

    const rasterState = createRasterLayerState({
      id: 'mc-marker-tiles',
      source: RasterLayerSource.UrlTemplate({
        template,
        tileSize: 256,
      }),
    });
    await this.onRasterLayerUpdate?.(rasterState);
  }

  private async serviceWorkerTileTemplate(
    server: LocalTileServer,
    tileRenderer: MarkerTileRenderer<MarkerState>,
  ): Promise<string> {
    server.startServiceWorker('/tile-sw.js');
    await server.waitForController();
    await server.sendSWRegisterAndWait(this.tileRouteId!, await tileRenderer.toSWData());
    return server.urlTemplate({
      routeId: this.tileRouteId!,
      tileSize: 256,
      cacheKey: String(this.tileVersion),
    });
  }

  private localTileTemplate(): string {
    registerTomTomTileProtocol();
    return localTileUrlTemplate({
      routeId: this.tileRouteId!,
      tileSize: 256,
      cacheKey: String(this.tileVersion),
    });
  }

  private async removeTileOverlay(): Promise<void> {
    this.tileGeneration++;
    if (!this.tileRouteId) return;
    LocalTileServer.startServer().unregister(this.tileRouteId);
    this.tileRenderer = null;
    this.tileRouteId = null;
    await this.onRasterLayerUpdate?.(null);
  }

  // ── composition ───────────────────────────────────────────────────────────

  async composition(data: MarkerState[]): Promise<void> {
    const selected = this.selected;
    if (!selected) {
      await this.add(data);
      return;
    }

    const selectedState = data.find((state) => state.id === selected.state.id);
    if (selectedState) {
      const dragPosition = selected.state.position;
      selectedState.position = dragPosition;
      await this.renderer.updateSelectedMarker({
        entity: selected,
        state: selectedState,
        bitmapIcon: selectedState.icon?.toBitmapIcon() ?? createDefaultIcon().toBitmapIcon(),
      });
    } else {
      await this.setSelectedMarker(null);
      await this.add(data);
      return;
    }

    const nonSelected = data.filter((state) => state.id !== selected.state.id);
    if (this.hasCompositionChanges(nonSelected)) {
      await this.add(nonSelected);
    }
  }

  // ── find / findWithZoom ───────────────────────────────────────────────────

  override find(position: GeoPoint): MarkerEntity<TomTomActualMarker> | null {
    return this.findWithZoom(position, this.holder.map.getZoom(), 'mouse');
  }

  /**
   * Find the marker under `position` at the given zoom level.
   *
   * For regular markers this defers to MapLibre's own rendered-geometry query
   * (`queryRenderedFeatures`), which returns the icons actually painted under the
   * point in render order — topmost first. That respects the real stacking order
   * AND the true on-screen icon size/placement, so it stays correct under tilt,
   * rotation and icon scaling (a hand-rolled geo/pixel-box test does not: the
   * icon's native bitmap size and tilt projection make it match far-off markers).
   * A small box the size of the pointer's
   * hit radius is queried as a fallback for near-misses on small icons.
   * Falls back to the tiled-marker (raster) radius hit-test when nothing regular
   * is hit. Mirrors Android's `GoogleMapMarkerController.find(position, zoom)`.
   */
  findWithZoom(
    position: GeoPoint,
    zoom: number,
    pointerType: 'touch' | 'mouse',
  ): MarkerEntity<TomTomActualMarker> | null {
    const tolerance =
      pointerType === 'touch' ? MARKER_HIT_RADIUS_TOUCH_PX : MARKER_HIT_RADIUS_MOUSE_PX;
    let regular: MarkerHit<MarkerEntity<TomTomActualMarker>> | null = null;
    const map = this.holder.map;
    const layerId = this.renderer.markerLayer.layerId;
    if (map.getLayer(layerId)) {
      const clickScreen = this.holder.toScreenOffset(position);
      // MapLibre returns matching symbols topmost-first, so the first regular
      // marker in the list is the one drawn on top of the stack.
      const topMost = (features: Array<{ properties?: Record<string, unknown> | null }>) => {
        for (const feature of features) {
          const id = feature.properties?.['mc-id'];
          if (typeof id !== 'string') continue;
          const entity = this.markerManager.getEntity(id);
          if (entity && entity.marker !== null) return entity;
        }
        return null;
      };
      // Exact point first (precise topmost under the cursor)...
      let hit = topMost(
        map.queryRenderedFeatures([clickScreen.x, clickScreen.y] as unknown as [number, number], {
          layers: [layerId],
        }),
      );
      // 指の下に描かれている通常マーカー。タイル化マーカーより手前に描かれるので、そのまま勝つ。
      if (hit) return hit;
      // ...then a small tap-tolerance box for near-misses on small icons.
      // Pointer-appropriate slop, the same radii the icon-rect fallback below
      // uses. `Settings.Default.tapTolerance` (48) is NOT the right value
      // here: it is a general map-wide tap slop, and querying a +/-48 CSS px
      // box around a 48 px icon made the marker answer clicks up to 48 px
      // outside it — roughly a 144 px square target for a mouse, which is
      // both wrong and more generous than the fallback that follows. A
      // finger still gets the wider touch radius.
      hit = topMost(
        map.queryRenderedFeatures(
          [
            [clickScreen.x - tolerance, clickScreen.y - tolerance],
            [clickScreen.x + tolerance, clickScreen.y + tolerance],
          ] as unknown as [[number, number], [number, number]],
          { layers: [layerId] },
        ),
      );
      if (hit) {
        const markerScreen = this.holder.toScreenOffset(hit.state.position);
        regular = {
          item: hit,
          exact: false,
          anchorY: markerScreen.y,
          distance: Math.hypot(clickScreen.x - markerScreen.x, clickScreen.y - markerScreen.y),
        };
      } else {
        // 最後の手段。タップ点の周りの通常マーカーを候補にし、コアの pickMarkerHit で選ぶ
        // （指の下にアイコンかラベルがあるものを優先し、なければ許容範囲内でアンカーの近いもの）。
        // android / iOS の find と同じ規則。以前は最近傍の 1 つだけを見ていたので、
        // 隣のピンの頭や横に置いたラベルを押すと外れていた。
        const project = (p: GeoPointInterface) => this.holder.toScreenOffset(p as GeoPoint);
        const bounds = markerSearchBounds(position, clickScreen, project);
        const candidates = bounds
          ? this.markerManager.findMarkersInBounds(bounds).filter(entity => entity.marker !== null)
          : [];
        regular = pickMarkerHit(
          clickScreen,
          candidates,
          entity => {
            const bmp = (entity.state.icon ?? createDefaultIcon()).toBitmapIcon();
            return {
              anchorScreen: project(entity.state.position),
              width: bmp.size.width,
              height: bmp.size.height,
              anchor: bmp.anchor,
            };
          },
          tolerance,
        );
      }
    }

    // タイル化マーカーも同じ規則で比べる（指の下に描かれていれば、通常マーカーの近接より勝つ）。
    const tiledHit = this.tileRenderer?.findHit(position, tolerance, zoom) ?? null;
    const tiledEntity = tiledHit ? this.markerManager.getEntity(tiledHit.item.id) : null;
    const best = preferMarkerHit<MarkerEntity<TomTomActualMarker>>(
      regular,
      tiledHit && tiledEntity ? { ...tiledHit, item: tiledEntity } : null,
    );
    return best?.item ?? null;
  }


  // ── other existing methods ────────────────────────────────────────────────

  override async update(state: MarkerState): Promise<void> {
    const selected = this.selected;
    if (selected?.state.id === state.id) {
      const nextFingerPrint = state.fingerPrint();
      if (hasOnlyPositionChanged(selected.fingerPrint, nextFingerPrint)) {
        selected.state = state;
        selected.fingerPrint = nextFingerPrint;
        this.updateSelectedPosition(state.position);
        return;
      }
      await this.renderer.updateSelectedMarker({
        entity: selected,
        state,
        bitmapIcon: state.icon?.toBitmapIcon() ?? createDefaultIcon().toBitmapIcon(),
      });
      return;
    }
    await super.update(state);
  }

  has(state: MarkerState): boolean {
    return this.selected?.state.id === state.id || this.markerManager.hasEntity(state.id);
  }

  getSelectedMarker(): MarkerEntity<TomTomActualMarker> | null {
    return this.selected;
  }

  async setSelectedMarker(
    entity: MarkerEntity<TomTomActualMarker> | null,
  ): Promise<void> {
    if (!entity) {
      const selected = this.selected;
      if (!selected) return;
      this.cancelSelectedPositionFrame();
      this.flushSelectedPosition();
      this.setDraggingState(selected.state, false);
      this.renderer.dragLayer.selected = null;
      this.renderer.drawDragLayer();
      this.markerManager.registerEntity(selected);
      this.renderer.redraw();
      this.selected = null;
      return;
    }

    this.cancelSelectedPositionFrame();
    this.pendingSelectedPosition = null;
    this.selected = entity;
    this.markerManager.removeEntity(entity.state.id);
    this.setDraggingState(entity.state, true);
    this.renderer.dragLayer.selected = entity;
    this.renderer.dragLayer.updatePosition(entity.state.position);
    this.renderer.redraw();
    this.renderer.drawDragLayer();
  }

  updateSelectedPosition(position: GeoPoint): void {
    this.pendingSelectedPosition = position;
    if (this.selectedPositionFrame != null) return;
    this.selectedPositionFrame = requestAnimationFrame(() => {
      this.selectedPositionFrame = null;
      this.flushSelectedPosition();
    });
  }

  async resync(): Promise<void> {
    await this.renderer.resync();
  }

  override async clear(): Promise<void> {
    this.cancelSelectedPositionFrame();
    this.pendingSelectedPosition = null;
    if (this.selected) {
      this.setDraggingState(this.selected.state, false);
      this.selected = null;
      this.renderer.dragLayer.selected = null;
      this.renderer.drawDragLayer();
    }
    await this.removeTileOverlay();
    await super.clear();
    await this.renderer.onPostProcess();
  }

  override destroy(): void {
    this.cancelSelectedPositionFrame();
    this.pendingSelectedPosition = null;
    this.tileGeneration++;
    this.selected = null;
    this.renderer.dragLayer.selected = null;
    if (this.tileRouteId) {
      LocalTileServer.startServer().unregister(this.tileRouteId);
      this.tileRouteId = null;
    }
    super.destroy();
  }

  private flushSelectedPosition(): void {
    const position = this.pendingSelectedPosition;
    this.pendingSelectedPosition = null;
    if (!position || !this.selected) return;
    if (this.renderer.dragLayer.updatePosition(position)) {
      this.selected.fingerPrint = this.selected.state.fingerPrint();
      this.renderer.drawDragLayer();
      this.holder.map.triggerRepaint();
    }
  }

  private cancelSelectedPositionFrame(): void {
    if (this.selectedPositionFrame == null) return;
    cancelAnimationFrame(this.selectedPositionFrame);
    this.selectedPositionFrame = null;
  }

  private hasCompositionChanges(data: MarkerState[]): boolean {
    const nextIds = new Set(data.map((state) => state.id));
    const currentEntities = this.markerManager.allEntities();
    if (currentEntities.length !== nextIds.size) return true;

    for (const entity of currentEntities) {
      if (!nextIds.has(entity.state.id)) return true;
    }

    return data.some((state) => {
      const entity = this.markerManager.getEntity(state.id);
      return !entity || !fingerPrintEquals(state.fingerPrint(), entity.fingerPrint);
    });
  }
}

function hasOnlyPositionChanged(
  previous: MarkerFingerPrint,
  current: MarkerFingerPrint,
): boolean {
  return (
    previous.id === current.id &&
    previous.icon === current.icon &&
    previous.clickable === current.clickable &&
    previous.draggable === current.draggable &&
    previous.animation === current.animation &&
    previous.zIndex === current.zIndex
  );
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}
