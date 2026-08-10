import { createGeoPoint, createOverlayHit, type GeoPointInterface, type OverlayHit } from '@mapconductor/js-sdk-core';
import type { OverlayKind, SlottedOverlayController } from '@mapconductor/js-sdk-core';
import {
  createPolygonEntity,
  type GeoPoint,
  type OnPolygonEventHandler,
  type PolygonState,
  wrapClickedPoint,
} from '@mapconductor/js-sdk-core';
import { TomTomPolygonOverlayRenderer } from './TomTomPolygonOverlayRenderer';

export class TomTomPolygonConductor implements SlottedOverlayController {
  readonly polygonOverlay: TomTomPolygonOverlayRenderer;
  clickListener: OnPolygonEventHandler | null = null;

  private operation = Promise.resolve();

  constructor(polygonOverlay: TomTomPolygonOverlayRenderer) {
    this.polygonOverlay = polygonOverlay;
  }

  composition(data: PolygonState[]): Promise<void> {
    return this.enqueue(async () => {
      const nextIds = new Set(data.map((state) => state.id));
      for (const entity of this.polygonOverlay.polygonManager.allEntities()) {
        if (!nextIds.has(entity.state.id)) {
          this.polygonOverlay.polygonManager.removeEntity(entity.state.id);
        }
      }

      for (const state of data) {
        const polygon = await this.polygonOverlay.createPolygon(state);
        if (polygon) {
          this.polygonOverlay.polygonManager.registerEntity(createPolygonEntity({ polygon, state }));
        }
      }

      await this.redraw();
    });
  }

  update(state: PolygonState): Promise<void> {
    return this.enqueue(async () => {
      const polygon = await this.polygonOverlay.createPolygon(state);
      if (polygon) {
        this.polygonOverlay.polygonManager.registerEntity(createPolygonEntity({ polygon, state }));
      }
      await this.redraw();
    });
  }

  has(state: PolygonState): boolean {
    return this.polygonOverlay.polygonManager.hasEntity(state.id);
  }

  resync(): Promise<void> {
    return this.enqueue(() => this.redraw());
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      this.polygonOverlay.polygonManager.clear();
      await this.redraw();
    });
  }

  private async redraw(): Promise<void> {
    await this.polygonOverlay.onPostProcess();
  }

  /**
   * Hit-test a map click (its lat/lng) against the polygons geometrically
   * (point-in-polygon, honouring holes and zIndex) and dispatch the click on the
   * top-most polygon that contains the point. Does NOT use a MapLibre
   * layer/overlay click event — detection is driven by the map click position,
   * matching the marker/polyline paths and android. Returns true if hit.
   */
  handleMapClick(clicked: GeoPoint): boolean {
    const entity = this.polygonOverlay.polygonManager.find(clicked);
    if (!entity) return false;
    // clicked は wrapClickedPoint で正規化してから配送する（日付変更線対策）。
    // core の PolygonController.dispatchClick と同じ保証をこの経路にも与える。
    // ヒットテスト（find）の入力は wrap しない。
    const polygonEvent = { state: entity.state, clicked: wrapClickedPoint(clicked) };
    entity.state.onClick?.(polygonEvent);
    this.clickListener?.(polygonEvent);
    return true;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.operation.then(operation);
    this.operation = next.catch(() => undefined);
    return next;
  }
  // ── SlottedOverlayController（Capable ファサードのスロット） ─────────
  //
  // ★ ここを実装し忘れると、コントローラを登録しても composition が黙って捨てられる。
  //   android-for-maplibre / mapbox のポリゴンが実際にそれで、hasPolygon が常に false、
  //   ポリゴン単体の状態更新が捨てられていた（ビルドもテストも緑のまま）。

  readonly kind: OverlayKind = 'polygon';

  hasId(id: string): boolean {
    return this.has({ id } as PolygonState);
  }

  async compositionAny(data: unknown[]): Promise<void> {
    await this.composition(data as PolygonState[]);
  }

  async updateAny(state: unknown): Promise<void> {
    await this.update(state as PolygonState);
  }

  setClickListenerAny(listener: unknown): void {
    this.clickListener = listener as OnPolygonEventHandler | null;
  }

  /**
   * タップの当たり判定と配送。カスケードの 1 段（{@link OverlayHitResolver}）。
   * 判定は既存の handleMapClick と同じ（point-in-polygon、穴と zIndex を考慮）。
   */
  resolveTap(position: GeoPointInterface): OverlayHit | null {
    const clicked = createGeoPoint(position);
    const entity = this.polygonOverlay.polygonManager.find(clicked);
    if (!entity) return null;
    return createOverlayHit('polygon', clicked, () => {
      // clicked は wrapClickedPoint で正規化してから配送する（日付変更線対策）。
      // core の PolygonController.dispatchClick と同じ保証をこの経路にも与える。
      const polygonEvent = { state: entity.state, clicked: wrapClickedPoint(clicked) };
      entity.state.onClick?.(polygonEvent);
      this.clickListener?.(polygonEvent);
    });
  }

}
