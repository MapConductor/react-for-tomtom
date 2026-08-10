import type * as maplibregl from 'maplibre-gl';
import type { MapCameraPosition } from '@mapconductor/js-sdk-core';
import { lngLatFromEvent } from './helpers';
import type { TomTomMarkerController } from './marker/TomTomMarkerController';
import type { TomTomMarkerEventController } from './marker/TomTomMarkerEventController';
import type { TomTomCircleController } from './circle/TomTomCircleController';
import type { TomTomPolylineController } from './polyline/TomTomPolylineController';
import type { TomTomPolygonConductor } from './polygon/TomTomPolygonConductor';
import type { TomTomGroundImageController } from './groundimage/TomTomGroundImageController';
import type { TomTomRasterLayerController } from './raster/TomTomRasterLayerController';

type MapPoint = ReturnType<typeof lngLatFromEvent>;

/**
 * `TomTomViewController` が地図に張るイベントの一式。
 *
 * コントローラーの private を覗かずに済むよう、必要なものだけを [MapEventDeps]
 * で受け取る。地図のタップは**マーカーが先**で、polyline → polygon → circle →
 * groundImage の順に当たり判定を通し、どれにも当たらなかったときだけ
 * `onMapClick` を呼ぶ（android と同じ順序）。
 */
export interface MapEventDeps {
  readonly map: maplibregl.Map;
  /** スタイルが使える状態かどうか。読み込み直しのたびに false → true と動く。 */
  readonly styleReadyRef: { current: boolean };
  readonly markerController: TomTomMarkerController;
  readonly markerEventController: TomTomMarkerEventController;
  readonly circleController: TomTomCircleController;
  readonly polylineController: TomTomPolylineController;
  readonly polygonController: TomTomPolygonConductor;
  readonly groundImageController: TomTomGroundImageController;
  readonly rasterLayerController: TomTomRasterLayerController;
  getCameraPosition(): MapCameraPosition | null;
  markInitialized(): void;
  onMapInitialized(): void;
  onMapClick(point: MapPoint): void;

  /**
   * タップの配送。コアの `BaseMapViewController.dispatchTap` を呼ぶ。
   * marker → circle → groundImage → polyline → polygon → map を 1 つだけ配送する。
   */
  dispatchTap(point: MapPoint): boolean;
  onMapLongClick(point: MapPoint): void;
  onCameraMoveStart(camera: MapCameraPosition): void;
  onCameraMove(camera: MapCameraPosition): void;
  onCameraMoveEnd(camera: MapCameraPosition): void;
}

export function installMapEventListeners(deps: MapEventDeps): void {
  const map = deps.map;
  const styleReadyRef = deps.styleReadyRef;
  // どちらも下のハンドラー同士でしか使わないので、クロージャに閉じ込めておく。
  let groundImagePointerDown: { point: MapPoint; screen: { x: number; y: number } } | null = null;
  let skipNextGroundImageClick = false;

    map.on('movestart', () => {
      const camera = deps.getCameraPosition();
      if (camera) deps.onCameraMoveStart(camera);
    });

    const preventGroundImageDrag = (e: { lngLat: { lat: number; lng: number }; point: { x: number; y: number }; preventDefault: () => void }) => {
      const point = lngLatFromEvent(e);
      if (deps.groundImageController.hasClickableAt(point)) {
        e.preventDefault();
        groundImagePointerDown = { point, screen: e.point };
      }
    };
    const dispatchGroundImagePointerUp = (e: { point: { x: number; y: number } }) => {
      const down = groundImagePointerDown;
      groundImagePointerDown = null;
      if (!down) return;

      const dx = e.point.x - down.screen.x;
      const dy = e.point.y - down.screen.y;
      if (Math.hypot(dx, dy) > 8) return;
      if (deps.groundImageController.dispatchClick(down.point)) {
        skipNextGroundImageClick = true;
      }
    };
    map.on('mousedown', preventGroundImageDrag);
    map.on('touchstart', preventGroundImageDrag);
    map.on('mouseup', dispatchGroundImagePointerUp);
    map.on('touchend', dispatchGroundImagePointerUp);

    map.on('click', (e) => {
      const point = lngLatFromEvent(e);
      // グラウンドイメージのドラッグ抑止で既に配送済みなら、その click は捨てる。
      // （mousedown/up で先に配送しているため。GL 系プロバイダ固有の事情。）
      if (skipNextGroundImageClick && deps.groundImageController.hasClickableAt(point)) {
        skipNextGroundImageClick = false;
        return;
      }
      skipNextGroundImageClick = false;
      // marker → circle → groundImage → polyline → polygon → map の一本道。
      // 順序と先勝ちはコアの BaseMapViewController.dispatchTap が持つ。
      deps.dispatchTap(point);
    });

    map.on('contextmenu', (e) => {
      deps.onMapLongClick(lngLatFromEvent(e));
    });

    map.on('move', () => {
      const camera = deps.getCameraPosition();
      if (camera) deps.onCameraMove(camera);
    });

    map.on('moveend', () => {
      const camera = deps.getCameraPosition();
      if (camera) deps.onCameraMoveEnd(camera);
    });

    map.on('load', () => {
      styleReadyRef.current = true;
      deps.markInitialized();
      deps.onMapInitialized();
    });

    map.on('error', (e) => {
      console.error('[MapConductor] TomTom error:', e.error);
    });

    const resyncAll = () => {
      void deps.markerController.resync().then(() => deps.markerEventController.resync());
      void deps.circleController.resync();
      void deps.polylineController.resync();
      deps.polygonController.resync();
      deps.groundImageController.resync();
      void deps.rasterLayerController.resync();
    };

    map.on('styledata', () => {
      const loaded = map.isStyleLoaded() === true;
      if (loaded && !styleReadyRef.current) {
        styleReadyRef.current = true;
        resyncAll();
      } else if (!loaded) {
        styleReadyRef.current = false;
      }
    });

    // Fallback: styledata can fire with isStyleLoaded()=false as the last event
    // (e.g. after setProjection), leaving styleReady stuck at false even though
    // the style is actually loaded.  The idle event fires once the map is stable,
    // guaranteeing isStyleLoaded()=true, so use it to recover.
    map.on('idle', () => {
      if (!styleReadyRef.current && map.isStyleLoaded()) {
        styleReadyRef.current = true;
        resyncAll();
      }
    });

    if (map.isStyleLoaded()) {
      styleReadyRef.current = true;
    }
}
