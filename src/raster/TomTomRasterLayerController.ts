import {
  createRasterLayerEntity,
  RasterLayerController,
  RasterLayerManager,
  type RasterHeaderSupport,
} from '@mapconductor/js-sdk-core';
import {
  type TomTomRasterLayerHandle,
  TomTomRasterLayerOverlayRenderer,
} from './TomTomRasterLayerOverlayRenderer';

/**
 * android-sdk の TomTomRasterLayerController と同じく汎用 RasterLayerController の薄い
 * サブクラス。composition/update/has/clear は基底クラスが提供する。GL スタイルが
 * 再読み込みされると既存のソース・レイヤーは失われるため、resync() で登録済みの
 * ラスターレイヤーを貼り直す（android-sdk の reapplyStyle 相当）。
 */
export class TomTomRasterLayerController extends RasterLayerController<TomTomRasterLayerHandle> {
  /**
   * 地図は TomTom の SDK ラッパが生成し、transformRequest も SDK 側が握っている。
   * こちらから差すと SDK の認証経路を壊しかねないので触っていない。
   *
   * userAgent はブラウザが上書きを許さないので、どのプロバイダでも web では効かない。
   */
  protected override get headerSupport(): RasterHeaderSupport {
    return { provider: 'TomTom', extraHeaders: false };
  }

  constructor(renderer: TomTomRasterLayerOverlayRenderer) {
    super({ rasterLayerManager: new RasterLayerManager<TomTomRasterLayerHandle>(), renderer });
  }

  async resync(): Promise<void> {
    const states = this.rasterLayerManager.allEntities().map((entity) => entity.state);
    if (states.length === 0) return;
    const layers = await this.renderer.onAdd(states.map((state) => ({ state })));
    layers.forEach((layer, index) => {
      if (layer != null) {
        this.rasterLayerManager.registerEntity(
          createRasterLayerEntity({ layer, state: states[index] }),
        );
      }
    });
    await this.renderer.onPostProcess();
  }
}
