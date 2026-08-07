import {
  createPolygonEntity,
  type GeoPoint,
  type OnPolygonEventHandler,
  type PolygonState,
  wrapClickedPoint,
} from '@mapconductor/js-sdk-core';
import { TomTomPolygonOverlayRenderer } from './TomTomPolygonOverlayRenderer';

export class TomTomPolygonConductor {
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
}
