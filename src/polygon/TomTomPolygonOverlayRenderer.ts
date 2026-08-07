import {
  AbstractPolygonOverlayRenderer,
  buildUnwrappedPolygonRings,
  type GeoPoint,
  type PolygonEntity,
  type PolygonManagerInterface,
  type PolygonState,
} from '@mapconductor/js-sdk-core';
import type { Coordinate, LineFeature, PolygonFeature } from '../helpers';
import { TomTomMapViewHolder } from '../TomTomMapViewHolder';
import {
  TomTomPolygonLayer,
  type TomTomActualPolygon,
} from './TomTomPolygonLayer';

export class TomTomPolygonOverlayRenderer extends AbstractPolygonOverlayRenderer<
  TomTomMapViewHolder,
  TomTomActualPolygon
> {
  readonly layer: TomTomPolygonLayer;
  readonly polygonManager: PolygonManagerInterface<TomTomActualPolygon>;

  constructor({
    layer,
    polygonManager,
    holder,
  }: {
    layer: TomTomPolygonLayer;
    polygonManager: PolygonManagerInterface<TomTomActualPolygon>;
    holder: TomTomMapViewHolder;
  }) {
    super(holder);
    this.layer = layer;
    this.polygonManager = polygonManager;
  }

  async createPolygon(state: PolygonState): Promise<TomTomActualPolygon | null> {
    if (state.points.length < 3) return null;
    return createTomTomPolygon(state);
  }

  async updatePolygonProperties({
    current,
  }: {
    polygon: TomTomActualPolygon;
    current: PolygonEntity<TomTomActualPolygon>;
    prev: PolygonEntity<TomTomActualPolygon>;
  }): Promise<TomTomActualPolygon | null> {
    return this.createPolygon(current.state);
  }

  async removePolygon(_entity: PolygonEntity<TomTomActualPolygon>): Promise<void> {
    // The source is rewritten from the remaining manager entities in onPostProcess().
  }

  override async onPostProcess(): Promise<void> {
    this.layer.draw(this.polygonManager.allEntities());
  }
}

function createTomTomPolygon(state: PolygonState): TomTomActualPolygon {
  // Unwrapped rings (longitudes continuous, may exceed ±180): TomTom GL renders
  // them seamlessly across the antimeridian, so the outer ring is never split
  // and ALL holes can always be included.
  const { outerRings, holeRings } = buildUnwrappedPolygonRings(
    state.points,
    state.holes,
    state.geodesic,
  );
  if (outerRings.length === 0) return { fillFeatures: [], outlineFeatures: [] };

  const outer = closeCoordinates(outerRings[0]);
  if (outer.length < 4) return { fillFeatures: [], outlineFeatures: [] };
  const holes = holeRings
    .map((hole) => closeCoordinates(hole))
    .filter((hole) => hole.length >= 4);

  const fillFeatures: PolygonFeature[] = [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [outer, ...holes],
      },
      properties: {
        id: state.id,
        [TomTomPolygonLayer.Prop.FILL_COLOR]: state.fillColor,
        [TomTomPolygonLayer.Prop.Z_INDEX]: state.zIndex,
      },
    },
  ];

  // 外周リングと各穴リングをそれぞれ stroke する。
  // android-sdk の TomTomPolygonOverlayRenderer.kt も外周＋全ての穴を stroke しており、
  // 外周だけだと穴の輪郭が描かれない。
  const outlineRings: Coordinate[][] = [outer, ...holes];
  const outlineFeatures: LineFeature[] = outlineRings.map((ring, index) => ({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: ring,
    },
    properties: {
      id: index === 0 ? `outline-${state.id}` : `outline-${state.id}-hole-${index - 1}`,
      [TomTomPolygonLayer.Prop.STROKE_COLOR]: state.strokeColor,
      [TomTomPolygonLayer.Prop.STROKE_WIDTH]: state.strokeWidth,
      [TomTomPolygonLayer.Prop.Z_INDEX]: state.zIndex,
    },
  }));

  return { fillFeatures, outlineFeatures };
}

function closeCoordinates(points: GeoPoint[]): Coordinate[] {
  if (points.length === 0) return [];
  const coordinates = points.map(toCoordinate);
  if (!sameCoordinate(coordinates[0], coordinates[coordinates.length - 1])) {
    coordinates.push(coordinates[0]);
  }
  return coordinates;
}

function toCoordinate(point: GeoPoint): Coordinate {
  return [point.longitude, point.latitude];
}

function sameCoordinate(a: Coordinate, b: Coordinate): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
