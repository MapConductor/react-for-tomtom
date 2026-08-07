import type * as maplibregl from 'maplibre-gl';
import { TomTomMap, type MapLibreOptions, type StyleInput } from '@tomtom-org/maps-sdk/map';
import {
  CircleManager,
  MapProvider,
  MarkerManager,
  MarkerTilingOptions,
  PolygonManager,
  PolylineManager,
  type GeoRectBounds,
  type MapConfig,
  type MapViewControllerInterface,
} from '@mapconductor/js-sdk-core';
import { TomTomViewController } from './TomTomViewController';
import { ZoomAltitudeConverter } from './zoom/ZoomAltitudeConverter';
import { toCameraPosition } from './MapCameraPosition';
import { TomTomMapViewHolder } from './TomTomMapViewHolder';
import { TomTomMarkerController } from './marker/TomTomMarkerController';
import { TomTomMarkerEventController } from './marker/TomTomMarkerEventController';
import { TomTomMarkerOverlayRenderer } from './marker/TomTomMarkerOverlayRenderer';
import { MarkerLayer, type TomTomActualMarker } from './marker/MarkerLayer';
import { MarkerDragLayer } from './marker/MarkerDragLayer';
import { TomTomCircleController } from './circle/TomTomCircleController';
import { TomTomCircleLayer, type TomTomActualCircle } from './circle/TomTomCircleLayer';
import { TomTomCircleOverlayRenderer } from './circle/TomTomCircleOverlayRenderer';
import { TomTomPolylineController } from './polyline/TomTomPolylineController';
import { TomTomPolylineLayer, type TomTomActualPolyline } from './polyline/TomTomPolylineLayer';
import { TomTomPolylineOverlayRenderer } from './polyline/TomTomPolylineOverlayRenderer';
import { TomTomPolygonConductor } from './polygon/TomTomPolygonConductor';
import { TomTomPolygonLayer, type TomTomActualPolygon } from './polygon/TomTomPolygonLayer';
import { TomTomPolygonOverlayRenderer } from './polygon/TomTomPolygonOverlayRenderer';
import { TomTomGroundImageController } from './groundimage/TomTomGroundImageController';
import { TomTomGroundImageOverlayRenderer } from './groundimage/TomTomGroundImageOverlayRenderer';
import { TomTomRasterLayerController } from './raster/TomTomRasterLayerController';
import { TomTomRasterLayerOverlayRenderer } from './raster/TomTomRasterLayerOverlayRenderer';

export interface TomTomConfig extends MapConfig {
  /** TomTom API key (mapKey). Passed to `new TomTomMap({ key })`. */
  apiKey?: string;
  /** TomTom Orbis style: a standard style id ('standardLight' etc.) or a StandardStyle config. */
  style?: StyleInput;
  maxZoom?: number;
  minZoom?: number;
  /** Restricts panning/zooming so the viewport cannot leave this rectangle. */
  restrictBounds?: GeoRectBounds;
  markerTilingOptions?: MarkerTilingOptions;
}

function toLngLatBounds(bounds: GeoRectBounds | undefined): maplibregl.LngLatBoundsLike | undefined {
  if (!bounds?.southWest || !bounds.northEast) return undefined;
  return [
    [bounds.southWest.longitude, bounds.southWest.latitude],
    [bounds.northEast.longitude, bounds.northEast.latitude],
  ];
}

// Sentinel used to silently cancel initialization when destroy() is called before load.
// Distinct from real errors so callers can ignore it without swallowing actual failures.
const DESTROYED_BEFORE_LOAD = Symbol('DESTROYED_BEFORE_LOAD');

/**
 * TomTom provider implementation
 */
export class TomTomProvider extends MapProvider {
  // Track map separately from controller so destroy() works even during async init
  private map: maplibregl.Map | null = null;
  // The TomTom SDK wrapper that owns the underlying MapLibre map.
  private ttMap: TomTomMap | null = null;

