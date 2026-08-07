import { AbstractZoomAltitudeConverter } from '@mapconductor/js-sdk-core';

/**
 * Zoom conversion between MapConductor's unified zoom (Google Maps 2D reference)
 * and the TomTom Orbis map's native MapLibre zoom.
 *
 * TomTom Orbis on web renders through MapLibre GL JS — the same Web Mercator
 * engine as the MapLibre web provider — so its zoom relates to Google Maps 2D
 * by the same constant offset MapLibre/Mapbox web use (~1.0), independent of
 * latitude. (This differs from android's TomTom SDK, whose ground-scale zoom
 * needed a latitude-dependent 1.76 offset — that native SDK is not what runs on
 * web.) The latitude parameter is kept on the API for signature symmetry with
 * the other converters and is not used by the constant Web-Mercator offset.
 */
export class ZoomAltitudeConverter extends AbstractZoomAltitudeConverter {
    /** Empirical offset: GoogleZoom ≈ TomTom(MapLibre).zoom + 1.0, matching the MapLibre web provider. */
    static readonly TOMTOM_TO_GOOGLE_ZOOM_OFFSET = 1.0;

    /** Google↔TomTom zoom offset (googleZoom − tomtomZoom). Constant (Web Mercator). */
    static zoomOffsetAt(_latitude: number): number {
        return ZoomAltitudeConverter.TOMTOM_TO_GOOGLE_ZOOM_OFFSET;
    }

    static tomtomZoomToGoogleZoom(tomtomZoom: number, latitude: number): number {
        const google = tomtomZoom + ZoomAltitudeConverter.zoomOffsetAt(latitude);
        return Math.min(Math.max(google, AbstractZoomAltitudeConverter.MIN_ZOOM_LEVEL), AbstractZoomAltitudeConverter.MAX_ZOOM_LEVEL);
    }

    static googleZoomToTomTomZoom(googleZoom: number, latitude: number): number {
        const tomtom = googleZoom - ZoomAltitudeConverter.zoomOffsetAt(latitude);
        return Math.min(Math.max(tomtom, AbstractZoomAltitudeConverter.MIN_ZOOM_LEVEL), AbstractZoomAltitudeConverter.MAX_ZOOM_LEVEL);
    }

    private cosLatitudeFactor(latitude: number): number {
        const clamped = Math.max(-85, Math.min(85, latitude));
        const latRad = (clamped * Math.PI) / 180;
        return Math.max(AbstractZoomAltitudeConverter.MIN_COS_LAT, Math.abs(Math.cos(latRad)));
    }

    private cosTiltFactor(tilt: number): number {
        const clamped = Math.max(0, Math.min(90, tilt));
        const tiltRad = (clamped * Math.PI) / 180;
        return Math.max(AbstractZoomAltitudeConverter.MIN_COS_TILT, Math.cos(tiltRad));
    }

    zoomLevelToAltitude({
        zoomLevel,
        latitude,
        tilt,
    }: {
        zoomLevel: number;
        latitude: number;
        tilt: number;
    }): number {
        // Convert the TomTom native zoom to its Google equivalent (latitude-dependent)
        // before the Web Mercator scale calculation.
        const googleZoom = ZoomAltitudeConverter.tomtomZoomToGoogleZoom(zoomLevel, latitude);
        const cosLat = this.cosLatitudeFactor(latitude);
        const cosTilt = this.cosTiltFactor(tilt);
        const distance = (this.zoom0Altitude * cosLat) / Math.pow(AbstractZoomAltitudeConverter.ZOOM_FACTOR, googleZoom);
        const altitude = distance * cosTilt;
        return Math.min(Math.max(altitude, AbstractZoomAltitudeConverter.MIN_ALTITUDE), AbstractZoomAltitudeConverter.MAX_ALTITUDE);
    }

    altitudeToZoomLevel({
        altitude,
        latitude,
        tilt,
    }: {
        altitude: number;
        latitude: number;
        tilt: number;
    }): number {
        const clampedAltitude = Math.min(Math.max(altitude, AbstractZoomAltitudeConverter.MIN_ALTITUDE), AbstractZoomAltitudeConverter.MAX_ALTITUDE);
        const cosLat = this.cosLatitudeFactor(latitude);
        const cosTilt = this.cosTiltFactor(tilt);
        const distance = clampedAltitude / cosTilt;
        const googleZoom = Math.log2((this.zoom0Altitude * cosLat) / distance);
        return ZoomAltitudeConverter.googleZoomToTomTomZoom(googleZoom, latitude);
    }
}
