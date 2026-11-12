import { cameraFromPaddedCenter, cameraWithPaddedCenter, MapPaddings, PolygonTiler, POLYGON_TILE_LAYER_ID, polygonTileRasterLayerState, POLYLINE_TILE_LAYER_ID, polylineTileRasterLayerState, CIRCLE_TILE_LAYER_ID, circleTileRasterLayerState } from '@mapconductor/js-sdk-core';
import type * as maplibregl from 'maplibre-gl';
import {
  BaseMapViewController,
  type CameraRestriction,
  type CircleCapable,
  type GeoRectBounds,
  type GroundImageCapable,
  type MapCameraPosition,
  type OnMapInitializedHandler,
  type MapViewControllerInterface,
  type MarkerAnimationOverlayHost,
  type MarkerCapable,
  type MarkerState,
  type OnGroundImageEventHandler,
  type OnMarkerEventHandler,
  type PolygonCapable,
  type PolylineCapable,
  type RasterLayerCapable,
  type MapUISettings,
  type GlGestureHandlers,
  applyGlMapUISettings,
  isEmptyCameraRestriction,
  type GeoPoint,
} from '@mapconductor/js-sdk-core';
import { ZoomAltitudeConverter } from './zoom/ZoomAltitudeConverter';
import { readVerticalFov } from './MapCameraPosition';
import type { TomTomMap } from '@tomtom-org/maps-sdk/map';
import type { TomTomMapDesignType } from './TomTomDesign';
import { isBlankStyle, type TomTomBlankBasemap } from './TomTomBlankBasemap';
import { TomTomMapViewHolder } from './TomTomMapViewHolder';
import { TomTomMarkerController } from './marker/TomTomMarkerController';
import { TomTomMarkerEventController } from './marker/TomTomMarkerEventController';
import { TomTomCircleController } from './circle/TomTomCircleController';
import { TomTomPolylineController } from './polyline/TomTomPolylineController';
import { TomTomPolygonController } from './polygon/TomTomPolygonController';
import { TomTomGroundImageController } from './groundimage/TomTomGroundImageController';
import { TomTomRasterLayerController } from './raster/TomTomRasterLayerController';
import { installMapEventListeners } from './TomTomViewControllerEvents';
import {
  easeToPosition,
  fitMapBounds,
  jumpToPosition,
  readCameraPosition,
} from './TomTomViewControllerCamera';

