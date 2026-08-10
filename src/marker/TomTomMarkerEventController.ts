import { DefaultMarkerEventController, type MarkerEventHost } from '@mapconductor/js-sdk-core';
import { TomTomMarkerController } from './TomTomMarkerController';
import { type TomTomActualMarker } from './MarkerLayer';

/**
 * TomTom のマーカーイベント。
 *
 * ドラッグの状態遷移・パン抑止・リスナー転送はすべてコアの
 * {@link DefaultMarkerEventController} が持つ。ここに残るのは
 * **TomTom 固有のもの**だけ——いまは何も無い。
 *
 * 移行前はこのファイルが 165 行あり、maplibre / mapbox / maptiler / tomtom / longdo の
 * 5 本が**型名以外 1 文字も違わなかった**。
 */
export class TomTomMarkerEventController extends DefaultMarkerEventController<TomTomActualMarker> {
    constructor(controller: TomTomMarkerController) {
        super(controller as unknown as MarkerEventHost<TomTomActualMarker>);
    }
}
