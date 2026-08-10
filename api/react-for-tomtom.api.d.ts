import { StyleInput, TomTomMap } from '@tomtom-org/maps-sdk/map';
import { MapConfig, GeoRectBounds, MarkerTilingOptions, MapProvider, MapViewControllerInterface, MapViewHolderBase, GeoPointInterface, Offset, GeoPoint, MarkerEntity, AbstractMarkerOverlayRenderer, MarkerManager, AddParams, ChangeParams, MarkerState, BitmapIcon, AbstractMarkerController, RasterLayerState, OnMarkerEventHandler, CircleEntity, AbstractCircleOverlayRenderer, CircleManagerInterface, CircleState, CircleController, PolylineEntity, AbstractPolylineOverlayRenderer, PolylineManagerInterface, PolylineState, PolylineController, MapCameraPosition, PolygonEntity, AbstractPolygonOverlayRenderer, PolygonManagerInterface, PolygonState, SlottedOverlayController, OnPolygonEventHandler, OverlayKind, OverlayHit, AbstractGroundImageOverlayRenderer, GroundImageState, GroundImageEntity, RasterLayerOverlayRenderer, RasterLayerAddParams, RasterLayerChangeParams, RasterLayerEntity, RasterLayerController, RasterHeaderSupport, BaseMapViewController, MarkerCapable, CircleCapable, PolylineCapable, PolygonCapable, GroundImageCapable, RasterLayerCapable, MapUISettings, OnMapInitializedHandler, MarkerAnimationOverlayHost, OnGroundImageEventHandler, CameraRestriction, MapDesignTypeInterface, AttributionRule, MapViewStateInterface, MapViewState, MapViewBaseProps, WebMercatorZoomAltitudeConverter } from '@mapconductor/js-sdk-core';
import * as maplibregl from 'maplibre-gl';
import React from 'react';