  async initialize(config: TomTomConfig): Promise<MapViewControllerInterface> {
    if (this.controller) {
      return this.controller;
    }

    const container =
      typeof config.container === 'string'
        ? document.getElementById(config.container)
        : config.container;

    if (!container) {
      throw new Error('Container element not found');
    }

    const initialCamera = config.initCameraPosition ? toCameraPosition(config.initCameraPosition) : null;
    // Google↔TomTom zoom offset is latitude-dependent, so the initial/min/max zoom
    // conversions use the initial camera latitude (0 when there is no initial camera).
    const zoomLat = initialCamera?.center[1] ?? 0;
    // TomTom Orbis maps are created through the SDK wrapper, which sets the API key
    // and Orbis style, then exposes the underlying MapLibre map. Everything after this
    // point drives that MapLibre map exactly like the MapLibre provider.
    const ttMap = new TomTomMap({
      apiKey: config.apiKey ?? '',
      style: config.style ?? 'standardLight',
      mapLibre: {
        container,
        center: initialCamera?.center ?? [0, 0],
        zoom: initialCamera?.zoom ?? ZoomAltitudeConverter.googleZoomToTomTomZoom(10, zoomLat),
        bearing: initialCamera?.bearing ?? 0,
        pitch: initialCamera?.tilt ?? 0,
        maxZoom: config.maxZoom !== undefined ? ZoomAltitudeConverter.googleZoomToTomTomZoom(config.maxZoom, zoomLat) : undefined,
        minZoom: config.minZoom !== undefined ? ZoomAltitudeConverter.googleZoomToTomTomZoom(config.minZoom, zoomLat) : undefined,
        maxBounds: toLngLatBounds(config.restrictBounds),
        ...config.options,
      } as MapLibreOptions,
    });
    const map = ttMap.mapLibreMap;

    // Track map immediately so destroy() can remove it even before load fires
    this.map = map;
    this.ttMap = ttMap;

    await new Promise<void>((resolve, reject) => {
      // 'load' fires once TomTom's Orbis style has finished loading on the MapLibre map.
      if (map.loaded()) {
        resolve();
      } else {
        map.once('load', () => resolve());
      }
      // If destroy() is called before load fires, reject with the sentinel so the
      // caller can distinguish an intentional cleanup from an unexpected error.
      map.once('remove', () => reject(DESTROYED_BEFORE_LOAD));
    });

    // If destroy() was called during initialization, bail out silently
    if (!this.map) {
      throw DESTROYED_BEFORE_LOAD;
    }

    const holder = new TomTomMapViewHolder(map.getContainer(), map);
    // Rely solely on styleReady rather than also calling isStyleLoaded() here.
    // isStyleLoaded() can return false transiently while TomTom processes an
    // addLayer/addSource call, which would incorrectly block overlay resync.
    const styleReadyRef = { current: true };
    const canEditStyle = () => styleReadyRef.current;
    const markerController = getMarkerController(holder, canEditStyle, config);
    const markerEventController = new TomTomMarkerEventController(markerController);
    const circleController = getCircleController(holder, canEditStyle);
    const polylineController = getPolylineController(holder, canEditStyle);
    const polygonController = getPolygonController(holder, canEditStyle);
    const groundImageController = getGroundImageController(holder, canEditStyle);
    const rasterLayerController = getRasterLayerController(holder, canEditStyle);

    this.controller = new TomTomViewController(
      holder,
      markerController,
      markerEventController,
      circleController,
      polylineController,
      polygonController,
      groundImageController,
      rasterLayerController,
      styleReadyRef,
      config.initCameraPosition?.tilt ?? null,
    );
    return this.controller;
  }

  destroy(): void {
    if (this.controller) {
      this.controller.destroy();
      this.controller = null;
    } else if (this.map) {
      // Map was created but controller hasn't been set yet (load not fired)
      this.map.remove();
    }
    this.map = null;
    this.ttMap = null;
  }

  /** The TomTom SDK map wrapper (Orbis modules, style switching, traffic, etc.). */
  getTomTomMap(): TomTomMap | null {
    return this.ttMap;
  }

  /** Returns true if the rejection was caused by an intentional destroy() call. */
  static isDestroyedBeforeLoad(error: unknown): boolean {
    return error === DESTROYED_BEFORE_LOAD;
  }
}

function getMarkerController(
  holder: TomTomMapViewHolder,
  canEditStyle: () => boolean,
  config: TomTomConfig,
): TomTomMarkerController {
  const markerManager = MarkerManager.defaultManager<TomTomActualMarker>();
  const markerLayer = new MarkerLayer({
    holder,
    canEditStyle,
    sourceId: 'mc-markers',
    layerId: 'mc-marker-layer',
  });
  const dragLayer = new MarkerDragLayer({
    holder,
    canEditStyle,
    sourceId: 'mc-marker-drag',
    layerId: 'mc-marker-drag-layer',
  });
  const renderer = new TomTomMarkerOverlayRenderer({
    holder,
    markerManager,
    markerLayer,
    dragLayer,
  });
  return new TomTomMarkerController(holder, renderer, config.markerTilingOptions);
}

function getCircleController(
  holder: TomTomMapViewHolder,
  canEditStyle: () => boolean,
): TomTomCircleController {
  const circleManager = new CircleManager<TomTomActualCircle>();
  const layer = new TomTomCircleLayer({ holder, canEditStyle });
  const renderer = new TomTomCircleOverlayRenderer({ layer, circleManager, holder });
  return new TomTomCircleController(renderer);
}

function getPolylineController(
  holder: TomTomMapViewHolder,
  canEditStyle: () => boolean,
): TomTomPolylineController {
  const polylineManager = new PolylineManager<TomTomActualPolyline>();
  const layer = new TomTomPolylineLayer({ holder, canEditStyle });
  const renderer = new TomTomPolylineOverlayRenderer({ layer, polylineManager, holder });
  return new TomTomPolylineController(renderer);
}

function getPolygonController(
  holder: TomTomMapViewHolder,
  canEditStyle: () => boolean,
): TomTomPolygonConductor {
  const polygonManager = new PolygonManager<TomTomActualPolygon>();
  const layer = new TomTomPolygonLayer({ holder, canEditStyle });
  const renderer = new TomTomPolygonOverlayRenderer({ layer, polygonManager, holder });
  return new TomTomPolygonConductor(renderer);
}

function getGroundImageController(
  holder: TomTomMapViewHolder,
  canEditStyle: () => boolean,
): TomTomGroundImageController {
  const renderer = new TomTomGroundImageOverlayRenderer({ holder, canEditStyle });
  return new TomTomGroundImageController(renderer);
}

function getRasterLayerController(
  holder: TomTomMapViewHolder,
  canEditStyle: () => boolean,
): TomTomRasterLayerController {
  const renderer = new TomTomRasterLayerOverlayRenderer(holder, canEditStyle);
  return new TomTomRasterLayerController(renderer);
}
