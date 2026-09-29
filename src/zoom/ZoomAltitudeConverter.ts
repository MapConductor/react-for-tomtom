import { AbstractZoomAltitudeConverter, WebMercatorZoomAltitudeConverter } from '@mapconductor/js-sdk-core';

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
export class ZoomAltitudeConverter extends WebMercatorZoomAltitudeConverter {
    /** Empirical offset: GoogleZoom ≈ TomTom(MapLibre).zoom + 1.0, matching the MapLibre web provider. */
    static readonly TOMTOM_TO_GOOGLE_ZOOM_OFFSET = 1.0;

    constructor(zoom0Altitude: number = AbstractZoomAltitudeConverter.DEFAULT_ZOOM0_ALTITUDE) {
        super(zoom0Altitude, ZoomAltitudeConverter.TOMTOM_TO_GOOGLE_ZOOM_OFFSET);
    }

    /**
     * Google↔TomTom zoom offset (googleZoom − tomtomZoom). Constant (Web Mercator).
     *
     * 緯度引数は他のコンバータと形を揃えるためだけに残してある。
     */
    static zoomOffsetAt(_latitude: number): number {
        return ZoomAltitudeConverter.TOMTOM_TO_GOOGLE_ZOOM_OFFSET;
    }

    static tomtomZoomToGoogleZoom(tomtomZoom: number, latitude: number): number {
        const google = tomtomZoom + ZoomAltitudeConverter.zoomOffsetAt(latitude);
        return Math.min(Math.max(google, AbstractZoomAltitudeConverter.MIN_ZOOM_LEVEL), AbstractZoomAltitudeConverter.MAX_ZOOM_LEVEL);
    }

    static googleZoomToTomTomZoom(googleZoom: number, latitude: number): number {
        // MIN/MAX_ZOOM_LEVEL は Google 系のズーム値。オフセットを引いた *あと* に
        // 当てると、Google 系の 0 がプロバイダ系の 0 へ潰れて戻ってこない
        // （読み戻しは +1 されるので 0 を指定したはずが 1 になる）。丸めるのは
        // 変換の前、値がまだ Google 系でいるあいだ。逆方向は変換してから丸めており、
        // そちらは元から Google 系どうしで正しい。
        const clamped = Math.min(
            Math.max(googleZoom, AbstractZoomAltitudeConverter.MIN_ZOOM_LEVEL),
            AbstractZoomAltitudeConverter.MAX_ZOOM_LEVEL,
        );
        return clamped - ZoomAltitudeConverter.zoomOffsetAt(latitude);
    }
}