interface TomTomConfig extends MapConfig {
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
/**
 * TomTom provider implementation
 */
declare class TomTomProvider extends MapProvider {
    private map;
    private ttMap;
    initialize(config: TomTomConfig): Promise<MapViewControllerInterface>;
    destroy(): void;
    /** The TomTom SDK map wrapper (Orbis modules, style switching, traffic, etc.). */
    getTomTomMap(): TomTomMap | null;
    /** Returns true if the rejection was caused by an intentional destroy() call. */
    static isDestroyedBeforeLoad(error: unknown): boolean;
}

declare class TomTomMapViewHolder extends MapViewHolderBase<HTMLElement, maplibregl.Map> {
    readonly mapView: HTMLElement;
    readonly map: maplibregl.Map;
    private _controller;
    constructor(mapView: HTMLElement, map: maplibregl.Map);
    getController(): TomTomViewController | null;
    setController(controller: TomTomViewController): void;
    toScreenOffset(position: GeoPointInterface): Offset;
    fromScreenOffsetSync(offset: Offset): GeoPoint;
}

type Coordinate = [number, number];
type PointFeature = {
    type: 'Feature';
    id?: string | number;
    geometry: {
        type: 'Point';
        coordinates: Coordinate;
    };
    properties: Record<string, unknown>;
};
type LineFeature = {
    type: 'Feature';
    id?: string | number;
    geometry: {
        type: 'LineString';
        coordinates: Coordinate[];
    };
    properties: Record<string, unknown>;
};
type PolygonFeature = {
    type: 'Feature';
    geometry: {
        type: 'Polygon';
        coordinates: Coordinate[][];
    };
    properties: Record<string, unknown>;
};
type FeatureCollection = {
    type: 'FeatureCollection';
    features: Array<PointFeature | LineFeature | PolygonFeature>;
};

type TomTomActualMarker = PointFeature;
declare class MarkerLayer {
    protected readonly holder: TomTomMapViewHolder;
    protected readonly canEditStyle: () => boolean;
    readonly sourceId: string;
    readonly layerId: string;
    constructor({ holder, canEditStyle, sourceId, layerId, }: {
        holder: TomTomMapViewHolder;
        canEditStyle: () => boolean;
        sourceId: string;
        layerId: string;
    });
    draw(entities: MarkerEntity<TomTomActualMarker>[]): boolean;
    ensureStyleResources(): boolean;
    protected setData(data: FeatureCollection): boolean;
    setIconOffsets(offsets: ReadonlyMap<string, [number, number]>, fallback: [number, number]): void;
}

declare class MarkerDragLayer extends MarkerLayer {
    selected: MarkerEntity<TomTomActualMarker> | null;
    constructor({ holder, canEditStyle, sourceId, layerId, }: {
        holder: TomTomMapViewHolder;
        canEditStyle: () => boolean;
        sourceId: string;
        layerId: string;
    });
    updatePosition(position: GeoPoint): boolean;
    drawSelected(): boolean;
}

declare class TomTomMarkerOverlayRenderer extends AbstractMarkerOverlayRenderer<TomTomMapViewHolder, TomTomActualMarker> {
    private readonly defaultMarkerIcon;
    private readonly iconRefCounter;
    private readonly iconBitmaps;
    private readonly pendingImageRemovals;
    readonly markerManager: MarkerManager<TomTomActualMarker>;
    readonly markerLayer: MarkerLayer;
    readonly dragLayer: MarkerDragLayer;
    constructor({ holder, markerManager, markerLayer, dragLayer, }: {
        holder: TomTomMapViewHolder;
        markerManager: MarkerManager<TomTomActualMarker>;
        markerLayer: MarkerLayer;
        dragLayer: MarkerDragLayer;
    });
    onAdd(data: AddParams[]): Promise<(TomTomActualMarker | null)[]>;
    onChange(data: ChangeParams<TomTomActualMarker>[]): Promise<(TomTomActualMarker | null)[]>;
    onRemove(data: MarkerEntity<TomTomActualMarker>[]): Promise<void>;
    onPostProcess(): Promise<void>;
    setMarkerVisible(entity: MarkerEntity<TomTomActualMarker>, visible: boolean): void;
    setMarkerPosition(entity: MarkerEntity<TomTomActualMarker>, position: GeoPoint): void;
    updateSelectedMarker({ entity, state, bitmapIcon, }: {
        entity: MarkerEntity<TomTomActualMarker>;
        state: MarkerState;
        bitmapIcon: BitmapIcon;
    }): Promise<void>;
    drawDragLayer(): void;
    redraw(): void;
    resync(): Promise<void>;
    private createMarkerFeature;
    private retainIcon;
    private releaseIcon;
    private customIconKey;
    private ensureImages;
    private ensureImage;
    private loadBitmapIcon;
    private ensureFallbackDefaultIcon;
    private removeUnusedImages;
    private syncIconOffsets;
    buildEntity(marker: TomTomActualMarker, state: MarkerState): MarkerEntity<TomTomActualMarker>;
}

declare class TomTomMarkerController extends AbstractMarkerController<TomTomActualMarker> {
    private readonly holder;
    readonly renderer: TomTomMarkerOverlayRenderer;
    private selected;
    private pendingSelectedPosition;
    private selectedPositionFrame;
    private readonly tilingOptions;
    private tileRenderer;
    private tileRouteId;
    private tileVersion;
    private tileGeneration;
    /** Called by TomTomViewController when RasterLayerState changes. */
    onRasterLayerUpdate: ((state: RasterLayerState | null) => Promise<void>) | null;
    constructor(holder: TomTomMapViewHolder, renderer: TomTomMarkerOverlayRenderer, tilingOptions?: MarkerTilingOptions);
    protected shouldTile(state: MarkerState, totalCount: number): boolean;
    protected onTiledMarkersChanged(): Promise<void>;
    private syncTiledOverlay;
    private serviceWorkerTileTemplate;
    private localTileTemplate;
    private removeTileOverlay;
    composition(data: MarkerState[]): Promise<void>;
    find(position: GeoPoint): MarkerEntity<TomTomActualMarker> | null;
    /**
     * Find the marker under `position` at the given zoom level.
     *
     * For regular markers this defers to MapLibre's own rendered-geometry query
     * (`queryRenderedFeatures`), which returns the icons actually painted under the
     * point in render order — topmost first. That respects the real stacking order
     * AND the true on-screen icon size/placement, so it stays correct under tilt,
     * rotation and icon scaling (a hand-rolled geo/pixel-box test does not: the
     * icon's native bitmap size and tilt projection make it match far-off markers).
     * A `tapTolerance` box is queried as a fallback for near-misses on small icons.
     * Falls back to the tiled-marker (raster) radius hit-test when nothing regular
     * is hit. Mirrors Android's `GoogleMapMarkerController.find(position, zoom)`.
     */
    findWithZoom(position: GeoPoint, zoom: number, pointerType: 'touch' | 'mouse'): MarkerEntity<TomTomActualMarker> | null;
    update(state: MarkerState): Promise<void>;
    has(state: MarkerState): boolean;
    getSelectedMarker(): MarkerEntity<TomTomActualMarker> | null;
    setSelectedMarker(entity: MarkerEntity<TomTomActualMarker> | null): Promise<void>;
    updateSelectedPosition(position: GeoPoint): void;
    resync(): Promise<void>;
    clear(): Promise<void>;
    destroy(): void;
    private flushSelectedPosition;
    private cancelSelectedPositionFrame;
    private hasCompositionChanges;
}

declare class TomTomMarkerEventController {
    private readonly controller;
    private activePointerId;
    private dragPanWasEnabled;
    private pointerDownOffset;
    private dragStarted;
    /** Last observed pointer input type — used by TomTomViewController for tile-marker hit radius. */
    lastPointerType: 'touch' | 'mouse';
    constructor(controller: TomTomMarkerController);
    resync(): void;
    setClickListener(listener: OnMarkerEventHandler | null): void;
    setDragStartListener(listener: OnMarkerEventHandler | null): void;
    setDragListener(listener: OnMarkerEventHandler | null): void;
    setDragEndListener(listener: OnMarkerEventHandler | null): void;
    setAnimateStartListener(listener: OnMarkerEventHandler | null): void;
    setAnimateEndListener(listener: OnMarkerEventHandler | null): void;
    destroy(): void;
    private readonly handlePointerDown;
    private readonly handlePointerMove;
    private readonly handlePointerUp;
    private readonly handlePointerCancel;
    private finishDrag;
    private restoreMapInteraction;
    private findMarkerAtPointer;
    private positionFromPointer;
    private localPoint;
}

type TomTomActualCircle = PolygonFeature & {
    id?: string | number;
};
declare class TomTomCircleLayer {
    static readonly Prop: {
        readonly FILL_COLOR: "fillColor";
        readonly STROKE_COLOR: "strokeColor";
        readonly STROKE_WIDTH: "strokeWidth";
        readonly Z_INDEX: "zIndex";
    };
    private readonly holder;
    private readonly canEditStyle;
    readonly sourceId: string;
    readonly layerId: string;
    readonly strokeLayerId: string;
    constructor({ holder, canEditStyle, sourceId, layerId, }: {
        holder: TomTomMapViewHolder;
        canEditStyle: () => boolean;
        sourceId?: string;
        layerId?: string;
    });
    draw(entities: CircleEntity<TomTomActualCircle>[]): boolean;
    private ensureStyleResources;
}

declare class TomTomCircleOverlayRenderer extends AbstractCircleOverlayRenderer<TomTomMapViewHolder, TomTomActualCircle> {
    readonly layer: TomTomCircleLayer;
    readonly circleManager: CircleManagerInterface<TomTomActualCircle>;
    constructor({ layer, circleManager, holder, }: {
        layer: TomTomCircleLayer;
        circleManager: CircleManagerInterface<TomTomActualCircle>;
        holder: TomTomMapViewHolder;
    });
    createCircle(state: CircleState): Promise<TomTomActualCircle | null>;
    updateCircleProperties({ current, }: {
        circle: TomTomActualCircle;
        current: CircleEntity<TomTomActualCircle>;
        prev: CircleEntity<TomTomActualCircle>;
    }): Promise<TomTomActualCircle | null>;
    removeCircle(_entity: CircleEntity<TomTomActualCircle>): Promise<void>;
    onPostProcess(): Promise<void>;
    redraw(): Promise<void>;
}

declare class TomTomCircleController extends CircleController<TomTomActualCircle> {
    readonly renderer: TomTomCircleOverlayRenderer;
    constructor(renderer: TomTomCircleOverlayRenderer);
    update(state: CircleState): Promise<void>;
    resync(): Promise<void>;
    clear(): Promise<void>;
    /**
     * Hit-test a map click (its lat/lng) against the circles geometrically (inside
     * the fill radius) and dispatch the click on the matching circle. Does NOT use
     * a MapLibre layer/overlay click event — detection is driven by the map click
     * position, matching the marker/polyline paths and android. Returns true if hit.
     */
    handleMapClick(clicked: GeoPoint): boolean;
}

type TomTomActualPolyline = LineFeature[];
declare class TomTomPolylineLayer {
    static readonly Prop: {
        readonly STROKE_COLOR: "strokeColor";
        readonly STROKE_WIDTH: "strokeWidth";
        readonly Z_INDEX: "zIndex";
    };
    private readonly holder;
    private readonly canEditStyle;
    readonly sourceId: string;
    readonly layerId: string;
    constructor({ holder, canEditStyle, sourceId, layerId, }: {
        holder: TomTomMapViewHolder;
        canEditStyle: () => boolean;
        sourceId?: string;
        layerId?: string;
    });
    draw(entities: PolylineEntity<TomTomActualPolyline>[]): boolean;
    private ensureStyleResources;
}

declare class TomTomPolylineOverlayRenderer extends AbstractPolylineOverlayRenderer<TomTomMapViewHolder, TomTomActualPolyline> {
    readonly layer: TomTomPolylineLayer;
    readonly polylineManager: PolylineManagerInterface<TomTomActualPolyline>;
    constructor({ layer, polylineManager, holder, }: {
        layer: TomTomPolylineLayer;
        polylineManager: PolylineManagerInterface<TomTomActualPolyline>;
        holder: TomTomMapViewHolder;
    });
    createPolyline(state: PolylineState): Promise<TomTomActualPolyline | null>;
    updatePolylineProperties({ current, }: {
        polyline: TomTomActualPolyline;
        current: PolylineEntity<TomTomActualPolyline>;
        prev: PolylineEntity<TomTomActualPolyline>;
    }): Promise<TomTomActualPolyline | null>;
    removePolyline(_entity: PolylineEntity<TomTomActualPolyline>): Promise<void>;
    onPostProcess(): Promise<void>;
    redraw(): Promise<void>;
    private resolveZIndex;
}

declare class TomTomPolylineController extends PolylineController<TomTomActualPolyline> {
    readonly renderer: TomTomPolylineOverlayRenderer;
    constructor(renderer: TomTomPolylineOverlayRenderer);
    resync(): Promise<void>;
    clear(): Promise<void>;
    /**
     * Hit-test a map click (its lat/lng) against the polylines geometrically and,
     * if the click lands within the tap tolerance of a line, dispatch the click on
     * the nearest polyline (with the closest point on that line as `clicked`).
     *
     * This intentionally does NOT use a MapLibre layer/overlay click event. Like
     * android (`TomTomMapViewController.onPolylineClickedInternal`) and the marker
     * path, the hit is derived from the map click position, so behaviour matches
     * across providers. Returns true if a polyline was hit (so the caller can
     * suppress the generic map click).
     */
    handleMapClick(clicked: GeoPoint, camera: MapCameraPosition | null): boolean;
}

interface TomTomActualPolygon {
    readonly fillFeatures: PolygonFeature[];
    readonly outlineFeatures: LineFeature[];
}
declare class TomTomPolygonLayer {
    static readonly Prop: {
        readonly FILL_COLOR: "fillColor";
        readonly STROKE_COLOR: "strokeColor";
        readonly STROKE_WIDTH: "strokeWidth";
        readonly Z_INDEX: "zIndex";
    };
    private readonly holder;
    private readonly canEditStyle;
    readonly sourceId: string;
    readonly layerId: string;
    readonly outlineSourceId: string;
    readonly outlineLayerId: string;
    constructor({ holder, canEditStyle, sourceId, layerId, outlineSourceId, outlineLayerId, }: {
        holder: TomTomMapViewHolder;
        canEditStyle: () => boolean;
        sourceId?: string;
        layerId?: string;
        outlineSourceId?: string;
        outlineLayerId?: string;
    });
    draw(entities: PolygonEntity<TomTomActualPolygon>[]): boolean;
    private ensureStyleResources;
}

declare class TomTomPolygonOverlayRenderer extends AbstractPolygonOverlayRenderer<TomTomMapViewHolder, TomTomActualPolygon> {
    readonly layer: TomTomPolygonLayer;
    readonly polygonManager: PolygonManagerInterface<TomTomActualPolygon>;
    constructor({ layer, polygonManager, holder, }: {
        layer: TomTomPolygonLayer;
        polygonManager: PolygonManagerInterface<TomTomActualPolygon>;
        holder: TomTomMapViewHolder;
    });
    createPolygon(state: PolygonState): Promise<TomTomActualPolygon | null>;
    updatePolygonProperties({ current, }: {
        polygon: TomTomActualPolygon;
        current: PolygonEntity<TomTomActualPolygon>;
        prev: PolygonEntity<TomTomActualPolygon>;
    }): Promise<TomTomActualPolygon | null>;
    removePolygon(_entity: PolygonEntity<TomTomActualPolygon>): Promise<void>;
    onPostProcess(): Promise<void>;
}

declare class TomTomPolygonConductor implements SlottedOverlayController {
    readonly polygonOverlay: TomTomPolygonOverlayRenderer;
    clickListener: OnPolygonEventHandler | null;
    private operation;
    constructor(polygonOverlay: TomTomPolygonOverlayRenderer);
    composition(data: PolygonState[]): Promise<void>;
    update(state: PolygonState): Promise<void>;
    has(state: PolygonState): boolean;
    resync(): Promise<void>;
    clear(): Promise<void>;
    private redraw;
    /**
     * Hit-test a map click (its lat/lng) against the polygons geometrically
     * (point-in-polygon, honouring holes and zIndex) and dispatch the click on the
     * top-most polygon that contains the point. Does NOT use a MapLibre
     * layer/overlay click event — detection is driven by the map click position,
     * matching the marker/polyline paths and android. Returns true if hit.
     */
    handleMapClick(clicked: GeoPoint): boolean;
    private enqueue;
    readonly kind: OverlayKind;
    hasId(id: string): boolean;
    compositionAny(data: unknown[]): Promise<void>;
    updateAny(state: unknown): Promise<void>;
    setClickListenerAny(listener: unknown): void;
    /**
     * タップの当たり判定と配送。カスケードの 1 段（{@link OverlayHitResolver}）。
     * 判定は既存の handleMapClick と同じ（point-in-polygon、穴と zIndex を考慮）。
     */
    resolveTap(position: GeoPointInterface): OverlayHit | null;
}

declare class TomTomGroundImageOverlayRenderer extends AbstractGroundImageOverlayRenderer<TomTomMapViewHolder, string> {
    private readonly canEditStyle;
    /** Last values applied to the map style, keyed by state id. */
    private readonly applied;
    constructor({ holder, canEditStyle, }: {
        holder: TomTomMapViewHolder;
        canEditStyle: () => boolean;
    });
    sourceId(id: string): string;
    layerId(id: string): string;
    createGroundImage(state: GroundImageState): Promise<string | null>;
    updateGroundImageProperties({ current, }: {
        groundImage: string;
        current: GroundImageEntity<string>;
        prev: GroundImageEntity<string>;
    }): Promise<string | null>;
    /** Sync an already-created image source+layer to the current state (diffed). */
    private applyToExisting;
    removeGroundImage(entity: GroundImageEntity<string>): Promise<void>;
}

declare class TomTomGroundImageController implements SlottedOverlayController {
    private readonly groundImageStates;
    private readonly groundImageIds;
    private readonly pendingUpdates;
    private readonly renderer;
    private updateFrame;
    constructor(renderer: TomTomGroundImageOverlayRenderer);
    composition(data: GroundImageState[]): void;
    update(state: GroundImageState): void;
    has(state: GroundImageState): boolean;
    hasClickableAt(point: GeoPoint): boolean;
    dispatchClick(point: GeoPoint): boolean;
    resync(): void;
    clear(): void;
    private cancelPendingUpdates;
    private upsert;
    private removeById;
    readonly kind: OverlayKind;
    hasId(id: string): boolean;
    compositionAny(data: unknown[]): Promise<void>;
    updateAny(state: unknown): Promise<void>;
    setClickListenerAny(_listener: unknown): void;
    /**
     * タップの当たり判定と配送。カスケードの 1 段（{@link OverlayHitResolver}）。
     * 判定は既存の dispatchClick と同じ（後ろに追加したものから見る = 上に載る方が先）。
     */
    resolveTap(position: GeoPointInterface): OverlayHit | null;
}

/** GL のソース／レイヤー ID の対。android-sdk の TomTomRasterLayerHandle と同一。 */
interface TomTomRasterLayerHandle {
    readonly sourceId: string;
    readonly layerId: string;
}
/**
 * android-sdk と同じく汎用 RasterLayerController が駆動する OverlayRenderer 実装。
 * onAdd/onChange/onRemove でネイティブ GL のソース・レイヤーを操作する。スタイルが
 * まだ編集できない場合はハンドルだけ返し、スタイル (再)読み込み後に controller.resync()
 * で貼り直す。
 */
declare class TomTomRasterLayerOverlayRenderer implements RasterLayerOverlayRenderer<TomTomRasterLayerHandle> {
    readonly holder: TomTomMapViewHolder;
    private readonly canEditStyle;
    constructor(holder: TomTomMapViewHolder, canEditStyle: () => boolean);
    private sourceId;
    private layerId;
    onAdd(data: RasterLayerAddParams[]): Promise<(TomTomRasterLayerHandle | null)[]>;
    onChange(data: RasterLayerChangeParams<TomTomRasterLayerHandle>[]): Promise<(TomTomRasterLayerHandle | null)[]>;
    onRemove(data: RasterLayerEntity<TomTomRasterLayerHandle>[]): Promise<void>;
    onCameraChanged(_mapCameraPosition: MapCameraPosition): Promise<void>;
    onPostProcess(): Promise<void>;
    private addLayer;
    private updateLayer;
    private removeLayer;
}

/**
 * android-sdk の TomTomRasterLayerController と同じく汎用 RasterLayerController の薄い
 * サブクラス。composition/update/has/clear は基底クラスが提供する。GL スタイルが
 * 再読み込みされると既存のソース・レイヤーは失われるため、resync() で登録済みの
 * ラスターレイヤーを貼り直す（android-sdk の reapplyStyle 相当）。
 */
declare class TomTomRasterLayerController extends RasterLayerController<TomTomRasterLayerHandle> {
    /**
     * 地図は TomTom の SDK ラッパが生成し、transformRequest も SDK 側が握っている。
     * こちらから差すと SDK の認証経路を壊しかねないので触っていない。
     *
     * userAgent はブラウザが上書きを許さないので、どのプロバイダでも web では効かない。
     */
    protected get headerSupport(): RasterHeaderSupport;
    constructor(renderer: TomTomRasterLayerOverlayRenderer);
    resync(): Promise<void>;
}

declare class TomTomViewController extends BaseMapViewController implements MapViewControllerInterface, MarkerCapable, CircleCapable, PolylineCapable, PolygonCapable, GroundImageCapable, RasterLayerCapable {
    private readonly mapInstance;
    private initialized;
    private logicalTiltHint;
    private readonly styleReadyRef;
    readonly holder: TomTomMapViewHolder;
    private readonly markerController;
    private readonly markerEventController;
    private readonly circleController;
    private readonly polylineController;
    private readonly polygonController;
    private readonly groundImageController;
    private readonly rasterLayerController;
    constructor(holder: TomTomMapViewHolder, markerController: TomTomMarkerController, markerEventController: TomTomMarkerEventController, circleController: TomTomCircleController, polylineController: TomTomPolylineController, polygonController: TomTomPolygonConductor, groundImageController: TomTomGroundImageController, rasterLayerController: TomTomRasterLayerController, styleReadyRef?: {
        current: boolean;
    }, logicalTiltHint?: number | null);
    getMap(): maplibregl.Map;
    applyUISettings(settings: MapUISettings): void;
    private setupEventListeners;
    setMapInitializedListener(listener: OnMapInitializedHandler | null): void;
    moveCamera(position: MapCameraPosition): Promise<boolean>;
    animateCamera(position: MapCameraPosition, durationMillis: number): Promise<boolean>;
    fitBounds(bounds: GeoRectBounds, padding: number): Promise<boolean>;
    getCameraPosition(): MapCameraPosition | null;
    compositionMarkers(data: MarkerState[]): Promise<void>;
    updateMarker(state: MarkerState): Promise<void>;
    setOnMarkerClickListener(_listener: OnMarkerEventHandler | null): void;
    setOnMarkerDragStart(_listener: OnMarkerEventHandler | null): void;
    setOnMarkerDrag(_listener: OnMarkerEventHandler | null): void;
    setOnMarkerDragEnd(_listener: OnMarkerEventHandler | null): void;
    setOnMarkerAnimateStart(_listener: OnMarkerEventHandler | null): void;
    setOnMarkerAnimateEnd(_listener: OnMarkerEventHandler | null): void;
    setMarkerAnimationOverlayHost(host: MarkerAnimationOverlayHost | null): void;
    setOnGroundImageClickListener(_listener: OnGroundImageEventHandler | null): void;
    clearOverlays(): Promise<void>;
    /**
     * TomTom は MapLibre GL ベースでネイティブの範囲制限 API を持つので、
     * `BaseMapViewController` のクランプ方式ではなく直接適用する。
     * android-sdk の同名メソッドと同じ方針。
     */
    setCameraRestriction(restriction: CameraRestriction | null): void;
    destroy(): void;
}

interface TomTomMapDesignType extends MapDesignTypeInterface<string> {
    /** TomTom Orbis style: a standard style id ('standardLight' etc.) or a StandardStyle config. */
    readonly style: StyleInput;
}
/**
 * TomTom Orbis map design (style).
 *
 * `id` / `getValue()` is the stable key (used for save/restore and as the map
 * re-init trigger); the value actually loaded by the SDK is [style] (a TomTom
 * Orbis {@link StyleInput}). Mirrors android `TomTomMapDesign` (Standard /
 * Driving / Satellite), with light/dark variants exposed like the other web
 * providers.
 */
declare class TomTomDesign implements TomTomMapDesignType {
    readonly id: string;
    readonly style: StyleInput;
    readonly attributionRules: readonly AttributionRule[];
    constructor(id: string, style: StyleInput, attributionRules?: readonly AttributionRule[]);
    getValue(): string;
    /** Default (browsing) light style. */
    static readonly Standard: TomTomDesign;
    static readonly StandardLight: TomTomDesign;
    static readonly StandardDark: TomTomDesign;
    /** Navigation-oriented styles. */
    static readonly Driving: TomTomDesign;
    static readonly DrivingLight: TomTomDesign;
    static readonly DrivingDark: TomTomDesign;
    /** Minimalist monochrome styles. */
    static readonly MonoLight: TomTomDesign;
    static readonly MonoDark: TomTomDesign;
    /** Satellite imagery basemap. */
    static readonly Satellite: TomTomDesign;
}

interface TomTomViewStateInterface extends MapViewStateInterface<TomTomMapDesignType> {
    /** TomTom API key (mapKey) used to initialize the Orbis map. */
    readonly apiKey: string;
}
interface TomTomViewStateParams {
    id?: string;
    /** TomTom API key (mapKey). Required for the Orbis map/tiles to load. */
    apiKey?: string;
    mapDesignType?: TomTomMapDesignType;
    cameraPosition?: MapCameraPosition;
}
declare class TomTomViewState extends MapViewState<TomTomMapDesignType> implements TomTomViewStateInterface {
    readonly apiKey: string;
    private _mapDesignType;
    constructor({ id, apiKey, mapDesignType, cameraPosition, }?: TomTomViewStateParams);
    get mapDesignType(): TomTomMapDesignType;
    set mapDesignType(value: TomTomMapDesignType);
}
declare function useTomTomViewState(params?: TomTomViewStateParams): TomTomViewStateInterface;

interface TomTomMapViewProps extends MapViewBaseProps<TomTomViewStateInterface> {
    maxZoom?: number;
    minZoom?: number;
    /** Restricts panning/zooming so the viewport cannot leave this rectangle. */
    restrictBounds?: GeoRectBounds;
    containerStyle?: React.CSSProperties;
    onError?: (error: Error) => void;
    children?: React.ReactNode;
    markerTilingOptions?: MarkerTilingOptions;
}
declare function TomTomMapView(props: TomTomMapViewProps): React.JSX.Element;
declare function TomTomMapView2D(props: TomTomMapViewProps): React.JSX.Element;

/**
 * 統一ズーム（Google Maps 基準・256px タイル）⇄ 高度の変換。
 *
 * TomTom Orbis の web は MapLibre GL JS の上で描かれる（MapLibre web プロバイダと
 * 同じ Web Mercator エンジン）ので、Google Maps 2D とのズーム差は MapLibre / Mapbox web と
 * 同じ定数 1.0 で、緯度に依存しない。
 *
 * **ネイティブの TomTom SDK とは違う。** android-for-tomtom / ios-for-tomtom は
 * グラウンドスケール基準で、`1.76 + log2(cos φ)` という緯度依存のオフセットを使う
 * （コアの {@link GroundScaleZoomAltitudeConverter}）。web で動くのはその SDK ではないので、
 * ここを 1.76 に揃えてはいけない。
 *
 * 換算式はコアの {@link WebMercatorZoomAltitudeConverter} にある。
 */
declare class ZoomAltitudeConverter extends WebMercatorZoomAltitudeConverter {
    /** Empirical offset: GoogleZoom ≈ TomTom(MapLibre).zoom + 1.0, matching the MapLibre web provider. */
    static readonly TOMTOM_TO_GOOGLE_ZOOM_OFFSET = 1;
    constructor(zoom0Altitude?: number);
    /**
     * Google↔TomTom zoom offset (googleZoom − tomtomZoom). Constant (Web Mercator).
     *
     * 緯度引数は他のコンバータと形を揃えるためだけに残してある。
     */
    static zoomOffsetAt(_latitude: number): number;
    static tomtomZoomToGoogleZoom(tomtomZoom: number, latitude: number): number;
    static googleZoomToTomTomZoom(googleZoom: number, latitude: number): number;
}

export { type TomTomConfig, TomTomDesign, type TomTomMapDesignType, TomTomMapView, TomTomMapView2D, type TomTomMapViewProps, TomTomProvider, TomTomViewController, TomTomViewState, type TomTomViewStateInterface, ZoomAltitudeConverter, useTomTomViewState };
