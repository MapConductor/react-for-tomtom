import { createGeoPoint, createOverlayHit, type GeoPointInterface, type OverlayHit } from '@mapconductor/js-sdk-core';
import type { OverlayKind, SlottedOverlayController } from '@mapconductor/js-sdk-core';
import {
  createGroundImageEntity,
  type GeoPoint,
  type GroundImageState,
  wrapClickedPoint,
} from '@mapconductor/js-sdk-core';
import { TomTomGroundImageOverlayRenderer } from './TomTomGroundImageOverlayRenderer';

export class TomTomGroundImageController implements SlottedOverlayController {
  private readonly groundImageStates = new Map<string, GroundImageState>();
  private readonly groundImageIds = new Set<string>();
  private readonly pendingUpdates = new Map<string, GroundImageState>();
  private readonly renderer: TomTomGroundImageOverlayRenderer;
  private updateFrame: number | null = null;

  constructor(renderer: TomTomGroundImageOverlayRenderer) {
    this.renderer = renderer;
  }

  composition(data: GroundImageState[]): void {
    this.cancelPendingUpdates();
    const nextIds = new Set(data.map((s) => s.id));
    for (const id of [...this.groundImageIds]) {
      if (!nextIds.has(id)) void this.removeById(id);
    }
    for (const state of data) {
      this.groundImageStates.set(state.id, state);
      void this.upsert(state);
    }
  }

  update(state: GroundImageState): void {
    this.groundImageStates.set(state.id, state);
    this.pendingUpdates.set(state.id, state);
    if (this.updateFrame != null) return;
    this.updateFrame = requestAnimationFrame(() => {
      this.updateFrame = null;
      const updates = Array.from(this.pendingUpdates.values());
      this.pendingUpdates.clear();
      for (const pending of updates) void this.upsert(pending);
    });
  }

  has(state: GroundImageState): boolean {
    return this.groundImageStates.has(state.id);
  }

  hasClickableAt(point: GeoPoint): boolean {
    return Array.from(this.groundImageStates.values()).some(
      (state) => state.onClick != null && state.bounds.contains(point),
    );
  }

  dispatchClick(point: GeoPoint): boolean {
    const states = Array.from(this.groundImageStates.values()).reverse();
    for (const state of states) {
      if (!state.bounds.contains(point)) continue;
      if (!state.onClick) return false;
      // clicked を正規化してから配送する。理由は core の GroundImageController.dispatchClick を参照。
      state.onClick({ state, clicked: wrapClickedPoint(point) });
      return true;
    }
    return false;
  }

  resync(): void {
    this.cancelPendingUpdates();
    this.groundImageIds.clear();
    for (const state of this.groundImageStates.values()) void this.upsert(state);
  }

  clear(): void {
    this.cancelPendingUpdates();
    for (const id of [...this.groundImageIds]) void this.removeById(id);
  }

  private cancelPendingUpdates(): void {
    if (this.updateFrame != null) cancelAnimationFrame(this.updateFrame);
    this.updateFrame = null;
    this.pendingUpdates.clear();
  }

  private async upsert(state: GroundImageState): Promise<void> {
    if (this.groundImageIds.has(state.id)) {
      const entity = createGroundImageEntity({ groundImage: state.id, state });
      await this.renderer.updateGroundImageProperties({
        groundImage: state.id,
        current: entity,
        prev: entity,
      });
    } else {
      const id = await this.renderer.createGroundImage(state);
      if (!id) return;
      this.groundImageIds.add(id);
    }
  }

  private async removeById(id: string): Promise<void> {
    const state = this.groundImageStates.get(id);
    if (!state) return;
    await this.renderer.removeGroundImage(createGroundImageEntity({ groundImage: id, state }));
    this.groundImageIds.delete(id);
    this.groundImageStates.delete(id);
  }
  // ── SlottedOverlayController（Capable ファサードのスロット） ─────────
  //
  // ★ ここを実装し忘れると、コントローラを登録しても composition が黙って捨てられる。
  //   android-for-maplibre / mapbox のポリゴンが実際にそれで、hasPolygon が常に false、
  //   ポリゴン単体の状態更新が捨てられていた（ビルドもテストも緑のまま）。

  readonly kind: OverlayKind = 'groundImage';

  hasId(id: string): boolean {
    return this.has({ id } as GroundImageState);
  }

  async compositionAny(data: unknown[]): Promise<void> {
    await this.composition(data as GroundImageState[]);
  }

  async updateAny(state: unknown): Promise<void> {
    await this.update(state as GroundImageState);
  }

  setClickListenerAny(_listener: unknown): void {
    // このコントローラは型付きのクリックリスナーを持たない。
  }

  /**
   * タップの当たり判定と配送。カスケードの 1 段（{@link OverlayHitResolver}）。
   * 判定は既存の dispatchClick と同じ（後ろに追加したものから見る = 上に載る方が先）。
   */
  resolveTap(position: GeoPointInterface): OverlayHit | null {
    const clicked = createGeoPoint(position);
    for (const state of Array.from(this.groundImageStates.values()).reverse()) {
      if (!state.bounds.contains(clicked)) continue;
      // クリックを持たないグラウンドイメージはカスケードを止めない（透過）。
      if (!state.onClick) return null;
      const onClick = state.onClick;
      return createOverlayHit('groundImage', clicked, () => {
        // clicked を正規化してから配送する。理由は core の GroundImageController.dispatchClick を参照。
        onClick({ state, clicked: wrapClickedPoint(clicked) });
      });
    }
    return null;
  }

}
