import { expect, it } from "vitest";
import { alignChineseSense, parseChineseOpenWordnetXml, scoreChineseLemma } from "./sense-alignment.mjs";

it("parses Chinese lemmas and joins them to ILI identifiers", () => {
  const xml = `
    <LexicalEntry id="entry-a"><Lemma writtenForm="有关系" partOfSpeech="v" /><Sense id="sense-a" synset="cmn-a" /></LexicalEntry>
    <LexicalEntry id="entry-b"><Lemma writtenForm="相关" partOfSpeech="v" /><Sense id="sense-b" synset="cmn-a" /></LexicalEntry>
    <Synset id="cmn-a" ili="i34896" partOfSpeech="v" members="sense-a sense-b" />`;
  expect(parseChineseOpenWordnetXml(xml).get("i34896")).toEqual(["有关系", "相关"]);
});

it("requires an unambiguous direct Chinese match before verification", () => {
  const candidates = [
    { id: "agree-a", synset: "a" },
    { id: "agree-b", synset: "b" },
  ];
  const synsets = new Map([
    ["a", { ili: "i-a", definition: ["first"] }],
    ["b", { ili: "i-b", definition: ["second"] }],
  ]);
  const chinese = new Map([["i-a", ["同意"]], ["i-b", ["同意"]]]);
  const result = alignChineseSense("同意", candidates, synsets, chinese);
  expect(result.state).toBe("candidate");
  expect(result.margin).toBe(0);
});

it("does not auto-verify a single-character Chinese lemma", () => {
  const candidates = [{ id: "give", synset: "give" }];
  const synsets = new Map([["give", { ili: "i-give", definition: ["transfer possession"] }]]);
  const chinese = new Map([["i-give", ["给"]]]);
  const result = alignChineseSense("给", candidates, synsets, chinese);
  expect(result.state).toBe("candidate");
  expect(result.score).toBe(1);
});

it("does not treat a negated gloss as a match for its positive lemma", () => {
  const result = scoreChineseLemma("不重要的", "重要的");
  expect(result.direct).toBe(false);
  expect(result.matchType).toBe("polarity-conflict");
});

it("count importance selects the right ILI but stays candidate without a direct lexical match", () => {
  const candidates = [
    { id: "count%2:32:00::", synset: "numeric" },
    { id: "count%2:42:00::", synset: "importance" },
  ];
  const synsets = new Map([
    ["numeric", { ili: "i-numeric", definition: ["determine the number or amount of"] }],
    ["importance", { ili: "i34896", definition: ["have weight; have import, carry weight"] }],
  ]);
  const chinese = new Map([["i-numeric", ["计数", "计算"]], ["i34896", ["有关系"]]]);
  const result = alignChineseSense("有重要性", candidates, synsets, chinese);
  expect(result.ili).toBe("i34896");
  expect(result.reference.id).toBe("count%2:42:00::");
  expect(result.state).toBe("candidate");
});
