# 変則将棋AI Web版

「自分の持ち駒が3枚になったら負け」という変則ルールを、ブラウザでYaneuraOuと対局・検討できるWebアプリです。

## 実装済み

- 9×9盤、駒移動、駒取り、持ち駒、駒打ち、成り・不成
- 二歩、行き所のない駒、打ち歩詰め、王手放置の禁止
- 持ち駒3枚による変則勝敗
- ユーザーの先手・後手選択
- パスワード付き検討モード
- 最善手・次善手・第3候補
- 検討開始／停止、1手戻る／進む
- スマートフォン対応

## 公開方式

`render.yaml`を利用するRender Blueprintです。Dockerのビルド中にYaneuraOu 9.70gitのMaterial版へ持ち駒3枚ルールの探索パッチを適用し、Linux向けにコンパイルします。

秘密の値はコードへ書かず、Renderの画面で設定します。

- `ANALYSIS_PASSWORD`: 検討モード用パスワード
- `SECRET_KEY`: Renderが自動生成

## ローカル確認（開発者向け）

Dockerが使える環境では、イメージをビルドしてポート10000で起動できます。`ANALYSIS_PASSWORD`と`SECRET_KEY`は起動時の環境変数として渡してください。

## ライセンスと第三者ソフトウェア

思考エンジンとして[YaneuraOu](https://github.com/yaneurao/YaneuraOu)を使用します。YaneuraOuはGPLv3で公開されています。詳細は`THIRD_PARTY_NOTICES.md`を参照してください。
