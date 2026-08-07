import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  MapContext,
  MapViewScope,
  MapServiceRegistryProvider,
  MapViewScopeProvider,
  InfoBubbleOverlay,
  MarkerAnimationLayer,
  MapAttributionOverlay,
  type InfoBubbleEntry,
  createMapContextValue,
} from '@mapconductor/js-sdk-react';
import {
  useCameraRestriction,
  useMapUISettings,
  useMarkerRenderingSupport,
} from '@mapconductor/js-sdk-react/internal';
import {
  MapViewBaseProps,
  OverlayCollector,
  MarkerTilingOptions,
  type GeoRectBounds,
  type MapCameraPosition,
  type GeoPoint,
  type MarkerAnimationOverlayEntry,
  type MapViewControllerInterface,
  mapViewStateInternal,
} from '@mapconductor/js-sdk-core';
import { TomTomProvider, TomTomConfig } from './TomTomProvider';
import type { TomTomViewStateInterface } from './TomTomViewState';
import type { TomTomViewController } from './TomTomViewController';

export interface TomTomMapViewProps extends MapViewBaseProps<TomTomViewStateInterface> {
  // Web-specific
  maxZoom?: number;
  minZoom?: number;
  /** Restricts panning/zooming so the viewport cannot leave this rectangle. */
  restrictBounds?: GeoRectBounds;
  containerStyle?: React.CSSProperties;
  onError?: (error: Error) => void;
  children?: React.ReactNode;
  markerTilingOptions?: MarkerTilingOptions;
}

type InternalTomTomMapViewProps = TomTomMapViewProps;

/**
 * TomTom React component.
 *
 * The TomTom Orbis SDK (`@tomtom-org/maps-sdk`) auto-loads the MapLibre CSS from
 * its CDN, so no separate stylesheet import is required.
 */
