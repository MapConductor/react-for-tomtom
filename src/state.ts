// React Native から安全に読める入口。地図の描画実装（`TomTomView.web`）を含まない。
//
// ルートの barrel は `@tomtom-org/maps-sdk` を実行時に引き込む。ブラウザ向け
// バンドラなら問題ないが、Metro/Hermes はこれを即時評価するため、React Native に
// 存在しないブラウザのグローバル（window / document）で落ちる。
// `@mapconductor/reactnative-for-tomtom` はルートではなくここから import する。
// react-for-longdo / react-for-maplibre / react-for-arcgis の state.ts と同じ取り決め。
//
// ここから出す 2 つは web SDK を**型としてしか**参照しないので、実行時には何も
// 引き込まない（`TomTomDesign` の `StyleInput` は `import type`）。
export { TomTomDesign, type TomTomMapDesignType } from './TomTomDesign';
export {
  TomTomViewState,
  useTomTomViewState,
  type TomTomViewStateInterface,
  type TomTomViewStateParams,
} from './TomTomViewState';
