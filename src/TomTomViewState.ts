import {
  useState } from 'react';
import {
  MapViewState,
  type MapViewStateInterface,
  type MapCameraPosition,
  MapCameraPosition as MapCameraPositionNS,
  createRandomId,
} from '@mapconductor/js-sdk-core';
import { TomTomDesign, type TomTomMapDesignType } from './TomTomDesign';

export interface TomTomViewStateInterface
  extends MapViewStateInterface<TomTomMapDesignType> {
  /** TomTom API key (mapKey) used to initialize the Orbis map. */
  readonly apiKey: string;
}

export interface TomTomViewStateParams {
  id?: string;
  /** TomTom API key (mapKey). Required for the Orbis map/tiles to load. */
  apiKey?: string;
  mapDesignType?: TomTomMapDesignType;
  cameraPosition?: MapCameraPosition;
}

export class TomTomViewState
  extends MapViewState<TomTomMapDesignType>
  implements TomTomViewStateInterface {
  readonly apiKey: string;
  private _mapDesignType: TomTomMapDesignType;

  constructor({
    id = createRandomId(),
    apiKey = '',
    mapDesignType = TomTomDesign.Standard,
    cameraPosition = MapCameraPositionNS.Default,
  }: TomTomViewStateParams = {}) {
    super({ id, cameraPosition });
    this.apiKey = apiKey;
    this._mapDesignType = mapDesignType;
  }

  override get mapDesignType(): TomTomMapDesignType {
    return this._mapDesignType;
  }

  override set mapDesignType(value: TomTomMapDesignType) {
    this._mapDesignType = value;
  }

  // Called by TomTomView when controller is initialized

  // Called by TomTomView when camera position changes

  // If zoom/bearing/tilt are all 0, treat as position-only update (matches Android/iOS behavior)
}

export function useTomTomViewState(params: TomTomViewStateParams = {}): TomTomViewStateInterface {
  const [state] = useState(() => new TomTomViewState(params));
  return state;
}