export class TomTomViewController
  extends BaseMapViewController
  implements
    MapViewControllerInterface,
    MarkerCapable,
    CircleCapable,
    PolylineCapable,
    PolygonCapable,
    GroundImageCapable,
    RasterLayerCapable
{
  private readonly mapInstance: maplibregl.Map;
  private initialized = false;
  private logicalTiltHint: number | null = null;
  /**
   * The paddings the app asked for. The engine's own `padding` is left at zero:
   * it widens the frustum toward the top, so under tilt a large top padding
   * reaches past the horizon and the engine loads tiles out to it (the map
   * stalls). Shifting the camera centre instead puts the target at the padded
   * centre with the frustum the engine would draw without padding.
   */
  private cameraPaddings: MapPaddings = MapPaddings.Zeros;
  private readonly styleReadyRef: { current: boolean };
  /** The SDK wrapper that owns style switching; null when driven headless. */
  private readonly ttMap: TomTomMap | null;
  private blankBasemap: TomTomBlankBasemap | null = null;

  readonly holder: TomTomMapViewHolder;
  private readonly markerController: TomTomMarkerController;
  private readonly markerEventController: TomTomMarkerEventController;
  private readonly circleController: TomTomCircleController;
  private readonly polylineController: TomTomPolylineController;
  private readonly polygonController: TomTomPolygonController;
  private readonly groundImageController: TomTomGroundImageController;
  private readonly rasterLayerController: TomTomRasterLayerController;

  constructor(
    holder: TomTomMapViewHolder,
    markerController: TomTomMarkerController,
    markerEventController: TomTomMarkerEventController,
    circleController: TomTomCircleController,
    polylineController: TomTomPolylineController,
    polygonController: TomTomPolygonController,
    groundImageController: TomTomGroundImageController,
    rasterLayerController: TomTomRasterLayerController,
    styleReadyRef: { current: boolean } = { current: true },
    logicalTiltHint: number | null = null,
    ttMap: TomTomMap | null = null,
  ) {
    super();
    this.ttMap = ttMap;
    this.mapInstance = holder.map;
    this.initialized = holder.map.loaded();
    this.holder = holder;
    this.holder.setController(this);
    this.styleReadyRef = styleReadyRef;
    this.logicalTiltHint = logicalTiltHint;
    this.markerController = markerController;
    this.markerEventController = markerEventController;
    this.circleController = circleController;
    this.polylineController = polylineController;
    this.polygonController = polygonController;
    this.groundImageController = groundImageController;
    this.rasterLayerController = rasterLayerController;

    // Capable ファサードの既定実装がここから kind で引く。
    // **登録を忘れると composition が黙って捨てられる。**
    this.registerOverlayController(this.markerController);
    this.registerOverlayController(this.circleController);
    this.registerOverlayController(this.polylineController);
    this.registerOverlayController(this.polygonController);
    this.registerOverlayController(this.groundImageController);
    this.registerOverlayController(this.rasterLayerController);
    // Many polygons are drawn as tiles by the tile service worker and shown
    // as one raster layer; taps still resolve against the original shapes.
    this.polygonController.tiler = new PolygonTiler();
    this.polygonController.tiler.onTemplate = async (template, tileSize) => {
      if (template) await this.rasterLayerController.upsert(polygonTileRasterLayerState(template, tileSize));
      else await this.rasterLayerController.removeById(POLYGON_TILE_LAYER_ID);
    };
    // Many polylines are drawn as tiles too (the tiler is set by the provider, with the map's
    // PolylineTilingOptions) and shown as one raster layer, in the polyline band.
    if (this.polylineController.tiler) {
      this.polylineController.tiler.onTemplate = async (template, tileSize) => {
        if (template) await this.rasterLayerController.upsert(polylineTileRasterLayerState(template, tileSize));
        else await this.rasterLayerController.removeById(POLYLINE_TILE_LAYER_ID);
      };
    }
    // Many circles are drawn as tiles too (the tiler is set by the provider, with the map's
    // CircleTilingOptions) and shown as one raster layer, at the bottom of the circle band.
    if (this.circleController.tiler) {
      this.circleController.tiler.onTemplate = async (template, tileSize) => {
        if (template) await this.rasterLayerController.upsert(circleTileRasterLayerState(template, tileSize));
        else await this.rasterLayerController.removeById(CIRCLE_TILE_LAYER_ID);
      };
    }
    // upsert / removeById, not composition / clear: those replace every raster
    // layer, so marker tiles removed the app's RasterLayers and polygon tiles
    // (and the app's RasterLayers removed the marker tiles).
    this.markerController.onRasterLayerUpdate = async (state) => {
      if (state) await this.rasterLayerController.upsert(state);
      else await this.rasterLayerController.removeById('mc-marker-tiles');
    };
    this.setupEventListeners();
  }

  getMap(): maplibregl.Map {
    return this.mapInstance;
  }

  /**
   * Swaps the Orbis style in place through the SDK wrapper (a style id is
   * only meaningful to it). `styledata` then resyncs every overlay, as for
   * MapLibre. Called by the view state's `mapDesignType` setter.
   */
  setMapDesignType(design: TomTomMapDesignType): void {
    this.blankBasemap?.setActive(isBlankStyle(design.style));
    this.ttMap?.setStyle(design.style);
  }

  /**
   * Hands over what shows `TomTomDesign.None` (the provider creates it before the
   * style loads, so the first paint is already blank).
   * @internal
   */
  attachBlankBasemap(blankBasemap: TomTomBlankBasemap): void {
    this.blankBasemap = blankBasemap;
  }

  applyUISettings(settings: MapUISettings): void {
    applyGlMapUISettings(this.mapInstance as unknown as Partial<GlGestureHandlers>, settings, 'TomTom');
  }

  private setupEventListeners(): void {
    installMapEventListeners({
      map: this.mapInstance,
      styleReadyRef: this.styleReadyRef,
      markerController: this.markerController,
      markerEventController: this.markerEventController,
      circleController: this.circleController,
      polylineController: this.polylineController,
      polygonController: this.polygonController,
      groundImageController: this.groundImageController,
      rasterLayerController: this.rasterLayerController,
      getCameraPosition: () => this.getCameraPosition(),
      markInitialized: () => {
        this.initialized = true;
      },
      onMapInitialized: () => this.notifyMapInitialized(),
      onMapClick: (point) => this.notifyMapClick(point),
      dispatchTap: (point) => this.dispatchTap(point),
      onMapLongClick: (point) => this.notifyMapLongClick(point),
      onCameraMoveStart: (camera) => this.notifyCameraMoveStart(camera),
      onCameraMove: (camera) => this.notifyCameraMove(camera),
      onCameraMoveEnd: (camera) => this.notifyCameraMoveEnd(camera),
    });
  }

  override setMapInitializedListener(listener: OnMapInitializedHandler | null): void {
    super.setMapInitializedListener(listener);
    if (listener && this.initialized) this.notifyMapInitialized();
  }

  moveCamera(position: MapCameraPosition): Promise<boolean> {
    this.logicalTiltHint = position.tilt;
    return jumpToPosition(this.mapInstance, this.withPaddedCenter(position));
  }

  animateCamera(position: MapCameraPosition, durationMillis: number): Promise<boolean> {
    this.logicalTiltHint = position.tilt;
    return easeToPosition(this.mapInstance, this.withPaddedCenter(position), durationMillis);
  }

  fitBounds(bounds: GeoRectBounds, padding: number): Promise<boolean> {
    // The fit centres the bounds in the full view (the engine does not keep a
    // fit's padding), so the camera paddings no longer describe the view.
    this.cameraPaddings = MapPaddings.Zeros;
    return fitMapBounds(this.mapInstance, bounds, padding);
  }

  getCameraPosition(): MapCameraPosition | null {
    const camera = readCameraPosition(this.mapInstance, this.holder, this.logicalTiltHint);
    if (!camera) return camera;
    return cameraFromPaddedCenter(camera, this.cameraPaddings, camera.fov, this.canvasSize());
  }

  /** Moves the camera centre so the target lands at the padded-area centre; the engine's padding stays zero. */
  private withPaddedCenter(position: MapCameraPosition): MapCameraPosition {
    const paddings = position.paddings ?? this.cameraPaddings;
    this.cameraPaddings = paddings;
    // toCameraPosition snaps a non-negative tilt's zoom to an integer, so measure the shift at that zoom.
    const zoom = position.tilt >= 0 ? Math.round(position.zoom) : position.zoom;
    return cameraWithPaddedCenter(position.copy({ paddings }), readVerticalFov(this.mapInstance), this.canvasSize(), zoom)
      .copy({ paddings: MapPaddings.Zeros });
  }

  private canvasSize(): { width: number; height: number } {
    const canvas = this.mapInstance.getCanvas();
    return { width: canvas.clientWidth, height: canvas.clientHeight };
  }

  // --- Marker ---

  /**
   * マーカーのヒットテストと配送。カスケードの先頭。
   *
   * ズームとポインタ種別（タッチかマウスかで許容半径が変わる）が要るので
   * コアの既定ではなくここで持つ。判定自体は core の MarkerManager。
   */
  protected override dispatchMarkerTap(point: GeoPoint): boolean {
    const entity = this.markerController.findWithZoom(
      point,
      this.mapInstance.getZoom(),
      this.markerEventController.lastPointerType,
    );
    if (!entity?.state.clickable) return false;
    this.markerController.dispatchClick(entity.state);
    return true;
  }

  async compositionMarkers(data: MarkerState[]): Promise<void> {
    await this.markerController.composition(data);
    this.markerEventController.resync();
  }

  async updateMarker(state: MarkerState): Promise<void> {
    await this.markerController.update(state);
    this.markerEventController.resync();
  }

  setOnMarkerClickListener(_listener: OnMarkerEventHandler | null): void {
    this.markerEventController.setClickListener(_listener);
  }
  setOnMarkerDragStart(_listener: OnMarkerEventHandler | null): void {
    this.markerEventController.setDragStartListener(_listener);
  }
  setOnMarkerDrag(_listener: OnMarkerEventHandler | null): void {
    this.markerEventController.setDragListener(_listener);
  }
  setOnMarkerDragEnd(_listener: OnMarkerEventHandler | null): void {
    this.markerEventController.setDragEndListener(_listener);
  }
  setOnMarkerAnimateStart(_listener: OnMarkerEventHandler | null): void {
    this.markerEventController.setAnimateStartListener(_listener);
  }
  setOnMarkerAnimateEnd(_listener: OnMarkerEventHandler | null): void {
    this.markerEventController.setAnimateEndListener(_listener);
  }
  setMarkerAnimationOverlayHost(host: MarkerAnimationOverlayHost | null): void {
    this.markerController.setMarkerAnimationOverlayHost(host);
  }

  // --- Circle ---

  // --- Polyline ---

  // --- Polygon ---

  // --- GroundImage ---

  setOnGroundImageClickListener(_listener: OnGroundImageEventHandler | null): void {}

  // --- RasterLayer ---

  // --- Lifecycle ---

  async clearOverlays(): Promise<void> {
    await this.clearOverlayControllers([
      this.markerController,
      this.circleController,
      this.polylineController,
      this.polygonController,
      this.groundImageController,
      this.rasterLayerController,
    ]);
  }

  /**
   * TomTom は MapLibre GL ベースでネイティブの範囲制限 API を持つので、
   * `BaseMapViewController` のクランプ方式ではなく直接適用する。
   * android-sdk の同名メソッドと同じ方針。
   */
  override setCameraRestriction(restriction: CameraRestriction | null): void {
    // super は呼ばない。基底クラスに保持させるとカメラ停止時のクランプ補正まで走ってしまう。
    // ネイティブ API 側で既に制限されているので二重適用になる（android-sdk と同じ振り分け）。
    const effective = isEmptyCameraRestriction(restriction) ? null : restriction;

    const bounds = effective?.bounds ?? null;
    const sw = bounds?.southWest ?? null;
    const ne = bounds?.northEast ?? null;
    this.mapInstance.setMaxBounds(
      sw != null && ne != null
        ? [
            [sw.longitude, sw.latitude],
            [ne.longitude, ne.latitude],
          ]
        : null,
    );

    // Google↔TomTom のズーム差は緯度依存なので、TomTomProvider の生成時と同じく
    // 単一の基準緯度で変換する。ここでは現在のカメラ緯度を使う（生成時は初期カメラ緯度）。
    const zoomLat = this.getCameraPosition()?.position.latitude ?? 0;
    const minZoom = effective?.minZoom;
    const maxZoom = effective?.maxZoom;
    this.mapInstance.setMinZoom(minZoom == null ? null : ZoomAltitudeConverter.googleZoomToTomTomZoom(minZoom, zoomLat));
    this.mapInstance.setMaxZoom(maxZoom == null ? null : ZoomAltitudeConverter.googleZoomToTomTomZoom(maxZoom, zoomLat));
  }

  destroy(): void {
    super.destroy();
    this.blankBasemap?.destroy();
    this.markerEventController.destroy();
    void this.clearOverlays().finally(() => {
      this.markerController.destroy();
      this.mapInstance.remove();
    });
  }
}
