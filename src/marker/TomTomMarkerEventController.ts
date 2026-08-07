import type {
  MarkerEntity,
  OnMarkerEventHandler,
  Offset,
} from '@mapconductor/js-sdk-core';
import { TomTomMarkerController } from './TomTomMarkerController';
import {
  type TomTomActualMarker,
} from './MarkerLayer';

const MARKER_DRAG_THRESHOLD_PX = 3;

export class TomTomMarkerEventController {
  private activePointerId: number | null = null;
  private dragPanWasEnabled = false;
  private pointerDownOffset: Offset | null = null;
  private dragStarted = false;

  /** Last observed pointer input type — used by TomTomViewController for tile-marker hit radius. */
  lastPointerType: 'touch' | 'mouse' = 'mouse';

  constructor(private readonly controller: TomTomMarkerController) {
    const canvas = this.controller.renderer.holder.map.getCanvas();
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerCancel);
  }

  resync(): void {
    // Marker clicks are handled at the view level (TomTomViewController map.on('click')).
  }

  setClickListener(listener: OnMarkerEventHandler | null): void {
    this.controller.clickListener = listener;
  }

  setDragStartListener(listener: OnMarkerEventHandler | null): void {
    this.controller.dragStartListener = listener;
  }

  setDragListener(listener: OnMarkerEventHandler | null): void {
    this.controller.dragListener = listener;
  }

  setDragEndListener(listener: OnMarkerEventHandler | null): void {
    this.controller.dragEndListener = listener;
  }

  setAnimateStartListener(listener: OnMarkerEventHandler | null): void {
    this.controller.animateStartListener = listener;
  }

  setAnimateEndListener(listener: OnMarkerEventHandler | null): void {
    this.controller.animateEndListener = listener;
  }

  destroy(): void {
    const canvas = this.controller.renderer.holder.map.getCanvas();
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('pointermove', this.handlePointerMove);
    canvas.removeEventListener('pointerup', this.handlePointerUp);
    canvas.removeEventListener('pointercancel', this.handlePointerCancel);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.lastPointerType = event.pointerType === 'touch' ? 'touch' : 'mouse';
    if (!event.isPrimary || event.button !== 0 || this.activePointerId != null) return;
    const entity = this.findMarkerAtPointer(event);
    if (!entity?.state.draggable) return;

    event.preventDefault();
    this.activePointerId = event.pointerId;
    this.pointerDownOffset = this.localPoint(event);
    this.dragStarted = false;
    this.dragPanWasEnabled = this.controller.renderer.holder.map.dragPan.isEnabled();
    this.controller.renderer.holder.map.dragPan.disable();
    this.controller.renderer.holder.map.getCanvas().setPointerCapture(event.pointerId);
    void this.controller.setSelectedMarker(entity);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    const selected = this.controller.getSelectedMarker();
    if (!selected) return;

    event.preventDefault();
    if (!this.dragStarted) {
      const down = this.pointerDownOffset;
      const current = this.localPoint(event);
      if (!down || Math.hypot(current.x - down.x, current.y - down.y) < MARKER_DRAG_THRESHOLD_PX) {
        return;
      }
      this.dragStarted = true;
      this.controller.dispatchDragStart(selected.state);
    }
    const position = this.positionFromPointer(event);
    selected.state.setPosition(position);
    this.controller.updateSelectedPosition(position);
    this.controller.dispatchDrag(selected.state);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    void this.finishDrag(event, true);
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    void this.finishDrag(event, false);
  };

  private async finishDrag(event: PointerEvent, updatePosition: boolean): Promise<void> {
    const selected = this.controller.getSelectedMarker();
    if (!selected) {
      this.restoreMapInteraction(event.pointerId);
      return;
    }

    const wasDragging = this.dragStarted;
    if (updatePosition && wasDragging) {
      const position = this.positionFromPointer(event);
      selected.state.setPosition(position);
      this.controller.updateSelectedPosition(position);
    }
    await this.controller.setSelectedMarker(null);
    if (wasDragging) {
      this.controller.dispatchDragEnd(selected.state);
    }
    this.restoreMapInteraction(event.pointerId);
  }

  private restoreMapInteraction(pointerId: number): void {
    const canvas = this.controller.renderer.holder.map.getCanvas();
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    if (this.dragPanWasEnabled) this.controller.renderer.holder.map.dragPan.enable();
    this.dragPanWasEnabled = false;
    this.activePointerId = null;
    this.pointerDownOffset = null;
    this.dragStarted = false;
  }

  private findMarkerAtPointer(
    event: PointerEvent,
  ): MarkerEntity<TomTomActualMarker> | null {
    const holder = this.controller.renderer.holder;
    if (!holder.map.getLayer(this.controller.renderer.markerLayer.layerId)) return null;
    // Hit-test against the marker's icon bounds (default icon size when icon is
    // null), the same way findWithZoom() resolves clicks — rather than a
    // single-pixel queryRenderedFeatures, which requires landing exactly on a
    // rendered pixel and ignores the icon size. This lets a drag start anywhere
    // within the icon's footprint.
    const position = holder.fromScreenOffsetSync(this.localPoint(event));
    return this.controller.findWithZoom(position, holder.map.getZoom(), this.lastPointerType);
  }

  private positionFromPointer(event: PointerEvent) {
    return this.controller.renderer.holder.fromScreenOffsetSync(this.localPoint(event));
  }

  private localPoint(event: PointerEvent): Offset {
    const rect = this.controller.renderer.holder.map.getCanvas().getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
}
