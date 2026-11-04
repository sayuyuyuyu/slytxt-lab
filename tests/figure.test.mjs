import assert from "node:assert/strict";
import test from "node:test";
import { figureFromParagraph } from "../src/lib/rehype-figure.mjs";

function img(properties) {
  return { type: "element", tagName: "img", properties, children: [] };
}
function p(children) {
  return { type: "element", tagName: "p", properties: {}, children };
}

test("figure: title 付き単独画像の段落が figure になる", () => {
  const node = p([img({ src: "/a.png", alt: "川の写真", title: "夕方の川" })]);
  const figure = figureFromParagraph(node);
  assert.equal(figure.tagName, "figure");
  assert.equal(figure.children[0].tagName, "img");
  assert.equal(figure.children[0].properties.alt, "川の写真");
  assert.equal(figure.children[0].properties.title, undefined);
  assert.equal(figure.children[1].tagName, "figcaption");
  assert.equal(figure.children[1].children[0].value, "夕方の川");
});

test("figure: 空白テキストに囲まれていても変換する", () => {
  const node = p([
    { type: "text", value: "\n" },
    img({ src: "/a.png", alt: "", title: "説明" }),
    { type: "text", value: "\n" }
  ]);
  assert.equal(figureFromParagraph(node)?.tagName, "figure");
});

test("figure: 対象でないものは触らない", () => {
  // title が無い
  assert.equal(figureFromParagraph(p([img({ src: "/a.png", alt: "x" })])), null);
  // 文中の画像（テキストと混在）
  assert.equal(
    figureFromParagraph(
      p([{ type: "text", value: "前 " }, img({ src: "/a.png", alt: "", title: "t" })])
    ),
    null
  );
  // 段落でない
  assert.equal(
    figureFromParagraph({ type: "element", tagName: "div", properties: {}, children: [] }),
    null
  );
});
