import {
  AbstractCircleOverlayRenderer,
  circleToRing,
  closeRing,
  type CircleEntity,
  type CircleManagerInterface,
  type CircleState,
} from '@mapconductor/js-sdk-core';
import { TomTomMapViewHolder } from '../TomTomMapViewHolder';
import {
  TomTomCircleLayer,
  type TomTomActualCircle,
} from './TomTomCircleLayer';

export class TomTomCircleOverlayRenderer extends AbstractCircleOverlayRenderer<
  TomTomMapViewHolder,
  TomTomActualCircle
> {
  readonly layer: TomTomCircleLayer;
  readonly circleManager: CircleManagerInterface<TomTomActualCircle>;

  constructor({
    layer,
    circleManager,
    holder,
  }: {
    layer: TomTomCircleLayer;
    circleManager: CircleManagerInterface<TomTomActualCircle>;
    holder: TomTomMapViewHolder;
  }) {
    super(holder);
    this.layer = layer;
    this.circleManager = circleManager;
  }

  async createCircle(state: CircleState): Promise<TomTomActualCircle | null> {
    return createTomTomCircle(state);
  }

  async updateCircleProperties({
    current,
  }: {
    circle: TomTomActualCircle;
    current: CircleEntity<TomTomActualCircle>;
    prev: CircleEntity<TomTomActualCircle>;
  }): Promise<TomTomActualCircle | null> {
    return this.createCircle(current.state);
  }

  async removeCircle(_entity: CircleEntity<TomTomActualCircle>): Promise<void> {
    // The source is rewritten from the remaining manager entities in onPostProcess().
  }

  override async onPostProcess(): Promise<void> {
    this.layer.draw(this.circleManager.allEntities());
  }

  async redraw(): Promise<void> {
    await this.onPostProcess();
  }
}

function createTomTomCircle(state: CircleState): TomTomActualCircle | null {
  // Ground-anchored circle polygon from the shared core geometry. The ring is
  // unwrapped (longitudes may exceed ±180), which TomTom GL renders seamlessly
  // across the antimeridian without splitting.
  const ring = closeRing(circleToRing(state.center, state.radiusMeters, state.geodesic));
  if (ring.length < 4) return null;
  const zIndex = state.zIndex ?? calculateZIndex(state.center.latitude, state.center.longitude);

  return {
    type: 'Feature',
    id: `circle-${state.id}`,
    geometry: {
      type: 'Polygon',
      coordinates: [ring.map((point) => [point.longitude, point.latitude])],
    },
    properties: {
      id: `circle-${state.id}`,
      [TomTomCircleLayer.Prop.FILL_COLOR]: state.fillColor,
      [TomTomCircleLayer.Prop.STROKE_COLOR]: state.strokeColor,
      [TomTomCircleLayer.Prop.STROKE_WIDTH]: state.strokeWidth,
      [TomTomCircleLayer.Prop.Z_INDEX]: zIndex,
    },
  };
}

function calculateZIndex(latitude: number, longitude: number): number {
  return Math.round(-latitude * 1_000_000 - longitude);
}
