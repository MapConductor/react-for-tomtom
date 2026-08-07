import type * as maplibregl from 'maplibre-gl';
import {
  createGeoRectBounds,
  type GeoRectBounds,
  type MapCameraPosition,
  type VisibleRegion,
} from '@mapconductor/js-sdk-core';
import { toCameraPosition, toMapCameraPosition } from './MapCameraPosition';
import type { TomTomMapViewHolder } from './TomTomMapViewHolder';

/**
 * カメラの読み書き。
 *
 * 移動系はどれも `moveend` を待って `true` を返す。呼び元に「動き終わった」を
 * 返せないと、続けて座標を読んだときに古い値が返るため。
 */
export function jumpToPosition(map: maplibregl.Map, position: MapCameraPosition): Promise<boolean> {
  const cam = toCameraPosition(position);
  return new Promise((resolve) => {
    map.once('moveend', () => resolve(true));
    // jumpTo (not flyTo) so duration = 0 moves the camera instantly with no animation.
    map.jumpTo({
      center: cam.center,
      zoom: cam.zoom,
      bearing: cam.bearing,
      pitch: cam.tilt,
    });
  });
}

export function easeToPosition(map: maplibregl.Map, position: MapCameraPosition, durationMillis: number): Promise<boolean> {
  const cam = toCameraPosition(position);
  return new Promise((resolve) => {
    map.once('moveend', () => resolve(true));
    map.easeTo({
      center: cam.center,
      zoom: cam.zoom,
      bearing: cam.bearing,
      pitch: cam.tilt,
      duration: durationMillis || 500,
    });
  });
}

export function fitMapBounds(map: maplibregl.Map, bounds: GeoRectBounds, padding: number): Promise<boolean> {
  return new Promise((resolve) => {
    map.once('moveend', () => resolve(true));
    const fitPadding = padding;
    map.fitBounds(
      [
        [bounds.southWest!.longitude, bounds.southWest!.latitude],
        [bounds.northEast!.longitude, bounds.northEast!.latitude],
      ],
      {
        ...(fitPadding != null ? { padding: fitPadding } : {}),
        // Preserve current rotation/tilt so the fit is correct at any bearing/pitch
        // (maplibre-gl resets bearing to 0 when omitted).
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      },
    );
  });
}

export function readCameraPosition(
  map: maplibregl.Map,
  holder: TomTomMapViewHolder,
  logicalTiltHint: number | null,
): MapCameraPosition | null {
  const camera = toMapCameraPosition({
    center: map.getCenter(),
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    tilt: map.getPitch(),
    logicalTiltHint: logicalTiltHint,
  });
  if (!camera) return camera;
  const visibleRegion = readVisibleRegion(map, holder);
  if (!visibleRegion) return camera;
  // Matches Android: the visible region rides on cameraPosition so that
  // mapViewState.cameraPosition.visibleRegion works without the controller.
  return camera.copy({ visibleRegion });
}


/**
 * Projects the four screen corners of the map viewport back to geo
 * coordinates via `fromScreenOffsetSync` and extends a bounds from them,
 * instead of using `map.getBounds()`'s axis-aligned box — this stays
 * correct when the map is rotated. Mirrors Android's
 * `TomTomViewControllerImpl.getMapCameraPosition()`.
 */
export function readVisibleRegion(map: maplibregl.Map, holder: TomTomMapViewHolder): VisibleRegion | null {
  const canvas = map.getCanvas();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return null;

  const nearLeft = holder.fromScreenOffsetSync({ x: 0, y: height });
  const nearRight = holder.fromScreenOffsetSync({ x: width, y: height });
  const farLeft = holder.fromScreenOffsetSync({ x: 0, y: 0 });
  const farRight = holder.fromScreenOffsetSync({ x: width, y: 0 });

  const bounds = createGeoRectBounds();
  bounds.extend(nearLeft);
  bounds.extend(nearRight);
  bounds.extend(farLeft);
  bounds.extend(farRight);

  return { bounds, nearLeft, nearRight, farLeft, farRight };
}
