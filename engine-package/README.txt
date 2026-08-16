変則将棋AI Material版 Windows x64
=================================

このフォルダーの実行ファイルは、Web版と同じ「持ち駒3枚で負け」の探索ルールと、
居玉・攻撃重視v3までの変更後評価を組み込んだYaneuraOu Material版です。
評価ファイルは不要です。

ShogiGUIでの登録
----------------
1. 「ツール」→「エンジン設定」からエンジンを追加します。
2. 通常は HensokuShogi-Material-AVX2.exe を選びます。
3. AVX2非対応の古いPCでは HensokuShogi-Material-SSE42.exe を選びます。
4. これまでのYaneuraOu release Material x64とは別のエンジンとして登録してください。

VariantPawnEval、VariantAttackEval、VariantHomeAttackEvalはすべて既定でtrueです。
そのため、ShogiGUIから特別な設定をしなくても現在のWeb版と同じ評価項目が有効です。

注意
----
既存の公式YaneuraOu実行ファイル自体を、Web側から自動的に変更することはできません。
変更後評価で検討するときは、このフォルダーの実行ファイルを選択してください。

ソース: https://github.com/takecha20020710/hensoku-shogi-web
YaneuraOuはGNU General Public License v3.0で公開されています。
