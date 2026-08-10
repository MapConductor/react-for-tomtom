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
} from '@mapconductor/js-sdk-core';
import { ZoomAltitudeConverter } from './zoom/ZoomAltitudeConverter';
import { TomTomMapViewHolder } from './TomTomMapViewHolder';
import { TomTomMarkerController } from './marker/TomTomMarkerController';
import { TomTomMarkerEventController } from './marker/TomTomMarkerEventController';
import { TomTomCircleController } from './circle/TomTomCircleController';
import { TomTomPolylineController } from './polyline/TomTomPolylineController';
import { TomTomPolygonConductor } from './polygon/TomTomPolygonConductor';
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
  private readonly styleReadyRef: { current: boolean };

  readonly holder: TomTomMapViewHolder;
  private readonly markerController: TomTomMarkerController;
  private readonly markerEventController: TomTomMarkerEventController;
  private readonly circleController: TomTomCircleController;
  private readonly polylineController: TomTomPolylineController;
  private readonly polygonController: TomTomPolygonConductor;
  private readonly groundImageController: TomTomGroundImageController;
  private readonly rasterLayerController: TomTomRasterLayerController;

  constructor(
    holder: TomTomMapViewHolder,
    markerController: TomTomMarkerController,
    markerEventController: TomTomMarkerEventController,
    circleController: TomTomCircleController,
    polylineController: TomTomPolylineController,
    polygonController: TomTomPolygonConductor,
    groundImageController: TomTomGroundImageController,
    rasterLayerController: TomTomRasterLayerController,
    styleReadyRef: { current: boolean } = { current: true },
    logicalTiltHint: number | null = null,
  ) {
    super();
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
    this.markerController.onRasterLayerUpdate = async (state) => {
      if (state) {
        await this.rasterLayerController.composition([state]);
      } else {
        await this.rasterLayerController.clear();
      }
    };
    this.setupEventListeners();
  }

  getMap(): maplibregl.Map {
    return this.mapInstance;
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
    return jumpToPosition(this.mapInstance, position);
  }

  animateCamera(position: MapCameraPosition, durationMillis: number): Promise<boolean> {
    this.logicalTiltHint = position.tilt;
    return easeToPosition(this.mapInstance, position, durationMillis);
  }

  fitBounds(bounds: GeoRectBounds, padding: number): Promise<boolean> {
    return fitMapBounds(this.mapInstance, bounds, padding);
  }

  getCameraPosition(): MapCameraPosition | null {
    return readCameraPosition(this.mapInstance, this.holder, this.logicalTiltHint);
  }

  // --- Marker ---

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
    await this.markerController.clear();
    await this.circleController.clear();
    await this.polylineController.clear();
    await this.polygonController.clear();
    this.groundImageController.clear();
    await this.rasterLayerController.clear();
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
    this.markerEventController.destroy();
    void this.clearOverlays().finally(() => {
      this.markerController.destroy();
      this.mapInstance.remove();
    });
  }
}