function InternalTomTomMapView({
  state,
  onMapLoaded,
  onMapClick,
  onMapLongClick,
  onCameraMoveStart,
  onCameraMove,
  onCameraMoveEnd,
  maxZoom,
  minZoom,
  restrictBounds,
  cameraRestriction,
  className,
  containerStyle,
  onError,
  children,
  markerTilingOptions,
}: InternalTomTomMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [provider] = useState(() => new TomTomProvider());
  const [scope] = useState(() => new MapViewScope());
  const [controller, setController] = useState<MapViewControllerInterface | null>(null);
  const [isReady, setIsReady] = useState(false);
  // `onMapLoaded` と同じ瞬間を「値」として持つ。イベントを取り逃した後から
  // マウントした子（examples の Three.js overlay 等）も読めるようにするため。
  const [isLoaded, setIsLoaded] = useState(false);
  const bridgeUnsubs = useRef<(() => void)[]>([]);
  const typedControllerRef = useRef<TomTomViewController | null>(null);
  const [bubbleEntries, setBubbleEntries] = useState<InfoBubbleEntry[]>([]);
  const [animationEntries, setAnimationEntries] = useState<MarkerAnimationOverlayEntry[]>([]);
  const [cameraTick, setCameraTick] = useState(0);

  // Keep latest callbacks in refs to avoid stale closures without re-running the effect
  const onMapLoadedRef = useRef(onMapLoaded);
  const onMapClickRef = useRef(onMapClick);
  const onMapLongClickRef = useRef(onMapLongClick);
  const onCameraMoveStartRef = useRef(onCameraMoveStart);
  const onCameraMoveRef = useRef(onCameraMove);
  const onCameraMoveEndRef = useRef(onCameraMoveEnd);
  onMapLoadedRef.current = onMapLoaded;
  onMapClickRef.current = onMapClick;
  onMapLongClickRef.current = onMapLongClick;
  onCameraMoveStartRef.current = onCameraMoveStart;
  onCameraMoveRef.current = onCameraMove;
  onCameraMoveEndRef.current = onCameraMoveEnd;

  // Initialize map
  useEffect(() => {
    if (!containerRef.current) return;

    const config: TomTomConfig = {
      container: containerRef.current,
      apiKey: state.apiKey,
      style: state.mapDesignType.style,
      maxZoom,
      minZoom,
      restrictBounds,
      initCameraPosition: state.cameraPosition,
      markerTilingOptions,
    };

    provider
      .initialize(config)
      .then((ctrl) => {
        mapViewStateInternal(state).setController(ctrl);
        mapViewStateInternal(state).setCameraPositionChangeListener(() => {
          setCameraTick(t => t + 1);
        });
        setController(ctrl);
        typedControllerRef.current = ctrl as TomTomViewController;

        ctrl.setCameraMoveStartListener((camera: MapCameraPosition) => {
          mapViewStateInternal(state).updateCameraPosition(camera);
          onCameraMoveStartRef.current?.(camera);
        });
        ctrl.setCameraMoveListener((camera: MapCameraPosition) => {
          mapViewStateInternal(state).updateCameraPosition(camera);
          onCameraMoveRef.current?.(camera);
          setCameraTick(t => t + 1);
        });
        ctrl.setCameraMoveEndListener((camera: MapCameraPosition) => {
          mapViewStateInternal(state).updateCameraPosition(camera);
          onCameraMoveEndRef.current?.(camera);
          setCameraTick(t => t + 1);
        });
        ctrl.setMapClickListener((point: GeoPoint) => onMapClickRef.current?.(point));
        ctrl.setMapLongClickListener((point: GeoPoint) => onMapLongClickRef.current?.(point));
        ctrl.setMapInitializedListener(() => {
          // 地図が出来た時点の実カメラ（visibleRegion 込み）を state へ流し込む。
          // これで `mapViewState.cameraPosition` が最初から権威ある値になり、
          // 拡張モジュールが `cameraPosition.visibleRegion.bounds` を初回から読める。
          const initial = typedControllerRef.current?.getCameraPosition() ?? null;
          if (initial) mapViewStateInternal(state).updateCameraPosition(initial);
          setIsLoaded(true);
          onMapLoadedRef.current?.(state);
        });

        const registry = scope.buildRegistry();
        for (const overlay of registry.getAll()) {
          const unsub = overlay.subscribe((data) => {
            overlay.render(data, ctrl).catch(console.error);
          });
          bridgeUnsubs.current.push(unsub);
        }

        // Subscribe to InfoBubble entries; re-render bubbles on change.
        // Mirrors the bubbles.forEach block in Android's MapViewBase.kt.
        const bubbleUnsub = scope.bubbleCollector.subscribe((map) => {
          setBubbleEntries(Array.from(map.values()));
        });
        bridgeUnsubs.current.push(bubbleUnsub);

        // Route Drop/Bounce animations to the screen-space overlay instead of
        // interpolating geo coordinates. Mirrors Android's
        // setMarkerAnimationOverlayHost wiring in MapViewBase.kt.
        typedControllerRef.current.setMarkerAnimationOverlayHost(scope.markerAnimationStore.start);
        bridgeUnsubs.current.push(() => typedControllerRef.current?.setMarkerAnimationOverlayHost(null));
        const animationUnsub = scope.markerAnimationStore.subscribe(setAnimationEntries);
        bridgeUnsubs.current.push(animationUnsub);

        // Mirrors Android's MapViewBase.kt DisposableEffect(controller) block.
        // Each collector subscribes to per-state observables (asObservable / asFlow).
        // When a fingerprint changes, the targeted update*() is called instead of
        // triggering a full composition() over all entities.
        const c = ctrl as unknown as Record<string, (s: never) => unknown>;
        const setupUpdateHandler = <S extends { id: string }>(
          collector: OverlayCollector<S>,
          hasMethod: string,
          updateMethod: string,
          onUpdated?: () => void,
        ) => {
          collector.setUpdateHandler((state) => {
            if ((c[hasMethod] as (s: S) => boolean)?.(state)) {
              void (c[updateMethod] as (s: S) => Promise<void>)?.(state);
              onUpdated?.();
            }
          });
          bridgeUnsubs.current.push(() => collector.setUpdateHandler(null));
        };

        // Marker position changes during a drag also need to re-project any
        // open InfoBubble anchored to that marker.
        setupUpdateHandler(scope.markerCollector, 'hasMarker', 'updateMarker', () => setCameraTick(t => t + 1));
        setupUpdateHandler(scope.circleCollector, 'hasCircle', 'updateCircle');
        setupUpdateHandler(scope.polylineCollector, 'hasPolyline', 'updatePolyline');
        setupUpdateHandler(scope.polygonCollector, 'hasPolygon', 'updatePolygon');
        setupUpdateHandler(scope.groundImageCollector, 'hasGroundImage', 'updateGroundImage');
        setupUpdateHandler(scope.rasterLayerCollector, 'hasRasterLayer', 'updateRasterLayer');

        setIsReady(true);
      })
      .catch((error) => {
        // Intentional cleanup by destroy() before load — happens in React Strict Mode.
        // The second effect invocation will re-initialize successfully.
        if (TomTomProvider.isDestroyedBeforeLoad(error)) return;
        console.error('Failed to initialize TomTom:', error);
        onError?.(error);
      });

    return () => {
      mapViewStateInternal(state).setCameraPositionChangeListener(null);
      mapViewStateInternal(state).setController(null);
      typedControllerRef.current = null;
      bridgeUnsubs.current.forEach((unsub) => unsub());
      bridgeUnsubs.current = [];
      provider.destroy();
    };
  }, [state.mapDesignType.getValue()]);

  useMapUISettings(state, controller);
  // マップ生成時 config だけでなく、prop の変化にも追随させる（android-sdk 相当）。
  useCameraRestriction(controller, { cameraRestriction, restrictBounds, minZoom, maxZoom });

  // cameraTick is read here only to force a re-render when the camera moves,
  // so that toScreenOffset() recalculates bubble positions.
  void cameraTick;


  // マーカー描画 capability をこのマップのサービスレジストリへ登録する。
  // marker-clustering などの拡張がここから解決する
  // （android-sdk の *MapView.kt / ios-sdk の *MapView.swift が
  //  MarkerRenderingSupportKey を put するのと同じ位置づけ）。
  useMarkerRenderingSupport(state, scope, controller);

  return (
    <MapContext.Provider value={createMapContextValue({ controller, isReady, isLoaded, state })}>
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          ...containerStyle,
        }}
      >
        <div
          ref={containerRef}
          className={className}
          style={{ width: '100%', height: '100%' }}
        />
        <MapAttributionOverlay
          scope={scope}
          camera={state.cameraPosition}
          designAttributionRules={state.mapDesignType.attributionRules}
        />
        {animationEntries.length > 0 && typedControllerRef.current && (
          <MarkerAnimationLayer
            entries={animationEntries}
            resolveScreenOffset={(entry) => typedControllerRef.current!.holder.toScreenOffset(entry.state.position)}
          />
        )}
        {bubbleEntries.length > 0 && typedControllerRef.current && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
            {bubbleEntries.map(entry => {
              const holder = typedControllerRef.current!.holder;
              const pos = entry.positionProvider();
              const screenOffset = holder.toScreenOffset(pos);
              const icon = entry.icon;
              const iconPixelSize = icon ? icon.iconSize * icon.scale : 0;
              return (
                <InfoBubbleOverlay
                  key={entry.id}
                  positionOffset={screenOffset}
                  iconSize={{ width: iconPixelSize, height: iconPixelSize }}
                  iconOffset={icon ? icon.anchor : { x: 0.5, y: 0.5 }}
                  infoAnchorOffset={icon ? icon.infoAnchor : { x: 0.5, y: 0.5 }}
                  tailOffset={entry.tailOffset}
                  style={{ pointerEvents: 'auto' }}
                >
                  {entry.content as ReactNode}
                </InfoBubbleOverlay>
              );
            })}
          </div>
        )}
      </div>
      <MapServiceRegistryProvider registry={state.serviceRegistry}>
        <MapViewScopeProvider scope={scope}>
          {children}
        </MapViewScopeProvider>
      </MapServiceRegistryProvider>
    </MapContext.Provider>
  );
}

// TomTom Orbis maps render in Web Mercator; there is no globe projection. Both
// entry points render the same 2D map, kept as two exports for API parity with
// the other providers (e.g. MapLibreMapView / MapLibreMapView2D).
export function TomTomMapView(props: TomTomMapViewProps) {
  return <InternalTomTomMapView {...props} />;
}

export function TomTomMapView2D(props: TomTomMapViewProps) {
  return <InternalTomTomMapView {...props} />;
}
